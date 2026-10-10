import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event
from time import monotonic
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.test import APITransactionTestCase

from companies.models import Company, CompanyRegistryCheck, RegistryCheckPurpose
from companies.services.activation import activate_company
from companies.services.administration import company_operation
from companies.services.authority import (
    DECLARATION_TEXT,
    DECLARATION_VERSION,
    admit_authority_request,
)
from companies.services.authority_requests import submit_authority_request
from companies.services.company import register_company, transition_company
from companies.services.registry import begin_registry_check, complete_registry_check
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    AuthorityRequestCases,
    evidence,
)
from integrations.abr.client import RegistryObservation
from integrations.kyc.base import (
    KYCProvider,
    NormalizedVerificationResult,
    VerificationSession,
)
from operators.models import Operator
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.retained_rows import retained_rows
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserAccount, UserProfile


class CompanyActivationFixtures(StubUploadDependencies):
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user = get_user_model().objects.create_user(
                email="activation-admin@example.test",
                password="pw-12345678",
                is_active=True,
                is_email_verified=True,
            )
            operator = Operator.get()
            operator.issuer_kyc_required = False
            operator.save(update_fields=["issuer_kyc_required"])
        self.company = register_company(
            owner=self.user,
            name="Activation Pty Ltd",
            acn="123456780",
            primary_contact_data={"first_name": "Activation", "last_name": "Administrator"},
        )
        with use_operator():
            self.profile = UserProfile.objects.get(user=self.user)
        self.source = self.admit(self.user, self.company)
        with use_operator():
            self.company.refresh_from_db()
        self.key = uuid4()
        self.client.force_authenticate(self.user)
        self.provider = self.enterContext(
            patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company))
        )

    def admit(self, actor, company):
        proposal, _ = submit_authority_request(
            requester=actor,
            company_id=company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=["admin"],
        )
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            return admit_authority_request(
                requester=actor,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment

    def payload(self, **changes):
        return {
            "idempotency_key": str(self.key),
            "appointment": str(self.source.pk),
            "lifecycle_revision": self.company.lifecycle_revision,
            "declaration_version": DECLARATION_VERSION,
            "accept_declaration": True,
            **changes,
        }

    def activate(self, **changes):
        return self.client.post(
            f"/api/v1/companies/{self.company.pk}/activate/", self.payload(**changes), format="json"
        )

    def service(self, **changes):
        return activate_company(actor=self.user, company_id=self.company.pk, **{**self.payload(), **changes})

    def database_timestamp(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT clock_timestamp()")
            return cursor.fetchone()[0]

    def expire_appointment_soon(self, seconds=2):
        with retained_rows(("companies_companyappointment", "companies_initial_appointment_identity")):
            with use_migrate(), connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "UPDATE companies_companyappointment "
                    "SET expires_at = clock_timestamp() + %s * interval '1 second' WHERE uuid = %s",
                    [seconds, self.source.pk],
                )
                self.assertEqual(cursor.rowcount, 1)

    def wait_for_ready(self, worker, ready, stage):
        deadline = monotonic() + 10
        while monotonic() < deadline:
            if ready.is_set():
                return
            if worker.done():
                worker.result()
                self.fail(f"Activation finished before {stage}")
            ready.wait(timeout=0.01)
        self.fail(f"Activation did not reach {stage}")

    def wait_for_appointment_expiry(self):
        deadline = monotonic() + 10
        with use_migrate():
            while monotonic() < deadline:
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "SELECT clock_timestamp() >= expires_at FROM companies_companyappointment WHERE uuid = %s",
                        [self.source.pk],
                    )
                    if cursor.fetchone() == (True,):
                        return
                Event().wait(0.01)
        self.fail("The selected appointment did not reach its PostgreSQL expiry")

    def wait_for_blocker(self, worker, *, blocker_pid, pids, table):
        deadline = monotonic() + 10
        with use_migrate():
            while monotonic() < deadline:
                if worker.done():
                    worker.result()
                    self.fail("Activation finished before the exact row lock was observed")
                if "worker" not in pids:
                    Event().wait(0.01)
                    continue
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "SELECT wait_event_type, query, %s = ANY(pg_blocking_pids(pid)) "
                        "FROM pg_stat_activity WHERE pid = %s",
                        [blocker_pid, pids["worker"]],
                    )
                    activity = cursor.fetchone()
                if activity and activity[0] == "Lock" and activity[1].startswith(f'SELECT "{table}".') and activity[2]:
                    return
                Event().wait(0.01)
        self.fail(f"Activation did not wait for the held exact {table}")

    def expiring_actor(self, seconds):
        with use_operator():
            actor = get_user_model().objects.create_user(
                email="provider-expiring@example.test",
                is_active=True,
                is_email_verified=True,
            )
            UserProfile.objects.create(user=actor, full_name="Provider Expiring Administrator")
        _, code, _ = issue_team_invitation(
            requester=self.user,
            company_id=self.company.pk,
            inviter_appointment_id=self.source.pk,
            idempotency_key=uuid4(),
            capabilities=["admin"],
            delegatable_capabilities=[],
            appointment_expires_at=timezone.now() + timedelta(seconds=seconds),
        )
        self.source = accept_team_invitation(
            requester=actor,
            code=code,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        )
        self.user = actor
        self.client.force_authenticate(actor)


