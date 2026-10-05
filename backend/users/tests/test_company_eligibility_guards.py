import json
from contextlib import contextmanager
from datetime import timedelta
from datetime import timezone as datetime_timezone
from time import sleep
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import atomic, current_alias, use_app, use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import (
    InvestorCategory,
    InvestorClassification,
    UserAccount,
    UserProfile,
)
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
    CompanyEligibilityRequestWithdrawal,
    CompanyEligibilityRevocation,
)
from users.services.company_eligibility import (
    eligibility_operation,
    preview_eligibility_request,
)
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_requests import (
    PDF,
    PRIVATE_BASIS,
    REQUESTS,
    SOURCES,
    CompanyEligibilityCases,
)


def stamp(value):
    return value.astimezone(datetime_timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


class CompanyEligibilityGuardTest(CompanyEligibilityCases, StubUploadDependencies, APITransactionTestCase):
    @contextmanager
    def database_role(self, role, actor):
        with use_app() if role == "app" else use_operator(), _requester_principal(actor.pk), atomic():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute(f"SET LOCAL ROLE {connection.ops.quote_name(settings.RLS_ROLES[role])}")
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES[role])
            yield

    def raw_insert(self, model, row):
        connection = connections[current_alias()]
        columns = []
        values = []
        placeholders = []
        for field in model._meta.concrete_fields:
            columns.append(connection.ops.quote_name(field.column))
            value = row[field.attname]
            if field.get_internal_type() == "JSONField" and value is not None:
                value = json.dumps(value)
                placeholders.append("%s::jsonb")
            else:
                placeholders.append("%s")
            values.append(value)
        table = connection.ops.quote_name(model._meta.db_table)
        with connection.cursor() as cursor:
            cursor.execute(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})", values)
        return row["uuid"]

    def clone_request(self, request, **changes):
        with use_operator():
            row = CompanyEligibilityRequest.objects.filter(pk=request.pk).values().get()
        now = timezone.now()
        row.update(uuid=uuid4(), idempotency_key=uuid4(), created_at=now, updated_at=now, submitted_at=now)
        return {**row, **changes}

    def request_command(self, row):
        return {
            "source": row["source_id"],
            "company": row["company_id"],
            "offering": row["offering_id"],
            "quantity": row["quantity"],
            "requested_expires_at": stamp(row["requested_expires_at"]),
            "preview_digest": row["digest"],
            "idempotency_key": row["idempotency_key"],
        }

    def lock_command(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT users_lock_company_eligibility_context()")

    def insert_request(self, row, *, command=None, preserve_timestamps=False):
        with self.database_role("operator", self.participant):
            with eligibility_operation(self.participant, "submit", **(command or self.request_command(row))), atomic():
                self.lock_command()
                at = timezone.now()
                current = (
                    row if preserve_timestamps else {**row, "created_at": at, "updated_at": at, "submitted_at": at}
                )
                return self.raw_insert(CompanyEligibilityRequest, current)

    def decision_row(self, request, *, actor=None, appointment=None, digest):
        record = CompanyEligibilityDecision(
            request=request,
            decided_by=actor or self.approver,
            appointment=appointment or self.appointment,
            idempotency_key=uuid4(),
            request_digest=request.digest,
            digest=digest,
            outcome="accepted",
            expires_at=self.requested_expiry,
            reason="",
        )
        return {field.attname: getattr(record, field.attname) for field in record._meta.concrete_fields}

    def decision_command(self, request, row):
        return {
            "request": request.pk,
            "company": request.company_id,
            "appointment": row["appointment_id"],
            "outcome": row["outcome"],
            "expires_at": stamp(row["expires_at"]) if row["expires_at"] else None,
            "reason": row["reason"],
            "preview_digest": row["digest"],
            "idempotency_key": row["idempotency_key"],
            "confirmation": True,
        }

    def insert_decision(self, request, row, *, actor=None, command=None, preserve_timestamps=False):
        principal = actor or self.approver
        with self.database_role("operator", principal):
            with eligibility_operation(
                principal, "decide", **(command or self.decision_command(request, row))
            ), atomic():
                self.lock_command()
                at = timezone.now()
                current = row if preserve_timestamps else {**row, "created_at": at, "updated_at": at, "decided_at": at}
                return self.raw_insert(CompanyEligibilityDecision, current)

    def raw_digest(self, facts):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT users_company_eligibility_hash(%s::jsonb)", [json.dumps(facts)])
            return cursor.fetchone()[0]

    def refusal_digest(self, request, row):
        with use_operator():
            configuration = Operator.get()
            facts = {
                "request": str(request.pk),
                "request_digest": request.digest,
                "appointment": str(row["appointment_id"]),
                "actor": row["decided_by_id"],
                "outcome": row["outcome"],
                "expires_at": None,
                "reason": row["reason"],
                "issuer_identity_required": configuration.issuer_kyc_required,
                "investor_identity_required": configuration.investor_kyc_required,
            }
        return self.raw_digest(facts)

    def revocation_row(self, decision, reason):
        record = CompanyEligibilityRevocation(
            decision=decision,
            revoked_by=self.approver,
            appointment=self.appointment,
            idempotency_key=uuid4(),
            digest=self.raw_digest(
                {
                    "decision": str(decision.pk),
                    "actor": self.approver.pk,
                    "appointment": str(self.appointment.pk),
                    "reason": reason,
                }
            ),
            reason=reason,
        )
        return {field.attname: getattr(record, field.attname) for field in record._meta.concrete_fields}

    def insert_revocation(self, request, row):
        with self.database_role("operator", self.approver):
            with eligibility_operation(
                self.approver,
                "revoke",
                request=request.pk,
                company=request.company_id,
                appointment=row["appointment_id"],
                idempotency_key=row["idempotency_key"],
                reason=row["reason"],
            ), atomic():
                self.lock_command()
                at = timezone.now()
                current = {**row, "created_at": at, "updated_at": at, "revoked_at": at}
                return self.raw_insert(CompanyEligibilityRevocation, current)

    def assert_database_timestamps(self, record, event, before, after, supplied):
        for field in ("created_at", "updated_at", event):
            with self.subTest(timestamp=field):
                actual = getattr(record, field)
                self.assertGreaterEqual(actual, before)
                self.assertLessEqual(actual, after)
                self.assertNotEqual(actual, supplied[field])
        self.assertEqual(record.created_at, record.updated_at)
        self.assertEqual(record.created_at, getattr(record, event))

    def assert_guard_refused(self, callback, *, permission=False):
        with self.assertRaises(DatabaseError) as refused:
            callback()
        self.assertIn(
            getattr(refused.exception.__cause__, "sqlstate", None), {"23514", "42501"} if permission else {"23514"}
        )

    def test_genuine_bounded_operator_sql_can_record_the_exact_request_snapshot(self):
        request, _ = self.created_request()
        row = self.clone_request(request)
        identifier = self.insert_request(row)
        with use_operator():
            retained = CompanyEligibilityRequest.objects.get(pk=identifier)
            self.assertEqual(retained.source_id, self.source.pk)
            self.assertEqual(retained.submitted_by_id, self.participant.pk)
            self.assertEqual(retained.shared_summary, request.shared_summary)
            self.assertEqual(retained.source_fingerprint, request.source_fingerprint)
            self.assertEqual(retained.evidence_hash, request.evidence_hash)

    def test_raw_pending_both_account_submit_and_acceptance_obey_the_current_identity_policy(self):
        with use_operator():
            self.participant, self.account = make_investor(
                "eligibility-raw-pending-participant", account_status="pending", id_verified=False, role="both"
            )
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        self.source = self.submit_source()
        original, _ = self.created_request()
        identifier = self.insert_request(self.clone_request(original))
        with use_operator():
            request = CompanyEligibilityRequest.objects.get(pk=identifier)
        self.client.force_authenticate(self.approver)
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=True)
        before = self.snapshots()
        self.assert_guard_refused(lambda: self.insert_request(self.clone_request(original)))
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canDecide"])
        row = self.decision_row(request, digest=preview.json()["previewDigest"])
        self.assert_guard_refused(lambda: self.insert_decision(request, row))
        self.assertEqual(self.snapshots(), before)
        with use_migrate():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertTrue(preview.json()["canDecide"])
        identifier = self.insert_decision(request, self.decision_row(request, digest=preview.json()["previewDigest"]))
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(pk=identifier)
            self.account.refresh_from_db()
            self.assertEqual(decision.outcome, "accepted")
            self.assertEqual(decision.appointment_id, self.appointment.pk)
            self.assertEqual(self.account.account_status, "pending")
            self.assertIsNone(self.account.activation_date)
            self.assertFalse(UserProfile.objects.get(pk=self.account.user_profile_id).is_id_verified)

    def test_raw_submit_refuses_disabled_standing_company_role_and_inactive_or_unverified_email(self):
        original, _ = self.created_request()
        before = self.snapshots()
        for required in (False, True):
            for status in ("rejected", "suspended", "terminated"):
                with self.subTest(required=required, status=status):
                    with use_migrate():
                        Operator.objects.filter(pk=1).update(investor_kyc_required=required)
                        UserAccount.objects.filter(pk=self.account.pk).update(account_status=status)
                    self.assert_guard_refused(lambda: self.insert_request(self.clone_request(original)))
        with use_migrate():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="active", role="company")
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        self.assert_guard_refused(lambda: self.insert_request(self.clone_request(original)))
        with use_migrate():
            UserAccount.objects.filter(pk=self.account.pk).update(role="investor")
        for active, email in ((False, True), (True, False)):
            with self.subTest(active=active, email_verified=email):
                with use_migrate():
                    type(self.participant).objects.filter(pk=self.participant.pk).update(
                        is_active=active, is_email_verified=email
                    )
                self.assert_guard_refused(lambda: self.insert_request(self.clone_request(original)))
        self.assertEqual(self.snapshots(), before)
        with use_migrate():
            type(self.participant).objects.filter(pk=self.participant.pk).update(is_active=True, is_email_verified=True)
        identifier = self.insert_request(self.clone_request(original))
        with use_operator():
            self.assertTrue(CompanyEligibilityRequest.objects.filter(pk=identifier).exists())

    def test_actual_operator_prefix_refuses_missing_configuration_at_its_lock_without_recreating_it(self):
        request, _ = self.created_request()
        row = self.clone_request(request)
        command = self.request_command(row)
        with self.database_role("operator", self.participant):
            with eligibility_operation(self.participant, "submit", **command), atomic():
                self.lock_command()
        before = self.snapshots()
        with use_migrate():
            Operator.objects.filter(pk=1).delete()
        with self.assertRaisesMessage(DatabaseError, "Company eligibility configuration is missing") as refused:
            with self.database_role("operator", self.participant):
                with eligibility_operation(self.participant, "submit", **command), atomic():
                    self.lock_command()
        self.assertEqual(getattr(refused.exception.__cause__, "sqlstate", None), "55000")
        with use_operator():
            self.assertFalse(Operator.objects.exists())
        self.assertEqual(self.snapshots(), before)

    def test_bare_operator_and_app_with_copied_command_cannot_insert_shared_records(self):
        request, _ = self.created_request()
        row = self.clone_request(request)

        def bare_operator():
            with self.database_role("operator", self.participant):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT set_config('app.company_eligibility_operation', '', true)")
                    cursor.execute("SELECT set_config('app.company_eligibility_command', '', true)")
                self.raw_insert(CompanyEligibilityRequest, row)

        def copied_app_command():
            with self.database_role("app", self.participant):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT set_config('app.company_eligibility_operation', 'submit', true)")
                    cursor.execute(
                        "SELECT set_config('app.company_eligibility_command', %s, true)",
                        [json.dumps(self.request_command(row), default=str)],
                    )
                self.raw_insert(CompanyEligibilityRequest, row)

        self.assert_guard_refused(bare_operator)
        self.assert_guard_refused(copied_app_command, permission=True)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)

    def test_complete_summary_equality_refuses_missing_null_and_extra_private_keys(self):
        request, _ = self.created_request()
        altered = [
            {**request.shared_summary, "declared_basis": PRIVATE_BASIS},
            {**request.shared_summary, "company": None},
            {**request.shared_summary, "declaration_text": None},
        ]
        for key in request.shared_summary:
            altered.append({name: value for name, value in request.shared_summary.items() if name != key})
        for summary in altered:
            with self.subTest(summary=summary):
                row = self.clone_request(request, shared_summary=summary)
                self.assert_guard_refused(lambda: self.insert_request(row))
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)
        self.insert_request(self.clone_request(request))

    def test_foreign_links_and_null_digest_cannot_be_smuggled_into_an_own_command(self):
        request, _ = self.created_request()
        foreign_source = self.submit_source(actor=self.other)
        correct = self.clone_request(request)
        command = self.request_command(correct)
        for field, value in (
            ("source_id", foreign_source.pk),
            ("user_account_id", self.other_account.pk),
            ("submitted_by_id", self.other.pk),
            ("source_fingerprint", None),
            ("evidence_hash", None),
            ("digest", None),
        ):
            with self.subTest(field=field):
                row = {**correct, field: value}
                self.assert_guard_refused(lambda: self.insert_request(row, command=command))
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)

    def test_genuine_bounded_operator_sql_acceptance_records_actual_person_and_appointment(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        row = self.decision_row(request, digest=preview.json()["previewDigest"])
        identifier = self.insert_decision(request, row)
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(pk=identifier)
            self.assertEqual(decision.request_id, request.pk)
            self.assertEqual(decision.decided_by_id, self.approver.pk)
            self.assertEqual(decision.appointment_id, self.appointment.pk)
            self.assertEqual(decision.request_digest, request.digest)
            self.assertEqual(decision.outcome, "accepted")
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, "submitted")
            self.assertIsNone(self.source.reviewed_by_id)

    def test_valid_raw_request_and_decision_replace_forged_times_with_the_database_clock(self):
        original, _ = self.created_request()
        for direction in (-1, 1):
            with self.subTest(direction=direction):
                forged = timezone.now() + timedelta(days=365 * direction)
                row = self.clone_request(
                    original,
                    created_at=forged,
                    updated_at=forged,
                    submitted_at=forged,
                )
                before = timezone.now()
                identifier = self.insert_request(row, preserve_timestamps=True)
                after = timezone.now()
                with use_operator():
                    request = CompanyEligibilityRequest.objects.get(pk=identifier)
                self.assert_database_timestamps(request, "submitted_at", before, after, row)
                self.assertEqual(request.digest, original.digest)
                self.client.force_authenticate(self.approver)
                preview = self.decision_preview(request)
                self.assertEqual(preview.status_code, 200, preview.content)
                row = {
                    **self.decision_row(request, digest=preview.json()["previewDigest"]),
                    "created_at": forged,
                    "updated_at": forged,
                    "decided_at": forged,
                }
                before = timezone.now()
                identifier = self.insert_decision(request, row, preserve_timestamps=True)
                after = timezone.now()
                with use_operator():
                    decision = CompanyEligibilityDecision.objects.get(pk=identifier)
                self.assert_database_timestamps(decision, "decided_at", before, after, row)
                self.assertEqual(decision.appointment_id, self.appointment.pk)
                self.assertEqual(decision.request_digest, request.digest)

    def test_raw_refusal_rejects_python_whitespace_even_with_the_matching_digest_and_command(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        reason = "Synthetic reasoned refusal"
        preview = self.decision_preview(request, outcome="refused", expires_at=None, reason=reason)
        self.assertEqual(preview.status_code, 200, preview.content)
        row = {
            **self.decision_row(request, digest=preview.json()["previewDigest"]),
            "outcome": "refused",
            "expires_at": None,
            "reason": reason,
        }
        self.assertEqual(self.refusal_digest(request, row), row["digest"])
        for whitespace in ("\t", "\n", "\u00a0", "\t\n \u00a0"):
            with self.subTest(reason=repr(whitespace)):
                malformed = self.decision_preview(request, outcome="refused", expires_at=None, reason=whitespace)
                self.assertEqual(malformed.status_code, 400, malformed.content)
                altered = {**row, "reason": whitespace}
                altered["digest"] = self.refusal_digest(request, altered)
                self.assert_guard_refused(lambda: self.insert_decision(request, altered))
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        identifier = self.insert_decision(request, row)
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(pk=identifier)
            self.assertEqual(decision.outcome, "refused")
            self.assertEqual(decision.reason, reason)
            self.assertIsNone(decision.expires_at)

    def test_raw_revocation_rejects_python_whitespace_with_a_matching_digest_and_valid_acceptance(self):
        request, decision, _ = self.accepted_request()
        for whitespace in ("\t", "\n", "\u00a0", "\t\n \u00a0"):
            with self.subTest(reason=repr(whitespace)):
                malformed = self.client.post(
                    self.company_url(request, "revoke"),
                    {
                        "appointment": str(self.appointment.pk),
                        "idempotency_key": str(uuid4()),
                        "reason": whitespace,
                    },
                    format="json",
                )
                self.assertEqual(malformed.status_code, 400, malformed.content)
                row = self.revocation_row(decision, whitespace)
                self.assert_guard_refused(lambda: self.insert_revocation(request, row))
        with use_operator():
            self.assertFalse(CompanyEligibilityRevocation.objects.exists())
        reason = "Synthetic reasoned revocation"
        identifier = self.insert_revocation(request, self.revocation_row(decision, reason))
        with use_operator():
            retained = CompanyEligibilityRevocation.objects.get(pk=identifier)
            self.assertEqual(retained.decision_id, decision.pk)
            self.assertEqual(retained.appointment_id, self.appointment.pk)
            self.assertEqual(retained.reason, reason)

    def test_maintenance_malformed_unbound_certificate_strings_refuse_raw_submit_until_authentic_restore(self):
        withdrawn = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(withdrawn.status_code, 204, withdrawn.content)
        self.source = self.submit_source(
            category=InvestorCategory.ACCOUNTANT_CERTIFICATE,
            certificate_issued_at=(timezone.localdate() - timedelta(days=1)).isoformat(),
            certifier_name="Synthetic Certifier",
            certifier_body="ca_anz",
            certifier_membership_number="SYNTHETIC-863",
        )
        original = {
            "certifier_name": self.source.certifier_name,
            "certifier_body": self.source.certifier_body,
            "certifier_membership_number": self.source.certifier_membership_number,
        }

        def fresh_row():
            preview = preview_eligibility_request(
                actor=self.participant,
                source=self.source.pk,
                company=self.company.pk,
                requested_expires_at=self.requested_expiry,
            )
            record = CompanyEligibilityRequest(
                user_account=self.account,
                company=self.company,
                source=self.source,
                submitted_by=self.participant,
                idempotency_key=uuid4(),
                version=preview["version"],
                category=self.source.category,
                shared_summary=preview["shared_summary"],
                source_fingerprint=preview["source_fingerprint"],
                evidence_hash=preview["evidence_hash"],
                digest=preview["preview_digest"],
                requested_expires_at=self.requested_expiry,
                sharing_accepted=True,
                declaration_accepted=True,
            )
            return preview, {field.attname: getattr(record, field.attname) for field in record._meta.concrete_fields}

        valid, row = fresh_row()
        self.assertTrue(valid["can_submit"])
        evidence_hash = row["evidence_hash"]
        for field in original:
            for whitespace in ("\t", "\n", "\u00a0", "\t\n \u00a0"):
                with self.subTest(field=field, value=repr(whitespace)):
                    with use_migrate():
                        InvestorClassification.objects.filter(pk=self.source.pk).update(**{field: whitespace})
                    preview, row = fresh_row()
                    self.assertFalse(preview["can_submit"])
                    self.assertIn("certificate_not_current", preview["unmet_requirements"])
                    self.assertEqual(row["evidence_hash"], evidence_hash)
                    self.assertEqual(row["shared_summary"][field], whitespace)
                    self.assert_guard_refused(lambda: self.insert_request(row))
                    with use_migrate():
                        InvestorClassification.objects.filter(pk=self.source.pk).update(**original)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())
        preview, row = fresh_row()
        self.assertTrue(preview["can_submit"])
        identifier = self.insert_request(row)
        with use_operator():
            request = CompanyEligibilityRequest.objects.get(pk=identifier)
            self.assertEqual(request.evidence_hash, evidence_hash)
            self.assertEqual(request.source_id, self.source.pk)
            for field, value in original.items():
                self.assertEqual(request.shared_summary[field], value)
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, "submitted")
            self.assertIsNone(self.source.reviewed_by_id)
            with self.source.evidence_file.open("rb") as retained:
                self.assertEqual(retained.read(), PDF)

    def test_raw_acceptance_refuses_foreign_appointment_and_null_or_changed_provenance(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        row = self.decision_row(request, digest=preview.json()["previewDigest"])
        command = self.decision_command(request, row)
        for field, value in (
            ("appointment_id", self.initial.pk),
            ("decided_by_id", self.other.pk),
            ("request_digest", None),
            ("digest", None),
            ("expires_at", None),
            ("request_digest", "0" * 64),
        ):
            with self.subTest(field=field):
                altered = {**row, field: value}
                self.assert_guard_refused(lambda: self.insert_decision(request, altered, command=command))
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        self.insert_decision(request, row)

    def test_raw_decision_requires_actual_boolean_confirmation_and_rejects_missing_confirmation(self):
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        preview = self.decision_preview(request)
        self.assertEqual(preview.status_code, 200, preview.content)
        row = self.decision_row(request, digest=preview.json()["previewDigest"])
        command = self.decision_command(request, row)
        missing = {key: value for key, value in command.items() if key != "confirmation"}
        self.assert_guard_refused(lambda: self.insert_decision(request, row, command=missing))
        for value in (False, None, "true", 1):
            with self.subTest(confirmation=value):
                altered = {**command, "confirmation": value}
                self.assert_guard_refused(lambda: self.insert_decision(request, row, command=altered))
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        self.insert_decision(request, row)

    def test_raw_decision_requires_current_personal_approve_not_prepare_or_expired_authority(self):
        request, _ = self.created_request()
        preparer, _, prepare = self.appointee("sql-preparer", ["prepare"])
        self.client.force_authenticate(preparer)
        preview = self.decision_preview(request, appointment=str(prepare.pk))
        self.assertEqual(preview.status_code, 200, preview.content)
        row = self.decision_row(request, actor=preparer, appointment=prepare, digest=preview.json()["previewDigest"])
        self.assert_guard_refused(lambda: self.insert_decision(request, row, actor=preparer))
        expiry = timezone.now() + timedelta(seconds=2)
        approver, _, appointment = self.appointee("sql-expired", ["approve"], expires_at=expiry)
        self.client.force_authenticate(approver)
        preview = self.decision_preview(request, appointment=str(appointment.pk))
        self.assertEqual(preview.status_code, 200, preview.content)
        row = self.decision_row(
            request, actor=approver, appointment=appointment, digest=preview.json()["previewDigest"]
        )
        wait = (expiry - timezone.now()).total_seconds()
        if wait > 0:
            self.assertLess(wait, 3)
            sleep(wait + 0.05)
        self.assert_guard_refused(lambda: self.insert_decision(request, row, actor=approver))
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())

    def test_source_payload_is_frozen_and_retained_after_company_binding(self):
        self.created_request()
        with use_operator():
            before = InvestorClassification.objects.filter(pk=self.source.pk).values().get()
        for field, value in (
            ("declared_basis", "Changed private basis"),
            ("declaration_text", "Changed declaration"),
            ("category", "product_value"),
            ("evidence_file", "replacement.pdf"),
            ("evidence_file_size", 1),
            ("submitted_at", timezone.now()),
        ):
            with self.subTest(field=field):

                def update():
                    with self.database_role("operator", self.participant):
                        InvestorClassification.objects.filter(pk=self.source.pk).update(**{field: value})

                self.assert_guard_refused(update)

        def delete():
            with self.database_role("operator", self.participant):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("DELETE FROM users_investorclassification WHERE uuid = %s", [self.source.pk])

        self.assert_guard_refused(delete)
        with use_operator():
            self.assertEqual(InvestorClassification.objects.filter(pk=self.source.pk).values().get(), before)

    def test_request_and_all_terminal_records_refuse_update_and_delete_under_valid_commands(self):
        request, decision, _ = self.accepted_request()
        revoke_payload = {
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
            "reason": "Synthetic retained revocation",
        }
        revoked = self.client.post(self.company_url(request, "revoke"), revoke_payload, format="json")
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.client.force_authenticate(self.participant)
        self.key = uuid4()
        pending, _ = self.created_request()
        withdrawn = self.client.post(
            f"{REQUESTS}{pending.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
        )
        self.assertEqual(withdrawn.status_code, 200, withdrawn.content)
        before = self.snapshots()
        with use_operator():
            request_row = CompanyEligibilityRequest.objects.filter(pk=request.pk).values().get()
            withdrawal = CompanyEligibilityRequestWithdrawal.objects.get(request=pending)
            revocation = CompanyEligibilityRevocation.objects.get(decision=decision)
        contexts = (
            (CompanyEligibilityRequest, request, self.participant, "submit", self.request_command(request_row)),
            (
                CompanyEligibilityDecision,
                decision,
                self.approver,
                "decide",
                {
                    "request": request.pk,
                    "company": request.company_id,
                    "appointment": decision.appointment_id,
                    "outcome": decision.outcome,
                    "expires_at": stamp(decision.expires_at),
                    "reason": decision.reason,
                    "preview_digest": decision.digest,
                    "idempotency_key": decision.idempotency_key,
                    "confirmation": True,
                },
            ),
            (
                CompanyEligibilityRequestWithdrawal,
                withdrawal,
                self.participant,
                "withdraw",
                {"request": pending.pk, "idempotency_key": withdrawal.idempotency_key},
            ),
            (
                CompanyEligibilityRevocation,
                revocation,
                self.approver,
                "revoke",
                {
                    "request": request.pk,
                    "company": request.company_id,
                    "appointment": revocation.appointment_id,
                    "idempotency_key": revocation.idempotency_key,
                    "reason": revocation.reason,
                },
            ),
        )
        for model, record, actor, operation, command in contexts:
            for verb in ("UPDATE", "DELETE"):
                for target in (record.pk, uuid4()):
                    with self.subTest(model=model._meta.label, verb=verb, matches=target == record.pk):

                        def mutate():
                            with self.database_role("operator", actor):
                                with eligibility_operation(actor, operation, **command), atomic():
                                    self.lock_command()
                                    table = connections[current_alias()].ops.quote_name(model._meta.db_table)
                                    sql = (
                                        f"UPDATE {table} SET updated_at = clock_timestamp()"
                                        if verb == "UPDATE"
                                        else f"DELETE FROM {table}"
                                    )
                                    with connections[current_alias()].cursor() as cursor:
                                        cursor.execute(f"{sql} WHERE uuid = %s", [target])

                        self.assert_guard_refused(mutate)
        self.assertEqual(self.snapshots(), before)

    def test_actual_own_app_role_cannot_forge_account_standing(self):
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
            before = UserAccount.objects.filter(pk=self.account.pk).values().get()
        with self.database_role("app", self.participant):
            self.assertTrue(UserAccount.objects.filter(pk=self.account.pk).exists())

        def forge():
            with self.database_role("app", self.participant):
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")

        self.assert_guard_refused(forge)
        with use_operator():
            self.assertEqual(UserAccount.objects.filter(pk=self.account.pk).values().get(), before)
