import csv
import io
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from importlib import import_module
from queue import Queue
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import Company, CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import accept_team_invitation, issue_team_invitation
from shared.db import atomic, current_alias, use_operator
from shared.storage import private_storage
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntryKind,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterMemberParticulars,
    RegisterParticularsChange,
    RegisterParticularsChangeDecision,
    ShareToken,
)
from tokens.models.choices import IDENTITY_LABELS, IDENTITY_LIVE, IDENTITY_PARTICULARS
from tokens.services.former_holders import purge_member_particulars, retention_cutoff
from tokens.services.register import REGISTER_HEADERS, member_identities
from tokens.services.register_events import create_member, open_register, record_entry
from tokens.services.register_evidence import evidence_snapshot
from tokens.services.register_particulars import (
    decide_particulars_change,
    prepare_particulars_change,
    preview_particulars_decision,
)
from tokens.tests.evidence_fixtures import staff_user, upload_evidence
from tokens.tests.register_command_fixtures import legacy_entry_before_company_transfers
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_imports import (
    LIVE,
    RESIDENCE,
    apply_import,
)
from tokens.tests.test_register_imports import decide as decide_import
from tokens.tests.test_register_imports import forge_decision as forge_import_decision
from tokens.tests.test_register_imports import forge_outcome as forge_import_outcome
from tokens.tests.test_register_imports import (
    import_fixture,
    import_payload,
    live_wallet,
    owner_appointment,
)
from tokens.tests.test_register_imports import prepared as prepared_import
from tokens.tests.test_register_imports import record_particulars

PARTICULARS_CHANGES = "/api/v1/tokens/register-particulars-changes/"
RENAMED = "Mia Renamed"
NEW_ADDRESS = "8 New Street, Melbourne VIC 3000"
PARTICULARS = IDENTITY_LABELS[IDENTITY_PARTICULARS]
LONG_AGO = date(2018, 1, 1)


def particulars_fixture():
    owner, company, token, member, _, _ = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    appointment = owner_appointment(company)
    evidence = upload_evidence(owner, appointment, RegisterEvidenceKind.SUPPORTING)
    return owner, company, token, member, appointment, evidence


def change_payload(member, evidence, appointment, **changes):
    return {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "member": member.pk,
        "supporting_evidence": evidence.pk,
        "name": RENAMED,
        "residential_address": NEW_ADDRESS,
        "as_at": DAY,
        "reason": "The member changed their name by deed poll and moved",
        **changes,
    }


def prepared(actor, payload):
    return prepare_particulars_change(actor=actor, **payload)[0]


def preview(actor, appointment, change, kind, reason=""):
    return preview_particulars_decision(
        actor=actor, change_id=change.pk, appointment=appointment.pk, kind=kind, reason=reason
    )[1]


def decide(actor, appointment, change, kind, reason="", idempotency_key=None):
    return decide_particulars_change(
        actor=actor,
        change_id=change.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=idempotency_key or uuid4(),
        preview_digest=preview(actor, appointment, change, kind, reason)["preview_digest"],
        confirmation=True,
        reason=reason,
    )


def apply_change(actor, appointment, change):
    decide(actor, appointment, change, "approve")
    return decide(actor, appointment, change, "apply")


def decision_digest(change, kind, actor, appointment, reason=""):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_register_particulars_decision_digest(%s, %s, %s, %s, %s)",
            [change.pk, kind, actor.pk, appointment.pk, reason],
        )
        return cursor.fetchone()[0]


def forge_decision(change, kind, actor, appointment, reason="", digest=None, decided_by=None):
    with company_operation(actor, change.company_id, f"register_particulars_{kind}"), atomic():
        decision = RegisterParticularsChangeDecision.objects.create(
            register_particulars_change=change,
            kind=kind,
            decided_by=decided_by or actor,
            appointment=appointment,
            idempotency_key=uuid4(),
            digest=digest or decision_digest(change, kind, actor, appointment, reason),
            reason=reason,
            decided_at=timezone.now(),
        )
        decision.refresh_from_db()
    return decision


def forge_outcome(change, actor, decision, **fields):
    with company_operation(actor, change.company_id, f"register_particulars_{decision.kind}"), atomic():
        RegisterParticularsChange.objects.filter(pk=change.pk).update(
            reviewed_by=actor, reviewed_at=decision.decided_at, **fields
        )


def write_particulars(change, actor, operation="register_particulars_apply", **fields):
    with company_operation(actor, change.company_id, operation), atomic():
        RegisterMemberParticulars.objects.update_or_create(
            member_id=change.member_id,
            defaults={
                "name": change.name,
                "residential_address": change.residential_address,
                "as_at": change.as_at,
                "source_import": None,
                "source_change": change,
                **fields,
            },
        )


def forged_fields(change):
    return {
        field.name: getattr(change, field.name)
        for field in RegisterParticularsChange._meta.fields
        if field.name not in ("uuid", "created_at", "updated_at", "file")
    }


def insert_forged(fields, actor, operation="register_particulars_prepare", scope=None, **changes):
    forged_id = uuid4()
    company_id = fields["company"].pk
    with company_operation(actor, scope or company_id, operation), atomic():
        RegisterParticularsChange.objects.create(
            **{
                **fields,
                "uuid": forged_id,
                "file": f"companies/{company_id}/register-particulars/{forged_id}/{uuid4()}.bin",
                **changes,
            }
        )