class CompanyActivationTest(CompanyActivationFixtures, APITransactionTestCase):
    def test_registry_start_uses_database_time_despite_skewed_application_default(self):
        started_at = CompanyRegistryCheck._meta.get_field("started_at")
        for hours in (-24, 24):
            with self.subTest(application_clock_offset_hours=hours):
                skewed = timezone.now() + timedelta(hours=hours)
                before = self.database_timestamp()
                with patch.object(started_at, "get_default", return_value=skewed):
                    receipt = begin_registry_check(self.company, RegistryCheckPurpose.AUTHORITY, self.user)
                after = self.database_timestamp()
                self.assertIsInstance(receipt.started_at, datetime)
                self.assertGreaterEqual(receipt.started_at, before)
                self.assertLessEqual(receipt.started_at, after)
                with use_operator():
                    stored = CompanyRegistryCheck.objects.get(pk=receipt.pk)
                    self.assertEqual(stored.started_at, receipt.started_at)

    def test_registry_completion_uses_database_time_despite_application_clock_skew(self):
        for hours in (-24, 24):
            with self.subTest(application_clock_offset_hours=hours):
                receipt = begin_registry_check(self.company, RegistryCheckPurpose.AUTHORITY, self.user)
                before = self.database_timestamp()
                clock = SimpleNamespace(now=Mock(return_value=before + timedelta(hours=hours)))
                with patch("companies.services.registry.timezone", clock, create=True):
                    completed = complete_registry_check(receipt, matching_observation(self.company))
                after = self.database_timestamp()
                self.assertEqual(completed.pk, receipt.pk)
                self.assertEqual(completed.status, "passed")
                self.assertIsInstance(completed.completed_at, datetime)
                self.assertGreaterEqual(completed.completed_at, before)
                self.assertLessEqual(completed.completed_at, after)
                self.assertGreaterEqual(completed.completed_at, completed.started_at)
                with use_operator():
                    stored = CompanyRegistryCheck.objects.get(pk=receipt.pk)
                    company = Company.objects.get(pk=self.company.pk)
                    self.assertEqual(stored.completed_at, completed.completed_at)
                    self.assertEqual(company.registry_check_id, receipt.pk)
                    self.assertEqual(company.registry_checked_at, completed.completed_at)

    def test_passed_activation_resume_uses_database_time_despite_application_clock_skew(self):
        original = Company.save

        def refuse_initial_effect(company, *args, **kwargs):
            if company.status == "active":
                raise DatabaseError("Synthetic failed company effect")
            return original(company, *args, **kwargs)

        for index, hours in enumerate((-24, 24)):
            with self.subTest(application_clock_offset_hours=hours):
                if index:
                    self.company = register_company(
                        owner=self.user,
                        name="Second Clock Activation Pty Ltd",
                        acn="987654320",
                        primary_contact_data={"first_name": "Synthetic", "last_name": "Administrator"},
                    )
                    self.source = self.admit(self.user, self.company)
                    self.key = uuid4()
                self.provider.return_value = matching_observation(self.company)
                with patch.object(Company, "save", refuse_initial_effect), self.assertRaisesMessage(
                    DatabaseError, "Synthetic failed company effect"
                ):
                    self.service()
                with use_operator():
                    receipt = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
                    self.assertEqual(receipt.status, "passed")
                    self.assertIsNotNone(receipt.completed_at)
                    self.assertIsNone(receipt.applied_at)
                    self.company.refresh_from_db()
                    revision = self.company.lifecycle_revision
                    self.assertEqual(self.company.status, "draft")
                    self.assertIsNone(self.company.activated_at)
                self.assertEqual(self.provider.call_count, index + 1)
                before = self.database_timestamp()
                clock = SimpleNamespace(now=Mock(return_value=before + timedelta(hours=hours)))
                with patch("companies.services.activation.timezone", clock):
                    company, restored = self.service()
                after = self.database_timestamp()
                self.assertEqual(restored.pk, receipt.pk)
                self.assertIsInstance(restored.applied_at, datetime)
                self.assertGreaterEqual(restored.applied_at, before)
                self.assertLessEqual(restored.applied_at, after)
                self.assertGreaterEqual(restored.applied_at, restored.completed_at)
                self.assertEqual(company.status, "active")
                self.assertEqual(company.activated_at, restored.applied_at)
                self.assertEqual(company.lifecycle_revision, revision + 1)
                with use_operator():
                    stored = CompanyRegistryCheck.objects.get(pk=receipt.pk)
                    current = Company.objects.get(pk=company.pk)
                    self.assertEqual(stored.applied_at, restored.applied_at)
                    self.assertEqual(current.activated_at, restored.applied_at)
                    self.assertEqual(current.lifecycle_revision, revision + 1)
                    self.assertEqual(CompanyRegistryCheck.objects.filter(idempotency_key=self.key).count(), 1)
                    self.assertEqual(
                        CompanyRegistryCheck.objects.filter(company=company, applied_at__isnull=False).count(), 1
                    )
                with patch("companies.services.activation.timezone", clock):
                    replayed_company, replayed = self.service()
                self.assertEqual(replayed.pk, restored.pk)
                self.assertEqual(replayed.applied_at, restored.applied_at)
                self.assertEqual(replayed_company.activated_at, restored.applied_at)
                self.assertEqual(replayed_company.lifecycle_revision, revision + 1)
                self.assertEqual(self.provider.call_count, index + 1)

    def test_actual_admission_activates_without_staff_upload_checklist_or_invented_review(self):
        response = self.activate()
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["company"]["status"], "active")
        self.assertEqual(body["attempt"]["appointment"], str(self.source.pk))
        self.assertEqual(body["attempt"]["declarationText"], DECLARATION_TEXT)
        self.assertIsNotNone(body["attempt"]["appliedAt"])
        with use_operator():
            self.company.refresh_from_db()
            self.assertFalse(self.user.is_staff)
            self.assertFalse(self.company.documents.exists())
            self.assertEqual(self.company.activated_at.isoformat().replace("+00:00", "Z"), body["attempt"]["appliedAt"])
            self.assertIsNone(self.company.submitted_at)
            self.assertIsNone(self.company.review_started_at)
            self.assertIsNone(self.company.approved_at)
            self.assertIsNone(self.company.approved_by_id)
            self.assertIsNone(self.company.officeholder_attested_at)
            self.assertEqual(self.company.lifecycle_revision, 1)
            self.assertEqual(self.company.registry_check.purpose, "activation")
            self.assertNotEqual(self.company.registry_check_id, self.source.registry_check_id)

    def test_identical_retry_retains_one_provider_call_and_one_effect_changed_terms_conflict(self):
        first = self.activate()
        second = self.activate()
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(first.json()["attempt"], second.json()["attempt"])
        self.provider.assert_called_once()
        self.assertEqual(self.activate(lifecycle_revision=2).status_code, 409)
        self.assertEqual(self.activate(appointment=str(uuid4())).status_code, 404)
        with use_operator():
            self.assertEqual(CompanyRegistryCheck.objects.filter(idempotency_key=self.key).count(), 1)

    def test_pending_refused_and_provider_failure_are_retained_and_new_key_can_retry(self):
        for reason, expected in (("unconfigured", "pending"), ("timeout", "pending"), ("not_found", "failed")):
            with self.subTest(reason=reason):
                self.key = uuid4()
                self.provider.return_value = RegistryObservation(reason=reason)
                response = self.activate()
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["attempt"]["status"], expected)
                self.assertEqual(response.json()["attempt"]["reason"], reason)
                self.assertIsNone(response.json()["attempt"]["appliedAt"])
                self.assertEqual(response.json()["company"]["status"], "draft")
                calls = self.provider.call_count
                self.assertEqual(self.activate().json()["attempt"], response.json()["attempt"])
                self.assertEqual(self.provider.call_count, calls)
        self.key = uuid4()
        self.provider.return_value = matching_observation(self.company)
        self.assertEqual(self.activate().json()["company"]["status"], "active")

    def test_current_revision_declaration_and_exact_source_are_required_before_provider(self):
        self.assertEqual(self.activate(lifecycle_revision=3).status_code, 409)
        self.assertEqual(self.activate(declaration_version="2026-10-03").status_code, 400)
        self.assertEqual(self.activate(accept_declaration=False).status_code, 400)
        self.assertEqual(self.activate(appointment=str(uuid4())).status_code, 404)
        self.provider.assert_not_called()
        self.assertEqual(self.activate().status_code, 200)

    def test_nonowner_investor_role_invited_personal_admin_activates_and_attempts_stay_actor_private(self):
        with use_operator():
            actor = get_user_model().objects.create_user(
                email="activation-investor@example.test",
                password="pw-12345678",
                is_active=True,
                is_email_verified=True,
            )
            profile = UserProfile.objects.create(user=actor, full_name="Appointed Investor")
            UserAccount.objects.create(user_profile=profile, role="investor")
        invitation, code, _ = issue_team_invitation(
            requester=self.user,
            company_id=self.company.pk,
            inviter_appointment_id=self.source.pk,
            idempotency_key=uuid4(),
            capabilities=["admin"],
            delegatable_capabilities=[],
        )
        source = accept_team_invitation(
            requester=actor, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        self.provider.return_value = RegistryObservation(reason="unconfigured")
        self.assertEqual(self.activate().status_code, 200)
        self.client.force_authenticate(actor)
        detail = self.client.get(f"/api/v1/companies/{self.company.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertIsNone(detail.json()["activation"]["latestAttempt"])
        self.assertFalse(detail.json()["isOwner"])
        self.provider.return_value = matching_observation(self.company)
        response = self.activate(appointment=str(source.pk), idempotency_key=str(uuid4()))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["company"]["status"], "active")

    def test_ownership_staff_and_delegatable_admin_do_not_replace_personal_appointment(self):
        with use_operator():
            actor = get_user_model().objects.create_user(
                email="activation-delegator@example.test",
                password="pw-12345678",
                is_active=True,
                is_email_verified=True,
                is_staff=True,
                is_superuser=True,
            )
            UserProfile.objects.create(user=actor, full_name="Delegator")
        _, code, _ = issue_team_invitation(
            requester=self.user,
            company_id=self.company.pk,
            inviter_appointment_id=self.source.pk,
            idempotency_key=uuid4(),
            capabilities=[],
            delegatable_capabilities=["admin"],
        )
        source = accept_team_invitation(
            requester=actor, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(owner=actor)
        self.client.force_authenticate(actor)
        self.assertEqual(self.activate(appointment=str(source.pk)).status_code, 404)
        self.assertIsNone(self.client.get(f"/api/v1/companies/{self.company.pk}/").json()["activation"])
        self.provider.assert_not_called()

    def test_revocation_expiry_account_identity_configuration_and_snapshot_changes_after_provider_refuse_effect(self):
        for change in ("inactive", "email", "kyc", "configuration", "identity", "revoked"):
            with self.subTest(change=change):
                self.key = uuid4()
                with use_migrate():
                    get_user_model().objects.filter(pk=self.user.pk).update(is_active=True, is_email_verified=True)
                    UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
                    Operator.objects.filter(pk=1).update(issuer_kyc_required=False)
                    Company.objects.filter(pk=self.company.pk).update(name=self.company.name, lifecycle_revision=0)

                def observe(**kwargs):
                    if change == "revoked":
                        revoke_company_appointment(requester=self.user, appointment_id=self.source.pk)
                    else:
                        with use_migrate():
                            if change == "inactive":
                                get_user_model().objects.filter(pk=self.user.pk).update(is_active=False)
                            elif change == "email":
                                get_user_model().objects.filter(pk=self.user.pk).update(is_email_verified=False)
                            elif change == "kyc":
                                UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
                            elif change == "configuration":
                                Operator.objects.filter(pk=1).update(issuer_kyc_required=True)
                            else:
                                Company.objects.filter(pk=self.company.pk).update(
                                    name="Changed company", lifecycle_revision=4
                                )
                    return matching_observation(self.company)

                self.provider.side_effect = observe
                response = self.activate()
                self.assertIn(response.status_code, (400, 404, 409), response.content)
                with use_operator():
                    retained = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
                    self.assertIsNotNone(retained.completed_at)
                    self.assertIsNone(retained.applied_at)
                    self.assertEqual(Company.objects.get(pk=self.company.pk).status, "draft")

    def test_raw_operator_and_app_cannot_forge_activation_provider_or_provenance(self):
        self.provider.return_value = RegistryObservation(reason="unconfigured")
        self.assertEqual(self.activate().status_code, 200)
        with use_operator():
            check = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
        for operation, mutation in (
            (
                "activation",
                lambda: Company.objects.filter(pk=self.company.pk).update(
                    status="active", activated_at=timezone.now(), lifecycle_revision=1
                ),
            ),
            ("activation", lambda: CompanyRegistryCheck.objects.filter(pk=check.pk).update(applied_at=timezone.now())),
            (
                "registry_result",
                lambda: CompanyRegistryCheck.objects.filter(pk=check.pk).update(status="passed", reason="matched"),
            ),
            (
                "registry",
                lambda: CompanyRegistryCheck.objects.filter(pk=check.pk).update(declaration_text="Forged declaration"),
            ),
        ):
            with self.subTest(operation=operation), company_operation(self.user, self.company.pk, operation), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f'SET LOCAL ROLE "{settings.RLS_ROLES["operator"]}"')
                with self.assertRaises(DatabaseError), atomic():
                    mutation()
        with self.app_as(self.user), self.assertRaises(DatabaseError), atomic():
            Company.objects.filter(pk=self.company.pk).update(status="active")
        with use_operator():
            self.assertEqual(Company.objects.get(pk=self.company.pk).status, "draft")
            self.assertIsNone(CompanyRegistryCheck.objects.get(pk=check.pk).applied_at)

    def test_concurrent_identical_requests_make_one_retained_attempt_and_effect(self):
        from companies.services.registry import perform_registry_check

        completed, release = Event(), Event()

        def pause_after_provider(receipt):
            checked = perform_registry_check(receipt)
            completed.set()
            if not release.wait(timeout=45):
                raise RuntimeError("Applied receipt replay coordination timed out")
            return checked

        def run():
            try:
                company, receipt = self.service()
                return company.status, company.lifecycle_revision, receipt.pk, receipt.applied_at
            finally:
                connections.close_all()

        with patch("companies.services.activation.perform_registry_check", side_effect=pause_after_provider):
            with ThreadPoolExecutor(max_workers=1) as pool:
                first = pool.submit(run)
                try:
                    self.wait_for_ready(first, completed, "the retained provider result")
                    with use_operator():
                        retained = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
                        self.assertEqual(retained.status, "passed")
                        self.assertIsNotNone(retained.completed_at)
                        self.assertIsNone(retained.applied_at)
                        company = Company.objects.get(pk=self.company.pk)
                        self.assertEqual((company.status, company.lifecycle_revision), ("draft", 0))
                    second = run()
                    self.assertEqual(second[:3], ("active", 1, retained.pk))
                    self.assertIsNotNone(second[3])
                finally:
                    release.set()
                self.assertEqual(first.result(timeout=20), second)
        with use_operator():
            retained = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
            self.assertEqual(CompanyRegistryCheck.objects.filter(idempotency_key=self.key).count(), 1)
            self.assertEqual(CompanyRegistryCheck.objects.filter(applied_at__isnull=False).count(), 1)
            company = Company.objects.get(pk=self.company.pk)
            self.assertEqual((company.status, company.lifecycle_revision), ("active", 1))
            self.assertEqual(company.activated_at, retained.applied_at)
        self.provider.assert_called_once()

    def test_provider_runs_outside_company_locks_and_expiry_after_real_company_lock_wait_blocks(self):
        self.expiring_actor(30)
        locked = Event()
        release = Event()
        pids = {}

        def hold():
            try:
                with use_migrate(), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["holder"] = cursor.fetchone()[0]
                    Company.objects.select_for_update().get(pk=self.company.pk)
                    locked.set()
                    if not release.wait(timeout=45):
                        raise RuntimeError("Company expiry coordination timed out")
            finally:
                connections.close_all()

        def run():
            try:
                with use_operator(), connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids["worker"] = cursor.fetchone()[0]
                return self.service()
            except APIException as error:
                return error.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            holder = pool.submit(hold)
            try:
                self.wait_for_ready(holder, locked, "the company row holder")
                worker = pool.submit(run)
                self.wait_for_blocker(
                    worker,
                    blocker_pid=pids["holder"],
                    pids=pids,
                    table="companies_company",
                )
                self.expire_appointment_soon()
                self.wait_for_appointment_expiry()
                self.assertFalse(worker.done())
            finally:
                release.set()
            holder.result(timeout=10)
            self.assertEqual(worker.result(timeout=20), 404)
        self.provider.assert_not_called()

    def test_self_service_activation_evidence_supports_existing_technical_recovery_without_staff_initial_activation(
        self,
    ):
        self.assertEqual(self.activate().status_code, 200)
        with use_operator():
            staff = get_user_model().objects.create_user(
                email="activation-recovery@example.test", is_active=True, is_staff=True
            )
            self.company.refresh_from_db()
        company = transition_company(self.company, "suspend", actor=staff, reason="Synthetic technical incident")
        company = transition_company(company, "set_active", actor=staff)
        self.assertEqual(company.status, "active")
        self.assertIsNone(company.approved_at)
        self.assertIsNone(company.officeholder_attested_at)
        with self.assertRaises(APIException):
            transition_company(company, "activate", actor=staff)

    def test_fresh_unverified_signup_configured_identity_self_declaration_and_activation_purpose_abr(self):
        self.client.force_authenticate(None)
        with patch("authentication.services.email_codes.EmailCodeService.generate", return_value="123456"), patch(
            "authentication.services.email_codes.sendgrid_client.send_email", return_value={"success": True}
        ):
            signup = self.client.post(
                "/api/signup/",
                {
                    "email": "fresh-activation@example.test",
                    "password": "pw-12345678",
                    "passwordConfirm": "pw-12345678",
                },
                format="json",
            )
        self.assertEqual(signup.status_code, 201, signup.content)
        self.assertFalse(signup.json()["isEmailVerified"])
        with use_operator():
            actor = get_user_model().objects.get(email="fresh-activation@example.test")
            profile = UserProfile.objects.get(user=actor)
            self.assertFalse(profile.is_id_verified)
            Operator.objects.filter(pk=1).update(issuer_kyc_required=True)
        verified = self.client.post(
            "/api/email-verification/", {"email": actor.email, "token": "123456"}, format="json"
        )
        self.assertEqual(verified.status_code, 200, verified.content)
        with use_operator():
            actor.refresh_from_db()
        self.client.force_authenticate(actor)
        provider = Mock(spec=KYCProvider)
        provider.get_provider_name.return_value = "kycaid"
        provider.create_applicant.return_value = {"applicant_id": "synthetic-fresh-activation"}
        provider.generate_session.return_value = VerificationSession(
            provider="kycaid",
            applicant_id="synthetic-fresh-activation",
            form_url="https://example.test/identity",
        )
        provider.get_applicant_status.return_value = {"synthetic": "approved"}
        provider.with_approval_evidence.return_value = {"synthetic": "approved"}
        provider.normalize_status.return_value = NormalizedVerificationResult(
            verification_status="completed",
            review_result="GREEN",
            is_verified=True,
        )
        provider.get_applicant_data.return_value = {}
        provider.extract_verified_data.return_value = {}
        with patch("users.services.identity.get_kyc_provider", return_value=provider), patch(
            "users.tasks.notifications.send_push_notification"
        ):
            self.assertEqual(
                self.client.post("/api/users/identity-verification/token/", {}, format="json").status_code, 200
            )
            identity = self.client.get("/api/users/identity-verification/status/")
        self.assertEqual(identity.status_code, 200, identity.content)
        self.assertTrue(identity.json()["isVerified"])
        created = self.client.post(
            "/api/v1/companies/",
            {
                "name": "Fresh Synthetic Pty Ltd",
                "acn": "987654320",
                "company_type": "pty",
                "primary_contact": {"first_name": "Fresh", "last_name": "Administrator"},
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        with use_operator():
            company = Company.objects.get(pk=created.json()["company"]["uuid"])
        self.provider.return_value = matching_observation(company)
        proposal = self.client.post(
            "/api/v1/company-authority/requests/",
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "file": evidence(),
                "requested_capabilities": ["admin"],
                "delegatable_capabilities": [],
            },
            format="multipart",
        )
        self.assertEqual(proposal.status_code, 201, proposal.content)
        admitted = self.client.post(
            f"/api/v1/company-authority/requests/{proposal.json()['uuid']}/admit/",
            {
                "declaration_version": DECLARATION_VERSION,
                "accept_declaration": True,
            },
            format="json",
        )
        self.assertEqual(admitted.status_code, 200, admitted.content)
        detail = self.client.get(f"/api/v1/companies/{company.pk}/")
        readiness = detail.json()["activation"]
        activated = self.client.post(
            f"/api/v1/companies/{company.pk}/activate/",
            {
                "idempotency_key": str(uuid4()),
                "appointment": readiness["appointment"],
                "lifecycle_revision": readiness["lifecycleRevision"],
                "declaration_version": readiness["declarationVersion"],
                "accept_declaration": True,
            },
            format="json",
        )
        self.assertEqual(activated.status_code, 200, activated.content)
        self.assertEqual(activated.json()["company"]["status"], "active")
        self.assertIsNotNone(activated.json()["attempt"]["appliedAt"])
        with use_operator():
            company.refresh_from_db()
            self.assertEqual(company.registry_check.purpose, "activation")
            self.assertFalse(actor.is_staff)
            self.assertIsNone(company.approved_at)
            self.assertFalse(company.documents.exists())

    def test_activation_refuses_outer_transaction_before_recording_attempt_or_calling_provider(self):
        with use_operator(), atomic():
            with self.assertRaisesMessage(RuntimeError, "durable atomic block"):
                self.service()
            self.assertFalse(CompanyRegistryCheck.objects.filter(idempotency_key=self.key).exists())
        self.provider.assert_not_called()
        self.assertEqual(self.activate().status_code, 200)

    def test_actual_provider_boundary_holds_no_company_lock_and_retains_result_after_source_expiry(self):
        self.expiring_actor(30)

        def take_company_lock():
            try:
                with use_operator(), atomic():
                    Company.objects.select_for_update(nowait=True).get(pk=self.company.pk)
                return True
            finally:
                connections.close_all()

        def observation(**kwargs):
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertTrue(pool.submit(take_company_lock).result(timeout=10))
            self.expire_appointment_soon()
            self.wait_for_appointment_expiry()
            return matching_observation(self.company)

        self.provider.side_effect = observation
        response = self.activate()
        self.assertEqual(response.status_code, 404, response.content)
        with use_operator():
            receipt = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
            self.assertEqual(receipt.status, "passed")
            self.assertIsNotNone(receipt.completed_at)
            self.assertIsNone(receipt.applied_at)
            self.assertEqual(Company.objects.get(pk=self.company.pk).status, "draft")

    def test_selected_source_is_rechecked_after_real_registry_check_lock_wait(self):
        self.expiring_actor(30)
        locked = Event()
        release = Event()
        pids = {}
        holders = []
        from companies.services.registry import perform_registry_check

        def hold_check(receipt):
            try:
                with use_operator(), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["holder"] = cursor.fetchone()[0]
                    CompanyRegistryCheck.objects.select_for_update().get(pk=receipt.pk)
                    locked.set()
                    if not release.wait(timeout=45):
                        raise RuntimeError("Registry check expiry coordination timed out")
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:

            def perform(receipt):
                completed = perform_registry_check(receipt)
                holder = pool.submit(hold_check, completed)
                holders.append(holder)
                self.wait_for_ready(holder, locked, "the registry receipt holder")
                self.expire_appointment_soon(seconds=5)
                return completed

            def run():
                try:
                    with use_operator(), connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["worker"] = cursor.fetchone()[0]
                    return self.activate()
                finally:
                    connections.close_all()

            with patch("companies.services.activation.perform_registry_check", side_effect=perform):
                worker = pool.submit(run)
                try:
                    self.wait_for_ready(worker, locked, "the registry receipt holder")
                    self.wait_for_blocker(
                        worker,
                        blocker_pid=pids["holder"],
                        pids=pids,
                        table="companies_companyregistrycheck",
                    )
                    self.wait_for_appointment_expiry()
                    self.assertFalse(worker.done())
                finally:
                    release.set()
                response = worker.result(timeout=20)
                holders[0].result(timeout=10)
        self.assertEqual(response.status_code, 404, response.content)
        with use_operator():
            receipt = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
            self.assertEqual(receipt.status, "passed")
            self.assertIsNone(receipt.applied_at)
            self.assertEqual(Company.objects.get(pk=self.company.pk).status, "draft")

    def test_passed_receipt_cannot_commit_an_orphan_activation_effect(self):
        original = Company.save

        def refuse_initial_effect(company, *args, **kwargs):
            if company.status == "active":
                raise DatabaseError("Synthetic failed company effect")
            return original(company, *args, **kwargs)

        with patch.object(Company, "save", refuse_initial_effect), self.assertRaisesMessage(
            DatabaseError, "Synthetic failed"
        ):
            self.service()
        with use_operator():
            receipt = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
            self.assertEqual(receipt.status, "passed")
            self.assertIsNone(receipt.applied_at)
        with self.assertRaisesMessage(DatabaseError, "single exact company activation effect"):
            with company_operation(self.user, self.company.pk, "activation"), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f'SET LOCAL ROLE "{settings.RLS_ROLES["operator"]}"')
                receipt.applied_at = timezone.now()
                receipt.save(update_fields=["applied_at", "updated_at"])
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS companies_activation_effect IMMEDIATE")
        with use_operator():
            self.assertIsNone(CompanyRegistryCheck.objects.get(pk=receipt.pk).applied_at)
            self.assertEqual(Company.objects.get(pk=self.company.pk).status, "draft")
        company, restored = self.service()
        self.assertEqual(company.status, "active")
        self.assertEqual(restored.pk, receipt.pk)
        self.assertIsNotNone(restored.applied_at)
        self.provider.assert_called_once()

    def test_current_personal_admin_missing_configured_identity_gets_actionable_refusal_and_private_readiness(self):
        with use_operator():
            Operator.objects.filter(pk=1).update(issuer_kyc_required=True)
        response = self.activate()
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], "issuer_identity_verification_required")
        detail = self.client.get(f"/api/v1/companies/{self.company.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertIsNone(detail.json()["activation"])
        self.provider.assert_not_called()
        with use_operator():
            self.assertFalse(CompanyRegistryCheck.objects.filter(idempotency_key=self.key).exists())
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
        self.assertEqual(self.activate().status_code, 200)

    def test_observed_registered_name_whitespace_is_normalized_by_the_actual_operator_guard(self):
        from dataclasses import replace

        self.provider.return_value = replace(
            matching_observation(self.company), entity_name="  ACTIVATION   Pty\tLtd   "
        )
        with use_operator():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute(f'SET ROLE "{settings.RLS_ROLES["operator"]}"')
            try:
                company, receipt = self.service()
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("RESET ROLE")
        self.assertEqual(company.status, "active")
        self.assertEqual(receipt.status, "passed")
        self.assertIsNotNone(receipt.applied_at)

    def test_unicode_name_matches_apply_under_actual_operator_and_true_mismatch_is_retained(self):
        from dataclasses import replace

        from companies.services.editing import update_company
        from companies.validators import acn_check_digit

        names = (
            ("Straße Pty Ltd", "\t STRASSE\u001cPty\u202fLtd\r"),
            ("ΣΟΣ Pty Ltd", "σος PTY LTD"),
            ("İ É Ａ Pty Ltd", "i\u0307 E\u0301 A Pty Ltd"),
        )
        for index, (supplied, observed) in enumerate(names):
            with self.subTest(supplied=supplied):
                company = register_company(
                    owner=self.user,
                    name=supplied,
                    acn=f"2345678{index}{acn_check_digit(f'2345678{index}')}",
                    primary_contact_data={"first_name": "Unicode", "last_name": "Administrator"},
                )
                source = self.admit(self.user, company)
                self.provider.return_value = replace(matching_observation(company), entity_name=observed)
                with use_operator():
                    db = connections[current_alias()]
                    with db.cursor() as cursor:
                        cursor.execute(f'SET ROLE "{settings.RLS_ROLES["operator"]}"')
                    try:
                        activated, receipt = activate_company(
                            actor=self.user,
                            company_id=company.pk,
                            appointment=source.pk,
                            lifecycle_revision=0,
                            idempotency_key=uuid4(),
                            declaration_version=DECLARATION_VERSION,
                            accept_declaration=True,
                        )
                    finally:
                        with db.cursor() as cursor:
                            cursor.execute("RESET ROLE")
                self.assertEqual(activated.status, "active")
                self.assertEqual(receipt.status, "passed")
                self.assertIsNotNone(receipt.applied_at)
        self.company = update_company(self.company, {"name": "Straße Pty Ltd"}, actor=self.user)
        self.provider.return_value = replace(matching_observation(self.company), entity_name="Strase Pty Ltd")
        self.assertEqual(self.activate().status_code, 200)
        with use_operator():
            receipt = CompanyRegistryCheck.objects.get(idempotency_key=self.key)
            self.assertEqual((receipt.status, receipt.reason), ("failed", "name_mismatch"))
            self.assertIsNone(receipt.applied_at)
            self.assertEqual(Company.objects.get(pk=self.company.pk).status, "draft")

    def test_raw_pending_receipts_require_exact_four_key_company_identity_for_all_purposes(self):
        from companies.identity import company_identity
        from companies.services.activation import _person_identity

        valid = company_identity(self.company)
        invalid = (
            None,
            {},
            {**valid, "name": "forged"},
            {**valid, "extra": "forged"},
            {k: v for k, v in valid.items() if k != "name"},
        )
        for purpose in ("authority", "activation", "retry"):
            with use_migrate():
                Company.objects.filter(pk=self.company.pk).update(status="warning" if purpose == "retry" else "draft")
                get_user_model().objects.filter(pk=self.user.pk).update(is_staff=purpose == "retry")
            provenance = (
                {
                    "initiating_appointment": self.source,
                    "idempotency_key": uuid4(),
                    "person_identity": _person_identity(self.user, self.profile),
                    "issuer_identity_required": False,
                    "declaration_version": DECLARATION_VERSION,
                    "declaration_text": DECLARATION_TEXT,
                }
                if purpose == "activation"
                else {}
            )
            fields = {
                "company": self.company,
                "initiated_by": self.user,
                "purpose": purpose,
                "requested_name": self.company.name,
                "requested_acn": self.company.acn,
                "requested_abn": self.company.abn,
                "lifecycle_revision": self.company.lifecycle_revision,
                **provenance,
            }
            with company_operation(self.user, self.company.pk, "registry"), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f'SET LOCAL ROLE "{settings.RLS_ROLES["operator"]}"')
                for identity in invalid:
                    with self.subTest(purpose=purpose, identity=identity), self.assertRaises(DatabaseError), atomic():
                        CompanyRegistryCheck.objects.create(
                            identity=identity, **{**fields, **({"idempotency_key": uuid4()} if provenance else {})}
                        )
                receipt = CompanyRegistryCheck.objects.create(identity=valid, **fields)
                self.assertEqual(receipt.identity, valid)
                if purpose == "activation":
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT companies_current_activation_source(receipt) "
                            "FROM companies_companyregistrycheck receipt WHERE uuid = %s",
                            [receipt.pk],
                        )
                        self.assertTrue(cursor.fetchone()[0])
            if purpose == "activation":
                for identity in invalid[1:]:
                    with use_migrate():
                        CompanyRegistryCheck.objects.filter(pk=receipt.pk).update(identity=identity)
                    with company_operation(self.user, self.company.pk, "activation"), atomic():
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute(f'SET LOCAL ROLE "{settings.RLS_ROLES["operator"]}"')
                            cursor.execute(
                                "SELECT companies_current_activation_source(receipt) "
                                "FROM companies_companyregistrycheck receipt WHERE uuid = %s",
                                [receipt.pk],
                            )
                            self.assertFalse(cursor.fetchone()[0], identity)
                with use_migrate():
                    CompanyRegistryCheck.objects.filter(pk=receipt.pk).update(identity=valid)
        self.provider.assert_not_called()

    def test_raw_receipt_update_waits_for_company_before_receipt_and_service_completion_has_no_deadlock(self):
        from time import monotonic

        from companies.services.registry import (
            begin_registry_check,
            complete_registry_check,
        )

        receipt = begin_registry_check(self.company, "authority", self.user)
        observation = matching_observation(self.company)
        locked, release, raw_started = Event(), Event(), Event()
        pids = {}

        def service_complete():
            try:
                with use_operator():
                    db = connections[current_alias()]
                    with db.cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["service"] = cursor.fetchone()[0]

                    def pause(execute, sql, params, many, context):
                        result = execute(sql, params, many, context)
                        if sql.startswith("SELECT") and 'FROM "companies_company"' in sql and "FOR UPDATE" in sql:
                            locked.set()
                            if not release.wait(timeout=10):
                                raise RuntimeError("Company lock coordination timed out")
                        return result

                    with db.execute_wrapper(pause):
                        return "completed", complete_registry_check(receipt, observation).status
            except DatabaseError as error:
                return "database_error", error.__cause__.sqlstate
            finally:
                connections.close_all()

        def raw_complete():
            try:
                with company_operation(self.user, self.company.pk, "registry_result"), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(f'SET LOCAL ROLE "{settings.RLS_ROLES["operator"]}"')
                        cursor.execute("SELECT pg_backend_pid()")
                        pids["raw"] = cursor.fetchone()[0]
                        raw_started.set()
                        cursor.execute(
                            "UPDATE companies_companyregistrycheck "
                            "SET completed_at = clock_timestamp(), updated_at = clock_timestamp(), "
                            "status = 'passed', reason = 'matched', registry_acn = %s, registry_abn = %s, "
                            "entity_name = %s, "
                            "entity_type = %s, entity_status = %s WHERE uuid = %s",
                            [
                                observation.acn,
                                observation.abn,
                                observation.entity_name,
                                observation.entity_type,
                                observation.entity_status,
                                receipt.pk,
                            ],
                        )
                return "completed", None
            except DatabaseError as error:
                return "refused", error.__cause__.sqlstate
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            service = pool.submit(service_complete)
            self.assertTrue(locked.wait(timeout=10))
            raw = pool.submit(raw_complete)
            self.assertTrue(raw_started.wait(timeout=10))
            try:
                blocked = False
                deadline = monotonic() + 5
                with use_migrate():
                    while monotonic() < deadline:
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT %s = ANY(pg_blocking_pids(%s))", [pids["service"], pids["raw"]])
                            blocked = cursor.fetchone()[0]
                        if blocked:
                            break
                        Event().wait(0.01)
                self.assertTrue(blocked, "Raw receipt UPDATE did not wait for the held exact Company")
            finally:
                release.set()
            service_result, raw_result = service.result(timeout=20), raw.result(timeout=20)
        self.assertEqual(service_result, ("completed", "passed"))
        self.assertEqual(raw_result, ("refused", "23514"))
        with use_operator():
            retained = CompanyRegistryCheck.objects.get(pk=receipt.pk)
            self.assertEqual(retained.status, "passed")
            self.assertIsNotNone(retained.completed_at)
        self.assertEqual(self.activate().status_code, 200)
        with use_operator():
            self.assertEqual(Company.objects.get(pk=self.company.pk).status, "active")

    def test_installed_unicode_canonicalizer_matches_python_casefold_whitespace_and_nfkc_vectors(self):
        import json
        import unicodedata
        from pathlib import Path

        from companies.identity import registered_name

        values, whitespace, casefold = [], [], {}
        for scalar in range(1, 0x110000):
            if 0xD800 <= scalar <= 0xDFFF:
                continue
            value = chr(scalar)
            if value.casefold() != value:
                casefold[str(scalar)] = value.casefold()
            if value.casefold() != value or unicodedata.normalize("NFKC", value) != value:
                values.append(value)
            if value.isspace():
                whitespace.append(value)
        frozen = Path(__file__).parent / "fixtures" / "unicode_15_1_casefold.json"
        self.assertEqual(json.loads(frozen.read_text()), casefold)
        self.assertEqual(len(casefold), 1530)
        self.assertEqual(len(whitespace), 29)
        values += [f"{value}Straße{value}ΣΟΣ{value}" for value in whitespace]
        values += [
            "",
            "\t\r",
            "Straße STRASSE",
            "ΣΟΣ σος σοσ",
            "İ I\u0307",
            "E\u0301 É",
            "Ａ Ｂ ﬁ ①",
            "\u0345\u0301",
            "\u212b\u0323",
            "\u1100\u1161\u11a8",
            "\u1e9b\u0323",
        ]
        with use_operator(), connections[current_alias()].cursor() as cursor:
            for start in range(0, len(values), 500):
                selected = values[start : start + 500]
                cursor.execute(
                    "SELECT value, normalize(value, NFKC), companies_canonical_name(value) "
                    "FROM unnest(%s::text[]) AS vectors(value)",
                    [selected],
                )
                actual = cursor.fetchall()
                self.assertEqual(len(actual), len(selected))
                for value, normalized, canonical in actual:
                    self.assertEqual(normalized, unicodedata.normalize("NFKC", value), repr(value))
                    self.assertEqual(canonical, registered_name(value), repr(value))
            cursor.execute(
                "SELECT companies_canonical_name(NULL), provolatile, proisstrict "
                "FROM pg_proc WHERE oid = 'companies_canonical_name(text)'::regprocedure"
            )
            self.assertEqual(cursor.fetchone(), (None, "i", True))
