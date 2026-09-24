import ast
import csv
import hashlib
import importlib
import io
import json
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from datetime import timezone as utc_zone
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.base import ContentFile
from django.db import DatabaseError, IntegrityError, connections
from django.db.models.expressions import RawSQL
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyDocument,
    CompanyPack,
    CompanyRegistryCheck,
    DocumentType,
)
from companies.services.document_review import prepare_document_review, verify_document
from documents.models import Document
from offerings.models import Subscription, SubscriptionStatus
from shared.db import atomic, current_alias, use_operator
from shared.models import Country
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from tokens.constants import STATUTORY_CALENDAR
from tokens.models import (
    CapitalIncreaseRequest,
    FormerHolder,
    IssuanceStatus,
    PauseChange,
    RegisterAcknowledgement,
    RegisterEntry,
    RegisterExport,
    RegisterInstruction,
    RegisterReconciliation,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
    TokenDeployment,
    TransferOrder,
)
from tokens.models.choices import TransferOrderType
from tokens.services.company_pack import COMPILER, produce_company_pack
from tokens.services.register import REGISTER_HEADERS, export_rows, months_after
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction_review,
    submit_correction,
)
from tokens.services.register_events import open_register, record_entry
from tokens.services.register_instructions import (
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.services.register_openings import (
    decide_link,
    prepare_link_review,
    submit_link,
)
from tokens.services.settlement_context import configured_domain
from tokens.tests.test_register_certificates import (
    entered,
    member_of,
    unused_address,
    wallet_of,
)
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_workflow_events import (
    SETTLEMENT,
    SettledTransferFixtures,
)
from tokens.tests.test_settlement_chain_agreement import factory_intent
from users.models import (
    FinancialProfile,
    InvestorClassification,
    UserAccount,
    UserProfile,
)
from wallets.models import Wallet
from whitelist.models import WhitelistApproval, WhitelistChange, WhitelistEntry

CONSUMER = Path(__file__).with_name("company_pack_consumer.py")
ISOLATED = ("-I", "-S")
PRODUCED_AT = datetime(2026, 9, 24, 1, 2, 3, 456789, tzinfo=utc_zone.utc)
RECORDED_AT = datetime(2026, 9, 21, 4, 5, 6, tzinfo=utc_zone.utc)
LAPSED_AT = datetime(2026, 9, 1, tzinfo=utc_zone.utc)
RENEWED_UNTIL = datetime(2027, 3, 1, tzinfo=utc_zone.utc)
INSTRUCTION = "SYNTHETIC-PACK-INSTRUCTION-1"
RECIPIENT = "Synthetic Successor Registry Pty Ltd"
OPERATOR = "0x" + "0e" * 20
ROLES = ("founder", "holder", "allottee", "buyer")
HOLDING_ROLES = ("founder", "holder", "buyer")
INTERFACES = ("AtomicSwap", "ShareToken", "ShareTokenFactory", "WhitelistRegistry")
CLASS_FILES = (
    "class.json",
    "entries.json",
    "authority.json",
    "issues.json",
    "former_members.json",
    "reconciliations.json",
    "waiting.json",
    "due.json",
)
SUBJECTS = ("allotment", "correction", "link")
REVIEW_PERMISSIONS = (
    "change_companydocument",
    "change_registercorrection",
    "view_registercorrection",
    "change_registerinstruction",
    "view_registerinstruction",
    "change_registerwalletlink",
    "view_registerwalletlink",
)
ALLOWED_IMPORTS = {"zipfile", "json", "csv", "hashlib", "io", "sys"}
LICENCE = (
    "The company, and a provider it names in writing, may use the records and the contract interface files in "
    "this pack to operate and move the company's own register and contracts."
)
PLATFORM_REFUSAL = "REFUSED django is importable, so this run could reach the platform: run it as python -I -S\n"


class Undone(Exception):
    pass


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def changes(*moves):
    return [{"member": str(member.pk), "shares": str(shares)} for member, shares in moves]


def pack_reviewer(label):
    reviewer = get_user_model().objects.create_user(
        email=f"{label}-reviewer@staff.example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(*Permission.objects.filter(codename__in=REVIEW_PERMISSIONS))
    UserProfile.objects.create(user=reviewer, full_name=f"Synthetic {label} reviewer")
    return reviewer


def evidence_of(label):
    return f"Synthetic {label} board resolution".encode()


def authority_document(company, label, reviewer):
    content = evidence_of(label)
    document = CompanyDocument.objects.create(
        company=company,
        document_type=DocumentType.OTHER,
        name=f"Synthetic {label} board resolution",
        file_size=len(content),
        mime_type="application/pdf",
    )
    document.file.save(f"{document.uuid}.pdf", ContentFile(content), save=True)
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    return verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)


def authority_terms(label, subject):
    return {
        "approving_director": f"Synthetic {label} director",
        "authority_reference": f"SYNTHETIC-{label.upper()}-{subject.upper()}",
        "reason": f"Synthetic {label} {subject}",
    }


def with_account_details(label, addresses):
    citizenship = Country.objects.create(code="SYC", name=f"Synthetic {label} citizenship")
    for index, role in enumerate(ROLES, 1):
        wallet = Wallet.objects.select_related("user_account__user_profile").get(address=addresses[role])
        profile = wallet.user_account.user_profile
        UserProfile.objects.filter(pk=profile.pk).update(
            phone_country_code="+61",
            phone_number=f"04915700{index:02d}",
            date_of_birth=date(1970 + index, index, 10 + index),
            citizenship_country=citizenship,
        )
        UserAccount.objects.filter(pk=wallet.user_account_id).update(account_number=f"MBR-{label}-{index}"[:20])
        FinancialProfile.objects.create(
            user_profile=profile,
            occupation=f"Synthetic {label} {role} occupation",
            source_of_funds_other_text=f"Synthetic {label} {role} funds",
        )


def allotted_subscription(tenant, reviewer, document, allottee, label):
    wallet = Wallet.objects.get(address=allottee)
    subscription = Subscription.objects.create(
        offering=tenant.offering,
        user_account_id=wallet.user_account_id,
        wallet=wallet,
        quantity=25,
        price_per_share=Decimal("2.50"),
        amount_due=Decimal("62.50"),
        status=SubscriptionStatus.PAID,
        reference=f"PAY-{label.upper()}",
        amount_received=Decimal("62.50"),
        payment_received_on=date(2026, 9, 18),
        payment_reference_seen=f"PAY-{label.upper()} deposit",
        payment_confirmed_by=reviewer,
        payment_confirmed_at=RECORDED_AT,
    )
    instruction = submit_instruction(
        actor=tenant.company.owner,
        operation_id=uuid4(),
        token_id=tenant.deployed_token.pk,
        document_id=document.pk,
        kind="issue",
        items=[{"subscription": str(subscription.pk), "recipient": allottee, "amount": "25"}],
        **authority_terms(label, "allotment"),
    )
    _, _, confirmation = prepare_instruction_review(proposal_id=instruction.pk, reviewer=reviewer)
    decide_instruction(proposal_id=instruction.pk, reviewer=reviewer, confirmation=confirmation, decision="apply")
    issuance = ShareIssuance.objects.create(
        token=tenant.deployed_token,
        recipient_address=allottee,
        recipient_name=f"Synthetic {label} allottee",
        amount="25",
        status=IssuanceStatus.COMPLETED,
        completed_at=RECORDED_AT,
        reason=f"Issuance request: Allotment of subscription PAY-{label.upper()}",
    )
    request = ShareIssuanceRequest.objects.create(
        token=tenant.deployed_token,
        dispatch_id=None,
        recipient_address=allottee,
        recipient_name=f"Synthetic {label} allottee",
        amount=25,
        reason=f"Allotment of subscription PAY-{label.upper()}",
        status=RequestStatus.EXECUTED,
        submitted_by=reviewer,
        submitted_at=RECORDED_AT,
        reviewed_by=reviewer,
        reviewed_at=RECORDED_AT,
        executed_issuance=issuance,
        executed_at=RECORDED_AT,
    )
    Subscription.objects.filter(pk=subscription.pk).update(issuance_request=request, status=SubscriptionStatus.ALLOTTED)
    return SimpleNamespace(
        subscription=Subscription.objects.get(pk=subscription.pk),
        instruction=RegisterInstruction.objects.get(pk=instruction.pk),
        issuance=issuance,
        request=request,
    )


def corrected(register, issue, reviewer, document, label):
    proposal = submit_correction(
        actor=register.company.owner,
        operation_id=uuid4(),
        corrects_id=issue.pk,
        document_id=document.pk,
        effective_on=DAY,
        authority="director_resolution",
        **authority_terms(label, "correction"),
    )
    _, confirmation = prepare_correction_review(proposal_id=proposal.pk, reviewer=reviewer)
    return decide_correction(proposal_id=proposal.pk, reviewer=reviewer, confirmation=confirmation, decision="apply")


def linked(company, member, reviewer, document, label):
    address = unused_address()
    proposal = submit_link(
        actor=company.owner,
        operation_id=uuid4(),
        company_id=company.pk,
        document_id=document.pk,
        mapping=[{"address": address, "member": str(member.pk)}],
        authority="director_resolution",
        **authority_terms(label, "link"),
    )
    _, confirmation = prepare_link_review(proposal_id=proposal.pk, reviewer=reviewer)
    return decide_link(proposal_id=proposal.pk, reviewer=reviewer, confirmation=confirmation, decision="apply")


def paused(company, token):
    contract = token.contract_address.lower()
    change = PauseChange.objects.create(
        token_id=token.pk,
        company_id=company.pk,
        initiated_by=company.owner,
        authority="issuer",
        paused=True,
        chain_id=settings.BLOCKCHAIN_CHAIN_ID,
        contract_address=contract,
        intent={
            "chain_id": settings.BLOCKCHAIN_CHAIN_ID,
            "sender": OPERATOR,
            "to": contract,
            "value": "0",
            "data": "0x8456cb59",
        },
    )
    PauseChange.objects.filter(pk=change.pk).update(
        status="observed",
        observation={"block_number": 90, "block_hash": "0x" + "ab" * 32, "observed_at": RECORDED_AT.isoformat()},
        completed_at=RECORDED_AT,
    )
    ShareToken.objects.filter(pk=token.pk).update(status="paused")
    return PauseChange.objects.get(pk=change.pk)


def approval_change(company, registry, holder, reviewer):
    address = holder.lower()
    expiry = int(RENEWED_UNTIL.timestamp())
    change = WhitelistChange.objects.create(
        action="add",
        address=address,
        chain_id=settings.BLOCKCHAIN_CHAIN_ID,
        registry_address=registry,
        company_id=company.pk,
        expires_at=RENEWED_UNTIL,
        intent={
            "chain_id": settings.BLOCKCHAIN_CHAIN_ID,
            "sender": OPERATOR,
            "to": registry,
            "value": "0",
            "data": "0xe0468dcd" + "0" * 24 + address[2:] + f"{expiry:064x}",
        },
        initiated_by=reviewer,
        authority="whitelist_admin",
        requested_wallet_id=Wallet.objects.get(address=holder).pk,
        entry_id=WhitelistEntry.objects.get(wallet__address=holder).pk,
    )
    WhitelistChange.objects.filter(pk=change.pk).update(status="unchanged", completed_at=RECORDED_AT)
    return WhitelistChange.objects.get(pk=change.pk)


def reconciled(token, reviewer, label):
    discrepancy = {"kind": "supply", "chain": "190", "expected": "175"}
    record = RegisterReconciliation.objects.create(
        token=token,
        status="discrepant",
        block_number=120,
        block_hash="0x" + "cd" * 32,
        register_sequence=4,
        discrepancies=[discrepancy],
    )
    RegisterAcknowledgement.objects.create(
        token_id=token.pk,
        reconciliation=record,
        discrepancy=discrepancy,
        reason=f"Synthetic {label} supply acknowledged",
        acknowledged_by_id=reviewer.pk,
    )
    return record


def pack_company(label):
    tenant = make_tenant(label)
    company, ordinary, preference = tenant.company, tenant.deployed_token, tenant.token
    TokenDeployment.objects.create(
        token_id=ordinary.pk,
        company_id=company.pk,
        intent={**factory_intent(ordinary, settings.BLOCKCHAIN_CHAIN_ID), "sender": OPERATOR},
    )
    addresses = {
        role: wallet_of(f"Synthetic {label} {role}", f"{index} Synthetic {label} Street, Sydney NSW 2000")
        for index, role in enumerate(ROLES, 1)
    }
    with_account_details(label, addresses)
    members = {role: member_of(company, address) for role, address in addresses.items()}
    reviewer = pack_reviewer(label)
    document = authority_document(company, label, reviewer)
    registry = "0x" + sha256(label.encode())[:40]
    for role, expires_at in (("founder", None), ("holder", LAPSED_AT)):
        WhitelistApproval.objects.create(
            entry=WhitelistEntry.objects.get(wallet__address=addresses[role]),
            company=company,
            registry_address=registry,
            status="active",
            expires_at=expires_at,
        )
    CompanyRegistryCheck.objects.create(
        company=company,
        purpose="review",
        requested_name=company.name,
        requested_acn=company.acn,
        identity={},
        lifecycle_revision=0,
        status="passed",
        entity_name=f"{label} registered entity",
    )
    register = open_register(
        token_id=ordinary.pk,
        operation_id=uuid4(),
        changes=changes((members["founder"], 100), (members["holder"], 50)),
        effective_on=DAY,
        recorded_by=company.owner,
    ).register
    allotment = allotted_subscription(tenant, reviewer, document, addresses["allottee"], label)
    issue = record_entry(
        register_id=register.pk,
        operation_id=allotment.issuance.pk,
        kind="issue",
        changes=changes((members["allottee"], 25)),
        effective_on=DAY,
        recorded_by=reviewer,
    )
    record_entry(
        register_id=register.pk,
        operation_id=tenant.swap.pk,
        kind="transfer",
        changes=changes((members["founder"], -40), (members["buyer"], 40)),
        effective_on=DAY,
        recorded_by=company.owner,
    )
    correction = corrected(register, issue, reviewer, document, label)
    link = linked(company, members["holder"], reviewer, document, label)
    former = unused_address()
    FormerHolder.objects.create(
        token=ordinary,
        wallet_address=former,
        ceased_on=date(2026, 3, 14),
        ceased_at_block=100,
        shares_at_cessation=10,
        name=f"Synthetic {label} former member",
        residential_address=f"9 Synthetic {label} Lane, Hobart TAS 7000",
    )
    second = open_register(
        token_id=preference.pk,
        operation_id=uuid4(),
        changes=changes((members["holder"], 10)),
        effective_on=DAY,
        recorded_by=company.owner,
    ).register
    entered(second, "issue", (members["buyer"], 4))
    increase = CapitalIncreaseRequest.objects.get(pk=tenant.capital_increase.pk)
    increase.submit(company.owner, Decimal("9.09"))
    increase.approve(reviewer, "Synthetic approval")
    return SimpleNamespace(
        label=label,
        tenant=tenant,
        company=company,
        ordinary=ordinary,
        preference=preference,
        members=members,
        addresses=addresses,
        registry=registry,
        former=former,
        issue=issue,
        reviewer=reviewer,
        document=document,
        allotment=allotment,
        correction=correction,
        link=link,
        increase=CapitalIncreaseRequest.objects.get(pk=increase.pk),
        pause=paused(company, ordinary),
        change=approval_change(company, registry, addresses["holder"], reviewer),
        reconciliation=reconciled(ordinary, reviewer, label),
    )


def records_of(fixture):
    registers = ShareRegister.objects.filter(token__company=fixture.company)
    return [
        str(value).lower()
        for value in (
            fixture.company.pk,
            fixture.company.acn,
            fixture.company.name,
            f"{fixture.label} registered entity",
            fixture.ordinary.pk,
            fixture.preference.pk,
            fixture.ordinary.contract_address,
            fixture.registry,
            fixture.former,
            fixture.tenant.swap.pk,
            *registers.values_list("uuid", flat=True),
            *RegisterEntry.objects.filter(register__in=registers).values_list("uuid", flat=True),
            *(member.pk for member in fixture.members.values()),
            *(fixture.addresses[role] for role in HOLDING_ROLES),
            *(f"Synthetic {fixture.label} {role}" for role in HOLDING_ROLES),
            f"Synthetic {fixture.label} reviewer",
            f"Synthetic {fixture.label} director",
            f"Synthetic {fixture.label} supply acknowledged",
            *(authority_terms(fixture.label, subject)["authority_reference"] for subject in SUBJECTS),
            sha256(evidence_of(fixture.label)),
            fixture.document.pk,
            fixture.correction.pk,
            fixture.link.pk,
            fixture.link.mapping[0]["address"],
            fixture.allotment.instruction.pk,
            fixture.allotment.request.pk,
            fixture.allotment.issuance.pk,
            fixture.allotment.subscription.pk,
            fixture.allotment.subscription.reference,
            fixture.increase.pk,
            fixture.increase.board_resolution_reference,
            fixture.pause.pk,
            fixture.change.pk,
            fixture.reconciliation.pk,
        )
    ]


def pack_staff(label):
    return grant(
        grant(staff_user(label), admin.site._registry[CompanyPack], "change"),
        admin.site._registry[CompanyDocument],
        "view",
    )


def page(company):
    return reverse("admin:companies_companypack_produce", args=[company.pk])


def files_of(content):
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        return {name: bundle.read(name) for name in bundle.namelist()}


def zipped(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
    return buffer.getvalue()


def remanifested(files):
    manifest = json.loads(files["manifest.json"])
    manifest["files"] = [
        {"path": path, "size": len(content), "sha256": sha256(content)}
        for path, content in sorted(files.items())
        if path != "manifest.json"
    ]
    return {**files, "manifest.json": json.dumps(manifest).encode()}


def text_of(content):
    return "\n".join(file.decode() for file in files_of(content).values()).lower()


def consume(content, *flags):
    with TemporaryDirectory() as directory:
        Path(directory, "pack.zip").write_bytes(content)
        return subprocess.run(
            [sys.executable, *flags, str(CONSUMER), "pack.zip"],
            cwd=directory,
            env={},
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )


def imports_of(source):
    tree = ast.parse(source)
    imported = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    imported |= {node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)}
    dynamic = [
        (node.func.id, ast.literal_eval(node.args[0]))
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in ("__import__", "exec", "eval", "compile", "open")
    ]
    return imported, dynamic


class ProducesPacks:
    def produce(self, company=None, **fields):
        request = {"instruction": INSTRUCTION, "recipient": RECIPIENT, **fields}
        with patch("tokens.services.company_pack.timezone.now", return_value=PRODUCED_AT):
            return self.client.post(page(company or self.a.company), request)

    def pack(self, company=None, **fields):
        response = self.produce(company, **fields)
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/zip"))
        return b"".join(response.streaming_content)


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackConsumerTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.client.force_login(pack_staff("pack-consumer-staff"))

    def test_a_fresh_consumer_reads_the_pack_without_the_platform_and_prints_the_digest_that_was_recorded(self):
        content = self.pack()

        result = consume(content, *ISOLATED)

        digest = sha256(files_of(content)["manifest.json"])
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertEqual(
            result.stdout.splitlines(),
            ["DEP: 4 entries verified, 3 current members", "DRF: 2 entries verified, 2 current members", digest],
        )
        self.assertEqual(
            sorted(RegisterExport.objects.filter(kind="company_pack").values_list("digest", flat=True)),
            [digest, digest],
        )

    def test_the_consumer_refuses_to_run_where_django_can_be_imported(self):
        result = consume(self.pack(), "-I")

        self.assertEqual((result.returncode, result.stdout, result.stderr), (1, "", PLATFORM_REFUSAL))

    def test_the_consumer_imports_only_the_standard_library_modules_it_is_allowed(self):
        self.assertEqual(imports_of(CONSUMER.read_text()), (ALLOWED_IMPORTS, [("__import__", "django")]))
        self.assertEqual(
            imports_of("import socket\nfrom urllib import request\n__import__('http')\n"),
            ({"socket", "urllib"}, [("__import__", "http")]),
        )

    def test_each_tampering_fails_the_consumer_and_names_what_failed(self):
        files = files_of(self.pack())
        folder = f"classes/{self.a.ordinary.pk}"
        entries_path, csv_path = f"{folder}/entries.json", f"{folder}/register.csv"
        entries = json.loads(files[entries_path])

        def rewritten_entries(change):
            copy = json.loads(files[entries_path])
            change(copy)
            return remanifested({**files, entries_path: json.dumps(copy).encode()})

        def shares_changed(copy):
            copy[1]["changes"][0]["shares"] = "26"

        def link_broken(copy):
            fields = json.loads(copy[2]["preimage"])
            fields[10] = copy[2]["previous_hash"] = "f" * 64
            copy[2]["preimage"] = json.dumps(fields)
            copy[2]["entry_hash"] = sha256(copy[2]["preimage"].encode())

        authority_path = f"{folder}/authority.json"

        def rewritten_authority(**fields):
            copy = json.loads(files[authority_path])
            copy["corrections"][0].update(fields)
            return remanifested({**files, authority_path: json.dumps(copy).encode()})

        def holding_changed():
            rows = list(csv.reader(io.StringIO(files[csv_path].decode(), newline="")))
            founder = next(row for row in rows if row and row[0] == str(self.a.members["founder"].pk))
            founder[REGISTER_HEADERS.index("Shares held")] = "61"
            sheet = io.StringIO()
            csv.writer(sheet).writerows(rows)
            return remanifested({**files, csv_path: sheet.getvalue().encode()})

        flipped = bytearray(files[csv_path])
        flipped[10] ^= 1
        for tampering, tampered, refusal in (
            ("a byte flipped in a file", {**files, csv_path: bytes(flipped)}, f"{csv_path}: SHA-256 does not match"),
            (
                "a file removed",
                {path: content for path, content in files.items() if path != f"{folder}/class.json"},
                f"{folder}/class.json: listed in the manifest and missing",
            ),
            ("a file added", {**files, "notes.txt": b"added"}, "notes.txt: present and not listed in the manifest"),
            (
                "a history removed with its listing",
                remanifested({path: content for path, content in files.items() if path != entries_path}),
                f"{entries_path}: not in the manifest",
            ),
            (
                "one entry's shares changed",
                rewritten_entries(shares_changed),
                f"{entries_path} entry 2: the preimage does not match the entry's fields",
            ),
            (
                "one previous_hash broken",
                rewritten_entries(link_broken),
                f"{entries_path} entry 3: previous_hash does not link to entry 2",
            ),
            (
                "the last entry removed",
                rewritten_entries(lambda copy: copy.pop()),
                f"{entries_path}: ends at entry 3 with {entries[2]['entry_hash']}, and the manifest's head is entry 4 "
                f"with {entries[3]['entry_hash']}",
            ),
            (
                "one holding changed",
                holding_changed(),
                f"{csv_path}: the current members are not what {entries_path} replays to",
            ),
            (
                "a correction's authority pointed at another entry",
                rewritten_authority(entry=entries[1]["uuid"]),
                f"{authority_path} corrections 1: entry {entries[1]['uuid']} is not its correction in entries.json",
            ),
            (
                "a correction's authority pointed at another correction",
                rewritten_authority(corrects=entries[2]["uuid"]),
                f"{authority_path} corrections 1: entry {entries[3]['uuid']} is not its correction in entries.json",
            ),
            (
                "an applied correction's entry removed",
                rewritten_authority(entry=None),
                f"{authority_path} corrections 1: an applied record names its entry, and no other record does",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(zipped(tampered), *ISOLATED)

                self.assertEqual((result.returncode, result.stdout), (1, ""))
                self.assertTrue(result.stderr.startswith(f"REFUSED {refusal}"), result.stderr)
        untouched = consume(zipped(files), *ISOLATED)
        self.assertEqual((untouched.returncode, untouched.stderr), (0, ""))


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.staff = pack_staff("pack-staff")
        self.client.force_login(self.staff)

    def test_the_manifest_lists_every_other_file_and_names_the_company_request_and_register_heads(self):
        content = self.pack()

        files = files_of(content)
        manifest = json.loads(files["manifest.json"])
        ordinary, preference = str(self.a.ordinary.pk), str(self.a.preference.pk)
        listed = {
            "README.md",
            "company.json",
            "approvals.json",
            "wallet_links.json",
            "contracts/contracts.json",
            *(f"contracts/{name}.json" for name in INTERFACES),
            *(f"classes/{token}/{name}" for token in (ordinary, preference) for name in CLASS_FILES),
            *(f"classes/{token}/register.csv" for token in (ordinary, preference)),
        }
        self.assertEqual(set(files), listed | {"manifest.json"})
        self.assertEqual(
            manifest["files"],
            [{"path": path, "size": len(files[path]), "sha256": sha256(files[path])} for path in sorted(listed)],
        )
        heads = dict(ShareRegister.objects.filter(token__company=self.a.company).values_list("token_id", "head_hash"))
        self.assertEqual(
            {key: value for key, value in manifest.items() if key != "files"},
            {
                "format": "ledova-company-pack",
                "version": 1,
                "company": {"uuid": str(self.a.company.pk), "name": self.a.company.name, "acn": self.a.company.acn},
                "as_at": "2026-09-24T01:02:03.456789+00:00",
                "instruction": INSTRUCTION,
                "recipient": RECIPIENT,
                "registers": [
                    {"class": ordinary, "symbol": "DEP", "sequence": 4, "head_hash": heads[self.a.ordinary.pk]},
                    {"class": preference, "symbol": "DRF", "sequence": 2, "head_hash": heads[self.a.preference.pk]},
                ],
            },
        )
        self.assertEqual(
            [list(row) for row in csv.reader(io.StringIO(files[f"classes/{ordinary}/register.csv"].decode()))],
            [REGISTER_HEADERS, *export_rows(self.a.ordinary, self.staff)],
        )

    def test_each_entry_carries_its_fields_and_the_preimage_its_hash_was_computed_over(self):
        entries = json.loads(files_of(self.pack())[f"classes/{self.a.ordinary.pk}/entries.json"])

        stored = list(RegisterEntry.objects.filter(register__token=self.a.ordinary).order_by("sequence"))
        self.assertEqual(
            [{key: value for key, value in entry.items() if key != "preimage"} for entry in entries],
            [
                {
                    "sequence": entry.sequence,
                    "uuid": str(entry.pk),
                    "register": str(entry.register_id),
                    "operation_id": str(entry.operation_id),
                    "kind": entry.kind,
                    "effective_on": entry.effective_on.isoformat(),
                    "changes": entry.changes,
                    "corrects": None if entry.corrects_id is None else str(entry.corrects_id),
                    "previous_hash": entry.previous_hash,
                    "created_at": entry.created_at.astimezone(utc_zone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                    "entry_hash": entry.entry_hash,
                }
                for entry in stored
            ],
        )
        self.assertEqual(entries[2]["operation_id"], str(self.a.tenant.swap.pk))
        self.assertEqual(entries[3]["corrects"], str(self.a.issue.pk))
        self.assertEqual([sha256(entry["preimage"].encode()) for entry in entries], [e.entry_hash for e in stored])

    def test_the_preimage_function_returns_the_text_the_stored_hash_function_digests(self):
        entries = RegisterEntry.objects.filter(register__token__company=self.a.company).annotate(
            preimage=RawSQL("tokens_register_entry_preimage(tokens_registerentry)", []),
            recomputed=RawSQL("tokens_register_entry_hash(tokens_registerentry)", []),
        )

        self.assertEqual(len(entries), 6)
        for entry in entries:
            with self.subTest(sequence=entry.sequence):
                self.assertEqual(sha256(entry.preimage.encode()), entry.recomputed)
                self.assertEqual(entry.recomputed, entry.entry_hash)
                self.assertEqual(json.loads(entry.preimage)[:2], ["ledova-register-v1", str(entry.pk)])

    def test_the_company_file_carries_the_company_its_instructing_account_and_its_registry_checks(self):
        record = json.loads(files_of(self.pack())["company.json"])

        company = self.a.company
        self.assertEqual(
            {key: record[key] for key in ("uuid", "name", "acn", "type", "status", "owner_name")},
            {
                "uuid": str(company.pk),
                "name": company.name,
                "acn": company.acn,
                "type": "pty",
                "status": company.status,
                "owner_name": "pack-a owner",
            },
        )
        self.assertEqual(
            [(check["requested_name"], check["status"], check["entity_name"]) for check in record["registry_checks"]],
            [(company.name, "passed", "pack-a registered entity")],
        )

    def test_the_pack_carries_no_credential_or_contact_detail_of_the_platform_account(self):
        text = text_of(self.pack())

        company = Company.objects.get(pk=self.a.company.pk)
        self.assertIn(company.name.lower(), text)
        for secret in (company.api_key, self.a.tenant.user.email, self.a.tenant.account.account_number):
            with self.subTest(secret=secret):
                self.assertTrue(secret)
                self.assertNotIn(secret.lower(), text)

    def test_the_contract_files_are_the_committed_interfaces_with_the_addresses_owners_and_domains(self):
        files = files_of(self.pack())

        for name in INTERFACES:
            with self.subTest(interface=name):
                self.assertEqual(
                    files[f"contracts/{name}.json"],
                    (Path(settings.BASE_DIR) / "contracts" / f"{name}.json").read_bytes(),
                )
        contracts = json.loads(files["contracts/contracts.json"])
        self.assertEqual(
            contracts["registries"], [{"address": self.a.registry, "interface": "contracts/WhitelistRegistry.json"}]
        )
        self.assertEqual(
            contracts["classes"],
            [
                {
                    "class": str(self.a.ordinary.pk),
                    "symbol": "DEP",
                    "address": self.a.ordinary.contract_address,
                    "owner_at_deployment": OPERATOR,
                    "interface": "contracts/ShareToken.json",
                    "domain": {
                        "name": "Ledova Trading",
                        "version": "1",
                        "chainId": settings.BLOCKCHAIN_CHAIN_ID,
                        "verifyingContract": self.a.ordinary.contract_address,
                    },
                },
                {
                    "class": str(self.a.preference.pk),
                    "symbol": "DRF",
                    "address": None,
                    "owner_at_deployment": None,
                    "interface": "contracts/ShareToken.json",
                    "domain": None,
                },
            ],
        )

    def test_the_compiler_settings_are_the_ones_the_contracts_are_built_with(self):
        contracts = Path(settings.BASE_DIR).parent / "contracts"
        config = (contracts / "hardhat.config.ts").read_text()

        for setting in (
            f'version: "{COMPILER["solidity"]}"',
            f'evmVersion: "{COMPILER["evm_version"]}"',
            f"runs: {COMPILER['optimizer_runs']}",
            f"viaIR: {str(COMPILER['via_ir']).lower()}",
        ):
            with self.subTest(setting=setting):
                self.assertIn(setting, config)
        self.assertEqual(
            json.loads((contracts / "package.json").read_text())["devDependencies"]["@openzeppelin/contracts"],
            COMPILER["openzeppelin"],
        )

    def test_the_settlement_domain_is_the_one_settlements_are_signed_under(self):
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "9d" * 20):
            configured = json.loads(files_of(self.pack())["contracts/contracts.json"])["swap"]
            self.assertEqual(configured["domain"], configured_domain())
        with override_settings(ATOMIC_SWAP_ADDRESS=""):
            unconfigured = json.loads(files_of(self.pack())["contracts/contracts.json"])["swap"]
        self.assertEqual((unconfigured["address"], unconfigured["domain"]), (None, None))

    def test_the_readme_names_the_request_each_head_and_owner_and_grants_the_owners_licence_verbatim(self):
        readme = files_of(self.pack())["README.md"].decode()

        self.assertIn(LICENCE, readme)
        self.assertIn(f'referenced as "{INSTRUCTION}", for {RECIPIENT}.', readme)
        self.assertIn("as at 2026-09-24T01:02:03.456789+00:00 (UTC)", readme)
        for register in ShareRegister.objects.filter(token__company=self.a.company):
            with self.subTest(register=register.token.symbol):
                self.assertIn(f"| {register.sequence} | `{register.head_hash}` |", readme)
        self.assertIn(f"| Share class DEP | `{self.a.ordinary.contract_address}` | `{OPERATOR}` |", readme)
        self.assertIn(f"| The company's registry | `{self.a.registry}` |", readme)
        self.assertNotIn("registryOf(", readme)

    def test_the_same_records_give_the_same_pack_and_a_different_request_a_different_digest(self):
        first, second = self.pack(), self.pack()
        other = self.pack(recipient="Another Synthetic Recipient")

        self.assertEqual(first, second)
        self.assertEqual(sha256(files_of(first)["manifest.json"]), sha256(files_of(second)["manifest.json"]))
        self.assertNotEqual(sha256(files_of(other)["manifest.json"]), sha256(files_of(first)["manifest.json"]))
        with zipfile.ZipFile(io.BytesIO(first)) as bundle:
            members = bundle.infolist()
        self.assertEqual([member.filename for member in members], sorted(member.filename for member in members))
        self.assertEqual({member.date_time for member in members}, {(1980, 1, 1, 0, 0, 0)})

    def test_a_pack_is_recorded_once_for_each_share_class_with_the_manifest_digest_and_the_request(self):
        response = self.produce()
        content = b"".join(response.streaming_content)

        self.assertEqual(
            response["Content-Disposition"],
            f'attachment; filename="company-pack-{self.a.company.acn}-20260924T010203Z.zip"',
        )
        digest = sha256(files_of(content)["manifest.json"])
        self.assertEqual(
            list(
                RegisterExport.objects.order_by("token__symbol").values_list(
                    "kind",
                    "token_id",
                    "requested_by_id",
                    "register_sequence",
                    "member_rows",
                    "former_rows",
                    "digest",
                    "instruction",
                    "recipient",
                    "requested_on",
                    "late",
                    "period_from",
                )
            ),
            [
                (
                    "company_pack",
                    self.a.ordinary.pk,
                    self.staff.pk,
                    4,
                    3,
                    1,
                    digest,
                    INSTRUCTION,
                    RECIPIENT,
                    None,
                    None,
                    None,
                ),
                (
                    "company_pack",
                    self.a.preference.pk,
                    self.staff.pk,
                    2,
                    2,
                    0,
                    digest,
                    INSTRUCTION,
                    RECIPIENT,
                    None,
                    None,
                    None,
                ),
            ],
        )

    def test_a_share_class_whose_register_is_not_opened_is_carried_with_an_empty_history(self):
        unopened = ShareToken.objects.create(
            company=self.a.company, name="Synthetic unopened shares", symbol="NEW", total_supply="500"
        )

        content = self.pack()

        files = files_of(content)
        folder = f"classes/{unopened.pk}"
        self.assertNotIn(f"{folder}/register.csv", files)
        self.assertEqual(json.loads(files[f"{folder}/entries.json"]), [])
        self.assertIsNone(json.loads(files[f"{folder}/class.json"])["register"])
        self.assertEqual(
            {name: json.loads(files[f"{folder}/{name}"]) for name in CLASS_FILES[2:]},
            {
                "authority.json": {"openings": [], "imports": [], "corrections": [], "instructions": []},
                "issues.json": [],
                "former_members.json": [],
                "reconciliations.json": [],
                "waiting.json": {"effects": None},
                "due.json": [],
            },
        )
        self.assertIn(
            {"class": str(unopened.pk), "symbol": "NEW", "sequence": 0, "head_hash": "0" * 64},
            json.loads(files["manifest.json"])["registers"],
        )
        self.assertIn("NEW: 0 entries verified, 0 current members", consume(content, *ISOLATED).stdout.splitlines())
        self.assertEqual(
            list(
                RegisterExport.objects.filter(token=unopened).values_list(
                    "register_sequence", "member_rows", "former_rows"
                )
            ),
            [(0, 0, 0)],
        )

    def test_a_refused_request_records_nothing_and_says_why(self):
        empty = Company.objects.create(owner=self.a.company.owner, name="Synthetic Empty Pty Ltd", acn="999999999")

        for request, company, refusal in (
            ({}, empty, "This company has no share classes, so there is no register to put in a pack."),
            ({"instruction": " \t"}, self.a.company, "This field is required."),
            ({"recipient": ""}, self.a.company, "This field is required."),
        ):
            with self.subTest(request=request, company=company.name):
                response = self.produce(company, **request)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
                self.assertContains(response, refusal)
        self.assertFalse(RegisterExport.objects.exists())

    def test_an_entry_that_no_longer_matches_its_hash_refuses_the_pack_and_records_nothing(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("ALTER TABLE tokens_registerentry DISABLE TRIGGER USER")
            cursor.execute(
                "UPDATE tokens_registerentry SET effective_on = '2020-01-01' WHERE uuid = %s", [self.a.issue.pk]
            )
            cursor.execute("ALTER TABLE tokens_registerentry ENABLE TRIGGER USER")

        response = self.produce()

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/html; charset=utf-8"))
        self.assertContains(
            response,
            "Entry 2 of DEP&#x27;s register does not match its hash, so no pack was produced. Run the register "
            "integrity verifier for this share class before producing a pack. Nothing was recorded.",
        )
        self.assertFalse(RegisterExport.objects.exists())

    def test_a_failure_while_writing_the_archive_records_nothing(self):
        with (
            patch("tokens.services.company_pack.zipfile.ZipFile.writestr", side_effect=OSError("synthetic failure")),
            self.assertRaisesMessage(OSError, "synthetic failure"),
        ):
            self.produce()

        self.assertFalse(RegisterExport.objects.exists())

    def test_staff_need_both_the_pack_permission_and_the_company_document_permission(self):
        pack, documents = admin.site._registry[CompanyPack], admin.site._registry[CompanyDocument]
        for label, user in (
            ("neither", staff_user("pack-neither")),
            ("pack only", grant(staff_user("pack-only"), pack, "change")),
            ("documents only", grant(staff_user("pack-documents-only"), documents, "view")),
            ("pack view and documents", grant(grant(staff_user("pack-viewer"), pack, "view"), documents, "view")),
        ):
            with self.subTest(staff=label):
                self.client.force_login(user)

                self.assertEqual(self.client.get(page(self.a.company)).status_code, 403)
                self.assertEqual(self.produce().status_code, 403)
        self.assertFalse(RegisterExport.objects.exists())

        self.client.force_login(self.staff)

        self.assertContains(self.client.get(reverse("admin:companies_companypack_changelist")), page(self.a.company))
        self.assertContains(self.client.get(page(self.a.company)), "Produce and download")
        self.assertEqual(self.produce().status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 2)

    def test_another_companys_pack_carries_none_of_this_companys_records(self):
        b = pack_company("pack-b")
        records = records_of(self.a)

        a_text, b_text = text_of(self.pack(self.a.company)), text_of(self.pack(b.company))

        self.assertEqual([record for record in records if record not in a_text], [])
        self.assertEqual([record for record in records if record in b_text], [])
        self.assertEqual([record for record in records_of(b) if record in a_text], [])

    def test_the_database_holds_a_company_pack_record_to_its_digest_instruction_and_recipient(self):
        def insert(**columns):
            row = {
                "uuid": uuid4(),
                "created_at": timezone.now(),
                "updated_at": timezone.now(),
                "token_id": self.a.ordinary.pk,
                "requested_by_id": self.staff.pk,
                "kind": "company_pack",
                "register_sequence": 4,
                "member_rows": 3,
                "former_rows": 1,
                "digest": "a" * 64,
                "instruction": INSTRUCTION,
                "recipient": RECIPIENT,
                **columns,
            }
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    f"INSERT INTO tokens_registerexport ({', '.join(row)}) VALUES ({', '.join(['%s'] * len(row))})",
                    list(row.values()),
                )

        insert()
        insert(register_sequence=0, member_rows=0, former_rows=0)
        for field, value, constraint in (
            ("digest", "", "register_export_company_pack_shape"),
            ("digest", "A" * 64, "register_export_company_pack_shape"),
            ("digest", "a" * 63, "register_export_company_pack_shape"),
            ("instruction", "", "register_export_company_pack_shape"),
            ("instruction", " \t", "register_export_company_pack_shape"),
            ("recipient", "", "register_export_company_pack_shape"),
            ("recipient", " ", "register_export_company_pack_shape"),
            ("requested_on", DAY, "register_export_company_pack_shape"),
            ("late", False, "register_export_company_pack_shape"),
            ("period_from", DAY, "register_export_period_only_for_notice_figures"),
        ):
            with (
                self.subTest(field=field, value=value),
                self.assertRaisesMessage(IntegrityError, constraint),
                atomic(),
            ):
                insert(**{field: value})
        self.assertEqual(RegisterExport.objects.filter(kind="company_pack").count(), 2)

    def test_downgrade_drops_the_preimage_function_only_while_no_company_pack_is_recorded(self):
        migration = importlib.import_module("tokens.migrations.0080_company_pack")

        with self.assertRaises(Undone), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_preimage(None, editor)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT to_regprocedure('tokens_register_entry_preimage(tokens_registerentry)')")
                self.assertIsNone(cursor.fetchone()[0])
            raise Undone
        self.pack()

        with self.assertRaisesRegex(RuntimeError, "Retain company pack records"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_preimage(None, editor)

        self.assertEqual(RegisterExport.objects.filter(kind="company_pack").count(), 2)


def owed(sequence, kind, output, due_on):
    return {
        "sequence": sequence,
        "kind": kind,
        "effective_on": DAY.isoformat(),
        "output": output,
        "due_on": due_on.isoformat(),
        "overdue": False,
    }


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackHistoryTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.client.force_login(pack_staff("pack-history-staff"))
        self.files = files_of(self.pack())

    def read(self, name, token=None):
        return json.loads(self.files[name if token is None else f"classes/{token.pk}/{name}"])

    def decided(self, record, subject, **terms):
        content = evidence_of("pack-a")
        return {
            "uuid": str(record.pk),
            "submitted_at": record.created_at.isoformat(),
            "authority": "director_resolution",
            **authority_terms("pack-a", subject),
            **terms,
            "evidence": {
                "document": str(self.a.document.pk),
                "document_type": "other",
                "name": "Synthetic pack-a board resolution",
                "mime_type": "application/pdf",
                "size": len(content),
                "sha256": sha256(content),
            },
            "status": "applied",
            "reviewer": "Synthetic pack-a reviewer",
            "reviewed_at": record.reviewed_at.isoformat(),
            "rejection_reason": "",
        }

    def test_the_authority_file_carries_each_decision_with_its_director_reviewer_and_evidence_digest(self):
        correction, instruction = self.a.correction, self.a.allotment.instruction
        entries = self.read("entries.json", self.a.ordinary)

        self.assertEqual(
            self.read("authority.json", self.a.ordinary),
            {
                "openings": [],
                "imports": [],
                "corrections": [
                    self.decided(
                        correction,
                        "correction",
                        corrects=str(self.a.issue.pk),
                        effective_on=DAY.isoformat(),
                        changes=[{"member": str(self.a.members["allottee"].pk), "shares": "-25"}],
                        base_sequence=3,
                        base_hash=entries[2]["entry_hash"],
                        entry=entries[3]["uuid"],
                    )
                ],
                "instructions": [
                    self.decided(
                        instruction,
                        "allotment",
                        kind="issue",
                        items=[
                            {
                                "subscription": str(self.a.allotment.subscription.pk),
                                "recipient": self.a.addresses["allottee"],
                                "amount": "25",
                            }
                        ],
                    )
                ],
            },
        )
        self.assertEqual(
            (entries[3]["kind"], entries[3]["operation_id"], entries[3]["corrects"]),
            ("correction", str(correction.pk), str(self.a.issue.pk)),
        )
        self.assertEqual(
            self.read("authority.json", self.a.preference),
            {"openings": [], "imports": [], "corrections": [], "instructions": []},
        )

    def test_the_wallet_links_file_carries_each_link_with_its_decision_and_evidence(self):
        holder = self.a.members["holder"]
        linked_address = self.a.link.mapping[0]["address"]

        self.assertEqual(
            self.read("wallet_links.json"),
            [self.decided(self.a.link, "link", mapping=[{"address": linked_address, "member": str(holder.pk)}])],
        )
        self.assertIn(linked_address, self.files[f"classes/{self.a.ordinary.pk}/register.csv"].decode())

    def test_the_issues_file_carries_each_issue_with_its_subscription_and_the_payment_as_recorded(self):
        allotment = self.a.allotment
        recorded = RECORDED_AT.isoformat()

        issues = self.read("issues.json", self.a.ordinary)

        self.assertEqual(
            issues,
            [
                {
                    "request": str(allotment.request.pk),
                    "type": "additional",
                    "recipient_address": self.a.addresses["allottee"],
                    "recipient_name": "Synthetic pack-a allottee",
                    "shares": "25",
                    "reason": "Allotment of subscription PAY-PACK-A",
                    "status": "executed",
                    "submitted_at": recorded,
                    "reviewer": "Synthetic pack-a reviewer",
                    "reviewed_at": recorded,
                    "rejection_reason": "",
                    "executed_at": recorded,
                    "issuance": {
                        "uuid": str(allotment.issuance.pk),
                        "status": "completed",
                        "shares": "25",
                        "completed_at": recorded,
                    },
                    "subscription": {
                        "uuid": str(allotment.subscription.pk),
                        "offering": str(self.a.tenant.offering.pk),
                        "status": "allotted",
                        "shares_requested": "25",
                        "shares_allotted": "25",
                        "price_per_share": "2.50",
                        "amount_due": "62.50",
                        "reference": "PAY-PACK-A",
                        "rail": "bank_transfer",
                        "payment": {
                            "basis": "recorded",
                            "amount_received": "62.50",
                            "received_on": "2026-09-18",
                            "reference_seen": "PAY-PACK-A deposit",
                            "transaction": None,
                            "recorded_at": recorded,
                            "refund_amount": None,
                            "refunded_at": None,
                            "refund_reference": "",
                        },
                    },
                }
            ],
        )
        self.assertEqual(self.read("entries.json", self.a.ordinary)[1]["operation_id"], issues[0]["issuance"]["uuid"])
        self.assertEqual(self.read("issues.json", self.a.preference), [])

    def test_the_class_file_carries_each_capital_increase_and_pause(self):
        increase, pause = self.a.increase, self.a.pause

        ordinary = self.read("class.json", self.a.ordinary)

        self.assertEqual(
            (ordinary["status"], ordinary["cap_increases"], ordinary["pauses"]),
            (
                "paused",
                [
                    {
                        "uuid": str(increase.pk),
                        "status": "approved",
                        "additional_shares": "100",
                        "new_authorised_total": "1100",
                        "purpose": "Growth",
                        "board_resolution_reference": "BOARD-pack-a",
                        "shareholder_approval_reference": "",
                        "submitted_at": increase.submitted_at.isoformat(),
                        "reviewer": "Synthetic pack-a reviewer",
                        "reviewed_at": increase.reviewed_at.isoformat(),
                        "rejection_reason": "",
                        "executed_at": None,
                    }
                ],
                [
                    {
                        "uuid": str(pause.pk),
                        "paused": True,
                        "authority": "issuer",
                        "status": "observed",
                        "requested_at": pause.created_at.isoformat(),
                        "completed_at": RECORDED_AT.isoformat(),
                    }
                ],
            ),
        )
        preference = self.read("class.json", self.a.preference)
        self.assertEqual((preference["cap_increases"], preference["pauses"]), ([], []))

    def test_the_approvals_file_carries_the_registry_each_approval_and_each_change(self):
        change = self.a.change

        self.assertEqual(
            self.read("approvals.json"),
            {
                "registries": [self.a.registry],
                "approvals": [
                    {
                        "wallet": self.a.addresses["founder"],
                        "registry": self.a.registry,
                        "status": "active",
                        "expires_at": None,
                        "listed": True,
                    },
                    {
                        "wallet": self.a.addresses["holder"],
                        "registry": self.a.registry,
                        "status": "active",
                        "expires_at": LAPSED_AT.isoformat(),
                        "listed": False,
                    },
                ],
                "changes": [
                    {
                        "uuid": str(change.pk),
                        "action": "add",
                        "wallet": self.a.addresses["holder"].lower(),
                        "registry": self.a.registry,
                        "expires_at": RENEWED_UNTIL.isoformat(),
                        "authority": "whitelist_admin",
                        "status": "unchanged",
                        "requested_at": change.created_at.isoformat(),
                        "completed_at": RECORDED_AT.isoformat(),
                        "transaction": None,
                    }
                ],
            },
        )

    def test_the_former_members_file_gives_each_former_member_the_date_it_must_be_kept_until(self):
        former = FormerHolder.objects.get(token=self.a.ordinary)

        self.assertEqual(
            self.read("former_members.json", self.a.ordinary),
            [
                {
                    "name": "Synthetic pack-a former member",
                    "residential_address": "9 Synthetic pack-a Lane, Hobart TAS 7000",
                    "wallet": self.a.former,
                    "shares_at_cessation": "10",
                    "ceased_on": "2026-03-14",
                    "retain_until": "2033-03-14",
                    "identity_source": "Never identified while it held shares",
                    "recorded_at": former.created_at.isoformat(),
                }
            ],
        )
        self.assertIn(self.a.former, self.files[f"classes/{self.a.ordinary.pk}/register.csv"].decode())
        self.assertEqual(self.read("former_members.json", self.a.preference), [])

    def test_the_reconciliations_file_carries_each_comparison_its_discrepancies_and_acknowledgements(self):
        record = self.a.reconciliation
        acknowledgement = RegisterAcknowledgement.objects.get(reconciliation=record)
        discrepancy = {"kind": "supply", "chain": "190", "expected": "175"}

        self.assertEqual(
            self.read("reconciliations.json", self.a.ordinary),
            [
                {
                    "uuid": str(record.pk),
                    "reconciled_at": record.created_at.isoformat(),
                    "status": "discrepant",
                    "block_number": 120,
                    "block_hash": "0x" + "cd" * 32,
                    "register_sequence": 4,
                    "discrepancies": [discrepancy],
                    "failure": "",
                    "acknowledgements": [
                        {
                            "discrepancy": discrepancy,
                            "reason": "Synthetic pack-a supply acknowledged",
                            "acknowledged_at": acknowledgement.created_at.isoformat(),
                        }
                    ],
                }
            ],
        )
        self.assertEqual(self.read("reconciliations.json", self.a.preference), [])

    def test_the_due_file_lists_the_certificates_and_notice_figures_still_owed_for_each_class(self):
        ordered_on = self.a.tenant.swap.created_at.astimezone(STATUTORY_CALENDAR).date()

        self.assertEqual(
            self.read("due.json", self.a.ordinary),
            [
                owed(3, "transfer", "notice_figures", date(2026, 10, 18)),
                owed(3, "transfer", "certificate", months_after(ordered_on, 1)),
            ],
        )
        self.assertEqual(
            self.read("due.json", self.a.preference),
            [
                owed(2, "issue", "notice_figures", date(2026, 10, 18)),
                owed(2, "issue", "certificate", date(2026, 11, 20)),
            ],
        )

    def test_the_waiting_file_is_null_where_the_register_has_no_opening_to_place_completions_against(self):
        for token in (self.a.ordinary, self.a.preference):
            with self.subTest(symbol=token.symbol):
                self.assertEqual(self.read("waiting.json", token), {"effects": None})

    def test_the_readme_states_the_restrictions_in_force_and_the_outputs_still_owed_for_this_company(self):
        readme = self.files["README.md"].decode()

        for line in (
            f"| `{self.a.addresses['founder']}` | `{self.a.registry}` | active | never | yes |",
            f"| `{self.a.addresses['holder']}` | `{self.a.registry}` | active | 2026-09-01T00:00:00+00:00 | no: frozen "
            "while it holds shares |",
            "- DEP is paused on chain, and no transfer of it settles until it is unpaused.",
            "- DEP: not established, so `effects` is `null`",
            "- DRF: not established, so `effects` is `null`",
            "| DEP | Synthetic pack-a former member | 2026-03-14 | 2033-03-14 |",
            "| DEP | 3 | transfer | notice_figures | 2026-10-18 | no |",
            "| DRF | 2 | issue | notice_figures | 2026-10-18 | no |",
            "| DRF | 2 | issue | certificate | 2026-11-20 | no |",
            "A subscription's `payment` has the `basis` `recorded`",
            "| Payment received on a subscription | Who entered what amount, and when | That money moved |",
        ):
            with self.subTest(line=line):
                self.assertIn(line, readme)
        for empty in ("No wallet approval is recorded", "No share class is paused", "No former member is recorded"):
            with self.subTest(empty=empty):
                self.assertNotIn(empty, readme)

    def test_the_consumer_checks_each_applied_correction_against_the_entry_it_names(self):
        result = consume(self.pack(), *ISOLATED)

        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertEqual(
            self.read("authority.json", self.a.ordinary)["corrections"][0]["entry"],
            self.read("entries.json", self.a.ordinary)[3]["uuid"],
        )


def account_details(fixture):
    values = [f"Synthetic {fixture.label} citizenship"]
    for role in ROLES:
        wallet = Wallet.objects.select_related(
            "user_account__user_profile__user", "user_account__user_profile__financial_profile", "whitelist_entry"
        ).get(address=fixture.addresses[role])
        account = wallet.user_account
        profile = account.user_profile
        values += [
            profile.user.email,
            profile.phone_number,
            profile.date_of_birth.isoformat(),
            profile.financial_profile.occupation,
            profile.financial_profile.source_of_funds_other_text,
            account.account_number,
            str(account.pk),
            str(profile.pk),
            str(wallet.pk),
            str(wallet.whitelist_entry.pk),
        ]
    return values


def investor_records(fixture):
    label, tenant = fixture.label, fixture.tenant
    account = (
        Wallet.objects.select_related("user_account__user_profile")
        .get(address=fixture.addresses["allottee"])
        .user_account
    )
    evidence = f"Synthetic {label} allottee classification evidence".encode()
    claim = InvestorClassification.objects.create(
        user_account=account,
        category="professional_investor",
        declaration_accepted=True,
        declaration_text="Declared",
        declared_basis=f"Synthetic {label} allottee basis",
        evidence_file_size=len(evidence),
        evidence_mime_type="application/pdf",
        submitted_at=RECORDED_AT,
    )
    claim.evidence_file.save(f"{label}-allottee-evidence.pdf", ContentFile(evidence), save=True)
    payslip = Document.objects.create(
        uploaded_by=account.user_profile.user,
        document_type="payslip",
        original_filename=f"Synthetic {label} allottee payslip.pdf",
        mime_type="application/pdf",
    )
    payslip.file.save(f"{label}-allottee-payslip.pdf", ContentFile(f"payslip of {label} allottee".encode()), save=True)
    return [
        str(claim.pk),
        claim.declared_basis,
        evidence.decode(),
        str(payslip.pk),
        payslip.original_filename,
        f"payslip of {label} allottee",
        str(tenant.investor_classification.pk),
        tenant.investor_classification.declared_basis,
        f"evidence for {label}",
        str(tenant.document.pk),
        f"payslip for {label}",
    ]


def unmatched_orders(fixture):
    tenant = fixture.tenant
    return [
        str(
            TransferOrder.objects.create(
                order_type=order_type,
                token=fixture.ordinary,
                payment_asset=tenant.refs.stablecoin,
                wallet=tenant.wallet,
                owner_account=tenant.account,
                wallet_address=tenant.wallet.address,
                quantity=7,
                price_per_share=Decimal("3.75"),
            ).pk
        )
        for order_type in (TransferOrderType.SELL, TransferOrderType.BUY)
    ]


def export_records(fixture):
    record = RegisterExport.objects.create(
        token=fixture.ordinary,
        requested_by_id=fixture.reviewer.pk,
        kind="inspection_copy",
        register_sequence=4,
        member_rows=3,
        former_rows=1,
        digest=sha256(f"Synthetic {fixture.label} inspection copy".encode()),
        instruction=f"SYNTHETIC-{fixture.label.upper()}-INSPECTION-INSTRUCTION",
        requested_on=DAY,
        recipient=f"Synthetic {fixture.label} inspector",
        late=False,
    )
    return [str(record.pk), record.digest, record.instruction, record.recipient]


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackAbsenceTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.client.force_login(pack_staff("pack-absence-staff"))

    def leaked(self, values):
        text = text_of(self.pack())
        return [value for value in values if value.lower() in text]

    def assert_none_leave(self, values):
        self.assertTrue(values and all(values))
        self.assertEqual(self.leaked(values), [])
        profile = Wallet.objects.get(address=self.a.addresses["founder"]).user_account.user_profile
        UserProfile.objects.filter(pk=profile.pk).update(residential_address=" ".join(values))

        self.assertEqual(self.leaked(values), values)

        UserProfile.objects.filter(pk=profile.pk).update(residential_address=profile.residential_address)
        self.assertEqual(self.leaked(values), [])

    def test_members_account_details_and_platform_ids_do_not_leave(self):
        self.assert_none_leave(account_details(self.a))

    def test_classification_claims_their_evidence_and_payslips_do_not_leave(self):
        self.assert_none_leave(investor_records(self.a))

    def test_unmatched_listings_and_orders_do_not_leave(self):
        self.assert_none_leave(unmatched_orders(self.a))

    def test_export_records_do_not_leave(self):
        self.assert_none_leave(export_records(self.a))


@override_settings(**SETTLEMENT)
class CompanyPackWaitingTest(SettledTransferFixtures, TransactionTestCase):
    def test_a_settled_transfer_the_directors_have_not_instructed_is_waiting_in_the_pack(self):
        self.open_register()
        self.complete()

        with use_operator():
            token = ShareToken.objects.select_related("company").get(pk=self.swap.share_token_id)
            archive, _ = produce_company_pack(token.company, self.owner, instruction=INSTRUCTION, recipient=RECIPIENT)
        content = archive.read()

        files = files_of(content)
        self.assertEqual(
            json.loads(files[f"classes/{token.pk}/waiting.json"]), {"effects": [self.waiting("uninstructed")]}
        )
        self.assertIn(f"- {token.symbol}: 1 waiting.", files["README.md"].decode())
        result = consume(content, *ISOLATED)
        self.assertEqual((result.returncode, result.stderr), (0, ""))


class CompanyPackSnapshotTest(TransactionTestCase):
    def setUp(self):
        self.owner, self.company, self.token, self.member, self.newcomer, self.opening = register_fixture()

    def append(self):
        try:
            record_entry(
                register_id=self.opening.register_id,
                operation_id=uuid4(),
                kind="issue",
                changes=changes((self.newcomer, 50)),
                effective_on=DAY,
                recorded_by=self.owner,
            )
        finally:
            connections.close_all()

    def produce(self, company=None):
        archive, _ = produce_company_pack(
            company or self.company, self.owner, instruction=INSTRUCTION, recipient=RECIPIENT
        )
        return archive.read()

    def test_an_entry_committed_while_the_pack_is_read_is_in_none_of_its_files(self):
        def read_the_head_then_append(**lookup):
            register = ShareRegister.objects.filter(**lookup).first()
            with ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(self.append).result(timeout=20)
            return register

        stand_in = Mock()
        stand_in.objects.filter.side_effect = lambda **lookup: SimpleNamespace(
            first=lambda: read_the_head_then_append(**lookup)
        )
        with patch("tokens.services.company_pack.ShareRegister", stand_in):
            during = self.produce()
        after = self.produce()

        folder = f"classes/{self.token.pk}"
        for content, sequence, members in ((during, 1, 1), (after, 2, 2)):
            with self.subTest(sequence=sequence):
                files = files_of(content)
                self.assertEqual(json.loads(files["manifest.json"])["registers"][0]["sequence"], sequence)
                self.assertEqual(len(json.loads(files[f"{folder}/entries.json"])), sequence)
                self.assertEqual(
                    consume(content, *ISOLATED).stdout.splitlines()[:1],
                    [f"REG: {sequence} entries verified, {members} current members"],
                )

    def test_a_company_with_no_approvals_pauses_former_members_or_outputs_owed_says_so(self):
        files = files_of(self.produce())

        readme = files["README.md"].decode()
        for line in (
            "No wallet approval is recorded for this company.",
            "No share class is paused.",
            "- REG: not established, so `effects` is `null`",
            "No former member is recorded.",
            "Nothing is owed.",
        ):
            with self.subTest(line=line):
                self.assertIn(line, readme)
        self.assertEqual(
            (json.loads(files["approvals.json"]), json.loads(files["wallet_links.json"])),
            ({"registries": [], "approvals": [], "changes": []}, []),
        )

    def test_the_company_is_read_with_its_registers_and_not_taken_from_the_callers_copy(self):
        stale = Company.objects.get(pk=self.company.pk)
        Company.objects.filter(pk=self.company.pk).update(name="Synthetic Renamed Pty Ltd")

        files = files_of(self.produce(stale))

        self.assertEqual(json.loads(files["company.json"])["name"], "Synthetic Renamed Pty Ltd")
        self.assertEqual(json.loads(files["manifest.json"])["company"]["name"], "Synthetic Renamed Pty Ltd")


class ScopedCompanyPackTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, _, _, self.opening = register_fixture()

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_pack_page_reads_one_snapshot_and_records_on_the_operator_connection(self):
        with use_operator():
            member = member_of(self.company, wallet_of("Synthetic Scoped Pack Member", "6 Synthetic Street"))
            entered(self.opening.register, "issue", (member, 5))
            staff = pack_staff("scoped-company-pack")
            self.client.force_login(staff)

        response = self.client.post(page(self.company), {"instruction": INSTRUCTION, "recipient": RECIPIENT})

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/zip"))
        digest = sha256(files_of(b"".join(response.streaming_content))["manifest.json"])
        with use_operator():
            record = RegisterExport.objects.get(kind="company_pack")
        self.assertEqual(
            (record.token_id, record.requested_by_id, record.digest, record.register_sequence, record.member_rows),
            (self.token.pk, staff.pk, digest, 2, 2),
        )
        self.the_principal_the_middleware_would_set(self.owner)
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            RegisterExport.objects.filter(pk=record.pk).exists()
