import csv
import hashlib
import io
import json
import logging
import zipfile
from datetime import timezone as utc_zone
from pathlib import Path
from tempfile import SpooledTemporaryFile

from django.conf import settings
from django.db.models.expressions import RawSQL
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.models import Company, CompanyRegistryCheck
from shared.db import atomic
from shared.utils.typed_data import DOMAIN_NAME, DOMAIN_VERSION
from tokens.constants import COMPANY_PACK_SPOOL_BYTES
from tokens.exceptions import RegisterIntegrityError, SettlementContextChanged
from tokens.models import (
    RegisterEntry,
    RegisterExport,
    RegisterExportKind,
    ShareRegister,
    ShareToken,
    TokenDeployment,
)
from tokens.services.register import (
    REGISTER_HEADERS,
    _sheet,
    _snapshot,
    _stored_register,
)
from tokens.services.settlement_context import configured_domain
from users.models import UserProfile
from whitelist.models import WhitelistApproval, WhitelistChange

logger = logging.getLogger(__name__)

PACK_FORMAT = "ledova-company-pack"
PACK_VERSION = 1
MANIFEST = "manifest.json"
README = "README.md"
ARCHIVE_EPOCH = (1980, 1, 1, 0, 0, 0)
EMPTY_HEAD = "0" * 64
PREIMAGE = RawSQL("tokens_register_entry_preimage(tokens_registerentry)", [])
INTERFACES = ("AtomicSwap", "ShareToken", "ShareTokenFactory", "WhitelistRegistry")
COMPILER = {
    "solidity": "0.8.24",
    "evm_version": "paris",
    "optimizer_runs": 200,
    "via_ir": True,
    "openzeppelin": "5.4.0",
}


def _json(value) -> bytes:
    return (
        json.dumps(
            value,
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
            default=lambda item: item.isoformat() if hasattr(item, "isoformat") else str(item),
        )
        + "\n"
    ).encode()


def _digest(content) -> str:
    return hashlib.sha256(content).hexdigest()


def _company(company) -> dict:
    owner = UserProfile.objects.filter(user_id=company.owner_id).values_list("full_name", flat=True).first()
    return {
        "uuid": company.pk,
        "name": company.name,
        "trading_name": company.trading_name,
        "type": company.company_type,
        "acn": company.acn,
        "abn": company.abn,
        "status": company.status,
        "phone": company.phone,
        "address": {
            "line_1": company.address_line_1,
            "line_2": company.address_line_2,
            "city": company.city,
            "state": company.state,
            "postcode": company.postcode,
            "country": company.country,
        },
        "owner_name": owner or "",
        "declarant_name": company.declarant_name,
        "board_resolution_reference": company.board_resolution_reference,
        "registry_status": company.registry_status,
        "registry_checks": list(
            CompanyRegistryCheck.objects.filter(company=company)
            .order_by("started_at", "uuid")
            .values(
                "purpose",
                "status",
                "reason",
                "started_at",
                "completed_at",
                "requested_name",
                "requested_acn",
                "requested_abn",
                "registry_acn",
                "registry_abn",
                "entity_name",
                "entity_type",
                "entity_status",
                "effective_from",
                "retrieved_at",
                "register_updated_at",
            )
        ),
    }


