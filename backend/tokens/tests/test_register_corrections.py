import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from datetime import timezone as utc_zone
from importlib import import_module
from queue import Queue
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib import admin
from django.db import DatabaseError, connection, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from companies.services.administration import company_operation
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterCorrection,
    RegisterCorrectionDecision,
    RegisterEntry,
    RegisterEvidence,
    RegisterEvidenceKind,
    ShareRegister,
)
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction,
    preview_correction_decision,
)
from tokens.services.register_events import (
    create_member,
    record_entry,
    verify_register,
)
from tokens.services.register_evidence import evidence_snapshot
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_imports import (
    owner_appointment,
    staff_user,
    upload_evidence,
)

CORRECTIONS = "/api/v1/tokens/register-corrections/"


def correction_fixture():
    owner, company, _, member, _, opening = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    appointment = owner_appointment(company)
    issue = record_entry(
        register_id=opening.register_id,
        operation_id=uuid4(),
        kind="issue",
        changes=[{"member": str(member.pk), "shares": "5"}],
        effective_on=DAY,
        recorded_by=owner,
    )
    evidence = upload_evidence(owner, appointment, RegisterEvidenceKind.AUTHORITY)
    return owner, company, appointment, issue, evidence


def correction_payload(issue, evidence, appointment, **changes):
    return {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "corrects_id": issue.pk,
        "authority_evidence": evidence.pk,
        "effective_on": DAY,
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-1",
        "reason": "Duplicate allotment recorded in the synthetic register",
        **changes,
    }


def prepared(actor, payload):
    return prepare_correction(actor=actor, **payload)[0]


def preview(actor, appointment, proposal, kind, reason=""):
    return preview_correction_decision(
        actor=actor, correction_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=reason
    )[1]


def decide(actor, appointment, proposal, kind, reason="", idempotency_key=None):
    return decide_correction(
        actor=actor,
        correction_id=proposal.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=idempotency_key or uuid4(),
        preview_digest=preview(actor, appointment, proposal, kind, reason)["preview_digest"],
        confirmation=True,
        reason=reason,
    )


def apply_correction(actor, appointment, proposal):
    decide(actor, appointment, proposal, "approve")
    return decide(actor, appointment, proposal, "apply")


def decision_digest(proposal, kind, actor, appointment, reason=""):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_register_correction_decision_digest(%s, %s, %s, %s, %s)",
            [proposal.pk, kind, actor.pk, appointment.pk, reason],
        )
        return cursor.fetchone()[0]


def forge_decision(proposal, kind, actor, appointment, reason="", digest=None, decided_by=None):
    with company_operation(actor, proposal.company_id, f"register_correction_{kind}"), atomic():
        decision = RegisterCorrectionDecision.objects.create(
            register_correction=proposal,
            kind=kind,
            decided_by=decided_by or actor,
            appointment=appointment,
            idempotency_key=uuid4(),
            digest=digest or decision_digest(proposal, kind, actor, appointment, reason),
            reason=reason,
            decided_at=timezone.now(),
        )
        decision.refresh_from_db()
    return decision


def forge_outcome(proposal, actor, decision, **fields):
    with company_operation(actor, proposal.company_id, f"register_correction_{decision.kind}"), atomic():
        RegisterCorrection.objects.filter(pk=proposal.pk).update(
            reviewed_by=actor, reviewed_at=decision.decided_at, **fields
        )


def forged_fields(proposal):
    return {
        field.name: getattr(proposal, field.name)
        for field in RegisterCorrection._meta.fields
        if field.name not in ("uuid", "created_at", "updated_at", "file")
    }


def insert_forged(fields, actor, operation="register_correction_prepare", scope=None, **changes):
    forged_id = uuid4()
    company_id = fields["company"].pk
    with company_operation(actor, scope or company_id, operation), atomic():
        RegisterCorrection.objects.create(
            **{
                **fields,
                "uuid": forged_id,
                "file": f"companies/{company_id}/register-corrections/{forged_id}/{uuid4()}.bin",
                **changes,
            }
        )


