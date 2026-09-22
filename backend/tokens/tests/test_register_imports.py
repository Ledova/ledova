import csv
import io
from datetime import date, timedelta
from importlib import import_module
from unittest.mock import Mock
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, IntegrityError, connection, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django.utils.html import escape
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase
from web3 import Web3

from companies.models import CompanyDocument, DocumentType
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import DOCUMENT_BYTES, attach_file
from offerings.tests.factories import allottable_subscription
from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic, current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    FormerHolder,
    ImportedFormerMember,
    IssuanceStatus,
    RegisterEntry,
    RegisterEntryKind,
    RegisterImport,
    RegisterInstruction,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.models.choices import (
    IDENTITY_LABELS,
    IDENTITY_LIVE,
    IDENTITY_PARTICULARS,
    IDENTITY_STAMPED,
)
from tokens.services.former_holders import (
    fold_former_holders,
    purge_imported_former_members,
    purge_member_particulars,
    retention_cutoff,
)
from tokens.services.register import (
    AS_AT_ROW,
    FORMER_MEMBER_HEADERS,
    MEMBER_AMBIGUOUS_NAME,
    NEVER_FOLDED,
    NEVER_RECONCILED,
    NOT_ON_CHAIN,
    RECONCILED_ROW,
    REGISTER_HEADERS,
    STALE,
    WAITING_ROW,
    WAITING_UNKNOWN,
)
from tokens.services.register_events import (
    create_member,
    open_register,
    record_entry,
    verify_register,
)
from tokens.services.register_imports import (
    decide_import,
    prepare_import_review,
    submit_import,
)
from tokens.services.register_instructions import (
    APPROVED,
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.tests.instruction_fixtures import instruction_payload
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_instructions import instruction_fixture
from tokens.tests.test_the_fold_that_writes_former_members import (
    ALICE,
    BOB,
    ZERO,
    transfer,
)
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.models import WhitelistEntry, WhitelistStatus

RESIDENCE = "12 Register Street, Sydney NSW 2000"
PARTICULARS = IDENTITY_LABELS[IDENTITY_PARTICULARS]
CAROL = Web3.to_checksum_address("0x" + "c3" * 20)
LIVE = Web3.to_checksum_address("0x" + "11" * 20)
FIRST = Web3.to_checksum_address("0x" + "22" * 20)
SECOND = Web3.to_checksum_address("0x" + "33" * 20)
STAMPED = Web3.to_checksum_address("0x" + "44" * 20)
NEWCOMER = {
    "name": "Nia Newcomer",
    "residential_address": "7 New Street, Perth WA 6000",
    "shares": "40",
    "entered_on": "2020-02-02",
    "amount_paid": None,
}
DECIDED = {"status": "applied", "asic_issued_total": 100, "asic_member_count": 2, "register_sequence": 1}


def verified_document(company, reviewer, document_type, name):
    document = attach_file(
        CompanyDocument.objects.create(
            company=company,
            document_type=document_type,
            name=name,
            file_size=len(DOCUMENT_BYTES),
            mime_type="application/pdf",
        )
    )
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    return verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)


def import_fixture():
    owner, company, token, member, other, opening = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    reviewer = get_user_model().objects.create_user(
        email=f"import-{uuid4()}@example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registerimport", "view_registerimport"]
        )
    )
    register_document = verified_document(company, reviewer, DocumentType.SHARE_REGISTER, "Share register")
    asic = verified_document(company, reviewer, DocumentType.ASIC_EXTRACT, "ASIC extract")
    return owner, company, token, member, reviewer, register_document, asic, opening


def import_payload(token, register_document, asic, member, **changes):
    return {
        "operation_id": uuid4(),
        "token_id": token.pk,
        "document_id": register_document.pk,
        "asic_document_id": asic.pk,
        "as_at": DAY.isoformat(),
        "members": [
            {
                "member": str(member.pk),
                "name": "Mia Member",
                "residential_address": RESIDENCE,
                "shares": "100",
                "entered_on": "2019-05-01",
                "amount_paid": "250.00",
            }
        ],
        "former_members": [
            {
                "name": "Fred Former",
                "residential_address": "3 Old Road, Hobart TAS 7000",
                "shares": "40",
                "ceased_on": "2022-03-01",
            }
        ],
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-IMPORT-1",
        "reason": "Import the company's existing register",
        **changes,
    }


def live_wallet(company, member, address, name, residence=RESIDENCE):
    user = get_user_model().objects.create_user(email=f"live-{uuid4()}@example.test", password="pw-12345678")
    profile = UserProfile.objects.create(user=user, full_name=name, residential_address=residence)
    account = UserAccount.objects.create(account_number=str(uuid4())[:20], user_profile=profile)
    wallet = Wallet.objects.create(user_account=account, address=address, chain="base")
    WhitelistEntry.objects.create(wallet=wallet, status=WhitelistStatus.ACTIVE)
    RegisterMemberWallet.objects.create(company=company, member=member, address=address)