def _entry(token, entry) -> dict:
    if _digest(entry.preimage.encode()) != entry.entry_hash:
        logger.error("Register entry %s of share class %s does not match its hash", entry.pk, token.pk)
        raise RegisterIntegrityError(
            f"Entry {entry.sequence} of {token.symbol}'s register does not match its hash, so no pack was produced. "
            "Run the register integrity verifier for this share class before producing a pack."
        )
    return {
        "sequence": entry.sequence,
        "uuid": entry.pk,
        "register": entry.register_id,
        "operation_id": entry.operation_id,
        "kind": entry.kind,
        "effective_on": entry.effective_on,
        "changes": entry.changes,
        "corrects": entry.corrects_id,
        "previous_hash": entry.previous_hash,
        "created_at": entry.created_at.astimezone(utc_zone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "entry_hash": entry.entry_hash,
        "preimage": entry.preimage,
    }


def _share_class(token) -> dict:
    register = ShareRegister.objects.filter(token=token).first()
    stored = _stored_register(token)
    entries = (
        []
        if register is None
        else [
            _entry(token, entry)
            for entry in RegisterEntry.objects.filter(register=register)
            .annotate(preimage=PREIMAGE)
            .order_by("sequence")
        ]
    )
    folder = f"classes/{token.pk}"
    files = {
        f"{folder}/class.json": _json(
            {
                "uuid": token.pk,
                "name": token.name,
                "symbol": token.symbol,
                "type": token.token_type,
                "authorised_shares": token.total_supply,
                "status": token.status,
                "transferable": token.is_transferable,
                "chain": token.chain,
                "contract_address": token.contract_address,
                "deployment_tx_hash": token.deployment_tx_hash,
                "deployed_at": token.deployed_at,
                "register": (
                    None
                    if register is None
                    else {
                        "uuid": register.pk,
                        "sequence": register.sequence,
                        "head_hash": register.head_hash,
                        "issued_supply": str(int(register.issued_supply)),
                    }
                ),
            }
        ),
        f"{folder}/entries.json": _json(entries),
    }
    if stored is not None:
        sheet = io.StringIO()
        csv.writer(sheet).writerows([REGISTER_HEADERS, *_sheet(token, stored)])
        files[f"{folder}/register.csv"] = sheet.getvalue().encode()
    return {
        "token": token,
        "files": files,
        "sequence": 0 if register is None else register.sequence,
        "head_hash": EMPTY_HEAD if register is None else register.head_hash,
        "member_rows": 0 if stored is None else len(stored["rows"]),
        "former_rows": 0 if stored is None else len(stored["former_members"]),
    }


def _swap_domain():
    try:
        return configured_domain()
    except SettlementContextChanged:
        return None


def _contracts(company, tokens) -> dict:
    chain_id = settings.BLOCKCHAIN_CHAIN_ID
    owners = {
        deployment.token_id: deployment.intent.get("sender")
        for deployment in TokenDeployment.objects.filter(token_id__in=[token.pk for token in tokens])
    }
    registries = set(WhitelistApproval.objects.filter(company=company).values_list("registry_address", flat=True))
    registries |= set(WhitelistChange.objects.filter(company_id=company.pk).values_list("registry_address", flat=True))
    return {
        "chain_id": chain_id,
        "compiler": COMPILER,
        "factory": {
            "address": settings.SHARE_TOKEN_FACTORY_ADDRESS or None,
            "interface": "contracts/ShareTokenFactory.json",
        },
        "swap": {
            "address": settings.ATOMIC_SWAP_ADDRESS or None,
            "interface": "contracts/AtomicSwap.json",
            "domain": _swap_domain(),
        },
        "registries": [
            {"address": address, "interface": "contracts/WhitelistRegistry.json"} for address in sorted(registries)
        ],
        "classes": [
            {
                "class": token.pk,
                "symbol": token.symbol,
                "address": token.contract_address,
                "owner_at_deployment": owners.get(token.pk),
                "interface": "contracts/ShareToken.json",
                "domain": (
                    None
                    if not token.contract_address
                    else {
                        "name": DOMAIN_NAME,
                        "version": DOMAIN_VERSION,
                        "chainId": chain_id,
                        "verifyingContract": token.contract_address,
                    }
                ),
            }
            for token in tokens
        ],
    }


def _archive(files):
    archive = SpooledTemporaryFile(max_size=COMPANY_PACK_SPOOL_BYTES)
    with zipfile.ZipFile(archive, "w") as bundle:
        for path, content in sorted(files.items()):
            member = zipfile.ZipInfo(path, date_time=ARCHIVE_EPOCH)
            member.compress_type = zipfile.ZIP_DEFLATED
            member.external_attr = 0o644 << 16
            bundle.writestr(member, content)
    archive.seek(0)
    return archive


def _record(classes, requested_by, digest, instruction, recipient):
    with atomic():
        RegisterExport.objects.bulk_create(
            RegisterExport(
                token=share_class["token"],
                requested_by_id=requested_by.pk,
                kind=RegisterExportKind.COMPANY_PACK,
                register_sequence=share_class["sequence"],
                member_rows=share_class["member_rows"],
                former_rows=share_class["former_rows"],
                digest=digest,
                instruction=instruction,
                recipient=recipient,
            )
            for share_class in classes
        )


def produce_company_pack(company, requested_by, *, instruction, recipient):
    with _snapshot():
        as_at = timezone.now().astimezone(utc_zone.utc)
        company = Company.objects.get(pk=company.pk)
        tokens = list(ShareToken.objects.filter(company=company).order_by("symbol", "uuid"))
        if not tokens:
            raise ValidationError("This company has no share classes, so there is no register to put in a pack.")
        classes = [_share_class(token) for token in tokens]
        record = _company(company)
        contracts = _contracts(company, tokens)
    files = {"company.json": _json(record), "contracts/contracts.json": _json(contracts)}
    for name in INTERFACES:
        files[f"contracts/{name}.json"] = (Path(settings.BASE_DIR) / "contracts" / f"{name}.json").read_bytes()
    for share_class in classes:
        files.update(share_class["files"])
    files[README] = render_to_string(
        "tokens/company_pack_readme.md",
        {
            "company": company,
            "as_at": as_at.isoformat(),
            "instruction": instruction,
            "recipient": recipient,
            "classes": classes,
            "contracts": contracts,
        },
    ).encode()
    manifest = _json(
        {
            "format": PACK_FORMAT,
            "version": PACK_VERSION,
            "company": {"uuid": company.pk, "name": company.name, "acn": company.acn},
            "as_at": as_at,
            "instruction": instruction,
            "recipient": recipient,
            "registers": [
                {
                    "class": share_class["token"].pk,
                    "symbol": share_class["token"].symbol,
                    "sequence": share_class["sequence"],
                    "head_hash": share_class["head_hash"],
                }
                for share_class in classes
            ],
            "files": [
                {"path": path, "size": len(content), "sha256": _digest(content)}
                for path, content in sorted(files.items())
            ],
        }
    )
    archive = _archive({**files, MANIFEST: manifest})
    digest = _digest(manifest)
    _record(classes, requested_by, digest, instruction, recipient)
    return archive, f"company-pack-{company.acn}-{as_at:%Y%m%dT%H%M%SZ}.zip"