def moved(register_id, source, target, shares, actor, effective_on=DAY):
    record_entry(
        register_id=register_id,
        operation_id=uuid4(),
        kind=RegisterEntryKind.TRANSFER,
        changes=sorted(
            [{"member": str(source.pk), "shares": str(-shares)}, {"member": str(target.pk), "shares": str(shares)}],
            key=lambda change: change["member"],
        ),
        effective_on=effective_on,
        recorded_by=actor,
    )


class RegisterParticularsTest(TransactionTestCase):
    def setUp(self):
        self.owner, self.company, self.token, self.member, self.appointment, self.evidence = particulars_fixture()
        self.payload = change_payload(self.member, self.evidence, self.appointment)

    def submit(self, **changes):
        return prepared(self.owner, {**self.payload, **changes})

    def preview(self, change, kind="apply", reason=""):
        return preview(self.owner, self.appointment, change, kind, reason)

    def decide(self, change, kind, reason="", **options):
        return decide(self.owner, self.appointment, change, kind, reason, **options)

    def apply(self, change):
        return apply_change(self.owner, self.appointment, change)

    def unmet(self, change, kind="apply"):
        return self.preview(change, kind)["unmet_requirements"]

    def held(self):
        return RegisterMemberParticulars.objects.get(member=self.member)

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def opened(self, symbol, member=None, effective_on=DAY):
        token = ShareToken.objects.create(company=self.company, name=symbol, symbol=symbol, total_supply="1000")
        open_register(
            token_id=token.pk,
            operation_id=uuid4(),
            changes=[{"member": str((member or self.member).pk), "shares": "100"}],
            effective_on=effective_on,
            recorded_by=self.owner,
        )
        return token

    def import_of(self, token, as_at, name="Mia Imported"):
        return prepared_import(
            self.owner,
            import_payload(
                token,
                upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.SHARE_REGISTER),
                upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.ASIC_EXTRACT),
                self.member,
                self.appointment,
                as_at=as_at.isoformat(),
                members=[
                    {
                        "member": str(self.member.pk),
                        "name": name,
                        "residential_address": f"{name} Street",
                        "shares": "100",
                        "entered_on": "2019-05-01",
                        "amount_paid": None,
                    }
                ],
                former_members=[],
            ),
        )

    def imported(self, token, as_at, name):
        return apply_import(self.owner, self.appointment, self.import_of(token, as_at, name))

    def shown(self, token=None):
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(f"/api/v1/tokens/{(token or self.token).uuid}/register/export/")
        self.assertEqual(response.status_code, 200)
        rows = list(csv.reader(io.StringIO(response.content.decode())))
        members = {row[0]: dict(zip(REGISTER_HEADERS, row)) for row in rows[1 : rows.index([])]}
        member = members[str(self.member.pk)]
        holders = client.get(f"/api/v1/tokens/{(token or self.token).uuid}/holders/").json()["holders"]
        holder = next(row for row in holders if row["member"] == str(self.member.pk))
        self.assertEqual((holder["name"], holder["identitySource"]), (member["Name"], member["Identity source"]))
        return member["Name"], member["Residential address"], member["Identity source"]

    def test_preparation_keeps_its_own_copy_of_the_supporting_upload_and_the_stated_particulars(self):
        change = self.submit()
        self.assertEqual(
            (
                change.status,
                change.company_id,
                change.member_id,
                change.name,
                change.residential_address,
                change.as_at,
                change.reason,
            ),
            ("submitted", self.company.pk, self.member.pk, RENAMED, NEW_ADDRESS, DAY, self.payload["reason"]),
        )
        self.assertEqual(
            (
                change.preparing_appointment_id,
                change.submitted_by_id,
                change.supporting_evidence_id,
                change.evidence_fingerprint,
            ),
            (self.appointment.pk, self.owner.pk, self.evidence.pk, self.evidence.sha256),
        )
        self.assertEqual(
            change.evidence_snapshot,
            {
                "provided_by": "company",
                "evidence": str(self.evidence.pk),
                "company": str(self.company.pk),
                "document_type": "supporting",
                "name": "supporting.pdf",
                "file_size": self.evidence.file_size,
                "mime_type": "application/pdf",
                "sha256": self.evidence.sha256,
            },
        )
        self.assertTrue(change.file.name.startswith(f"companies/{self.company.pk}/register-particulars/{change.pk}/"))
        self.assertNotEqual(change.file.name, self.evidence.file.name)
        with change.file.open("rb") as kept, self.evidence.file.open("rb") as uploaded:
            self.assertEqual(kept.read(), uploaded.read())
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        trimmed = self.submit(operation_id=uuid4(), name=f"  {RENAMED} ", residential_address=f"\t{NEW_ADDRESS}\n")
        self.assertEqual((trimmed.name, trimmed.residential_address), (RENAMED, NEW_ADDRESS))

    def test_application_records_the_members_particulars_from_the_change(self):
        change = self.submit()
        self.assertEqual(
            {key: value for key, value in self.preview(change, "approve").items() if key != "preview_digest"},
            {
                "unmet_requirements": [],
                "can_decide": True,
                "member": self.member.pk,
                "name": RENAMED,
                "residential_address": NEW_ADDRESS,
                "as_at": DAY,
                "current": None,
            },
        )
        applied = self.apply(change)
        held = self.held()
        self.assertEqual(
            (held.name, held.residential_address, held.as_at, held.source_change_id, held.source_import_id),
            (RENAMED, NEW_ADDRESS, DAY, change.pk, None),
        )
        self.assertEqual(
            (applied.status, applied.reviewed_by_id, list(applied.decisions.values_list("kind", flat=True))),
            ("applied", self.owner.pk, ["approve", "apply"]),
        )
        self.assertEqual(applied.reviewed_at, applied.decisions.get(kind="apply").decided_at)
        self.assertEqual(self.shown(), (RENAMED, NEW_ADDRESS, PARTICULARS))
        later = self.submit(operation_id=uuid4(), name="Mia Later", as_at=DAY + timedelta(days=1))
        self.assertEqual(
            self.preview(later, "approve")["current"],
            {
                "name": RENAMED,
                "residential_address": NEW_ADDRESS,
                "as_at": DAY,
                "source_import": None,
                "source_change": change.pk,
                "source_grant": None,
                "source_transfer": None,
            },
        )
        self.apply(later)
        self.assertEqual((self.held().name, self.held().source_change_id), ("Mia Later", later.pk))

    def test_the_latest_as_at_wins_between_imports_and_changes_in_either_order(self):
        self.imported(self.token, DAY - timedelta(days=10), "Mia Imported")
        self.assertEqual(self.shown(), ("Mia Imported", "Mia Imported Street", PARTICULARS))
        pending = self.submit(operation_id=uuid4(), name="Mia Pending", as_at=DAY + timedelta(days=1))
        self.decide(pending, "approve")
        change = self.apply(self.submit())
        self.assertEqual((self.held().source_change_id, self.held().as_at), (change.pk, DAY))
        self.assertEqual(self.shown(), (RENAMED, NEW_ADDRESS, PARTICULARS))
        older = self.imported(self.opened("OLD"), DAY - timedelta(days=5), "Mia Older")
        self.assertEqual(older.status, "applied")
        self.assertEqual((self.held().name, self.held().source_change_id), (RENAMED, change.pk))
        newer = self.imported(self.opened("NEW"), DAY + timedelta(days=2), "Mia Newer")
        self.assertEqual(
            (self.held().name, self.held().as_at, self.held().source_import_id, self.held().source_change_id),
            ("Mia Newer", DAY + timedelta(days=2), newer.pk, None),
        )
        self.assertEqual(self.shown(), ("Mia Newer", "Mia Newer Street", PARTICULARS))
        self.assertEqual(self.unmet(pending), ["newer_particulars_exist"])
        with self.assertRaisesMessage(ValidationError, "newer_particulars_exist"):
            self.decide(pending, "apply")
        with self.assertRaisesMessage(
            ValidationError,
            f"already records this member's particulars as at {(DAY + timedelta(days=2)).isoformat()}, after "
            f"{(DAY + timedelta(days=1)).isoformat()}",
        ):
            self.submit(operation_id=uuid4(), as_at=DAY + timedelta(days=1))
        self.assertEqual(self.decide(pending, "reject", "Superseded by the newer register").status, "rejected")
        self.assertEqual(self.held().source_import_id, newer.pk)

    def test_a_members_live_identity_wins_over_particulars_from_a_change(self):
        live_wallet(self.company, self.member, LIVE, "Live Mia", "1 Live Street")
        self.apply(self.submit())
        self.assertEqual(self.held().source_change_id, RegisterParticularsChange.objects.get().pk)
        self.assertEqual(self.shown(), ("Live Mia", "1 Live Street", IDENTITY_LABELS[IDENTITY_LIVE]))
        identity = member_identities(self.token, [self.member.pk])[self.member.pk]
        self.assertEqual((identity.name, identity.source), ("Live Mia", IDENTITY_LIVE))

    def test_preparation_refuses_unusable_references_dates_text_and_evidence(self):
        _, _, _, stranger, _, foreign_evidence = particulars_fixture()
        authority = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.AUTHORITY)
        for changes, refusal, message in (
            ({"member": stranger.pk}, NotFound, "Register member not found"),
            ({"member": uuid4()}, NotFound, "Register member not found"),
            ({"member": "member"}, ValidationError, "must be UUIDs"),
            ({"as_at": "2026-02-30"}, ValidationError, "an ISO date"),
            ({"as_at": timezone.localdate() + timedelta(days=1)}, ValidationError, "after the day it is prepared"),
            ({"name": " "}, ValidationError, "needs a name"),
            ({"residential_address": ""}, ValidationError, "needs a residential address"),
            ({"reason": "\t"}, ValidationError, "needs a reason"),
            ({"name": None}, ValidationError, "needs a name"),
            ({"name": "N" * 256}, ValidationError, "name may have at most 255 characters"),
            ({"residential_address": "A" * 1001}, ValidationError, "address may have at most 1000 characters"),
            ({"reason": "R" * 1001}, ValidationError, "reason may have at most 1000 characters"),
            ({"supporting_evidence": authority.pk}, ValidationError, "supporting document you uploaded"),
            ({"supporting_evidence": foreign_evidence.pk}, ValidationError, "supporting document you uploaded"),
            ({"supporting_evidence": uuid4()}, ValidationError, "supporting document you uploaded"),
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(refusal, message):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterParticularsChange.objects.exists())
        longest = self.submit(name="N" * 255, residential_address="A" * 1000, reason="R" * 1000)
        self.assertEqual((len(longest.name), len(longest.residential_address)), (255, 1000))
        today = timezone.localdate()
        self.assertEqual(self.submit(operation_id=uuid4(), as_at=today).as_at, today)

    def test_preparation_refuses_a_date_before_the_particulars_the_register_already_holds(self):
        self.apply(self.submit())
        with self.assertRaisesMessage(
            ValidationError,
            f"already records this member's particulars as at {DAY.isoformat()}, after "
            f"{(DAY - timedelta(days=1)).isoformat()}",
        ):
            self.submit(operation_id=uuid4(), as_at=DAY - timedelta(days=1))
        same_day = self.submit(operation_id=uuid4(), name="Mia Same Day")
        self.assertEqual(self.apply(same_day).status, "applied")
        self.assertEqual((self.held().name, self.held().source_change_id), ("Mia Same Day", same_day.pk))

    def test_a_member_who_left_before_the_retention_period_takes_no_change(self):
        left, buyer, never, on_cutoff, before_cutoff = (
            create_member(company_id=self.company.pk, member_id=uuid4()) for _ in range(5)
        )
        token = self.opened("OLD", left, LONG_AGO)
        change = self.submit(member=left.pk)
        self.decide(change, "approve")
        moved(token.stored_register.pk, left, buyer, 100, self.owner, effective_on=date(2018, 6, 1))
        self.assertEqual(self.unmet(change), ["member_left_retention"])
        with self.assertRaisesMessage(ValidationError, "member_left_retention"):
            self.decide(change, "apply")
        cutoff = retention_cutoff()
        for symbol, member, left_on in (
            ("EDGE", on_cutoff, cutoff),
            ("PAST", before_cutoff, cutoff - timedelta(days=1)),
        ):
            edge = self.opened(symbol, member, LONG_AGO)
            moved(edge.stored_register.pk, member, buyer, 100, self.owner, effective_on=left_on)
        self.assertEqual(self.submit(operation_id=uuid4(), member=on_cutoff.pk).member_id, on_cutoff.pk)
        for member in (left, never, before_cutoff):
            with self.subTest(member=member.pk), self.assertRaisesMessage(ValidationError, "has held no shares since"):
                self.submit(operation_id=uuid4(), member=member.pk)
        self.assertEqual(self.decide(change, "reject", "The member left the register long ago").status, "rejected")
        moved(self.token.stored_register.pk, self.member, buyer, 100, self.owner)
        self.assertEqual(self.apply(self.submit(operation_id=uuid4())).status, "applied")
        self.assertEqual(self.held().name, RENAMED)
        self.assertFalse(RegisterMemberParticulars.objects.filter(member=left).exists())

    def test_an_identical_decision_retry_returns_the_change_and_a_changed_one_conflicts(self):
        change = self.submit()
        key = uuid4()
        approved = self.decide(change, "approve", idempotency_key=key)
        retry = {
            "actor": self.owner,
            "change_id": change.pk,
            "appointment": self.appointment.pk,
            "kind": "approve",
            "idempotency_key": key,
            "preview_digest": approved.decisions.get().digest,
            "confirmation": True,
        }
        self.assertEqual(decide_particulars_change(**retry).pk, change.pk)
        for changes in ({"kind": "reject", "reason": "Changed"}, {"preview_digest": "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                decide_particulars_change(**{**retry, **changes})
        self.assertEqual(
            RegisterParticularsChangeDecision.objects.filter(register_particulars_change=change).count(), 1
        )
        with self.assertRaisesMessage(ValidationError, "already_approved"):
            self.decide(change, "approve")
        with self.assertRaisesMessage(ValidationError, "Confirm the exact register change decision"):
            decide_particulars_change(**{**retry, "idempotency_key": uuid4(), "confirmation": False})
        self.assertEqual(self.decide(change, "apply").status, "applied")
        with self.assertRaisesMessage(ValidationError, "change_decided"):
            self.decide(change, "reject", "Too late")
        with self.assertRaisesMessage(NotFound, "Register change not found"):
            preview_particulars_decision(
                actor=self.owner, change_id=uuid4(), appointment=self.appointment.pk, kind="approve"
            )

    def test_particulars_that_change_after_an_apply_preview_refuse_the_stale_decision(self):
        change = self.submit()
        self.decide(change, "approve")
        stale = self.preview(change)["preview_digest"]
        self.apply(self.submit(operation_id=uuid4(), name="Mia Meanwhile"))
        self.assertEqual(self.unmet(change), [])
        with self.assertRaises(RegisterChangeConflict):
            decide_particulars_change(
                actor=self.owner,
                change_id=change.pk,
                appointment=self.appointment.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=stale,
                confirmation=True,
            )
        change.refresh_from_db()
        self.assertEqual((change.status, change.decisions.count()), ("submitted", 1))
        self.assertEqual(self.held().name, "Mia Meanwhile")
        self.assertEqual(self.decide(change, "apply").status, "applied")
        self.assertEqual(self.held().name, RENAMED)

    def test_a_failed_application_rolls_back_the_particulars_and_the_decision(self):
        change = self.submit()
        self.decide(change, "approve")
        digest = self.preview(change)["preview_digest"]
        with patch.object(RegisterParticularsChange, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                decide_particulars_change(
                    actor=self.owner,
                    change_id=change.pk,
                    appointment=self.appointment.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=digest,
                    confirmation=True,
                )
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        change.refresh_from_db()
        self.assertEqual((change.status, change.decisions.count()), ("submitted", 1))
        self.assertEqual(self.decide(change, "apply").status, "applied")

    def test_rejection_takes_a_reason_and_stays_available_when_the_copy_is_unavailable(self):
        change = self.submit()
        with private_storage().open(change.file.name, "wb") as stored:
            stored.write(b"%PDF-1.4 tampered")
        self.assertEqual(self.unmet(change, "approve"), ["evidence_unavailable"])
        self.assertEqual(self.preview(change, "reject")["unmet_requirements"], ["reason_required"])
        self.assertEqual(
            self.preview(change, "approve", "No")["unmet_requirements"],
            [
                "evidence_unavailable",
                "reason_not_allowed",
            ],
        )
        rejected = self.decide(change, "reject", "The retained copy changed")
        self.assertEqual(
            (rejected.status, rejected.rejection_reason, rejected.reviewed_by_id),
            ("rejected", "The retained copy changed", self.owner.pk),
        )
        self.assertEqual(rejected.reviewed_at, rejected.decisions.get(kind="reject").decided_at)
        self.assertFalse(RegisterMemberParticulars.objects.exists())

    def test_the_database_refuses_forged_changes_rewrites_and_deletion(self):
        change = self.submit()
        with company_operation(self.owner, self.company.pk, "register_particulars_apply"):
            for write in (
                lambda: RegisterParticularsChange.objects.filter(pk=change.pk).update(name="Rewritten"),
                lambda: RegisterParticularsChange.objects.filter(pk=change.pk).update(as_at=DAY - timedelta(days=1)),
                lambda: RegisterParticularsChange.objects.filter(pk=change.pk).update(file="elsewhere"),
                lambda: RegisterParticularsChange.objects.filter(pk=change.pk).update(
                    status="applied", reviewed_by=self.owner, reviewed_at=timezone.now()
                ),
            ):
                with self.assertRaises(DatabaseError), atomic():
                    write()
            with self.assertRaisesMessage(DatabaseError, "Retain particulars changes"), atomic():
                change.delete()
        self.assertTrue(change.file.storage.exists(change.file.name))
        forged = forged_fields(change)
        authority = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.AUTHORITY)
        _, _, _, stranger, _, _ = particulars_fixture()
        folder = f"companies/{self.company.pk}/register-particulars/{uuid4()}"
        for changes in (
            {"member": stranger},
            {"name": " "},
            {"residential_address": "\n"},
            {"reason": "\t"},
            {"as_at": timezone.now().date() + timedelta(days=1)},
            {"status": "applied"},
            {"rejection_reason": "Forged"},
            {"reviewed_by": self.owner},
            {"reviewed_at": timezone.now()},
            {"evidence_fingerprint": "0" * 64},
            {"evidence_snapshot": {**change.evidence_snapshot, "name": "forged.pdf"}},
            {
                "supporting_evidence": authority,
                "evidence_fingerprint": authority.sha256,
                "evidence_snapshot": evidence_snapshot(authority),
            },
            {"submitted_by": staff_user()},
            {"supporting_evidence": None},
            {"preparing_appointment": None},
            {"file": f"{folder}/{uuid4()}.bin"},
        ):
            with self.subTest(changes=changes):
                self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner, **changes))
        for operation in ("register_particulars_approve", "register_import_prepare"):
            with self.subTest(operation=operation):
                self.assert_refused(
                    "exact current intent", lambda: insert_forged(forged, self.owner, operation=operation)
                )
        for changes in ({}, {"as_at": timezone.localdate()}):
            with self.subTest(admitted=changes), self.assertRaises(RuntimeError), atomic():
                insert_forged(forged, self.owner, **changes)
                raise RuntimeError("rollback")
        self.assertEqual(RegisterParticularsChange.objects.count(), 1)
        with self.assertRaises(RuntimeError), atomic():
            decision = forge_decision(change, "reject", self.owner, self.appointment, reason="Exact")
            self.assert_refused(
                "Only the exact company decision",
                lambda: forge_outcome(
                    change, self.owner, decision, status="rejected", rejection_reason="Exact", name="Forged"
                ),
            )
            raise RuntimeError("rollback")
        self.apply(change)
        with company_operation(self.owner, self.company.pk, "register_particulars_apply"):
            for fields in (
                {"reviewed_at": timezone.now()},
                {"updated_at": timezone.now()},
                {"status": "rejected", "rejection_reason": "Later"},
            ):
                with self.subTest(fields=fields), self.assertRaises(DatabaseError), atomic():
                    RegisterParticularsChange.objects.filter(pk=change.pk).update(**fields)
        self.assertEqual(RegisterParticularsChange.objects.get(pk=change.pk).status, "applied")

    def test_an_import_counts_newer_particulars_only_from_an_applied_import_or_a_change(self):
        proposal = self.import_of(self.token, DAY - timedelta(days=3))
        waiting = self.import_of(self.opened("WAIT"), DAY, "Mia Waiting")
        for pending in (proposal, waiting):
            decide_import(self.owner, self.appointment, pending, "approve")
        with self.assertRaises(RuntimeError), atomic():
            forge_import_decision(waiting, "apply", self.owner, self.appointment)
            record_particulars(waiting, self.owner)
            self.assertEqual((self.held().name, self.held().source_import_id), ("Mia Waiting", waiting.pk))
            decision = forge_import_decision(proposal, "apply", self.owner, self.appointment)
            with self.assertRaisesMessage(DatabaseError, "record every member's particulars"), atomic():
                forge_import_outcome(proposal, self.owner, decision, status="applied", register_sequence=1)
            raise RuntimeError("rollback")
        self.assertEqual(RegisterImport.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        self.apply(self.submit())
        self.assertEqual(decide_import(self.owner, self.appointment, proposal, "apply").status, "applied")
        self.assertEqual(self.held().name, RENAMED)

    def test_an_import_dated_the_day_of_a_change_records_its_own_particulars_and_replaces_the_change(self):
        change = self.apply(self.submit())
        proposal = self.import_of(self.opened("SAME"), DAY, "Mia Same Day")
        decide_import(self.owner, self.appointment, proposal, "approve")
        with self.assertRaises(RuntimeError), atomic():
            decision = forge_import_decision(proposal, "apply", self.owner, self.appointment)
            with self.assertRaisesMessage(DatabaseError, "record every member's particulars"), atomic():
                forge_import_outcome(proposal, self.owner, decision, status="applied", register_sequence=1)
            raise RuntimeError("rollback")
        self.assertEqual(self.held().source_change_id, change.pk)
        self.assertEqual(decide_import(self.owner, self.appointment, proposal, "apply").status, "applied")
        self.assertEqual(
            (self.held().name, self.held().as_at, self.held().source_import_id, self.held().source_change_id),
            ("Mia Same Day", DAY, proposal.pk, None),
        )

    def test_an_apply_digest_binds_each_of_the_members_current_particulars(self):
        self.apply(self.submit())
        change = self.submit(operation_id=uuid4(), name="Mia Next")
        bound = decision_digest(change, "apply", self.owner, self.appointment)
        for column, value in (
            ("name", "Mia Altered"),
            ("residential_address", "9 Altered Street"),
            ("as_at", DAY + timedelta(days=1)),
            ("source_change_id", change.pk),
        ):
            with self.subTest(column=column), self.assertRaises(RuntimeError), atomic():
                with connection.cursor() as cursor:
                    cursor.execute(
                        "ALTER TABLE tokens_registermemberparticulars "
                        "DISABLE TRIGGER tokens_register_member_particulars_source"
                    )
                    cursor.execute(
                        f"UPDATE tokens_registermemberparticulars SET {column} = %s WHERE member_id = %s",
                        [value, self.member.pk],
                    )
                self.assertNotEqual(decision_digest(change, "apply", self.owner, self.appointment), bound)
                raise RuntimeError("rollback")
        self.assertEqual(decision_digest(change, "apply", self.owner, self.appointment), bound)

    def test_particulars_from_a_change_follow_the_seven_year_clock_and_the_change_is_kept(self):
        change = self.apply(self.submit())
        later = timezone.now() + timedelta(days=4000)
        self.assertEqual(purge_member_particulars(now=later), 0)
        left_on = retention_cutoff() - timedelta(days=1)
        legacy_entry_before_company_transfers(
            self.token, self.owner, "cessation", [{"member": str(self.member.pk), "shares": "-100"}], left_on
        )
        self.assertEqual(purge_member_particulars(now=timezone.now() - timedelta(days=1)), 0)
        self.assertEqual(purge_member_particulars(), 1)
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        change.refresh_from_db()
        self.assertEqual((change.status, change.name, change.residential_address), ("applied", RENAMED, NEW_ADDRESS))
        self.assertTrue(change.file.storage.exists(change.file.name))
        self.assertTrue(change.supporting_evidence.file.storage.exists(change.supporting_evidence.file.name))


class RegisterParticularsApiTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, self.appointment, self.evidence = particulars_fixture()
        self.client.force_authenticate(self.owner)
        self.payload = {
            **change_payload(self.member, self.evidence, self.appointment),
            "as_at": DAY.isoformat(),
        }

    def test_preparation_reads_lists_and_refuses_rewrites_changed_retries_and_anonymous_callers(self):
        created = self.client.post(PARTICULARS_CHANGES, self.payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        row = created.json()
        self.assertEqual(
            (row["status"], row["stage"], row["providedBy"], row["preparedByName"], row["decisions"]),
            ("submitted", "submitted", "company", "Synthetic register owner", []),
        )
        self.assertEqual(
            (row["member"], row["name"], row["residentialAddress"], row["asAt"], row["supportingEvidence"]),
            (str(self.member.pk), RENAMED, NEW_ADDRESS, DAY.isoformat(), str(self.evidence.pk)),
        )
        self.assertEqual(row["preparingAppointment"], str(self.appointment.pk))
        self.assertNotIn("file", row)
        self.assertEqual(self.client.post(PARTICULARS_CHANGES, self.payload, format="json").status_code, 200)
        self.assertEqual(
            self.client.post(PARTICULARS_CHANGES, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        for changes in ({"name": ""}, {"name": "N" * 256}, {"as_at": "soon"}, {"member": "member"}):
            with self.subTest(changes=changes):
                self.assertEqual(
                    self.client.post(PARTICULARS_CHANGES, {**self.payload, **changes}, format="json").status_code, 400
                )
        detail = f"{PARTICULARS_CHANGES}{row['uuid']}/"
        self.assertEqual(self.client.get(detail).json()["uuid"], row["uuid"])
        self.assertEqual(self.client.get(f"{detail}file/").status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        with use_operator():
            stranger, elsewhere, _, their_member, their_appointment, their_evidence = particulars_fixture()
        theirs = str(prepared(stranger, change_payload(their_member, their_evidence, their_appointment)).pk)
        _, code, _ = issue_team_invitation(
            requester=stranger,
            company_id=elsewhere.pk,
            inviter_appointment_id=their_appointment.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.READ_REGISTER],
            delegatable_capabilities=[],
            appointment_expires_at=None,
        )
        accept_team_invitation(
            requester=self.owner, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        for query, expected in (
            ({}, [row["uuid"], theirs]),
            ({"company": str(self.company.pk)}, [row["uuid"]]),
            ({"company": str(elsewhere.pk)}, [theirs]),
            ({"member": str(self.member.pk)}, [row["uuid"]]),
            ({"member": str(other.pk)}, []),
            ({"status": "submitted"}, [row["uuid"], theirs]),
            ({"status": "applied"}, []),
        ):
            with self.subTest(query=query):
                listed = self.client.get(PARTICULARS_CHANGES, query).json()["results"]
                self.assertEqual(sorted(item["uuid"] for item in listed), sorted(expected))
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(PARTICULARS_CHANGES, self.payload, format="json").status_code, 401)


class RegisterParticularsMigrationTest(TransactionTestCase):
    GUARDS = ("tokens_guard_register_evidence", "tokens_guard_register_import")
    FUNCTIONS = (
        "tokens_check_register_particulars_decision",
        "tokens_guard_register_member_particulars",
        "tokens_guard_register_particulars_change",
        "tokens_guard_register_particulars_decision",
        "tokens_register_particulars_approved",
        "tokens_register_particulars_decision_digest",
    )
    PINNED = ["search_path=pg_catalog, public, pg_temp"]

    def installed(self, names):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, prosrc FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname", [list(names)]
            )
            return cursor.fetchall()

    def configured(self, names):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, proconfig FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname", [list(names)]
            )
            return cursor.fetchall()

    def test_upgrade_dates_each_members_imported_particulars_from_its_import(self):
        self.addCleanup(restore_every_migration)
        migrate_to([("tokens", "0082_company_eligibility_admission")])
        owner, _, token, member, appointment, register_copy, asic, _ = import_fixture()
        proposal = prepared_import(
            owner, import_payload(token, register_copy, asic, member, appointment, as_at="2026-09-01")
        )
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO tokens_registermemberparticulars (uuid, created_at, updated_at, member_id, name, "
                "residential_address, source_import_id) VALUES (%s, now(), now(), %s, 'Mia Member', %s, %s)",
                [uuid4(), member.pk, RESIDENCE, proposal.pk],
            )
        restore_every_migration()
        held = RegisterMemberParticulars.objects.get(member=member)
        self.assertEqual(
            (held.name, held.as_at, held.source_import_id, held.source_change_id),
            ("Mia Member", date(2026, 9, 1), proposal.pk, None),
        )

    def test_reversal_restores_the_earlier_guards_and_upload_kinds_then_reapplies(self):
        self.addCleanup(restore_every_migration)
        every = self.GUARDS + self.FUNCTIONS
        previous = ("tokens", "0082_company_eligibility_admission")
        company_run, pinned = self.installed(every), self.configured(every)
        self.assertEqual(pinned, [(name, self.PINNED) for name in sorted(every)])
        self.assertIn("'supporting'", dict(company_run)["tokens_guard_register_evidence"])
        self.assertIn("p.source_change_id IS NOT NULL", dict(company_run)["tokens_guard_register_import"])
        migrate_to([("tokens", "0063_swap_finalized_receipt")])
        migrate_to([previous])
        earlier = self.installed(self.GUARDS)
        self.assertEqual(self.configured(self.GUARDS), [(name, self.PINNED) for name in self.GUARDS])
        self.assertNotIn("'supporting'", dict(earlier)["tokens_guard_register_evidence"])
        self.assertNotIn("source_change_id", dict(earlier)["tokens_guard_register_import"])
        self.assertEqual(self.installed(self.FUNCTIONS), [])
        restore_every_migration()
        self.assertEqual((self.installed(every), self.configured(every)), (company_run, pinned))
        migrate_to([previous])
        self.assertEqual((self.installed(self.GUARDS), self.installed(self.FUNCTIONS)), (earlier, []))
        self.assertEqual(self.configured(self.GUARDS), [(name, self.PINNED) for name in self.GUARDS])
        restore_every_migration()
        self.assertEqual((self.installed(every), self.configured(every)), (company_run, pinned))

    def test_reversal_refuses_while_changes_or_supporting_uploads_exist(self):
        owner, _, _, member, appointment, evidence = particulars_fixture()
        company_run = self.installed(self.GUARDS + self.FUNCTIONS)
        migration = import_module("tokens.migrations.0091_company_particulars_change_guards")

        def refused():
            with self.assertRaisesMessage(DatabaseError, "Retain particulars changes"), atomic():
                with connections[current_alias()].schema_editor() as editor:
                    migration.remove_company_particulars(None, editor)
            self.assertEqual(self.installed(self.GUARDS + self.FUNCTIONS), company_run)

        refused()
        prepared(owner, change_payload(member, evidence, appointment))
        with atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("ALTER TABLE tokens_registerevidence DISABLE TRIGGER tokens_register_evidence_guard")
            try:
                cursor.execute("UPDATE tokens_registerevidence SET kind = 'authority' WHERE uuid = %s", [evidence.pk])
            finally:
                cursor.execute("ALTER TABLE tokens_registerevidence ENABLE TRIGGER tokens_register_evidence_guard")
        refused()


class ScopedRegisterParticularsTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, self.appointment, self.evidence = particulars_fixture()
            self.stranger, _, _, _, _, _ = particulars_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.change = prepared(self.owner, change_payload(self.member, self.evidence, self.appointment))

    def test_the_app_reads_but_only_the_bounded_operator_command_prepares_decides_and_writes_particulars(self):
        self.assertEqual(list(RegisterParticularsChange.objects.values_list("pk", flat=True)), [self.change.pk])
        for write in (
            lambda: RegisterParticularsChange.objects.filter(pk=self.change.pk).update(status="rejected"),
            lambda: RegisterParticularsChange.objects.filter(pk=self.change.pk).update(name="Forged"),
            lambda: list(RegisterParticularsChangeDecision.objects.all()),
            self.change.delete,
        ):
            with self.assertRaises(DatabaseError), atomic():
                write()
        refused = "Only the register's own commands write member particulars"
        with self.assertRaisesMessage(DatabaseError, refused), atomic():
            RegisterMemberParticulars.objects.create(
                member=self.member, name="Forged", residential_address="Nowhere", as_at=DAY, source_change=self.change
            )
        apply_change(self.owner, self.appointment, self.change)
        self.assertEqual(RegisterParticularsChange.objects.get(pk=self.change.pk).status, "applied")
        self.assertEqual(RegisterMemberParticulars.objects.get(member=self.member).source_change_id, self.change.pk)
        with self.assertRaisesMessage(DatabaseError, refused), atomic():
            RegisterMemberParticulars.objects.filter(member=self.member).update(name="Forged")
        RegisterMemberParticulars.objects.filter(member=self.member).delete()
        self.assertEqual(RegisterMemberParticulars.objects.get(member=self.member).name, RENAMED)
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertFalse(RegisterParticularsChange.objects.filter(pk=self.change.pk).exists())
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        self.no_principal_is_set()
        self.assertFalse(RegisterParticularsChange.objects.exists())

    def test_a_failed_application_leaves_the_change_particulars_and_decisions_as_they_were(self):
        decide(self.owner, self.appointment, self.change, "approve")
        digest = preview(self.owner, self.appointment, self.change, "apply")["preview_digest"]
        with patch.object(RegisterParticularsChange, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                decide_particulars_change(
                    actor=self.owner,
                    change_id=self.change.pk,
                    appointment=self.appointment.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=digest,
                    confirmation=True,
                )
        self.assertEqual(RegisterParticularsChange.objects.get(pk=self.change.pk).status, "submitted")
        with use_operator():
            self.assertFalse(RegisterMemberParticulars.objects.exists())
            self.assertEqual(
                list(RegisterParticularsChangeDecision.objects.values_list("kind", flat=True)), ["approve"]
            )

    def test_the_operator_cannot_truncate_retained_changes(self):
        with use_operator(), self.assertRaises(DatabaseError), atomic(), connections[
            current_alias()
        ].cursor() as cursor:
            cursor.execute("TRUNCATE tokens_registerparticularschange CASCADE")
        self.assertTrue(self.change.file.storage.exists(self.change.file.name))

    def test_separate_connections_serialize_a_duplicate_application(self):
        decide(self.owner, self.appointment, self.change, "approve")
        digest = preview(self.owner, self.appointment, self.change, "apply")["preview_digest"]
        key = uuid4()
        reached = Queue()

        def application():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    try:
                        return decide_particulars_change(
                            actor=self.owner,
                            change_id=self.change.pk,
                            appointment=self.appointment.pk,
                            kind="apply",
                            idempotency_key=key,
                            preview_digest=digest,
                            confirmation=True,
                        ).status
                    except RegisterChangeConflict:
                        return "conflict"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                Company.objects.select_for_update(no_key=True).get(pk=self.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                futures = [pool.submit(application) for _ in range(2)]
                workers = [reached.get(timeout=10) for _ in futures]
                self.assertEqual(len({blocker, *(pid for pid, _ in workers)}), 3)
                self.assertEqual({role for _, role in workers}, {settings.RLS_ROLES["operator"]})
                deadline = time.monotonic() + 10
                blocked = False
                while time.monotonic() < deadline:
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT bool_and(cardinality(pg_blocking_pids(pid)) > 0) "
                            "FROM pg_stat_activity WHERE pid = ANY(%s)",
                            [[pid for pid, _ in workers]],
                        )
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked)
            results = [future.result(timeout=15) for future in futures]
        with use_operator():
            self.assertEqual(results, ["applied", "applied"])
            self.assertEqual(RegisterParticularsChangeDecision.objects.filter(kind="apply").count(), 1)
            self.assertEqual(RegisterMemberParticulars.objects.get(member=self.member).source_change_id, self.change.pk)
