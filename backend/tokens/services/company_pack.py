import csv
import hashlib
import io
import json
import logging
import zipfile
from datetime import timezone as utc_zone
from decimal import Decimal
from pathlib import Path
from tempfile import SpooledTemporaryFile
from uuid import UUID

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
    ShareTokenStatus,
)
from tokens.services import company_pack_chain as chain
from tokens.services import company_pack_documents as documents
from tokens.services import company_pack_history as history
from tokens.services.register import (
    REGISTER_HEADERS,
    _sheet,
    _snapshot,
    _stored_register,
    outputs_due,
)
from tokens.services.settlement_context import configured_domain
from users.models import UserProfile

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
UNRESOLVED = {
    "deployment": ("deploying",),
    "issuance": ("queued", "executing"),
    "capital_increase": ("executing",),
    "pause": ("pending", "executing"),
    "swap_approval": ("pending", "executing"),
    "settlement": ("executing",),
    "approval_change": ("pending", "executing"),
}


def _plain(item):
    if hasattr(item, "isoformat"):
        return item.isoformat()
    if isinstance(item, (UUID, Decimal)):
        return str(item)
    raise TypeError(f"A {type(item).__name__} value is not written into a company pack.")


def _json(value) -> bytes:
    return (
        json.dumps(
            value,
            indent=2,
            sort_keys=True,
            ensure_ascii=False,
            default=_plain,
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


def _share_class(company, token, outputs) -> dict:
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
    authority = history.authority_records(company, token)
    issues = history.issues(company, token)
    waiting = history.waiting(token)
    former = history.former_members(stored)
    due = history.due(outputs, token)
    cap_increases = history.cap_increases(company, token)
    pauses = history.pauses(company, token)
    deployment = chain.deployment(company, token)
    settlements = chain.settlements(company, token)
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
                "cap_increases": cap_increases,
                "pauses": pauses,
            }
        ),
        f"{folder}/entries.json": _json(entries),
        f"{folder}/chain.json": _json({"deployment": deployment, "operations": chain.operations(company, token)}),
        f"{folder}/settlements.json": _json(settlements),
        f"{folder}/authority.json": _json(history.authority(authority)),
        f"{folder}/issues.json": _json(issues),
        f"{folder}/former_members.json": _json(former),
        f"{folder}/reconciliations.json": _json(history.reconciliations(token)),
        f"{folder}/waiting.json": _json(waiting),
        f"{folder}/due.json": _json(due),
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
        "waiting": waiting["effects"],
        "awaiting_allotment": issues["awaiting_allotment"],
        "former": former,
        "due": due,
        "deployment": deployment,
        "unresolved": _unresolved(token, deployment, issues, cap_increases, pauses, settlements),
        "evidence": [record for records in authority.values() for record in records],
    }


def _unresolved(token, deployment, issues, cap_increases, pauses, settlements):
    records = [
        ("deployment", None if deployment is None else deployment["uuid"], token.status),
        *(
            ("issuance", issue["execution"]["uuid"], issue["execution"]["status"])
            for issue in issues["issues"]
            if issue["execution"] is not None
        ),
        *(("capital_increase", increase["uuid"], increase["status"]) for increase in cap_increases),
        *(("pause", pause["uuid"], pause["status"]) for pause in pauses),
        *(("settlement", settlement["uuid"], settlement["status"]) for settlement in settlements),
    ]
    if deployment is not None:
        records.append(("swap_approval", deployment["uuid"], deployment["swap_approval"]["outcome"]))
    return [
        {"symbol": token.symbol, "purpose": purpose, "record": record, "status": status}
        for purpose, record, status in records
        if status in UNRESOLVED[purpose]
    ]


def _swap_domain():
    try:
        return configured_domain()
    except SettlementContextChanged:
        return None


def _owner(deployment):
    return None if deployment is None else deployment["intent"].get("sender")


def _approved_on(deployment):
    intent = None if deployment is None else deployment["swap_approval"]["intent"]
    return None if intent is None else intent.get("to")


def _class_contract(share_class, chain_id) -> dict:
    token, deployment = share_class["token"], share_class["deployment"]
    return {
        "class": token.pk,
        "symbol": token.symbol,
        "address": token.contract_address,
        "owner_at_deployment": _owner(deployment),
        "approved_on": _approved_on(deployment),
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


def _registry_owner(classes):
    owners = {_owner(share_class["deployment"]) for share_class in classes if share_class["token"].contract_address}
    owners.discard(None)
    return owners.pop() if len(owners) == 1 else None


def _contracts(classes, registries) -> dict:
    chain_id = settings.BLOCKCHAIN_CHAIN_ID
    owner = _registry_owner(classes)
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
            {
                "address": address,
                "interface": "contracts/WhitelistRegistry.json",
                "owner": owner,
            }
            for address in registries
        ],
        "classes": [_class_contract(share_class, chain_id) for share_class in classes],
    }


def _member(path):
    member = zipfile.ZipInfo(path, date_time=ARCHIVE_EPOCH)
    member.compress_type = zipfile.ZIP_DEFLATED
    member.external_attr = 0o644 << 16
    return member


def _archive(files, stored, manifest):
    archive = SpooledTemporaryFile(max_size=COMPANY_PACK_SPOOL_BYTES)
    listed = []
    with zipfile.ZipFile(archive, "w") as bundle:
        for path in sorted({*files, *stored}):
            if path in files:
                bundle.writestr(_member(path), files[path])
                size, digest = len(files[path]), _digest(files[path])
            else:
                with bundle.open(_member(path), "w") as target:
                    size, digest = documents.carry(stored[path], target)
            listed.append({"path": path, "size": size, "sha256": digest})
        manifest = _json({**manifest, "files": listed})
        bundle.writestr(_member(MANIFEST), manifest)
    archive.seek(0)
    return archive, manifest


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
        outputs = outputs_due(company=company)
        classes = [_share_class(company, token, outputs) for token in tokens]
        record = _company(company)
        approvals = history.approvals(company, as_at)
        links = history.link_records(company)
        wallet_links = history.wallet_links(links)
        listed, held = documents.held(company)
        copies = documents.evidence([*links, *(item for share_class in classes for item in share_class["evidence"])])
        contracts = _contracts(classes, approvals["registries"])
    stored = {**held, **copies}
    documents.within_ceiling(company, stored)
    files = {
        "company.json": _json(record),
        "approvals.json": _json(approvals),
        "wallet_links.json": _json(wallet_links),
        "documents.json": _json(listed),
        "contracts/contracts.json": _json(contracts),
    }
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
            "approvals": approvals["approvals"],
            "documents": listed,
            "copies": len(copies),
            "paused": any(share_class["token"].status == ShareTokenStatus.PAUSED for share_class in classes),
            "former": any(share_class["former"] for share_class in classes),
            "due": any(share_class["due"] for share_class in classes),
            "unresolved": [
                *(row for share_class in classes for row in share_class["unresolved"]),
                *(
                    {"symbol": None, "purpose": "approval_change", "record": change["uuid"], "status": change["status"]}
                    for change in approvals["changes"]
                    if change["status"] in UNRESOLVED["approval_change"]
                ),
            ],
        },
    ).encode()
    archive, manifest = _archive(
        files,
        stored,
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
        },
    )
    digest = _digest(manifest)
    _record(classes, requested_by, digest, instruction, recipient)
    return archive, f"company-pack-{company.acn}-{as_at:%Y%m%dT%H%M%SZ}.zip"