class RegisterImportTest(TransactionTestCase):
    def setUp(self):
        (
            self.owner,
            self.company,
            self.token,
            self.member,
            self.reviewer,
            self.register_document,
            self.asic,
            self.opening,
        ) = import_fixture()
        self.payload = import_payload(self.token, self.register_document, self.asic, self.member)
        self.newcomer = uuid4()

    def submit(self, **changes):
        return submit_import(actor=self.owner, **{**self.payload, **changes})

    def unopened(self, symbol="UNO", **fields):
        return ShareToken.objects.create(
            company=self.company, name=f"{symbol} shares", symbol=symbol, total_supply="1000", **fields
        )

    def opening_import(self, token, **changes):
        return {
            "operation_id": uuid4(),
            "token_id": token.pk,
            "members": [{**self.payload["members"][0], "shares": "60"}, {**NEWCOMER, "member": str(self.newcomer)}],
            "former_members": [{**self.payload["former_members"][0], "ceased_on": DAY.isoformat()}],
            **changes,
        }

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def opening_changes(self, newcomer_shares="40"):
        return sorted(
            [
                {"member": str(self.member.pk), "shares": "60"},
                {"member": str(self.newcomer), "shares": newcomer_shares},
            ],
            key=lambda change: change["member"],
        )

    def apply(self, proposal, total=100, count=1):
        _, _, confirmation = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        return decide_import(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            asic_issued_total=total,
            asic_member_count=count,
        )

    def move(self, source, target, shares, effective_on=DAY):
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.TRANSFER,
            changes=sorted(
                [{"member": str(source.pk), "shares": str(-shares)}, {"member": str(target.pk), "shares": str(shares)}],
                key=lambda change: change["member"],
            ),
            effective_on=effective_on,
            recorded_by=self.owner,
        )

    def export(self, token=None):
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(f"/api/v1/tokens/{(token or self.token).uuid}/register/export/")
        self.assertEqual(response.status_code, 200)
        return list(csv.reader(io.StringIO(response.content.decode())))

    def members(self, token=None):
        rows = self.export(token)
        return {row[0]: dict(zip(REGISTER_HEADERS, row)) for row in rows[1 : rows.index([])]}

    def test_submission_binds_both_documents_and_retains_the_register_copy(self):
        proposal = self.submit()
        self.assertEqual((proposal.status, proposal.token_id, proposal.as_at), ("submitted", self.token.pk, DAY))
        self.assertEqual(
            (proposal.evidence_fingerprint, proposal.asic_document, proposal.asic_fingerprint),
            (self.register_document.verified_fingerprint, self.asic.pk, self.asic.verified_fingerprint),
        )
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        self.assertEqual(proposal.members[0]["amount_paid"], "250.00")
        self.assertEqual(self.submit(operation_id=self.payload["operation_id"]).pk, proposal.pk)

    def test_submission_refuses_unusable_rows_and_documents(self):
        row = self.payload["members"][0]
        for changes in (
            {"members": []},
            {"members": [{**row, "member": str(uuid4())}]},
            {"members": [row, row]},
            {"members": [{**row, "shares": "0"}]},
            {"members": [{**row, "shares": "1" * 79}]},
            {"members": [{**row, "entered_on": "2030-01-01"}]},
            {"members": [{**row, "name": " "}]},
            {"former_members": [{**self.payload["former_members"][0], "ceased_on": "2030-01-01"}]},
            {"document_id": self.asic.pk},
            {"asic_document_id": self.register_document.pk},
            {"as_at": (timezone.localdate() + timedelta(days=1)).isoformat()},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterImport.objects.exists())

    def test_submission_refuses_text_longer_than_its_column(self):
        row = self.payload["members"][0]
        former = self.payload["former_members"][0]
        for changes in (
            {"members": [{**row, "name": "N" * 256}]},
            {"former_members": [{**former, "name": "N" * 256}]},
            {"members": [{**row, "residential_address": "A" * 1001}]},
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(ValidationError, "at most"):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterImport.objects.exists())
        self.apply(self.submit(members=[{**row, "name": "N" * 255}], former_members=[{**former, "name": "F" * 255}]))
        self.assertEqual(RegisterMemberParticulars.objects.get(member=self.member).name, "N" * 255)
        self.assertEqual(ImportedFormerMember.objects.get().name, "F" * 255)

    def test_amounts_paid_are_plain_amounts_of_at_most_two_places_within_the_guards_bounds(self):
        row = self.payload["members"][0]
        for amount in ("1e2", "100.000", "-0", "-1.00", "0100", "1" * 19, " 1.00", "1.", ".50", "1,000.00", 250):
            with self.subTest(amount=amount), self.assertRaisesMessage(ValidationError, "plain amount"):
                self.submit(operation_id=uuid4(), members=[{**row, "amount_paid": amount}])
        self.assertFalse(RegisterImport.objects.exists())
        for amount in ("0", "0.5", "1" * 18 + ".99", None):
            with self.subTest(amount=amount):
                proposal = self.submit(operation_id=uuid4(), members=[{**row, "amount_paid": amount}])
                self.assertEqual(proposal.members[0]["amount_paid"], amount)

    def test_imported_former_members_ceased_before_the_opening_and_inside_the_retention_floor(self):
        former = self.payload["former_members"][0]
        cutoff = retention_cutoff()
        for ceased_on, message in (
            (DAY, f"before the register's opening on {DAY.isoformat()}"),
            (cutoff - timedelta(days=1), f"ceased before {cutoff.isoformat()}"),
        ):
            with self.subTest(ceased_on=ceased_on), self.assertRaisesMessage(ValidationError, message):
                self.submit(operation_id=uuid4(), former_members=[{**former, "ceased_on": ceased_on.isoformat()}])
        self.assertFalse(RegisterImport.objects.exists())
        edges = [cutoff, DAY - timedelta(days=1)]
        proposal = self.submit(former_members=[{**former, "ceased_on": day.isoformat()} for day in edges])
        self.assertEqual([row["ceased_on"] for row in proposal.former_members], [day.isoformat() for day in edges])

    def test_application_records_particulars_former_members_and_the_asic_figures(self):
        proposal = self.submit()
        _, comparison, _ = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        self.assertEqual(
            comparison,
            [
                {
                    "member": str(self.member.pk),
                    "imported": 100,
                    "stored": 100,
                    "entered_on": DAY,
                    "name": "Mia Member",
                    "imported_entered_on": "2019-05-01",
                    "wallets": [],
                    "live_name": "",
                    "live_address": "",
                }
            ],
        )
        applied = self.apply(proposal)
        self.assertEqual(
            (applied.status, applied.asic_issued_total, applied.asic_member_count, applied.register_sequence),
            ("applied", 100, 1, 1),
        )
        self.assertEqual(list(RegisterEntry.objects.filter(register__token=self.token)), [self.opening])
        particulars = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((particulars.name, particulars.residential_address), ("Mia Member", RESIDENCE))
        (former,) = ImportedFormerMember.objects.all()
        self.assertEqual(
            (former.name, former.shares_at_cessation, former.ceased_on), ("Fred Former", 40, date(2022, 3, 1))
        )

    def test_replaying_an_application_with_other_asic_figures_conflicts(self):
        proposal = self.apply(self.submit())
        replay = {"proposal_id": proposal.pk, "reviewer": self.reviewer, "confirmation": "", "decision": "apply"}
        repeated = decide_import(**replay, asic_issued_total=100, asic_member_count=1)
        self.assertEqual((repeated.pk, repeated.status), (proposal.pk, "applied"))
        for total, count in ((99, 1), (100, 2)):
            with self.subTest(total=total, count=count), self.assertRaises(RegisterChangeConflict):
                decide_import(**replay, asic_issued_total=total, asic_member_count=count)
        proposal.refresh_from_db()
        self.assertEqual((proposal.asic_issued_total, proposal.asic_member_count), (100, 1))

    def test_figures_that_differ_from_the_asic_extract_or_changed_holdings_refuse_application(self):
        proposal = self.submit()
        for total, count, message in ((99, 1, "ASIC extract shows 99"), (100, 2, "held by 2 members")):
            with self.subTest(total=total, count=count), self.assertRaisesMessage(ValidationError, message):
                self.apply(proposal, total, count)
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(self.member.pk), "shares": "5"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        with self.assertRaisesMessage(ValidationError, "(import 100, stored 105)"):
            self.apply(proposal)
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        rejected = decide_import(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation="",
            decision="reject",
            rejection_reason="Stale",
        )
        self.assertEqual((rejected.status, rejected.asic_issued_total), ("rejected", None))

    def test_the_imported_date_entered_lasts_while_the_holding_is_continuous_and_amount_paid_while_unchanged(self):
        self.apply(self.submit())
        rows = self.export()
        member = dict(zip(REGISTER_HEADERS, rows[1]))
        self.assertEqual(
            [
                member[header]
                for header in ("Name", "Residential address", "Identity source", "Date entered", "Amount paid")
            ],
            ["Mia Member", RESIDENCE, PARTICULARS, "2019-05-01", "250.00"],
        )
        heading = rows.index(FORMER_MEMBER_HEADERS)
        former = dict(zip(FORMER_MEMBER_HEADERS, rows[heading + 1]))
        self.assertEqual(
            [
                former[header]
                for header in ("Name", "Wallet address", "Shares held on ceasing", "Date ceased", "Identity source")
            ],
            ["Fred Former", "", "40", "2022-03-01", PARTICULARS],
        )
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(self.member.pk), "shares": "5"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        member = self.members()[str(self.member.pk)]
        self.assertEqual(
            [member[header] for header in ("Name", "Shares held", "Date entered", "Amount paid")],
            ["Mia Member", "105", "2019-05-01", ""],
        )
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        returned = DAY + timedelta(days=1)
        self.move(self.member, other, 105)
        self.move(other, self.member, 105, effective_on=returned)
        member = self.members()[str(self.member.pk)]
        self.assertEqual(
            [member[header] for header in ("Shares held", "Date entered", "Amount paid")],
            ["105", returned.isoformat(), ""],
        )

    def test_the_import_leaves_the_date_entered_and_amount_paid_the_platform_recorded(self):
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        self.move(self.member, other, 40)
        row = self.payload["members"][0]
        proposal = self.submit(
            members=[
                {**row, "shares": "60"},
                {
                    "member": str(other.pk),
                    "name": "Olive Other",
                    "residential_address": "4 Other Road, Perth WA 6000",
                    "shares": "40",
                    "entered_on": "2018-01-01",
                    "amount_paid": "999.00",
                },
            ]
        )
        self.apply(proposal, total=100, count=2)
        members = self.members()
        self.assertEqual(
            [members[str(self.member.pk)][header] for header in ("Name", "Date entered", "Amount paid")],
            ["Mia Member", "2019-05-01", "250.00"],
        )
        self.assertEqual(
            [members[str(other.pk)][header] for header in ("Name", "Date entered", "Amount paid")],
            ["Olive Other", DAY.isoformat(), ""],
        )

    def test_a_share_class_takes_one_applied_import(self):
        first = self.submit()
        second = self.submit(operation_id=uuid4())
        _, _, confirmation = prepare_import_review(proposal_id=second.pk, reviewer=self.reviewer)
        self.apply(first)
        refusal = "already has an applied import"
        with self.assertRaisesMessage(ValidationError, refusal):
            self.submit(operation_id=uuid4())
        with self.assertRaisesMessage(ValidationError, refusal):
            prepare_import_review(proposal_id=second.pk, reviewer=self.reviewer)
        with self.assertRaisesMessage(ValidationError, refusal):
            decide_import(
                proposal_id=second.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                asic_issued_total=100,
                asic_member_count=1,
            )
        RegisterMemberParticulars.objects.filter(member=self.member).update(source_import=second)
        with self.assertRaisesMessage(IntegrityError, "one_applied_register_import_per_class"), atomic():
            RegisterImport.objects.filter(pk=second.pk).update(
                status="applied",
                reviewed_by=self.reviewer,
                reviewed_at=timezone.now(),
                asic_issued_total=100,
                asic_member_count=1,
                register_sequence=1,
            )
        self.assertEqual(ImportedFormerMember.objects.count(), 1)

    def test_an_older_import_for_another_class_keeps_the_newer_particulars(self):
        row = self.payload["members"][0]
        imports = {}
        for symbol, as_at, residence in (
            ("OLD", date(2020, 6, 1), "Older address"),
            ("NEW", DAY, "Newer address"),
            ("OLDER", date(2019, 12, 1), "Oldest address"),
        ):
            token = ShareToken.objects.create(company=self.company, name=symbol, symbol=symbol, total_supply="1000")
            open_register(
                token_id=token.pk,
                operation_id=uuid4(),
                changes=[{"member": str(self.member.pk), "shares": "100"}],
                effective_on=DAY,
                recorded_by=self.owner,
            )
            imports[symbol] = self.submit(
                operation_id=uuid4(),
                token_id=token.pk,
                as_at=as_at.isoformat(),
                members=[{**row, "residential_address": residence}],
                former_members=[],
            )
        for symbol, residence, source in (
            ("OLD", "Older address", "OLD"),
            ("NEW", "Newer address", "NEW"),
            ("OLDER", "Newer address", "NEW"),
        ):
            self.apply(imports[symbol])
            particulars = RegisterMemberParticulars.objects.get(member=self.member)
            with self.subTest(applied=symbol):
                self.assertEqual(
                    (particulars.residential_address, particulars.source_import_id), (residence, imports[source].pk)
                )
        self.assertEqual(
            self.members(imports["OLDER"].token)[str(self.member.pk)]["Residential address"], "Newer address"
        )

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_live_identity_wins_an_ambiguous_one_stays_and_particulars_fill_in_only_where_nothing_resolves(self):
        ambiguous, walletless, stamped = (create_member(company_id=self.company.pk, member_id=uuid4()) for _ in "abc")
        for member in (ambiguous, walletless, stamped):
            self.move(self.member, member, 25)
        live_wallet(self.company, self.member, LIVE, "Live Mia", "1 Live Street")
        live_wallet(self.company, ambiguous, FIRST, "Bea One")
        live_wallet(self.company, ambiguous, SECOND, "Ben Two")
        RegisterMemberWallet.objects.create(company=self.company, member=stamped, address=STAMPED)
        ShareIssuance.objects.create(
            token=self.token,
            recipient_address=STAMPED,
            recipient_name="Stamped Sam",
            recipient_residential_address="5 Stamp Street",
            identity_stamped_at=timezone.now(),
            amount="25",
            status=IssuanceStatus.COMPLETED,
            completed_at=timezone.now(),
        )
        row = self.payload["members"][0]
        proposal = self.submit(
            members=[
                {**row, "member": str(member.pk), "name": f"Imported {label}", "shares": "25"}
                for label, member in (("Mia", self.member), ("Amy", ambiguous), ("Wes", walletless), ("Sam", stamped))
            ]
        )
        _, comparison, _ = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        self.assertEqual(
            {row["member"]: (row["name"], row["live_name"], row["wallets"], row["entered_on"]) for row in comparison},
            {
                str(self.member.pk): ("Imported Mia", "Live Mia", [LIVE], DAY),
                str(ambiguous.pk): ("Imported Amy", MEMBER_AMBIGUOUS_NAME, [FIRST, SECOND], DAY),
                str(walletless.pk): ("Imported Wes", "", [], DAY),
                str(stamped.pk): ("Imported Sam", "", [STAMPED], DAY),
            },
        )
        self.client.force_login(self.reviewer)
        page = self.client.get(reverse("admin:tokens_registerimport_review", args=[proposal.pk]))
        for shown in ("Live Mia, 1 Live Street", LIVE, f"{FIRST}, {SECOND}", MEMBER_AMBIGUOUS_NAME, DAY.isoformat()):
            self.assertContains(page, escape(shown))
        self.apply(proposal, total=100, count=4)
        members = self.members()
        shown = ("Name", "Residential address", "Holder type", "Identity source")
        self.assertEqual(
            [members[str(self.member.pk)][header] for header in shown],
            ["Live Mia", "1 Live Street", "Member", IDENTITY_LABELS[IDENTITY_LIVE]],
        )
        self.assertEqual(
            [members[str(ambiguous.pk)][header] for header in shown[:3]], [MEMBER_AMBIGUOUS_NAME, "", "Ambiguous"]
        )
        self.assertEqual(
            [members[str(walletless.pk)][header] for header in shown],
            ["Imported Wes", RESIDENCE, "Member", PARTICULARS],
        )
        self.assertEqual(
            [members[str(stamped.pk)][header] for header in shown[:3]], ["Stamped Sam", "5 Stamp Street", "Member"]
        )
        self.assertTrue(members[str(stamped.pk)]["Identity source"].startswith("Stamped at allotment on "))

    def test_a_folded_former_member_keeps_the_imported_particulars_when_nothing_else_resolves(self):
        self.apply(self.submit())
        for address in (ALICE, CAROL):
            RegisterMemberWallet.objects.create(company=self.company, member=self.member, address=address)
        ShareIssuance.objects.create(
            token=self.token,
            recipient_address=CAROL,
            recipient_name="Stamped Mia",
            recipient_residential_address="9 Stamp Street",
            identity_stamped_at=timezone.now() - timedelta(days=1),
            amount="50",
            status=IssuanceStatus.COMPLETED,
            completed_at=timezone.now() - timedelta(days=1),
        )
        ShareToken.objects.filter(pk=self.token.pk).update(deployment_tx_hash="0x" + "de" * 32)
        self.token.refresh_from_db()
        reader = Mock()
        reader.finalized_block.return_value = 99
        reader.deployment_block.return_value = 1
        reader.block_date.side_effect = lambda block: DAY + timedelta(days=block)
        reader.transfer_entries.return_value = [
            transfer(ZERO, ALICE, 100, 10),
            transfer(ALICE, BOB, 100, 20),
            transfer(ZERO, CAROL, 50, 30),
            transfer(CAROL, BOB, 50, 40),
        ]
        fold_former_holders(self.token, reader=reader)
        folded = {
            row.wallet_address: (row.name, row.residential_address, row.identity_source)
            for row in FormerHolder.objects.filter(token=self.token)
        }
        self.assertEqual(
            folded,
            {
                ALICE: ("Mia Member", RESIDENCE, IDENTITY_PARTICULARS),
                CAROL: ("Stamped Mia", "9 Stamp Street", IDENTITY_STAMPED),
            },
        )

    def test_the_holders_api_lists_imported_former_members_as_the_csv_does(self):
        self.apply(self.submit())
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(f"/api/v1/tokens/{self.token.uuid}/holders/")
        self.assertEqual(response.status_code, 200)
        (former,) = response.json()["formerMembers"]
        self.assertEqual(
            {key: former[key] for key in former if key not in ("uuid", "identityRecordedAt")},
            {
                "walletAddress": None,
                "name": "Fred Former",
                "residentialAddress": "3 Old Road, Hobart TAS 7000",
                "sharesAtCessation": "40",
                "ceasedOn": "2022-03-01",
                "ceasedAtBlock": None,
                "identitySource": IDENTITY_PARTICULARS,
                "identitySourceDisplay": PARTICULARS,
            },
        )
        rows = self.export()
        heading = rows.index(FORMER_MEMBER_HEADERS)
        self.assertEqual(rows[heading + 1][0], "Fred Former")

    def test_the_database_refuses_forged_imports_rewrites_and_deletion(self):
        proposal = self.submit()
        with self.assertRaises(DatabaseError), atomic():
            RegisterImport.objects.filter(pk=proposal.pk).update(members=[])
        with self.assertRaises(DatabaseError), atomic():
            RegisterImport.objects.filter(pk=proposal.pk).update(
                status="applied",
                reviewed_by=self.reviewer,
                reviewed_at=timezone.now(),
                asic_issued_total=100,
                asic_member_count=1,
                register_sequence=1,
            )
        with self.assertRaises(DatabaseError), atomic():
            proposal.delete()
        forged = {
            field.name: getattr(proposal, field.name)
            for field in RegisterImport._meta.fields
            if field.name not in ("uuid", "created_at", "updated_at", "file")
        }
        member = proposal.members[0]
        without_amount = {key: value for key, value in member.items() if key != "amount_paid"}
        former = proposal.former_members[0]
        for changes in (
            {"members": [{**member, "member": None}]},
            {"members": [{**member, "shares": "0"}]},
            {"members": [{**member, "residential_address": ""}]},
            {"members": [{**without_amount, "note": "an extra key in place of amount_paid"}]},
            {"former_members": [{**former, "note": "an extra key"}]},
            {"former_members": [{**former, "ceased_on": DAY.isoformat()}]},
        ):
            forged_id = uuid4()
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                RegisterImport.objects.create(
                    **{
                        **forged,
                        **changes,
                        "uuid": forged_id,
                        "file": f"companies/{self.company.pk}/register-imports/{forged_id}/{uuid4()}.bin",
                    }
                )
        self.assertEqual(RegisterImport.objects.count(), 1)

    def test_particulars_and_imported_former_members_follow_the_seven_year_clock_and_the_import_is_kept(self):
        proposal = self.apply(self.submit())
        ceased = timezone.make_aware(timezone.datetime(2022, 3, 1))
        self.assertEqual(purge_imported_former_members(now=ceased + timedelta(days=2557)), 0)
        self.assertEqual(purge_imported_former_members(now=ceased + timedelta(days=2559)), 1)
        later = timezone.now() + timedelta(days=4000)
        self.assertEqual(purge_member_particulars(now=later), 0)
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        self.move(self.member, other, 100)
        left = timezone.make_aware(timezone.datetime.combine(DAY, timezone.datetime.min.time()))
        self.assertEqual(purge_member_particulars(now=left + timedelta(days=2557)), 0)
        self.assertEqual(purge_member_particulars(now=left + timedelta(days=2559)), 1)
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        proposal.refresh_from_db()
        self.assertEqual(
            (proposal.members[0]["name"], proposal.former_members[0]["name"]), ("Mia Member", "Fred Former")
        )
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))

    def test_an_import_opens_a_class_not_yet_on_chain_with_its_members_particulars_and_former_members(self):
        deployed = self.unopened(
            "DEP",
            status=ShareTokenStatus.DEPLOYED,
            contract_address=Web3.to_checksum_address("0x" + "d4" * 20),
            chain=BLOCKCHAIN_BASE,
        )
        shown = ("Name", "Shares held", "Identity source", "Date entered", "Amount paid")
        for token in (self.unopened(), deployed):
            with self.subTest(status=token.status):
                proposal = self.submit(**self.opening_import(token))
                _, comparison, _ = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
                self.assertEqual(
                    {row["member"]: (row["imported"], row["stored"]) for row in comparison},
                    {str(self.member.pk): (60, None), str(self.newcomer): (40, None)},
                )
                applied = self.apply(proposal, total=100, count=2)
                self.assertEqual((applied.status, applied.register_sequence), ("applied", 1))
                (entry,) = RegisterEntry.objects.filter(register__token=token)
                self.assertEqual(
                    (entry.kind, entry.sequence, entry.operation_id, entry.effective_on, entry.recorded_by_id),
                    (RegisterEntryKind.OPENING, 1, proposal.pk, DAY, self.reviewer.pk),
                )
                self.assertEqual(entry.changes, self.opening_changes())
                self.assertEqual(verify_register(entry.register_id)["issued_supply"], "100")
                self.assertEqual(
                    [(row.name, row.ceased_on) for row in ImportedFormerMember.objects.filter(token=token)],
                    [("Fred Former", DAY)],
                )
                members = self.members(token)
                self.assertEqual(
                    {member: [members[member][header] for header in shown] for member in members},
                    {
                        str(self.member.pk): ["Mia Member", "60", PARTICULARS, "2019-05-01", "250.00"],
                        str(self.newcomer): ["Nia Newcomer", "40", PARTICULARS, "2020-02-02", ""],
                    },
                )
        self.assertEqual(RegisterMember.objects.get(pk=self.newcomer).company_id, self.company.pk)
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_an_approved_issue_keeps_a_class_from_being_opened_by_an_import(self):
        token = self.unopened()
        proposal = self.submit(**self.opening_import(token))
        _, _, confirmation = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        ShareIssuanceRequest.objects.create(token=token, recipient_address=CAROL, amount=5, reason="Allot").approve(
            self.reviewer
        )
        refusal = "has an approved issue or an applied register instruction"
        with self.assertRaisesMessage(ValidationError, refusal):
            self.submit(**self.opening_import(token))
        with self.assertRaisesMessage(ValidationError, refusal):
            prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        with self.assertRaisesMessage(ValidationError, refusal):
            decide_import(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                asic_issued_total=100,
                asic_member_count=2,
            )
        self.assertFalse(ShareRegister.objects.filter(token=token).exists())
        self.assertFalse(RegisterMember.objects.filter(pk=self.newcomer).exists())

    def test_a_class_opened_after_submission_applies_the_import_by_the_opened_rules(self):
        token = self.unopened()
        dated = self.submit(**self.opening_import(token))
        earlier = self.submit(**self.opening_import(token, former_members=self.payload["former_members"]))
        confirmations = {
            proposal.pk: prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)[2]
            for proposal in (dated, earlier)
        }
        open_register(
            token_id=token.pk,
            operation_id=uuid4(),
            changes=[{"member": str(self.member.pk), "shares": "100"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        for proposal, refusal in (
            (dated, f"ceased before the register's opening on {DAY.isoformat()}"),
            (earlier, f"{self.newcomer} (import 40, stored None)"),
        ):
            with self.subTest(refusal=refusal), self.assertRaisesMessage(ValidationError, refusal):
                decide_import(
                    proposal_id=proposal.pk,
                    reviewer=self.reviewer,
                    confirmation=confirmations[proposal.pk],
                    decision="apply",
                    asic_issued_total=100,
                    asic_member_count=2,
                )
        self.assertEqual(RegisterEntry.objects.filter(register__token=token).count(), 1)
        self.assertFalse(RegisterMember.objects.filter(pk=self.newcomer).exists())
        with self.assertRaisesMessage(ValidationError, "must already be a member"):
            self.submit(**self.opening_import(token, former_members=self.payload["former_members"]))

    def test_an_opening_import_refuses_a_member_of_another_company(self):
        _, _, _, stranger, _, _ = register_fixture()
        row = {**self.payload["members"][0], "member": str(stranger.pk), "shares": "100"}
        with self.assertRaisesMessage(ValidationError, "must belong to this company"):
            self.submit(**self.opening_import(self.unopened(), members=[row]))
        self.assertFalse(RegisterImport.objects.exists())

    def test_asic_figures_that_differ_refuse_an_opening_and_record_nothing(self):
        token = self.unopened()
        proposal = self.submit(**self.opening_import(token))
        for total, count, message in ((99, 2, "ASIC extract shows 99 shares"), (100, 1, "held by 1 members")):
            with self.subTest(total=total, count=count), self.assertRaisesMessage(ValidationError, message):
                self.apply(proposal, total, count)
        self.assertEqual(RegisterImport.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(ShareRegister.objects.filter(token=token).exists())
        self.assertFalse(RegisterMember.objects.filter(pk=self.newcomer).exists())
        self.assertFalse(RegisterMemberParticulars.objects.exists())

    def test_replaying_an_opening_returns_it_and_leaves_one_entry(self):
        token = self.unopened()
        payload = self.opening_import(token)
        proposal = self.submit(**payload)
        self.assertEqual(self.submit(**payload).pk, proposal.pk)
        self.apply(proposal, total=100, count=2)
        replay = {"proposal_id": proposal.pk, "reviewer": self.reviewer, "confirmation": "", "decision": "apply"}
        self.assertEqual(decide_import(**replay, asic_issued_total=100, asic_member_count=2).status, "applied")
        with self.assertRaises(RegisterChangeConflict):
            decide_import(**replay, asic_issued_total=100, asic_member_count=1)
        self.assertEqual(ShareRegister.objects.get(token=token).sequence, 1)
        with self.assertRaisesMessage(ValidationError, "already has an applied import"):
            self.submit(**self.opening_import(token))

    def test_the_database_ties_an_opening_import_to_exactly_its_own_entry(self):
        token = self.unopened()
        proposal = self.submit(**self.opening_import(token))
        exact = {
            "token_id": token.pk,
            "operation_id": proposal.pk,
            "changes": self.opening_changes(),
            "effective_on": DAY,
            "recorded_by": self.reviewer,
        }

        def unchanged():
            pass

        def an_issue_after_it():
            record_entry(
                register_id=ShareRegister.objects.get(token=token).pk,
                operation_id=uuid4(),
                kind=RegisterEntryKind.ISSUE,
                changes=[{"member": str(self.newcomer), "shares": "5"}],
                effective_on=DAY,
                recorded_by=self.owner,
            )

        def an_approved_issue():
            request = ShareIssuanceRequest.objects.create(
                token=token, recipient_address=CAROL, amount=5, reason="Allot"
            )
            request.approve(self.reviewer)

        def forge(entry, after=unchanged):
            for row in proposal.members:
                create_member(company_id=self.company.pk, member_id=row["member"])
                RegisterMemberParticulars.objects.update_or_create(
                    member_id=row["member"],
                    defaults={
                        "name": row["name"],
                        "residential_address": row["residential_address"],
                        "source_import": proposal,
                    },
                )
            if entry is not None:
                open_register(**entry)
            after()
            RegisterImport.objects.filter(pk=proposal.pk).update(
                **DECIDED, reviewed_by=self.reviewer, reviewed_at=timezone.now()
            )

        for entry, after in (
            (None, unchanged),
            ({**exact, "changes": self.opening_changes(newcomer_shares="50")}, unchanged),
            ({**exact, "effective_on": DAY - timedelta(days=1)}, unchanged),
            ({**exact, "recorded_by": self.owner}, unchanged),
            (exact, an_issue_after_it),
            (exact, an_approved_issue),
        ):
            with self.subTest(entry=entry, after=after.__name__):
                self.assert_refused("exactly the register's only entry", lambda: forge(entry, after))
        self.assert_refused("ceased before the register's opening", lambda: forge({**exact, "operation_id": uuid4()}))
        with self.assertRaises(RuntimeError), atomic():
            forge(exact)
            self.assertEqual(RegisterImport.objects.get(pk=proposal.pk).status, "applied")
            raise RuntimeError("rollback")
        self.assertEqual(RegisterImport.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(ShareRegister.objects.filter(token=token).exists())

    def test_the_database_admits_an_opening_import_only_for_an_eligible_class_and_its_companys_members(self):
        token = self.unopened()
        proposal = self.submit(**self.opening_import(token))
        forged = {
            field.name: getattr(proposal, field.name)
            for field in RegisterImport._meta.fields
            if field.name not in ("uuid", "created_at", "updated_at", "file")
        }
        _, _, _, stranger, _, _ = register_fixture()

        def insert(**changes):
            forged_id = uuid4()
            RegisterImport.objects.create(
                **{
                    **forged,
                    **changes,
                    "uuid": forged_id,
                    "file": f"companies/{self.company.pk}/register-imports/{forged_id}/{uuid4()}.bin",
                }
            )

        row = proposal.members[0]
        self.assert_refused("exact current intent", lambda: insert(members=[{**row, "member": str(stranger.pk)}]))
        with self.assertRaises(RuntimeError), atomic():
            insert(members=[{**row, "member": str(uuid4())}])
            raise RuntimeError("rollback")
        ShareIssuanceRequest.objects.create(token=token, recipient_address=CAROL, amount=5, reason="Allot").approve(
            self.reviewer
        )
        self.assert_refused("exact current intent", insert)
        self.assertEqual(RegisterImport.objects.count(), 1)

    def test_an_import_opened_class_reads_not_on_chain_with_nothing_waiting_until_a_completion(self):
        token = self.unopened()
        self.apply(self.submit(**self.opening_import(token)), total=100, count=2)
        client = APIClient()
        client.force_authenticate(self.owner)
        rows = self.export(token)
        self.assertIn([RECONCILED_ROW, NOT_ON_CHAIN], rows)
        self.assertIn([AS_AT_ROW, NOT_ON_CHAIN], rows)
        self.assertNotIn(WAITING_ROW, [row[0] for row in rows if row])
        self.assertEqual(client.get(f"/api/v1/tokens/{token.uuid}/holders/").json()["waitingEffects"], 0)
        self.assertEqual(client.get(f"/api/v1/tokens/{token.uuid}/register/waiting/").json(), {"effects": []})
        synthetic = self.export()
        for row in (
            [RECONCILED_ROW, NEVER_RECONCILED],
            [AS_AT_ROW, NEVER_FOLDED, STALE],
            [WAITING_ROW, WAITING_UNKNOWN],
        ):
            self.assertIn(row, synthetic)
        ShareIssuance.objects.create(
            token=token,
            recipient_address=CAROL,
            amount="5",
            status=IssuanceStatus.COMPLETED,
            completed_at=timezone.now(),
        )
        self.assertIn([WAITING_ROW, WAITING_UNKNOWN], self.export(token))
        self.assertEqual(client.get(f"/api/v1/tokens/{token.uuid}/register/waiting/").json(), {"effects": None})


class ImportOpenedInstructionTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.reviewer, self.document, self.request = instruction_fixture("import-opened")
        self.token = self.tenant.deployed_token
        self.reviewer.user_permissions.add(
            *Permission.objects.filter(codename__in=["change_registerimport", "view_registerimport"])
        )
        self.member = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        self.payload = import_payload(
            self.token,
            verified_document(self.tenant.company, self.reviewer, DocumentType.SHARE_REGISTER, "Share register"),
            verified_document(self.tenant.company, self.reviewer, DocumentType.ASIC_EXTRACT, "ASIC extract"),
            self.member,
        )

    def submit(self):
        proposal = submit_import(actor=self.tenant.user, **{**self.payload, "operation_id": uuid4()})
        return proposal, prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)[2]

    def decide(self, proposal, confirmation):
        return decide_import(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            asic_issued_total=100,
            asic_member_count=1,
        )

    def test_an_applied_register_instruction_keeps_a_class_from_being_opened_by_an_import(self):
        proposal, confirmation = self.submit()
        allottable_subscription(self.tenant)
        self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token, status__in=APPROVED).exists())
        refusal = "has an approved issue or an applied register instruction"
        with self.assertRaisesMessage(ValidationError, refusal):
            self.submit()
        with self.assertRaisesMessage(ValidationError, refusal):
            self.decide(proposal, confirmation)
        with self.assertRaisesMessage(DatabaseError, "exactly the register's only entry"), atomic():
            open_register(
                token_id=self.token.pk,
                operation_id=proposal.pk,
                changes=[{"member": str(self.member.pk), "shares": "100"}],
                effective_on=DAY,
                recorded_by=self.reviewer,
            )
            RegisterMemberParticulars.objects.create(
                member=self.member, name="Mia Member", residential_address=RESIDENCE, source_import=proposal
            )
            RegisterImport.objects.filter(pk=proposal.pk).update(
                **{**DECIDED, "asic_member_count": 1}, reviewed_by=self.reviewer, reviewed_at=timezone.now()
            )
        self.assertFalse(RegisterEntry.objects.filter(register__token=self.token).exists())

    def test_an_import_opened_class_takes_no_issue_instruction(self):
        payload = instruction_payload(self.token, self.document, [self.request])
        waiting = submit_instruction(actor=self.tenant.user, **payload)
        _, _, confirmation = prepare_instruction_review(proposal_id=waiting.pk, reviewer=self.reviewer)
        applied = {"status": "applied", "reviewed_by": self.reviewer, "reviewed_at": timezone.now()}
        with self.assertRaises(RuntimeError), atomic():
            self.request.approve(self.reviewer)
            RegisterInstruction.objects.filter(pk=waiting.pk).update(**applied)
            raise RuntimeError("rollback")
        self.request.refresh_from_db()
        self.decide(*self.submit())
        refusal = "opened from an imported register"
        with self.assertRaisesMessage(ValidationError, refusal):
            submit_instruction(actor=self.tenant.user, **{**payload, "operation_id": uuid4()})
        with self.assertRaisesMessage(ValidationError, refusal):
            prepare_instruction_review(proposal_id=waiting.pk, reviewer=self.reviewer)
        with self.assertRaisesMessage(ValidationError, refusal):
            decide_instruction(
                proposal_id=waiting.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        self.request.approve(self.reviewer)
        with self.assertRaisesMessage(DatabaseError, "takes no register instruction until it is on chain"), atomic():
            RegisterInstruction.objects.filter(pk=waiting.pk).update(**applied)
        self.assertEqual(RegisterInstruction.objects.get(pk=waiting.pk).status, "submitted")


class RegisterImportOpeningMigrationTest(TransactionTestCase):
    GUARDS = ("tokens_guard_register_import", "tokens_guard_register_instruction")

    def installed(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, prosrc FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname", [list(self.GUARDS)]
            )
            return cursor.fetchall()

    def test_reversal_restores_the_guards_the_earlier_migrations_installed_and_reapplies(self):
        self.addCleanup(restore_every_migration)
        (previous,) = import_module("tokens.migrations.0077_import_opening").Migration.dependencies
        opening = self.installed()
        migrate_to([("tokens", "0071_register_export_audit")])
        migrate_to([previous])
        earlier = self.installed()
        self.assertEqual([name for name, _ in earlier], list(self.GUARDS))
        restore_every_migration()
        self.assertEqual(self.installed(), opening)
        self.assertNotEqual(opening, earlier)
        migrate_to([previous])
        self.assertEqual(self.installed(), earlier)
        restore_every_migration()
        self.assertEqual(self.installed(), opening)

    def test_reversal_refuses_while_an_import_has_opened_a_register(self):
        owner, company, _, member, reviewer, register_document, asic, _ = import_fixture()
        token = ShareToken.objects.create(company=company, name="Unopened", symbol="UNO", total_supply="1000")
        proposal = submit_import(actor=owner, **import_payload(token, register_document, asic, member))
        _, _, confirmation = prepare_import_review(proposal_id=proposal.pk, reviewer=reviewer)
        decide_import(
            proposal_id=proposal.pk,
            reviewer=reviewer,
            confirmation=confirmation,
            decision="apply",
            asic_issued_total=100,
            asic_member_count=1,
        )
        opening = self.installed()
        migration = import_module("tokens.migrations.0077_import_opening")
        with self.assertRaisesMessage(DatabaseError, "Cannot restore guards"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.close_imports(None, editor)
        self.assertEqual(self.installed(), opening)


class ScopedRegisterImportTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            (
                self.owner,
                self.company,
                self.token,
                self.member,
                self.reviewer,
                self.register_document,
                self.asic,
                _,
            ) = import_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = submit_import(
            actor=self.owner, **import_payload(self.token, self.register_document, self.asic, self.member)
        )

    def test_app_submits_and_reads_but_only_the_operator_reviews_applies_and_writes_particulars(self):
        self.assertEqual(list(RegisterImport.objects.values_list("pk", flat=True)), [self.proposal.pk])
        with self.assertRaises(PermissionDenied):
            prepare_import_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberParticulars.objects.create(
                member=self.member, name="Forged", residential_address="Nowhere", source_import=self.proposal
            )
        with use_operator():
            _, _, confirmation = prepare_import_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
            decide_import(
                proposal_id=self.proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                asic_issued_total=100,
                asic_member_count=1,
            )
        self.assertEqual((RegisterMemberParticulars.objects.count(), ImportedFormerMember.objects.count()), (1, 1))
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(
            (
                RegisterImport.objects.count(),
                RegisterMemberParticulars.objects.count(),
                ImportedFormerMember.objects.count(),
            ),
            (0, 0, 0),
        )

    def test_the_app_submits_an_opening_import_and_only_the_operator_opens_the_register(self):
        with use_operator():
            token = ShareToken.objects.create(company=self.company, name="Unopened", symbol="UNO", total_supply="1000")
        newcomer = uuid4()
        payload = import_payload(
            token,
            self.register_document,
            self.asic,
            self.member,
            members=[{**NEWCOMER, "member": str(newcomer), "shares": "100"}],
        )
        proposal = submit_import(actor=self.owner, **payload)
        with self.assertRaises(PermissionDenied):
            prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        with self.assertRaises(DatabaseError), atomic():
            RegisterMember.objects.create(uuid=newcomer, company=self.company)
        with use_operator():
            _, _, confirmation = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
            decide_import(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                asic_issued_total=100,
                asic_member_count=1,
            )
        (entry,) = RegisterEntry.objects.filter(register__token=token)
        self.assertEqual(
            (entry.operation_id, entry.changes, entry.recorded_by_id),
            (proposal.pk, [{"member": str(newcomer), "shares": "100"}], self.reviewer.pk),
        )
        self.assertEqual(RegisterMemberParticulars.objects.get(member_id=newcomer).name, "Nia Newcomer")
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertFalse(RegisterEntry.objects.filter(register__token=token).exists())
