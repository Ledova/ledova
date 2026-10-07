import csv
import io
from datetime import date, timedelta
from importlib import import_module
from unittest.mock import Mock
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, IntegrityError, connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase
from web3 import Web3

from companies.services.administration import company_operation
from offerings.tests.factories import eligible_subscriber
from shared.constants import BLOCKCHAIN_BASE
from shared.db import atomic, current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    FormerHolder,
    ImportedFormerMember,
    IssuanceStatus,
    RegisterEntry,
    RegisterEntryKind,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterImportDecision,
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
    member_identities,
    prepare_certificate,
    prepare_inspection_copy,
    prepare_notice_figures,
)
from tokens.services.register_events import (
    create_member,
    open_register,
    record_entry,
    verify_register,
)
from tokens.services.register_imports import (
    decide_import,
    prepare_import,
    preview_import_decision,
)
from tokens.services.register_instructions import (
    APPROVED,
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.tests.evidence_fixtures import (
    owner_appointment,
    staff_user,
    upload_evidence,
)
from tokens.tests.instruction_fixtures import (
    instruction_payload,
    retained_instruction,
    retained_paid_instruction,
)
from tokens.tests.register_command_fixtures import (
    legacy_entry_before_company_transfers,
    transfer_existing_member,
)
from tokens.tests.register_grant_fixtures import grant_existing_member
from tokens.tests.retained_issuance_fixtures import approve_retained_request
from tokens.tests.test_register_certificates import pages_of
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_instructions import (
    instruction_fixture,
    issuance_request,
)
from tokens.tests.test_the_fold_that_writes_former_members import (
    ALICE,
    BOB,
    ZERO,
    transfer,
)
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.models import WhitelistEntry

RESIDENCE = "12 Register Street, Sydney NSW 2000"
PARTICULARS = IDENTITY_LABELS[IDENTITY_PARTICULARS]
CAROL = Web3.to_checksum_address("0x" + "c3" * 20)
LIVE = Web3.to_checksum_address("0x" + "11" * 20)
FIRST = Web3.to_checksum_address("0x" + "22" * 20)
SECOND = Web3.to_checksum_address("0x" + "33" * 20)
STAMPED = Web3.to_checksum_address("0x" + "44" * 20)
TRUST = Web3.to_checksum_address("0x" + "75" * 20)
TRUST_LABEL = "Synthetic Employee Share Trust"
TRUSTEE = "Synthetic Trustee Pty Ltd ATF Synthetic Employee Share Trust"
TRUSTEE_ADDRESS = "Level 3, 1 Trust Street, Sydney NSW 2000"
NEWCOMER = {
    "name": "Nia Newcomer",
    "residential_address": "7 New Street, Perth WA 6000",
    "shares": "40",
    "entered_on": "2020-02-02",
    "amount_paid": None,
}


def import_fixture():
    owner, company, token, member, other, opening = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    appointment = owner_appointment(company)
    register_copy = upload_evidence(owner, appointment, RegisterEvidenceKind.SHARE_REGISTER)
    asic = upload_evidence(owner, appointment, RegisterEvidenceKind.ASIC_EXTRACT)
    return owner, company, token, member, appointment, register_copy, asic, opening


def import_payload(token, register_copy, asic, member, appointment, **changes):
    return {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "token_id": token.pk,
        "register_evidence": register_copy.pk,
        "asic_evidence": asic.pk,
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


def stated(payload):
    return {
        "asic_issued_total": str(sum(int(row["shares"]) for row in payload["members"])),
        "asic_member_count": len(payload["members"]),
        **payload,
    }


def prepared(actor, payload):
    return prepare_import(actor=actor, **stated(payload))[0]


def preview(actor, appointment, proposal, kind, reason=""):
    return preview_import_decision(
        actor=actor, import_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=reason
    )[1]


def decide(actor, appointment, proposal, kind, reason="", idempotency_key=None):
    return decide_import(
        actor=actor,
        import_id=proposal.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=idempotency_key or uuid4(),
        preview_digest=preview(actor, appointment, proposal, kind, reason)["preview_digest"],
        confirmation=True,
        reason=reason,
    )


def apply_import(actor, appointment, proposal):
    decide(actor, appointment, proposal, "approve")
    return decide(actor, appointment, proposal, "apply")


def decision_digest(proposal, kind, actor, appointment, reason=""):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_register_import_decision_digest(%s, %s, %s, %s, %s)",
            [proposal.pk, kind, actor.pk, appointment.pk, reason],
        )
        return cursor.fetchone()[0]


def forge_decision(proposal, kind, actor, appointment, reason="", digest=None):
    with company_operation(actor, proposal.company_id, f"register_import_{kind}"), atomic():
        decision = RegisterImportDecision.objects.create(
            register_import=proposal,
            kind=kind,
            decided_by=actor,
            appointment=appointment,
            idempotency_key=uuid4(),
            digest=digest or decision_digest(proposal, kind, actor, appointment, reason),
            reason=reason,
            decided_at=timezone.now(),
        )
        decision.refresh_from_db()
    return decision


def forge_outcome(proposal, actor, decision, **fields):
    with company_operation(actor, proposal.company_id, f"register_import_{decision.kind}"), atomic():
        RegisterImport.objects.filter(pk=proposal.pk).update(
            reviewed_by=actor, reviewed_at=decision.decided_at, **fields
        )


def record_particulars(proposal, actor, operation="register_import_apply", scope=None, **fields):
    with company_operation(actor, scope or proposal.company_id, operation), atomic():
        for row in proposal.members:
            RegisterMemberParticulars.objects.update_or_create(
                member_id=row["member"],
                defaults={
                    "name": row["name"],
                    "residential_address": row["residential_address"],
                    "as_at": proposal.as_at,
                    "source_import": proposal,
                    "source_change": None,
                    **fields,
                },
            )


def forged_fields(proposal):
    return {
        field.name: getattr(proposal, field.name)
        for field in RegisterImport._meta.fields
        if field.name not in ("uuid", "created_at", "updated_at", "file", "asic_file")
    }


def insert_forged(fields, actor, operation="register_import_prepare", **changes):
    forged_id = uuid4()
    company_id = fields["company"].pk
    folder = f"companies/{company_id}/register-imports/{forged_id}"
    with company_operation(actor, company_id, operation), atomic():
        RegisterImport.objects.create(
            **{
                **fields,
                **changes,
                "uuid": forged_id,
                "file": f"{folder}/{uuid4()}.bin",
                "asic_file": f"{folder}/{uuid4()}.bin",
            }
        )


def live_wallet(company, member, address, name, residence=RESIDENCE):
    user = get_user_model().objects.create_user(email=f"live-{uuid4()}@example.test", password="pw-12345678")
    profile = UserProfile.objects.create(user=user, full_name=name, residential_address=residence)
    account = UserAccount.objects.create(account_number=str(uuid4())[:20], user_profile=profile)
    wallet = Wallet.objects.create(user_account=account, address=address, chain="base")
    WhitelistEntry.objects.create(wallet=wallet)
    RegisterMemberWallet.objects.create(company=company, member=member, address=address)


class RegisterImportTest(TransactionTestCase):
    def setUp(self):
        (
            self.owner,
            self.company,
            self.token,
            self.member,
            self.appointment,
            self.register_copy,
            self.asic,
            self.opening,
        ) = import_fixture()
        self.staff = staff_user()
        self.payload = import_payload(self.token, self.register_copy, self.asic, self.member, self.appointment)
        self.newcomer = uuid4()

    def submit(self, **changes):
        return prepared(self.owner, {**self.payload, **changes})

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

    def preview(self, proposal, kind="apply", reason=""):
        return preview(self.owner, self.appointment, proposal, kind, reason)

    def decide(self, proposal, kind, reason="", **options):
        return decide(self.owner, self.appointment, proposal, kind, reason, **options)

    def apply(self, proposal):
        return apply_import(self.owner, self.appointment, proposal)

    def unmet(self, proposal, kind="apply"):
        return self.preview(proposal, kind)["unmet_requirements"]

    def move(self, source, target, shares, effective_on=DAY):
        if (
            RegisterImport.objects.filter(token=self.token, status="applied").exists()
            and not self.token.contract_address
        ):
            return transfer_existing_member(self.owner, self.appointment, self.token, source, target, shares)
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

    def test_preparation_binds_both_uploads_and_retains_copies_with_the_stated_figures(self):
        proposal = self.submit()
        self.assertEqual((proposal.status, proposal.token_id, proposal.as_at), ("submitted", self.token.pk, DAY))
        self.assertEqual(
            (
                proposal.evidence_fingerprint,
                proposal.asic_fingerprint,
                proposal.source_document,
                proposal.asic_document,
            ),
            (self.register_copy.sha256, self.asic.sha256, None, None),
        )
        self.assertEqual(
            (proposal.preparing_appointment_id, proposal.asic_issued_total, proposal.asic_member_count),
            (self.appointment.pk, 100, 1),
        )
        self.assertEqual(
            (proposal.evidence_snapshot["provided_by"], proposal.asic_snapshot["document_type"]),
            ("company", RegisterEvidenceKind.ASIC_EXTRACT),
        )
        for stored in (proposal.file, proposal.asic_file):
            self.assertTrue(stored.storage.exists(stored.name))
        self.assertNotEqual(proposal.file.name, proposal.asic_file.name)
        self.assertEqual(proposal.members[0]["amount_paid"], "250.00")
        replayed, created = prepare_import(actor=self.owner, **stated(self.payload))
        self.assertEqual((replayed.pk, created), (proposal.pk, False))
        with self.assertRaises(RegisterChangeConflict):
            prepare_import(actor=self.owner, **stated({**self.payload, "reason": "Another reason"}))

    def test_preparation_refuses_unusable_rows_evidence_and_figures(self):
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
            {"register_evidence": self.asic.pk},
            {"asic_evidence": self.register_copy.pk},
            {"as_at": (timezone.localdate() + timedelta(days=1)).isoformat()},
            {"asic_issued_total": "99"},
            {"asic_member_count": 2},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterImport.objects.exists())

    def test_preparation_refuses_text_longer_than_its_column(self):
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

    def test_application_records_particulars_former_members_and_the_stated_figures(self):
        proposal = self.submit()
        self.assertEqual(
            self.preview(proposal, "approve")["comparison"],
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
        self.assertEqual(
            (applied.reviewed_by_id, list(applied.decisions.values_list("kind", flat=True))),
            (self.owner.pk, ["approve", "apply"]),
        )
        self.assertEqual(list(RegisterEntry.objects.filter(register__token=self.token)), [self.opening])
        particulars = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((particulars.name, particulars.residential_address), ("Mia Member", RESIDENCE))
        (former,) = ImportedFormerMember.objects.all()
        self.assertEqual(
            (former.name, former.shares_at_cessation, former.ceased_on), ("Fred Former", 40, date(2022, 3, 1))
        )

    def test_an_identical_decision_retry_returns_the_import_and_a_changed_one_conflicts(self):
        proposal = self.submit()
        key = uuid4()
        approved = self.decide(proposal, "approve", idempotency_key=key)
        retry = {
            "actor": self.owner,
            "import_id": proposal.pk,
            "appointment": self.appointment.pk,
            "kind": "approve",
            "idempotency_key": key,
            "preview_digest": approved.decisions.get().digest,
            "confirmation": True,
        }
        self.assertEqual(decide_import(**retry).pk, proposal.pk)
        for changes in ({"kind": "reject", "reason": "Changed"}, {"preview_digest": "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                decide_import(**{**retry, **changes})
        self.assertEqual(RegisterImportDecision.objects.filter(register_import=proposal).count(), 1)
        with self.assertRaisesMessage(ValidationError, "already_approved"):
            self.decide(proposal, "approve")
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_a_register_change_after_an_apply_preview_refuses_the_stale_decision(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        stale = self.preview(proposal)["preview_digest"]
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        self.move(self.member, other, 100)
        self.move(other, self.member, 100)
        self.assertEqual(self.unmet(proposal), [])
        with self.assertRaises(RegisterChangeConflict):
            decide_import(
                actor=self.owner,
                import_id=proposal.pk,
                appointment=self.appointment.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=stale,
                confirmation=True,
            )
        proposal.refresh_from_db()
        self.assertEqual((proposal.status, proposal.decisions.count()), ("submitted", 1))
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_holdings_that_change_after_preparation_keep_it_from_applying_and_it_can_be_rejected(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(self.member.pk), "shares": "5"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        self.assertIn("holdings_differ", self.unmet(proposal))
        with self.assertRaisesMessage(ValidationError, "holdings_differ"):
            self.decide(proposal, "apply")
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        rejected = self.decide(proposal, "reject", reason="Stale")
        self.assertEqual(
            (rejected.status, rejected.rejection_reason, rejected.reviewed_by_id, rejected.asic_issued_total),
            ("rejected", "Stale", self.owner.pk, 100),
        )

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
        grant_existing_member(self.owner, self.appointment, self.token, self.member, 5, DAY)
        member = self.members()[str(self.member.pk)]
        self.assertEqual(
            [member[header] for header in ("Name", "Shares held", "Date entered", "Amount paid")],
            ["Mia Member", "105", "2019-05-01", ""],
        )
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        returned = timezone.now().date()
        self.move(self.member, other, 105, effective_on=returned)
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
        self.apply(proposal)
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
        self.decide(second, "approve")
        self.apply(first)
        refusal = "already has an applied import"
        with self.assertRaisesMessage(ValidationError, refusal):
            self.submit(operation_id=uuid4())
        self.assertIn("class_has_applied_import", self.unmet(second))
        with self.assertRaisesMessage(ValidationError, "class_has_applied_import"):
            self.decide(second, "apply")
        with self.assertRaisesMessage(IntegrityError, "one_applied_register_import_per_class"), atomic():
            decision = forge_decision(second, "apply", self.owner, self.appointment)
            record_particulars(second, self.owner)
            forge_outcome(second, self.owner, decision, status="applied", register_sequence=1)
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
        comparison = self.preview(proposal, "approve")["comparison"]
        self.assertEqual(
            {row["member"]: (row["name"], row["live_name"], row["wallets"], row["entered_on"]) for row in comparison},
            {
                str(self.member.pk): ("Imported Mia", "Live Mia", [LIVE], DAY),
                str(ambiguous.pk): ("Imported Amy", MEMBER_AMBIGUOUS_NAME, [FIRST, SECOND], DAY),
                str(walletless.pk): ("Imported Wes", "", [], DAY),
                str(stamped.pk): ("Imported Sam", "", [STAMPED], DAY),
            },
        )
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.post(
            f"/api/v1/tokens/register-imports/{proposal.pk}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        shown = {row["member"]: row for row in response.json()["comparison"]}
        self.assertEqual(
            (shown[str(self.member.pk)]["liveName"], shown[str(self.member.pk)]["liveAddress"]),
            ("Live Mia", "1 Live Street"),
        )
        self.assertEqual(
            (shown[str(ambiguous.pk)]["wallets"], shown[str(self.member.pk)]["imported"]), ([FIRST, SECOND], "25")
        )
        self.apply(proposal)
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

    def test_a_folded_former_live_member_keeps_the_profile_over_imported_particulars(self):
        self.apply(self.submit())
        RegisterMemberWallet.objects.create(company=self.company, member=self.member, address=ALICE)
        live_wallet(self.company, self.member, LIVE, "Live Mia", "1 Live Street")
        ShareToken.objects.filter(pk=self.token.pk).update(deployment_tx_hash="0x" + "de" * 32)
        self.token.refresh_from_db()
        reader = Mock()
        reader.finalized_block.return_value = 99
        reader.deployment_block.return_value = 1
        reader.block_date.side_effect = lambda block: DAY + timedelta(days=block)
        reader.transfer_entries.return_value = [
            transfer(ZERO, ALICE, 100, 10),
            transfer(ALICE, BOB, 100, 20),
            transfer(ZERO, LIVE, 50, 30),
            transfer(LIVE, BOB, 50, 40),
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
                LIVE: ("Live Mia", "1 Live Street", IDENTITY_LIVE),
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
                "member": None,
                "sourceEntry": None,
                "sourceEntrySequence": None,
                "sourceEntryKind": None,
                "sourceEffectiveOn": None,
                "corrects": None,
                "correctedBy": None,
                "returnedEntry": None,
                "returnedOn": None,
            },
        )
        rows = self.export()
        heading = rows.index(FORMER_MEMBER_HEADERS)
        self.assertEqual(rows[heading + 1][0], "Fred Former")

    def test_the_database_refuses_forged_imports_rewrites_and_deletion(self):
        proposal = self.submit()
        with company_operation(self.owner, self.company.pk, "register_import_apply"):
            for write in (
                lambda: RegisterImport.objects.filter(pk=proposal.pk).update(members=[]),
                lambda: RegisterImport.objects.filter(pk=proposal.pk).update(asic_issued_total=101),
                lambda: RegisterImport.objects.filter(pk=proposal.pk).update(
                    status="applied", reviewed_by=self.owner, reviewed_at=timezone.now(), register_sequence=1
                ),
                proposal.delete,
            ):
                with self.assertRaises(DatabaseError), atomic():
                    write()
        forged = forged_fields(proposal)
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
            {"asic_issued_total": 99},
            {"asic_member_count": 2},
            {"evidence_fingerprint": "0" * 64},
            {"asic_snapshot": {**proposal.asic_snapshot, "sha256": "0" * 64}},
            {"register_evidence": self.asic},
            {"preparing_appointment": None},
            {"submitted_by": self.staff},
            {"status": "applied"},
        ):
            with self.subTest(changes=changes):
                self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner, **changes))
        for actor, operation in ((self.owner, "register_import_approve"), (self.staff, "register_import_prepare")):
            with self.subTest(actor=actor.email, operation=operation):
                self.assert_refused("exact current intent", lambda: insert_forged(forged, actor, operation=operation))
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner)
            raise RuntimeError("rollback")
        self.assertEqual(RegisterImport.objects.count(), 1)

    def test_particulars_and_imported_former_members_follow_the_seven_year_clock_and_the_import_is_kept(self):
        proposal = self.apply(self.submit())
        ceased = timezone.make_aware(timezone.datetime(2022, 3, 1))
        self.assertEqual(purge_imported_former_members(now=ceased + timedelta(days=2557)), 0)
        self.assertEqual(purge_imported_former_members(now=ceased + timedelta(days=2559)), 1)
        later = timezone.now() + timedelta(days=4000)
        self.assertEqual(purge_member_particulars(now=later), 0)
        left_on = retention_cutoff() - timedelta(days=1)
        legacy_entry_before_company_transfers(
            self.token, self.owner, "cessation", [{"member": str(self.member.pk), "shares": "-100"}], left_on
        )
        self.assertEqual(purge_member_particulars(now=timezone.now() - timedelta(days=1)), 0)
        self.assertEqual(purge_member_particulars(), 1)
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        proposal.refresh_from_db()
        self.assertEqual(
            (proposal.members[0]["name"], proposal.former_members[0]["name"]), ("Mia Member", "Fred Former")
        )
        for stored in (proposal.file, proposal.asic_file):
            self.assertTrue(stored.storage.exists(stored.name))

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
                approval = self.preview(proposal, "approve")
                self.assertEqual(
                    {row["member"]: (row["imported"], row["stored"]) for row in approval["comparison"]},
                    {str(self.member.pk): (60, None), str(self.newcomer): (40, None)},
                )
                self.assertTrue(approval["opens_register"])
                applied = self.apply(proposal)
                self.assertEqual((applied.status, applied.register_sequence), ("applied", 1))
                (entry,) = RegisterEntry.objects.filter(register__token=token)
                self.assertEqual(
                    (entry.kind, entry.sequence, entry.operation_id, entry.effective_on, entry.recorded_by_id),
                    (RegisterEntryKind.OPENING, 1, proposal.pk, DAY, self.owner.pk),
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
        self.decide(proposal, "approve")
        approve_retained_request(
            ShareIssuanceRequest.objects.create(token=token, recipient_address=CAROL, amount=5, reason="Allot"),
            self.staff,
        )
        refusal = "has an approved issue or an applied register instruction"
        with self.assertRaisesMessage(ValidationError, refusal):
            self.submit(**self.opening_import(token))
        self.assertIn("class_not_openable", self.unmet(proposal))
        with self.assertRaisesMessage(ValidationError, "class_not_openable"):
            self.decide(proposal, "apply")
        self.assertFalse(ShareRegister.objects.filter(token=token).exists())
        self.assertFalse(RegisterMember.objects.filter(pk=self.newcomer).exists())

    def test_a_class_opened_after_preparation_applies_the_import_by_the_opened_rules(self):
        token = self.unopened()
        dated = self.submit(**self.opening_import(token))
        earlier = self.submit(**self.opening_import(token, former_members=self.payload["former_members"]))
        for proposal in (dated, earlier):
            self.decide(proposal, "approve")
        open_register(
            token_id=token.pk,
            operation_id=uuid4(),
            changes=[{"member": str(self.member.pk), "shares": "100"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        for proposal, unmet in ((dated, "former_member_after_opening"), (earlier, "holdings_differ")):
            with self.subTest(unmet=unmet):
                self.assertIn(unmet, self.unmet(proposal))
                with self.assertRaisesMessage(ValidationError, unmet):
                    self.decide(proposal, "apply")
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

    def test_stated_figures_that_differ_refuse_an_opening_and_record_nothing(self):
        token = self.unopened()
        for figures, message in (
            ({"asic_issued_total": "99"}, "ASIC extract shows 99 shares"),
            ({"asic_member_count": 1}, "held by 1 members"),
        ):
            with self.subTest(figures=figures), self.assertRaisesMessage(ValidationError, message):
                self.submit(**self.opening_import(token), **figures)
        self.assertFalse(RegisterImport.objects.exists())
        self.assertFalse(ShareRegister.objects.filter(token=token).exists())
        self.assertFalse(RegisterMember.objects.filter(pk=self.newcomer).exists())
        self.assertFalse(RegisterMemberParticulars.objects.exists())

    def test_replaying_an_opening_returns_it_and_leaves_one_entry(self):
        token = self.unopened()
        payload = self.opening_import(token)
        proposal = self.submit(**payload)
        self.assertEqual(self.submit(**payload).pk, proposal.pk)
        self.decide(proposal, "approve")
        key = uuid4()
        applied = self.decide(proposal, "apply", idempotency_key=key)
        replay = {
            "actor": self.owner,
            "import_id": proposal.pk,
            "appointment": self.appointment.pk,
            "kind": "apply",
            "idempotency_key": key,
            "preview_digest": applied.decisions.get(kind="apply").digest,
            "confirmation": True,
        }
        self.assertEqual(decide_import(**replay).status, "applied")
        with self.assertRaises(RegisterChangeConflict):
            decide_import(**{**replay, "preview_digest": "0" * 64})
        self.assertEqual(ShareRegister.objects.get(token=token).sequence, 1)
        with self.assertRaisesMessage(ValidationError, "already has an applied import"):
            self.submit(**self.opening_import(token))

    def test_the_database_ties_an_opening_import_to_exactly_its_own_entry(self):
        token = self.unopened()
        proposal = self.submit(**self.opening_import(token))
        self.decide(proposal, "approve")
        exact = {
            "token_id": token.pk,
            "operation_id": proposal.pk,
            "changes": self.opening_changes(),
            "effective_on": DAY,
            "recorded_by": self.owner,
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
            request.approve(self.staff)

        def forge(entry, after=unchanged):
            decision = forge_decision(proposal, "apply", self.owner, self.appointment)
            for row in proposal.members:
                create_member(company_id=self.company.pk, member_id=row["member"])
            record_particulars(proposal, self.owner)
            if entry is not None:
                open_register(**entry)
            after()
            forge_outcome(proposal, self.owner, decision, status="applied", register_sequence=1)

        for entry, after in (
            (None, unchanged),
            ({**exact, "changes": self.opening_changes(newcomer_shares="50")}, unchanged),
            ({**exact, "effective_on": DAY - timedelta(days=1)}, unchanged),
            ({**exact, "recorded_by": self.staff}, unchanged),
            (exact, an_issue_after_it),
            (exact, an_approved_issue),
        ):
            with self.subTest(entry=entry, after=after.__name__):
                refusal = (
                    "New non-paid issue approval requires its genuine company source"
                    if after is an_approved_issue
                    else "exactly the register's only entry"
                )
                self.assert_refused(refusal, lambda: forge(entry, after))
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
        forged = forged_fields(proposal)
        _, _, _, stranger, _, _ = register_fixture()
        row = proposal.members[0]
        alone = {"asic_issued_total": int(row["shares"]), "asic_member_count": 1}
        self.assert_refused(
            "exact current intent",
            lambda: insert_forged(forged, self.owner, members=[{**row, "member": str(stranger.pk)}], **alone),
        )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner, members=[{**row, "member": str(uuid4())}], **alone)
            raise RuntimeError("rollback")
        approve_retained_request(
            ShareIssuanceRequest.objects.create(token=token, recipient_address=CAROL, amount=5, reason="Allot"),
            self.staff,
        )
        self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner))
        self.assertEqual(RegisterImport.objects.count(), 1)

    def test_an_import_opened_class_reads_not_on_chain_with_nothing_waiting_until_a_completion(self):
        token = self.unopened()
        self.apply(self.submit(**self.opening_import(token)))
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

    def test_notice_figures_name_a_member_from_the_imported_particulars_when_nothing_else_resolves(self):
        self.apply(self.submit())
        buyer = create_member(company_id=self.company.pk, member_id=uuid4())
        self.move(self.member, buyer, 30)
        content, _ = prepare_notice_figures(
            self.token, self.staff, period_from=DAY, instruction="SYNTHETIC-NOTICE-IMPORTED"
        )
        rows = list(csv.reader(io.StringIO(content.decode())))
        self.assertIn(
            ["2", "Transfer", timezone.now().date().isoformat(), "", str(self.member.pk), "Mia Member", "-30", ""], rows
        )
        self.assertIn([str(self.member.pk), "Mia Member", RESIDENCE, "70", "not recorded"], rows)

    def trust_import(self):
        trust = create_member(company_id=self.company.pk, member_id=uuid4())
        self.move(self.member, trust, 40)
        WhitelistEntry.objects.create(address=TRUST, label=TRUST_LABEL)
        RegisterMemberWallet.objects.create(company=self.company, member=trust, address=TRUST)
        row = self.payload["members"][0]
        trustee = {"name": TRUSTEE, "residential_address": TRUSTEE_ADDRESS, "amount_paid": None}
        self.apply(
            self.submit(members=[{**row, "shares": "60"}, {**row, "member": str(trust.pk), "shares": "40", **trustee}])
        )
        return trust

    def test_a_trust_held_at_a_labelled_treasury_address_shows_its_imported_particulars_on_every_output(self):
        trust = self.trust_import()
        shown = ("Name", "Residential address", "Holder type", "Identity source")

        self.assertEqual(
            [self.members()[str(trust.pk)][header] for header in shown],
            [TRUSTEE, TRUSTEE_ADDRESS, "Treasury", PARTICULARS],
        )
        inspection = list(
            csv.reader(
                io.StringIO(
                    prepare_inspection_copy(
                        self.token, self.owner, instruction="SYNTHETIC-INSPECTION", requested_on=DAY, recipient="A"
                    ).decode()
                )
            )
        )
        copied = {row[0]: dict(zip(REGISTER_HEADERS, row)) for row in inspection[1 : inspection.index([])]}
        self.assertEqual(
            [copied[str(trust.pk)][header] for header in shown], [TRUSTEE, TRUSTEE_ADDRESS, "Treasury", PARTICULARS]
        )
        client = APIClient()
        client.force_authenticate(self.owner)
        holders = {
            row["member"]: row for row in client.get(f"/api/v1/tokens/{self.token.uuid}/holders/").json()["holders"]
        }
        self.assertEqual(
            [holders[str(trust.pk)][key] for key in ("name", "holderType", "identitySource")],
            [TRUSTEE, "treasury", PARTICULARS],
        )
        identity = member_identities(self.token, [trust.pk])[trust.pk]
        self.assertEqual(
            (identity.name, identity.residential_address, identity.holder_type, identity.source, identity.user_id),
            (TRUSTEE, TRUSTEE_ADDRESS, "treasury", IDENTITY_PARTICULARS, None),
        )
        [transferee, _] = pages_of(
            prepare_certificate(self.token, self.staff, sequence=2, instruction="SYNTHETIC-CERTIFICATE")
        )
        self.assertIn(f"Member: {TRUSTEE}", transferee)
        self.assertIn(f"Residential address: {TRUSTEE_ADDRESS}", transferee)
        content, _ = prepare_notice_figures(
            self.token, self.staff, period_from=DAY, instruction="SYNTHETIC-NOTICE-TRUST"
        )
        rows = list(csv.reader(io.StringIO(content.decode())))
        self.assertIn([str(trust.pk), TRUSTEE, TRUSTEE_ADDRESS, "40", "not recorded"], rows)

    def test_a_trust_whose_wallets_resolve_to_someone_else_too_stays_ambiguous(self):
        trust = self.trust_import()
        live_wallet(self.company, trust, LIVE, "Live Lee")

        self.assertEqual(
            [self.members()[str(trust.pk)][header] for header in ("Name", "Residential address", "Holder type")],
            [MEMBER_AMBIGUOUS_NAME, "", "Ambiguous"],
        )

    def test_a_folded_former_trust_address_keeps_the_imported_particulars(self):
        self.trust_import()
        ShareToken.objects.filter(pk=self.token.pk).update(deployment_tx_hash="0x" + "de" * 32)
        self.token.refresh_from_db()
        reader = Mock()
        reader.finalized_block.return_value = 99
        reader.deployment_block.return_value = 1
        reader.block_date.side_effect = lambda block: DAY + timedelta(days=block)
        reader.transfer_entries.return_value = [transfer(ZERO, TRUST, 40, 10), transfer(TRUST, BOB, 40, 20)]

        fold_former_holders(self.token, reader=reader)

        folded = FormerHolder.objects.get(token=self.token, wallet_address=TRUST)
        self.assertEqual(
            (folded.name, folded.residential_address, folded.identity_source),
            (TRUSTEE, TRUSTEE_ADDRESS, IDENTITY_PARTICULARS),
        )


class ImportOpenedInstructionTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.reviewer, self.document, self.subscription = instruction_fixture("import-opened")
        self.token = self.tenant.deployed_token
        self.member = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        self.appointment = owner_appointment(self.tenant.company)
        self.payload = import_payload(
            self.token,
            upload_evidence(self.tenant.user, self.appointment, RegisterEvidenceKind.SHARE_REGISTER),
            upload_evidence(self.tenant.user, self.appointment, RegisterEvidenceKind.ASIC_EXTRACT),
            self.member,
            self.appointment,
        )

    def submit(self):
        proposal = prepared(self.tenant.user, {**self.payload, "operation_id": uuid4()})
        decide(self.tenant.user, self.appointment, proposal, "approve")
        return proposal

    def apply(self, proposal):
        return decide(self.tenant.user, self.appointment, proposal, "apply")

    def test_an_applied_register_instruction_keeps_a_class_from_being_opened_by_an_import(self):
        proposal = self.submit()
        eligible_subscriber(self.tenant)
        retained_paid_instruction(
            actor=self.tenant.user,
            reviewer=self.reviewer,
            status="applied",
            **instruction_payload(self.token, self.document, [self.subscription]),
        )
        self.assertFalse(ShareIssuanceRequest.objects.filter(token=self.token, status__in=APPROVED).exists())
        refusal = "has an approved issue or an applied register instruction"
        with self.assertRaisesMessage(ValidationError, refusal):
            self.submit()
        with self.assertRaisesMessage(ValidationError, "class_not_openable"):
            self.apply(proposal)
        with self.assertRaisesMessage(DatabaseError, "exactly the register's only entry"), atomic():
            decision = forge_decision(proposal, "apply", self.tenant.user, self.appointment)
            open_register(
                token_id=self.token.pk,
                operation_id=proposal.pk,
                changes=[{"member": str(self.member.pk), "shares": "100"}],
                effective_on=DAY,
                recorded_by=self.tenant.user,
            )
            record_particulars(proposal, self.tenant.user)
            forge_outcome(proposal, self.tenant.user, decision, status="applied", register_sequence=1)
        self.assertFalse(RegisterEntry.objects.filter(register__token=self.token).exists())

    def test_an_import_opened_class_takes_no_issue_instruction(self):
        payload = instruction_payload(self.token, self.document, [self.subscription])
        waiting = retained_paid_instruction(actor=self.tenant.user, reviewer=self.reviewer, **payload)
        nonpaid_payload = instruction_payload(self.token, self.document, [issuance_request(self.tenant)])
        original_nonpaid = retained_instruction(actor=self.tenant.user, **nonpaid_payload)
        confirmation = "Retired original paid proposal"
        with self.assertRaisesMessage(ValidationError, "New paid issues"):
            prepare_instruction_review(proposal_id=waiting.pk, reviewer=self.reviewer)
        applied = {"status": "applied", "reviewed_by": self.reviewer, "reviewed_at": timezone.now()}
        with self.assertRaisesMessage(DatabaseError, "Fresh paid ISSUE authority"), atomic():
            RegisterInstruction.objects.filter(pk=waiting.pk).update(**applied)
        self.apply(self.submit())
        refusal = "opened from an imported register"
        with self.assertRaises(PermissionDenied):
            submit_instruction(actor=self.tenant.user, **{**payload, "operation_id": uuid4()})
        with self.assertRaisesMessage(ValidationError, refusal):
            prepare_instruction_review(proposal_id=waiting.pk, reviewer=self.reviewer)
        with self.assertRaises(PermissionDenied):
            decide_instruction(
                proposal_id=waiting.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        with self.assertRaisesMessage(DatabaseError, "Fresh paid ISSUE authority"), atomic():
            RegisterInstruction.objects.filter(pk=waiting.pk).update(**applied)
        with self.assertRaisesMessage(ValidationError, refusal):
            submit_instruction(actor=self.tenant.user, **{**nonpaid_payload, "operation_id": uuid4()})
        with self.assertRaisesMessage(ValidationError, refusal):
            prepare_instruction_review(proposal_id=original_nonpaid.pk, reviewer=self.reviewer)
        with self.assertRaisesMessage(DatabaseError, "takes no register instruction until it is on chain"), atomic():
            RegisterInstruction.objects.filter(pk=original_nonpaid.pk).update(**applied)
        self.assertEqual(RegisterInstruction.objects.get(pk=waiting.pk).status, "submitted")
        self.assertEqual(RegisterInstruction.objects.get(pk=original_nonpaid.pk).status, "submitted")


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
        owner, company, _, member, appointment, register_copy, asic, _ = import_fixture()
        token = ShareToken.objects.create(company=company, name="Unopened", symbol="UNO", total_supply="1000")
        apply_import(
            owner, appointment, prepared(owner, import_payload(token, register_copy, asic, member, appointment))
        )
        opening = self.installed()
        migration = import_module("tokens.migrations.0077_import_opening")
        with self.assertRaisesMessage(DatabaseError, "Cannot restore guards"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.close_imports(None, editor)
        self.assertEqual(self.installed(), opening)


class CompanyRegisterImportMigrationTest(TransactionTestCase):
    def guard(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT prosrc FROM pg_proc WHERE proname = 'tokens_guard_register_import'")
            return cursor.fetchone()[0]

    def insert_policy(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy "
                "WHERE polname = 'tokens_registerimport_insert'"
            )
            return cursor.fetchone()[0]

    def test_reversal_restores_the_staff_review_guard_and_owner_submissions_then_reapplies(self):
        self.addCleanup(restore_every_migration)
        company_run, closed = self.guard(), self.insert_policy()
        self.assertIn("tokens_registerimportdecision", company_run)
        self.assertNotIn("submitted_by_id", closed)
        migrate_to([("tokens", "0081_held_orders_and_retired_statuses")])
        staff_review = self.guard()
        self.assertIn("Only operator review may decide", staff_review)
        self.assertNotIn("tokens_registerimportdecision", staff_review)
        self.assertIn("submitted_by_id", self.insert_policy())
        restore_every_migration()
        self.assertEqual((self.guard(), self.insert_policy()), (company_run, closed))

    def test_reversal_refuses_while_company_register_evidence_or_imports_exist(self):
        import_fixture()
        company_run = self.guard()
        migration = import_module("tokens.migrations.0084_company_register_import_guards")
        with self.assertRaisesMessage(DatabaseError, "Retain company register imports"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_company_imports(None, editor)
        self.assertEqual(self.guard(), company_run)


class ScopedRegisterImportTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            (
                self.owner,
                self.company,
                self.token,
                self.member,
                self.appointment,
                self.register_copy,
                self.asic,
                _,
            ) = import_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = prepared(
            self.owner, import_payload(self.token, self.register_copy, self.asic, self.member, self.appointment)
        )

    def test_the_app_reads_but_only_the_bounded_operator_command_prepares_decides_and_writes_particulars(self):
        self.assertEqual(list(RegisterImport.objects.values_list("pk", flat=True)), [self.proposal.pk])
        for write in (
            lambda: RegisterMemberParticulars.objects.create(
                member=self.member,
                name="Forged",
                residential_address="Nowhere",
                as_at=self.proposal.as_at,
                source_import=self.proposal,
            ),
            lambda: RegisterImport.objects.filter(pk=self.proposal.pk).update(status="rejected"),
            lambda: list(RegisterImportDecision.objects.all()),
        ):
            with self.assertRaises(DatabaseError), atomic():
                write()
        apply_import(self.owner, self.appointment, self.proposal)
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

    def test_an_opening_import_opens_the_register_only_through_the_operator_command(self):
        with use_operator():
            token = ShareToken.objects.create(company=self.company, name="Unopened", symbol="UNO", total_supply="1000")
        newcomer = uuid4()
        payload = import_payload(
            token,
            self.register_copy,
            self.asic,
            self.member,
            self.appointment,
            members=[{**NEWCOMER, "member": str(newcomer), "shares": "100"}],
        )
        proposal = prepared(self.owner, payload)
        with self.assertRaises(DatabaseError), atomic():
            RegisterMember.objects.create(uuid=newcomer, company=self.company)
        apply_import(self.owner, self.appointment, proposal)
        (entry,) = RegisterEntry.objects.filter(register__token=token)
        self.assertEqual(
            (entry.operation_id, entry.changes, entry.recorded_by_id),
            (proposal.pk, [{"member": str(newcomer), "shares": "100"}], self.owner.pk),
        )
        self.assertEqual(RegisterMemberParticulars.objects.get(member_id=newcomer).name, "Nia Newcomer")
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertFalse(RegisterEntry.objects.filter(register__token=token).exists())