def staff_era(proposal):
    with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
        cursor.execute("ALTER TABLE tokens_registercorrection DISABLE TRIGGER tokens_register_correction_identity")
        try:
            RegisterCorrection.objects.filter(pk=proposal.pk).update(
                preparing_appointment=None, authority_evidence=None, source_document=uuid4()
            )
        finally:
            cursor.execute("ALTER TABLE tokens_registercorrection ENABLE TRIGGER tokens_register_correction_identity")
    with use_operator():
        proposal.refresh_from_db()
    return proposal


def moved_away(issue, actor, shares):
    member = issue.changes[0]["member"]
    with use_operator():
        other = str(create_member(company_id=issue.register.company_id, member_id=uuid4()).pk)
        record_entry(
            register_id=issue.register_id,
            operation_id=uuid4(),
            kind="transfer",
            changes=sorted(
                [{"member": member, "shares": str(-shares)}, {"member": other, "shares": str(shares)}],
                key=lambda change: change["member"],
            ),
            effective_on=DAY,
            recorded_by=actor,
        )


class RegisterCorrectionTest(TransactionTestCase):
    def setUp(self):
        self.owner, self.company, self.appointment, self.issue, self.evidence = correction_fixture()
        self.payload = correction_payload(self.issue, self.evidence, self.appointment)

    def submit(self, **changes):
        return prepared(self.owner, {**self.payload, **changes})

    def preview(self, proposal, kind="apply", reason=""):
        return preview(self.owner, self.appointment, proposal, kind, reason)

    def decide(self, proposal, kind, reason="", **options):
        return decide(self.owner, self.appointment, proposal, kind, reason, **options)

    def apply(self, proposal):
        return apply_correction(self.owner, self.appointment, proposal)

    def unmet(self, proposal, kind="apply"):
        return self.preview(proposal, kind)["unmet_requirements"]

    def issue_again(self):
        return record_entry(
            register_id=self.issue.register_id,
            operation_id=uuid4(),
            kind="issue",
            changes=self.issue.changes,
            effective_on=DAY,
            recorded_by=self.owner,
        )

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def test_preparation_keeps_its_own_copy_of_the_upload_with_the_exact_inverse_and_the_register_head(self):
        proposal = self.submit()
        register = ShareRegister.objects.get(pk=self.issue.register_id)
        self.assertEqual(proposal.changes, [{"member": self.issue.changes[0]["member"], "shares": "-5"}])
        self.assertEqual(
            (proposal.status, proposal.base_sequence, proposal.base_hash), ("submitted", 2, register.head_hash)
        )
        self.assertEqual(
            (
                proposal.preparing_appointment_id,
                proposal.authority_evidence_id,
                proposal.source_document,
                proposal.evidence_fingerprint,
            ),
            (self.appointment.pk, self.evidence.pk, None, self.evidence.sha256),
        )
        self.assertEqual(
            proposal.evidence_snapshot,
            {
                "provided_by": "company",
                "evidence": str(self.evidence.pk),
                "company": str(self.company.pk),
                "document_type": "authority",
                "name": "authority.pdf",
                "file_size": self.evidence.file_size,
                "mime_type": "application/pdf",
                "sha256": self.evidence.sha256,
            },
        )
        self.assertNotEqual(proposal.file.name, self.evidence.file.name)
        with proposal.file.open("rb") as kept, self.evidence.file.open("rb") as uploaded:
            self.assertEqual(kept.read(), uploaded.read())
        self.assertEqual(RegisterEntry.objects.filter(register_id=proposal.register_id).count(), 2)

    def test_application_records_the_exact_compensating_entry_once(self):
        proposal = self.submit()
        self.assertEqual(
            {key: value for key, value in self.preview(proposal, "approve").items() if key != "preview_digest"},
            {
                "unmet_requirements": [],
                "can_decide": True,
                "register_sequence": 2,
                "original_changes": self.issue.changes,
                "changes": proposal.changes,
                "effective_on": DAY,
            },
        )
        applied = self.apply(proposal)
        entry = applied.applied_entry
        self.assertEqual(
            (entry.kind, entry.corrects_id, entry.operation_id, entry.changes, entry.effective_on),
            ("correction", self.issue.pk, proposal.pk, proposal.changes, DAY),
        )
        self.assertEqual(
            (entry.previous_hash, entry.sequence, entry.recorded_by_id), (proposal.base_hash, 3, self.owner.pk)
        )
        self.assertEqual(
            (applied.status, applied.reviewed_by_id, list(applied.decisions.values_list("kind", flat=True))),
            ("applied", self.owner.pk, ["approve", "apply"]),
        )
        self.assertEqual(applied.reviewed_at, applied.decisions.get(kind="apply").decided_at)
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "100")
        self.assertEqual(RegisterEntry.objects.filter(operation_id=proposal.pk).count(), 1)

    def test_a_changed_preparation_retry_conflicts_and_an_entry_takes_one_correction(self):
        proposal = self.submit()
        self.assertEqual(prepare_correction(actor=self.owner, **self.payload), (proposal, False))
        other = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.AUTHORITY)
        for change in (
            {"reason": "Other intent"},
            {"effective_on": DAY - timedelta(days=1)},
            {"approving_director": "Other Director"},
            {"authority_evidence": other.pk},
        ):
            with self.subTest(change=change), self.assertRaises(RegisterChangeConflict):
                self.submit(**change)
        pending = self.submit(operation_id=uuid4())
        self.apply(proposal)
        with self.assertRaisesMessage(ValidationError, "cannot be compensated"):
            self.submit(operation_id=uuid4())
        self.assertEqual(self.unmet(pending, "approve"), ["entry_already_corrected", "register_changed"])
        with self.assertRaisesMessage(ValidationError, "entry_already_corrected"):
            self.decide(pending, "approve")
        self.assertEqual(self.decide(pending, "reject", "Already corrected").status, "rejected")
        self.assertEqual(RegisterEntry.objects.filter(corrects=self.issue).count(), 1)

    def test_a_correction_cannot_take_effect_after_the_day_it_is_prepared(self):
        now = datetime(2026, 9, 25, 23, 59, 59, tzinfo=utc_zone.utc)
        entries = RegisterEntry.objects.count()
        with patch("django.utils.timezone.now", return_value=now):
            with self.assertRaisesMessage(ValidationError, "cannot take effect after the day it is prepared"):
                self.submit(effective_on=now.date() + timedelta(days=1))
            self.assertFalse(RegisterCorrection.objects.exists())
            proposal = self.submit(effective_on=now.date())
        self.assertEqual((proposal.status, proposal.effective_on), ("submitted", now.date()))
        self.assertEqual(RegisterEntry.objects.count(), entries)

    def test_court_authority_is_distinct_and_a_resolution_names_its_director(self):
        for changes in (
            {"approving_director": ""},
            {"authority": "court_order"},
            {"authority_reference": " "},
            {"reason": ""},
            {"authority": "ordinary_resolution"},
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(ValidationError, "approving director"):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterCorrection.objects.exists())
        proposal = self.submit(authority="court_order", approving_director="", authority_reference="SYNTHETIC-COURT-1")
        self.assertEqual(self.apply(proposal).authority, "court_order")

    def test_preparation_refuses_an_inverse_that_would_take_a_holding_below_zero(self):
        moved_away(self.issue, self.owner, 103)
        with self.assertRaisesMessage(ValidationError, "below zero"):
            self.submit()
        self.assertFalse(RegisterCorrection.objects.exists())

    def test_an_identical_decision_retry_returns_the_correction_and_a_changed_one_conflicts(self):
        proposal = self.submit()
        key = uuid4()
        approved = self.decide(proposal, "approve", idempotency_key=key)
        retry = {
            "actor": self.owner,
            "correction_id": proposal.pk,
            "appointment": self.appointment.pk,
            "kind": "approve",
            "idempotency_key": key,
            "preview_digest": approved.decisions.get().digest,
            "confirmation": True,
        }
        self.assertEqual(decide_correction(**retry).pk, proposal.pk)
        for changes in ({"kind": "reject", "reason": "Changed"}, {"preview_digest": "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                decide_correction(**{**retry, **changes})
        self.assertEqual(RegisterCorrectionDecision.objects.filter(register_correction=proposal).count(), 1)
        with self.assertRaisesMessage(ValidationError, "already_approved"):
            self.decide(proposal, "approve")
        with self.assertRaisesMessage(ValidationError, "Confirm the exact register correction decision"):
            decide_correction(**{**retry, "idempotency_key": uuid4(), "confirmation": False})
        self.assertEqual(self.decide(proposal, "apply").status, "applied")
        with self.assertRaisesMessage(ValidationError, "correction_decided"):
            self.decide(proposal, "reject", "Too late")

    def test_a_register_change_after_an_apply_preview_refuses_the_stale_decision(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        stale = self.preview(proposal)["preview_digest"]
        self.issue_again()
        self.assertEqual(self.unmet(proposal), ["register_changed"])
        with self.assertRaises(RegisterChangeConflict):
            decide_correction(
                actor=self.owner,
                correction_id=proposal.pk,
                appointment=self.appointment.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=stale,
                confirmation=True,
            )
        proposal.refresh_from_db()
        self.assertEqual((proposal.status, proposal.decisions.count()), ("submitted", 1))
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "110")

    def test_a_register_change_after_preparation_keeps_it_from_applying_and_it_can_be_rejected(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        moved_away(self.issue, self.owner, 103)
        self.assertEqual(self.unmet(proposal), ["position_would_go_negative", "register_changed"])
        with self.assertRaisesMessage(ValidationError, "register_changed"):
            self.decide(proposal, "apply")
        rejected = self.decide(proposal, "reject", "Prepare it again against the current register")
        self.assertEqual(
            (rejected.status, rejected.rejection_reason, rejected.applied_entry_id),
            ("rejected", "Prepare it again against the current register", None),
        )
        self.assertEqual(rejected.reviewed_at, rejected.decisions.get(kind="reject").decided_at)
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "105")

    def test_a_failed_application_rolls_back_the_entry_projection_and_decision(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        digest = self.preview(proposal)["preview_digest"]
        with patch.object(RegisterCorrection, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                decide_correction(
                    actor=self.owner,
                    correction_id=proposal.pk,
                    appointment=self.appointment.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=digest,
                    confirmation=True,
                )
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "105")
        self.assertFalse(RegisterEntry.objects.filter(operation_id=proposal.pk).exists())
        proposal.refresh_from_db()
        self.assertEqual((proposal.status, proposal.decisions.count()), ("submitted", 1))
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_the_database_refuses_forged_corrections_rewrites_and_deletion(self):
        proposal = self.submit()
        with company_operation(self.owner, self.company.pk, "register_correction_apply"):
            for write in (
                lambda: RegisterCorrection.objects.filter(pk=proposal.pk).update(reason="Rewritten"),
                lambda: RegisterCorrection.objects.filter(pk=proposal.pk).update(changes=[]),
                lambda: RegisterCorrection.objects.filter(pk=proposal.pk).update(file="elsewhere"),
                lambda: RegisterCorrection.objects.filter(pk=proposal.pk).update(preparing_appointment=None),
                lambda: RegisterCorrection.objects.filter(pk=proposal.pk).update(
                    status="applied", reviewed_by=self.owner, reviewed_at=timezone.now(), applied_entry=self.issue
                ),
                proposal.delete,
            ):
                with self.assertRaises(DatabaseError), atomic():
                    write()
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        forged = forged_fields(proposal)
        register_copy = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.SHARE_REGISTER)
        folder = f"companies/{self.company.pk}/register-corrections/{uuid4()}"
        for changes in (
            {"changes": []},
            {"changes": [{**proposal.changes[0], "shares": "-4"}]},
            {"base_hash": "0" * 64},
            {"base_sequence": 1},
            {"status": "applied"},
            {"rejection_reason": "Forged"},
            {"evidence_fingerprint": "0" * 64},
            {"evidence_snapshot": {**proposal.evidence_snapshot, "name": "forged.pdf"}},
            {
                "authority_evidence": register_copy,
                "evidence_fingerprint": register_copy.sha256,
                "evidence_snapshot": evidence_snapshot(register_copy),
            },
            {"authority_evidence": None},
            {"preparing_appointment": None},
            {"submitted_by": staff_user()},
            {"authority": "court_order"},
            {"effective_on": (timezone.now() + timedelta(days=1)).date()},
            {"file": f"{folder}/{uuid4()}.bin"},
        ):
            with self.subTest(changes=changes):
                self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner, **changes))
        self.assert_refused(
            "register_correction_exact_provenance",
            lambda: insert_forged(forged, self.owner, source_document=uuid4()),
        )
        for operation in ("register_correction_approve", "register_import_prepare"):
            with self.subTest(operation=operation):
                self.assert_refused(
                    "exact current intent", lambda: insert_forged(forged, self.owner, operation=operation)
                )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner)
            raise RuntimeError("rollback")
        self.apply(proposal)
        self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner))
        with company_operation(self.owner, self.company.pk, "register_correction_apply"):
            with self.assertRaises(DatabaseError), atomic():
                RegisterCorrection.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
        self.assertEqual(RegisterCorrection.objects.count(), 1)

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_admin_keeps_corrections_as_read_only_history_with_their_evidence(self):
        proposal = self.submit()
        reviewer = staff_user()
        with use_migrate():
            reviewer.is_superuser = True
            reviewer.save(update_fields=["is_superuser"])
        self.client.force_login(reviewer)
        change = reverse("admin:tokens_registercorrection_change", args=[proposal.pk])
        evidence = reverse("admin:tokens_registercorrection_evidence", args=[proposal.pk])
        response = self.client.get(change)
        self.assertContains(response, evidence)
        self.assertNotContains(response, "/review/")
        self.assertEqual(self.client.post(change, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.get(evidence).status_code, 200)
        model_admin = admin.site._registry[RegisterCorrection]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            {field.name for field in RegisterCorrection._meta.fields} - {"file"} <= set(model_admin.readonly_fields)
        )
        proposal.refresh_from_db()
        self.assertEqual((proposal.status, proposal.reason), ("submitted", self.payload["reason"]))


class RegisterCorrectionApiTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.appointment, self.issue, self.evidence = correction_fixture()
        self.client.force_authenticate(self.owner)
        self.payload = correction_payload(self.issue, self.evidence, self.appointment)

    def test_preparation_reads_lists_and_refuses_rewrites_changed_retries_and_anonymous_callers(self):
        created = self.client.post(CORRECTIONS, self.payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        row = created.json()
        self.assertEqual(
            (row["status"], row["stage"], row["providedBy"], row["preparedByName"], row["decisions"]),
            ("submitted", "submitted", "company", "Synthetic register owner", []),
        )
        self.assertEqual(
            (row["authorityEvidence"], row["preparingAppointment"], row["sourceDocument"]),
            (str(self.evidence.pk), str(self.appointment.pk), None),
        )
        self.assertNotIn("file", row)
        self.assertEqual(self.client.post(CORRECTIONS, self.payload, format="json").status_code, 200)
        self.assertEqual(
            self.client.post(CORRECTIONS, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        detail = f"{CORRECTIONS}{row['uuid']}/"
        self.assertEqual(self.client.get(detail).json()["uuid"], row["uuid"])
        self.assertEqual(self.client.get(f"{detail}file/").status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        for query, expected in (
            ({"company": str(self.company.pk)}, [row["uuid"]]),
            ({"register": str(self.issue.register_id)}, [row["uuid"]]),
            ({"register": str(uuid4())}, []),
            ({"status": "submitted"}, [row["uuid"]]),
            ({"status": "applied"}, []),
        ):
            with self.subTest(query=query):
                listed = self.client.get(CORRECTIONS, query).json()["results"]
                self.assertEqual([item["uuid"] for item in listed], expected)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(CORRECTIONS, self.payload, format="json").status_code, 401)


class RegisterCorrectionMigrationTest(TransactionTestCase):
    GUARDS = ("tokens_guard_register_correction", "tokens_guard_register_evidence")
    FUNCTIONS = (
        "tokens_register_correction_approved",
        "tokens_register_correction_decision_digest",
        "tokens_guard_register_correction_decision",
        "tokens_check_register_correction_decision",
    )

    def installed(self, names=GUARDS):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, prosrc FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname", [list(names)]
            )
            return cursor.fetchall()

    def configured(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, proconfig FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname", [list(self.GUARDS)]
            )
            return cursor.fetchall()

    def insert_policy(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy "
                "WHERE polname = 'tokens_registercorrection_insert'"
            )
            return cursor.fetchone()[0]

    def test_upgrade_preserves_register_history_without_fabricated_proposals(self):
        self.addCleanup(restore_every_migration)
        migrate_to([("tokens", "0063_swap_finalized_receipt")])
        _, _, _, _, _, opening = register_fixture()
        original_hash = opening.entry_hash
        restore_every_migration()
        self.assertEqual(RegisterEntry.objects.get(pk=opening.pk).entry_hash, original_hash)
        self.assertFalse(RegisterCorrection.objects.exists())

    def test_reversal_restores_the_staff_review_guard_owner_submissions_and_upload_kinds_then_reapplies(self):
        self.addCleanup(restore_every_migration)
        previous = ("tokens", "0084_company_register_import_guards")
        company_run, closed, pinned = self.installed(), self.insert_policy(), self.configured()
        self.assertEqual(
            pinned,
            [(name, ["search_path=pg_catalog, public, pg_temp"]) for name in sorted(self.GUARDS)],
        )
        self.assertIn("tokens_registercorrectiondecision", dict(company_run)["tokens_guard_register_correction"])
        self.assertIn("'authority'", dict(company_run)["tokens_guard_register_evidence"])
        self.assertNotIn("submitted_by_id", closed)
        self.assertEqual(len(self.installed(self.FUNCTIONS)), 4)
        migrate_to([("tokens", "0063_swap_finalized_receipt")])
        migrate_to([previous])
        earlier = self.installed()
        self.assertEqual(dict(self.configured())["tokens_guard_register_correction"], None)
        self.assertIn("Only operator review may decide", dict(earlier)["tokens_guard_register_correction"])
        self.assertNotIn("'authority'", dict(earlier)["tokens_guard_register_evidence"])
        self.assertIn("submitted_by_id", self.insert_policy())
        restore_every_migration()
        self.assertEqual((self.installed(), self.insert_policy(), self.configured()), (company_run, closed, pinned))
        migrate_to([previous])
        self.assertEqual(self.installed(), earlier)
        self.assertIn("submitted_by_id", self.insert_policy())
        self.assertEqual(self.installed(self.FUNCTIONS), [])
        restore_every_migration()
        self.assertEqual((self.installed(), self.insert_policy()), (company_run, closed))

    def test_reversal_refuses_while_company_corrections_decisions_or_authority_uploads_exist(self):
        correction_fixture()
        company_run = self.installed()
        migration = import_module("tokens.migrations.0086_company_register_correction_guards")
        with self.assertRaisesMessage(DatabaseError, "Retain company register corrections"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_company_corrections(None, editor)
        self.assertEqual(self.installed(), company_run)

    def test_reversal_refuses_while_a_company_decision_on_a_staff_era_correction_exists(self):
        owner, _, appointment, issue, evidence = correction_fixture()
        proposal = staff_era(prepared(owner, correction_payload(issue, evidence, appointment)))
        with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("ALTER TABLE tokens_registerevidence DISABLE TRIGGER tokens_register_evidence_guard")
            try:
                RegisterEvidence.objects.filter(pk=evidence.pk).update(kind=RegisterEvidenceKind.SHARE_REGISTER)
            finally:
                cursor.execute("ALTER TABLE tokens_registerevidence ENABLE TRIGGER tokens_register_evidence_guard")
        decide(owner, appointment, proposal, "reject", reason="Prepared for the retired staff review")
        company_run = self.installed()
        migration = import_module("tokens.migrations.0086_company_register_correction_guards")
        with self.assertRaisesMessage(DatabaseError, "Retain company register corrections"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_company_corrections(None, editor)
        self.assertEqual(self.installed(), company_run)

    def test_the_original_reversal_still_refuses_to_discard_existing_proposals(self):
        owner, _, appointment, issue, evidence = correction_fixture()
        proposal = prepared(owner, correction_payload(issue, evidence, appointment))
        migration = import_module("tokens.migrations.0064_reviewed_register_corrections")
        with self.assertRaisesRegex(RuntimeError, "Retain correction"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterCorrection.objects.filter(pk=proposal.pk).exists())


class ScopedRegisterCorrectionTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.appointment, self.issue, self.evidence = correction_fixture()
            self.stranger, _, _, _, _ = correction_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = prepared(self.owner, correction_payload(self.issue, self.evidence, self.appointment))

    def test_the_app_reads_but_only_the_bounded_operator_command_prepares_and_decides(self):
        self.assertEqual(list(RegisterCorrection.objects.values_list("pk", flat=True)), [self.proposal.pk])
        for write in (
            lambda: RegisterCorrection.objects.filter(pk=self.proposal.pk).update(status="rejected"),
            lambda: RegisterCorrection.objects.filter(pk=self.proposal.pk).update(approving_director="Forged"),
            lambda: list(RegisterCorrectionDecision.objects.all()),
            self.proposal.delete,
        ):
            with self.assertRaises(DatabaseError), atomic():
                write()
        applied = apply_correction(self.owner, self.appointment, self.proposal)
        self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "applied")
        self.assertEqual(RegisterEntry.objects.get(operation_id=self.proposal.pk).pk, applied.applied_entry_id)
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertFalse(RegisterCorrection.objects.filter(pk=self.proposal.pk).exists())
        self.no_principal_is_set()
        self.assertFalse(RegisterCorrection.objects.exists())

    def test_a_failed_application_leaves_the_correction_positions_and_decisions_as_they_were(self):
        decide(self.owner, self.appointment, self.proposal, "approve")
        digest = preview(self.owner, self.appointment, self.proposal, "apply")["preview_digest"]
        with patch.object(RegisterCorrection, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                decide_correction(
                    actor=self.owner,
                    correction_id=self.proposal.pk,
                    appointment=self.appointment.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=digest,
                    confirmation=True,
                )
        self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "submitted")
        with use_operator():
            self.assertEqual(verify_register(self.proposal.register_id)["issued_supply"], "105")
            self.assertFalse(RegisterEntry.objects.filter(operation_id=self.proposal.pk).exists())
            self.assertEqual(list(RegisterCorrectionDecision.objects.values_list("kind", flat=True)), ["approve"])

    def test_the_operator_cannot_truncate_retained_authority(self):
        with use_operator(), self.assertRaises(DatabaseError), atomic(), connections[
            current_alias()
        ].cursor() as cursor:
            cursor.execute("TRUNCATE tokens_registercorrection CASCADE")
        self.assertTrue(self.proposal.file.storage.exists(self.proposal.file.name))

    def competing_applications(self, register_change=False):
        decide(self.owner, self.appointment, self.proposal, "approve")
        digest = preview(self.owner, self.appointment, self.proposal, "apply")["preview_digest"]
        key = uuid4()
        recorder = staff_user()
        reached = Queue()

        def application():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    try:
                        return decide_correction(
                            actor=self.owner,
                            correction_id=self.proposal.pk,
                            appointment=self.appointment.pk,
                            kind="apply",
                            idempotency_key=key,
                            preview_digest=digest,
                            confirmation=True,
                        ).applied_entry_id
                    except RegisterChangeConflict:
                        return "conflict"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                if register_change:
                    ShareRegister.objects.select_for_update().get(pk=self.proposal.register_id)
                else:
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
                if register_change:
                    record_entry(
                        register_id=self.proposal.register_id,
                        operation_id=uuid4(),
                        kind="issue",
                        changes=self.issue.changes,
                        effective_on=self.issue.effective_on,
                        recorded_by=recorder,
                    )
            results = [future.result(timeout=15) for future in futures]
        with use_operator():
            applications = RegisterCorrectionDecision.objects.filter(kind="apply").count()
            if register_change:
                self.assertEqual((results, applications), (["conflict", "conflict"], 0))
                self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "submitted")
                self.assertEqual(verify_register(self.proposal.register_id)["issued_supply"], "110")
            else:
                entry = RegisterEntry.objects.get(operation_id=self.proposal.pk)
                self.assertEqual((results, applications), ([entry.pk, entry.pk], 1))
                self.assertEqual(verify_register(self.proposal.register_id)["issued_supply"], "100")

    def test_separate_connections_serialize_a_duplicate_application(self):
        self.competing_applications()

    def test_a_concurrent_register_append_refuses_the_waiting_applications(self):
        self.competing_applications(register_change=True)
