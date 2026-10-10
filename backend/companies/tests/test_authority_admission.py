import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.db.models import ProtectedError
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyAuthorityRequest,
    CompanyAuthorityRequestWithdrawal,
    CompanyRegistryCheck,
)
from companies.services.authority import (
    DECLARATION_TEXT,
    DECLARATION_VERSION,
    admit_authority_request,
    has_company_capability,
    revoke_authority_request,
)
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
    withdraw_authority_request,
)
from companies.services.editing import update_company
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    PDF,
    STORAGES,
    URL,
    AuthorityRequestCases,
    authority_fixture,
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
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.models import RegisterMemberWallet, ShareToken
from tokens.services.register_events import create_member, open_register
from users.models import UserAccount, UserProfile
from wallets.models import Wallet


class CompanyAuthorityAdmissionFixtures(StubUploadDependencies):
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("admission", "112233445")
            self.other, self.other_profile, self.other_company = authority_fixture("other-admission", "998877665")
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.key = uuid4()
        self.proposal, created = self.submit()
        self.assertTrue(created)
        self.url = f"{URL}{self.proposal.pk}/admit/"
        self.revoke_url = f"{URL}{self.proposal.pk}/revoke/"
        self.client.force_authenticate(self.user)
        self.provider = self.enterContext(
            patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company))
        )

    def submit(self, **changes):
        return submit_authority_request(
            **{
                "requester": self.user,
                "company_id": self.company.pk,
                "idempotency_key": self.key,
                "file": evidence(),
                "requested_capabilities": ["admin", "prepare"],
                "delegatable_capabilities": ["approve"],
                **changes,
            }
        )

    def declaration(self, **changes):
        return {"declaration_version": DECLARATION_VERSION, "accept_declaration": True, **changes}

    def admit(self, **changes):
        return self.client.post(self.url, self.declaration(**changes), format="json")

    def service_admit(self, **changes):
        return admit_authority_request(
            **{
                "requester": self.user,
                "request_id": self.proposal.pk,
                **self.declaration(),
                **changes,
            }
        )

    def change_snapshot_fixture(self, model, identity, changes):
        if model is Company and set(changes) == {"name"}:
            update_company(self.company, changes, actor=self.user)
            return
        with use_migrate() if model is Company else use_operator():
            model.objects.filter(pk=identity).update(**changes)

    def appointment(self):
        with use_operator():
            return CompanyAppointment.objects.get(request=self.proposal)

    def assert_no_appointment(self):
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())

    def concurrent(self, functions):
        barrier = Barrier(len(functions))

        def execute(function):
            try:
                with use_operator():
                    actor = get_user_model().objects.get(pk=self.user.pk)
                barrier.wait(timeout=20)
                try:
                    result = function(actor)
                    return "success", str(result.pk)
                except APIException as error:
                    return "refused", error.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(functions)) as pool:
            return [future.result(timeout=40) for future in [pool.submit(execute, function) for function in functions]]


class CompanyAuthorityAdmissionTest(CompanyAuthorityAdmissionFixtures, APITransactionTestCase):
    def test_admission_records_exact_declaration_scope_and_abr_outcome_without_activating_company(self):
        before = {field.attname: getattr(self.proposal, field.attname) for field in self.proposal._meta.fields}
        response = self.admit()
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["status"], "admitted")
        appointment = body["appointment"]
        self.assertEqual(appointment["status"], "active")
        self.assertTrue(appointment["isEffective"])
        self.assertEqual(appointment["capabilities"], ["admin", "prepare"])
        self.assertEqual(appointment["delegatableCapabilities"], ["approve"])
        self.assertEqual(appointment["declarationVersion"], "2026-10-04")
        self.assertEqual(appointment["declarationText"], DECLARATION_TEXT)
        self.assertIsNone(appointment["expiresAt"])
        self.assertIsNone(appointment["revokedAt"])
        self.assertIsNotNone(appointment["createdAt"])
        recorded = self.appointment()
        self.assertEqual(str(recorded.pk), appointment["uuid"])
        with use_operator():
            retained = CompanyAuthorityRequest.objects.get(pk=self.proposal.pk)
            self.assertEqual(
                {field.attname: getattr(retained, field.attname) for field in retained._meta.fields}, before
            )
            self.company.refresh_from_db()
            self.assertEqual(self.company.status, "draft")
            check = CompanyRegistryCheck.objects.get(pk=recorded.registry_check_id)
            self.assertEqual((check.company_id, check.initiated_by_id), (self.company.pk, self.user.pk))
            self.assertEqual((check.purpose, check.status, check.reason), ("authority", "passed", "matched"))
            self.assertIsNotNone(check.completed_at)
            self.assertEqual(check.identity, retained.company_identity)
        self.provider.assert_called_once_with(acn="112233445", abn="")
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="prepare"))
        self.assertFalse(has_company_capability(requester=self.user, company_id=self.company.pk, capability="approve"))
        self.assertFalse(
            has_company_capability(requester=self.user, company_id=self.other_company.pk, capability="admin")
        )
        self.assertEqual(self.client.get(f"{URL}{self.proposal.pk}/").json(), body)
        self.assertEqual(self.client.get(URL).json()["results"], [body])
        download = self.client.get(body["fileUrl"])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b"".join(download.streaming_content), PDF)
        self.assertEqual(download["Cache-Control"], "private, no-store")

    def test_declaration_missing_changed_unaccepted_and_claimed_terms_are_refused_before_provider(self):
        bodies = (
            {},
            {"accept_declaration": True},
            {"declaration_version": DECLARATION_VERSION},
            self.declaration(declaration_version="2026-10-03"),
            self.declaration(accept_declaration=False),
            self.declaration(declaration_text="I may act for any company"),
            self.declaration(company=str(self.other_company.pk)),
            self.declaration(capabilities=["approve"]),
            self.declaration(requester=self.other.pk),
            self.declaration(status="active"),
            [],
            "",
        )
        for body in bodies:
            with self.subTest(body=body):
                response = self.client.post(self.url, body, format="json")
                self.assertEqual(response.status_code, 400, response.content)
        self.provider.assert_not_called()
        self.assert_no_appointment()
        self.assertEqual(self.admit().status_code, 200)

    def test_bootstrap_requires_personal_admin_and_not_only_delegation(self):
        for requested, delegatable in ((["prepare"], ["admin"]), ([], ["admin"]), (["approve"], [])):
            with self.subTest(requested=requested, delegatable=delegatable):
                proposal, _ = self.submit(
                    idempotency_key=uuid4(), requested_capabilities=requested, delegatable_capabilities=delegatable
                )
                response = self.client.post(f"{URL}{proposal.pk}/admit/", self.declaration(), format="json")
                self.assertEqual(response.status_code, 400, response.content)
        self.provider.assert_not_called()
        self.assert_no_appointment()
        self.assertEqual(self.admit().status_code, 200)

    def test_configured_representative_identity_gate_and_disabled_gate_keep_existing_semantics(self):
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
        response = self.admit()
        self.assertEqual(response.status_code, 400, response.content)
        self.assert_no_appointment()
        self.provider.assert_not_called()
        with use_operator():
            operator = Operator.get()
            operator.issuer_kyc_required = False
            operator.save(update_fields=["issuer_kyc_required"])
        self.assertEqual(self.admit().status_code, 200)
        with use_operator():
            self.profile.refresh_from_db()
            self.assertFalse(self.profile.is_id_verified)

    def test_failed_unavailable_missing_and_mismatched_abr_results_never_admit(self):
        observation = matching_observation(self.company)
        for result in (
            RegistryObservation(reason="unconfigured"),
            RegistryObservation(reason="unavailable"),
            RegistryObservation(reason="not_found"),
            RegistryObservation(acn=self.company.acn, entity_name=self.company.name),
            RegistryObservation(**{**observation.__dict__, "entity_name": "Different Pty Ltd"}),
            RegistryObservation(**{**observation.__dict__, "acn": "999999999"}),
            RegistryObservation(**{**observation.__dict__, "entity_status": "Cancelled"}),
        ):
            with self.subTest(result=result):
                self.provider.return_value = result
                response = self.admit()
                self.assertEqual(response.status_code, 400, response.content)
                self.assert_no_appointment()
                with use_operator():
                    self.company.refresh_from_db()
                    self.assertEqual(self.company.status, "draft")
        self.provider.return_value = observation
        self.assertEqual(self.admit().status_code, 200)

    def test_stale_company_and_person_snapshots_owner_status_and_expiry_are_refused(self):
        for model, identity, changes in (
            (Company, self.company.pk, {"name": "Renamed Pty Ltd"}),
            (Company, self.company.pk, {"acn": "555555555"}),
            (Company, self.company.pk, {"owner": self.other}),
            (Company, self.company.pk, {"status": "submitted"}),
            (UserProfile, self.profile.pk, {"full_name": "Changed representative"}),
            (get_user_model(), self.user.pk, {"email": "changed@example.test"}),
        ):
            with self.subTest(model=model, changes=changes):
                with use_operator():
                    original = model.objects.values(*changes).get(pk=identity)
                self.change_snapshot_fixture(model, identity, changes)
                try:
                    response = self.admit()
                    self.assertEqual(response.status_code, 409, response.content)
                    self.assert_no_appointment()
                finally:
                    self.change_snapshot_fixture(model, identity, original)
        expiry = timezone.now() + timedelta(seconds=1)
        proposal, _ = self.submit(idempotency_key=uuid4(), requested_expires_at=expiry)
        with patch("companies.services.authority.timezone.now", return_value=expiry):
            response = self.client.post(f"{URL}{proposal.pk}/admit/", self.declaration(), format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.provider.assert_not_called()
        self.assert_no_appointment()
        self.assertEqual(self.admit().status_code, 200)

    def test_provider_return_rechecks_company_person_and_current_account_before_effect(self):
        for model, identity, changes, expected in (
            (Company, self.company.pk, {"name": "Changed while ABR ran Pty Ltd"}, 409),
            (UserProfile, self.profile.pk, {"full_name": "Changed while ABR ran"}, 409),
            (UserProfile, self.profile.pk, {"is_id_verified": False}, 400),
            (get_user_model(), self.user.pk, {"is_active": False}, 403),
        ):
            with self.subTest(model=model, changes=changes):
                with use_operator():
                    original = model.objects.values(*changes).get(pk=identity)

                def change_then_return(**kwargs):
                    self.change_snapshot_fixture(model, identity, changes)
                    return matching_observation(self.company)

                self.provider.side_effect = change_then_return
                try:
                    response = self.admit()
                    self.assertEqual(response.status_code, expected, response.content)
                    self.assert_no_appointment()
                finally:
                    self.change_snapshot_fixture(model, identity, original)
        self.provider.side_effect = None
        self.assertEqual(self.admit().status_code, 200)

    def test_admission_retry_reuses_history_after_company_change_and_revocation_without_provider(self):
        response = self.admit()
        self.assertEqual(response.status_code, 200, response.content)
        with patch("shared.uploads.scan_upload", side_effect=RuntimeError("retained evidence must not be rescanned")):
            replay = self.client.post(
                URL,
                {
                    "company": str(self.company.pk),
                    "idempotency_key": str(self.key),
                    "file": evidence(),
                    "requested_capabilities": ["admin", "prepare"],
                    "delegatable_capabilities": ["approve"],
                },
                format="multipart",
            )
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json(), response.json())
        update_company(self.company, {"name": "Changed after admission Pty Ltd"}, actor=self.user)
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
        self.provider.reset_mock()
        self.provider.side_effect = RuntimeError("provider must not run on a retained admission")
        repeated = self.admit()
        self.assertEqual(repeated.json(), response.json())
        refused = self.admit(declaration_version="changed")
        self.assertEqual(refused.status_code, 400, refused.content)
        revoked = self.client.post(self.revoke_url, {}, format="json")
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.assertEqual(self.admit().json(), revoked.json())
        self.provider.assert_not_called()
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.assertEqual(CompanyRegistryCheck.objects.count(), 1)

    def test_revocation_is_immutable_self_only_and_retains_request_evidence(self):
        admitted = self.admit()
        self.assertEqual(admitted.status_code, 200, admitted.content)
        self.assertEqual(self.client.post(f"{URL}{self.proposal.pk}/withdraw/", {}, format="json").status_code, 409)
        response = self.client.post(self.revoke_url, {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["appointment"]["status"]), ("admitted", "revoked"))
        self.assertFalse(body["appointment"]["isEffective"])
        self.assertIsNotNone(body["appointment"]["revokedAt"])
        self.assertEqual(body["appointment"]["uuid"], admitted.json()["appointment"]["uuid"])
        self.assertEqual(self.client.post(self.revoke_url, {}, format="json").json(), body)
        self.assertFalse(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        with use_operator():
            recorded = CompanyAppointmentRevocation.objects.get(appointment=self.appointment())
            self.assertEqual(recorded.revoked_by_id, self.user.pk)
            self.assertEqual(CompanyAppointmentRevocation.objects.count(), 1)
            self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())
        self.assertEqual(self.client.get(f"{URL}{self.proposal.pk}/").json(), body)
        download = self.client.get(body["fileUrl"])
        self.assertEqual(b"".join(download.streaming_content), PDF)
        self.assertEqual(len([path for path in self.root.rglob("*") if path.is_file()]), 1)

    def test_revoke_refuses_unadmitted_and_nonempty_claims_then_recovers(self):
        self.assertEqual(self.client.post(self.revoke_url, {}, format="json").status_code, 400)
        self.assertEqual(self.admit().status_code, 200)
        for body in ({"revoked_by": self.other.pk}, {"company": str(self.other_company.pk)}, {"reason": "changed"}, []):
            with self.subTest(body=body):
                response = self.client.post(self.revoke_url, body, format="json")
                self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())
        self.assertEqual(self.client.post(self.revoke_url, {}, format="json").status_code, 200)

    def test_expiry_stops_current_authority_and_retained_admission_retry_does_not_extend_it(self):
        expiry = timezone.now() + timedelta(days=1)
        self.proposal, _ = self.submit(idempotency_key=uuid4(), requested_expires_at=expiry)
        self.url = f"{URL}{self.proposal.pk}/admit/"
        response = self.admit()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        recorded = self.appointment()
        self.assertEqual(recorded.expires_at, expiry)
        self.provider.reset_mock()
        with patch("companies.services.authority.timezone.now", return_value=expiry):
            self.assertFalse(
                has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin")
            )
            repeated = self.admit()
            self.assertEqual(repeated.status_code, 200, repeated.content)
            self.assertEqual(repeated.json()["appointment"]["status"], "expired")
            self.assertFalse(repeated.json()["appointment"]["isEffective"])
        self.provider.assert_not_called()
        self.assertEqual(self.appointment().expires_at, expiry)

    def test_locked_current_account_is_rechecked_for_admission_revocation_and_capability(self):
        for field in ("is_active", "is_email_verified"):
            with self.subTest(operation="admit", field=field):
                with use_operator():
                    get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
                self.assertTrue(getattr(self.user, field))
                with self.assertRaises(PermissionDenied):
                    self.service_admit()
                with use_operator():
                    get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})
        self.assert_no_appointment()
        self.service_admit()
        for field in ("is_active", "is_email_verified"):
            with self.subTest(operation="revoke", field=field):
                with use_operator():
                    get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
                self.assertFalse(
                    has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin")
                )
                with self.assertRaises(PermissionDenied):
                    revoke_authority_request(requester=self.user, request_id=self.proposal.pk)
                with use_operator():
                    get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))

    def test_lost_configured_identity_stops_authority_without_rewriting_admission_or_retained_reads(self):
        self.service_admit()
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
        self.assertFalse(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        body = self.client.get(f"{URL}{self.proposal.pk}/").json()
        self.assertEqual(body["appointment"]["status"], "active")
        self.assertFalse(body["appointment"]["isEffective"])
        self.assertEqual(body["status"], "admitted")
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))

    def test_foreign_request_staff_superuser_and_shared_company_owner_cannot_admit_revoke_or_read(self):
        for staff, superuser in ((False, False), (True, False), (True, True)):
            with use_operator():
                get_user_model().objects.filter(pk=self.other.pk).update(is_staff=staff, is_superuser=superuser)
                self.other.refresh_from_db()
            with use_migrate():
                Company.objects.filter(pk=self.company.pk).update(owner=self.other)
            self.client.force_authenticate(self.other)
            for url, body in ((self.url, self.declaration()), (self.revoke_url, {})):
                with self.subTest(staff=staff, superuser=superuser, url=url):
                    foreign = self.client.post(url, body, format="json")
                    missing = self.client.post(url.replace(str(self.proposal.pk), str(uuid4())), body, format="json")
                    self.assertEqual((foreign.status_code, foreign.content), (missing.status_code, missing.content))
                    self.assertEqual(foreign.status_code, 404)
            self.assertEqual(self.client.get(f"{URL}{self.proposal.pk}/").status_code, 404)
            self.assertEqual(self.client.get(f"{URL}{self.proposal.pk}/file/").status_code, 404)
            self.assertEqual(self.client.get(URL).json()["results"], [])
            self.assertFalse(
                has_company_capability(requester=self.other, company_id=self.company.pk, capability="admin")
            )
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(owner=self.user)
        self.client.force_authenticate(None)
        self.assertEqual(self.admit().status_code, 401)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.admit().status_code, 200)

    def test_shareholder_register_position_and_platform_staff_do_not_supply_company_authority(self):
        with use_operator():
            get_user_model().objects.filter(pk=self.user.pk).update(is_staff=True, is_superuser=True)
            self.user.refresh_from_db()
            account = UserAccount.objects.create(user_profile=self.other_profile, account_number="SYNTHETIC-HOLDER")
            wallet = Wallet.objects.create(user_account=account, address="0x" + "a" * 40, chain="base")
            token = ShareToken.objects.create(
                company=self.company, name="Synthetic shares", symbol="SYN", total_supply="1000"
            )
            member = create_member(company_id=self.company.pk, member_id=uuid4())
            opening = open_register(
                token_id=token.pk,
                operation_id=uuid4(),
                changes=[{"member": str(member.pk), "shares": "10"}],
                effective_on=timezone.now().date(),
                recorded_by=self.user,
            )
            RegisterMemberWallet.objects.create(company=self.company, member=member, address=wallet.address)
            self.assertEqual(opening.register.positions.get(member=member).shares, 10)
        for actor in (self.user, self.other):
            self.assertFalse(has_company_capability(requester=actor, company_id=self.company.pk, capability="admin"))
        self.client.force_authenticate(self.other)
        self.assertEqual(self.admit().status_code, 404)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.admit().status_code, 200)
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        self.assertFalse(has_company_capability(requester=self.other, company_id=self.company.pk, capability="admin"))

    def test_one_bootstrap_per_company_forever_blocks_competing_request_after_revocation(self):
        competitor, _ = self.submit(idempotency_key=uuid4())
        self.assertEqual(self.admit().status_code, 200)
        response = self.client.post(f"{URL}{competitor.pk}/admit/", self.declaration(), format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.client.post(self.revoke_url, {}, format="json").status_code, 200)
        refused = self.client.post(f"{URL}{competitor.pk}/admit/", self.declaration(), format="json")
        self.assertEqual(refused.status_code, 409, refused.content)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)
        self.assertEqual(self.client.get(f"{URL}{competitor.pk}/").json()["status"], "pending")

    def test_withdrawn_request_never_admits_and_keeps_a_positive_new_request_control(self):
        withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
        response = self.admit()
        self.assertEqual(response.status_code, 409, response.content)
        self.assert_no_appointment()
        self.provider.assert_not_called()
        self.proposal, _ = self.submit(idempotency_key=uuid4())
        self.url = f"{URL}{self.proposal.pk}/admit/"
        self.assertEqual(self.admit().status_code, 200)

    def test_failed_appointment_and_revocation_insertion_roll_back_history_and_allow_retry(self):
        with patch.object(CompanyAppointment, "save", side_effect=DatabaseError("synthetic admission insert failure")):
            with self.assertRaises(DatabaseError):
                self.service_admit()
        self.assert_no_appointment()
        with use_operator():
            self.assertEqual(
                CompanyAuthorityRequest.objects.get(pk=self.proposal.pk).request_digest, self.proposal.request_digest
            )
            self.company.refresh_from_db()
            self.assertEqual(self.company.status, "draft")
        self.service_admit()
        with patch.object(CompanyAppointmentRevocation, "save", side_effect=DatabaseError("synthetic revoke failure")):
            with self.assertRaises(DatabaseError):
                revoke_authority_request(requester=self.user, request_id=self.proposal.pk)
        with use_operator():
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        self.assertEqual(revoke_authority_request(requester=self.user, request_id=self.proposal.pk).status, "admitted")
        with self.proposal.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)

    def test_app_cannot_forge_identity_appointment_or_revocation_and_operator_cannot_change_scope(self):
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
        with self.app_as(self.user), self.assertRaises(DatabaseError), atomic():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
        with self.app_as(self.user), self.assertRaises(DatabaseError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("UPDATE users_userprofile SET is_id_verified = true WHERE uuid = %s", [self.profile.pk])
        with use_operator():
            self.profile.refresh_from_db()
            self.assertFalse(self.profile.is_id_verified)
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
        self.service_admit()
        recorded = self.appointment()
        values = {field.attname: getattr(recorded, field.attname) for field in recorded._meta.fields}
        values["uuid"] = uuid4()
        with (
            self.app_as(self.user),
            self.assertRaisesMessage(DatabaseError, "Initial company authority requires"),
            atomic(),
        ):
            CompanyAppointment.objects.create(**values)
        with (
            self.app_as(self.user),
            self.assertRaisesMessage(DatabaseError, "Initial company authority requires"),
            atomic(),
        ):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "INSERT INTO companies_companyappointment "
                    "(uuid, created_at, updated_at, company_id, request_id, registry_check_id, capabilities, "
                    "delegatable_capabilities, expires_at, declaration_version, declaration_text) "
                    "SELECT %s, created_at, updated_at, company_id, request_id, registry_check_id, capabilities, "
                    "delegatable_capabilities, expires_at, declaration_version, declaration_text "
                    "FROM companies_companyappointment WHERE uuid = %s",
                    [uuid4(), recorded.pk],
                )
        with self.app_as(self.user), self.assertRaises(DatabaseError), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "INSERT INTO companies_companyappointmentrevocation "
                    "(uuid, appointment_id, revoked_by_id, created_at, updated_at) "
                    "VALUES (%s, %s, %s, statement_timestamp(), statement_timestamp())",
                    [uuid4(), recorded.pk, self.user.pk],
                )
        with use_operator(), _requester_principal(self.other.pk), self.assertRaises(DatabaseError), atomic():
            CompanyAppointmentRevocation.objects.create(appointment=recorded, revoked_by=self.other)
        for changed in (
            {"capabilities": ["admin", "approve"]},
            {"delegatable_capabilities": ["admin"]},
            {"company_id": self.other_company.pk},
            {"declaration_version": "2026-10-03"},
            {"declaration_text": "I am a platform employee"},
        ):
            with (
                self.subTest(changed=changed),
                use_operator(),
                _requester_principal(self.user.pk),
                self.assertRaisesMessage(DatabaseError, "Initial company authority requires"),
                atomic(),
            ):
                CompanyAppointment.objects.create(**{**values, **changed})
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanyAppointment.objects.filter(pk=recorded.pk).update(capabilities=["admin", "approve"])
        self.assertTrue(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        self.assertFalse(has_company_capability(requester=self.user, company_id=self.company.pk, capability="approve"))

    def test_app_cannot_change_provider_results_applicant_bindings_or_disable_issuer_identity_policy(self):
        changes = {
            "is_id_verified": False,
            "verified_at": timezone.now(),
            "review_result": "GREEN",
            "verification_status": "completed",
            "rejection_labels": ["SANCTIONS"],
            "kyc_provider": "sumsub",
            "kycaid_applicant_id": "forged-kycaid-applicant",
            "sumsub_applicant_id": "forged-sumsub-applicant",
            "sumsub_verification_status": "completed",
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                with (
                    self.app_as(self.user),
                    self.assertRaisesMessage(DatabaseError, "Provider identity results"),
                    atomic(),
                ):
                    UserProfile.objects.filter(pk=self.profile.pk).update(**{field: value})
                with (
                    self.app_as(self.user),
                    self.assertRaisesMessage(DatabaseError, "Provider identity results"),
                    atomic(),
                ):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            f"UPDATE users_userprofile SET {field} = %s WHERE uuid = %s",
                            [json.dumps(value) if isinstance(value, list) else value, self.profile.pk],
                        )
        with self.app_as(self.user), self.assertRaisesMessage(DatabaseError, "Only platform configuration"), atomic():
            Operator.objects.filter(pk=1).update(issuer_kyc_required=False)
        with use_operator():
            self.assertTrue(Operator.get().issuer_kyc_required)
            self.profile.refresh_from_db()
            self.assertTrue(self.profile.is_id_verified)
            self.assertIsNone(self.profile.kycaid_applicant_id)
            self.assertIsNone(self.profile.sumsub_applicant_id)
        self.assertEqual(self.admit().status_code, 200)

    def test_self_service_provider_session_and_approval_persist_through_bounded_identity_service(self):
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
        provider = Mock(spec=KYCProvider)
        provider.get_provider_name.return_value = "kycaid"
        provider.create_applicant.return_value = {"applicant_id": "synthetic-authority-applicant"}
        provider.generate_session.return_value = VerificationSession(
            provider="kycaid", applicant_id="synthetic-authority-applicant", form_url="https://example.test/identity"
        )
        provider.get_applicant_status.return_value = {"synthetic": "approved"}
        provider.with_approval_evidence.return_value = {"synthetic": "approved"}
        provider.normalize_status.return_value = NormalizedVerificationResult(
            verification_status="completed", review_result="GREEN", is_verified=True
        )
        provider.get_applicant_data.return_value = {}
        provider.extract_verified_data.return_value = {}
        with (
            patch("users.services.identity.get_kyc_provider", return_value=provider),
            patch("users.tasks.notifications.send_push_notification") as notification,
        ):
            session = self.client.post("/api/users/identity-verification/token/", {}, format="json")
            self.assertEqual(session.status_code, 200, session.content)
            self.assertEqual(session.json()["applicantId"], "synthetic-authority-applicant")
            approved = self.client.get("/api/users/identity-verification/status/")
            self.assertEqual(approved.status_code, 200, approved.content)
            self.assertTrue(approved.json()["isVerified"])
            notification.defer.assert_called_once()
        with use_operator():
            self.profile.refresh_from_db()
            self.assertEqual(self.profile.kycaid_applicant_id, "synthetic-authority-applicant")
            self.assertEqual(self.profile.review_result, "GREEN")
            self.assertTrue(self.profile.is_id_verified)
            self.assertIsNotNone(self.profile.verified_at)
        self.assertEqual(self.admit().status_code, 200)

    def test_appointment_and_revocation_refuse_sql_orm_mutation_and_history_deletion(self):
        self.service_admit()
        recorded = self.appointment()
        with (
            use_operator(),
            _requester_principal(self.user.pk),
            self.assertRaisesMessage(DatabaseError, "An admitted appointment must be revoked"),
            atomic(),
        ):
            CompanyAuthorityRequestWithdrawal.objects.create(request=self.proposal, withdrawn_by=self.user)
        with (
            use_operator(),
            _requester_principal(self.user.pk),
            self.assertRaisesMessage(DatabaseError, "An admitted appointment must be revoked"),
            atomic(),
        ):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "INSERT INTO companies_companyauthorityrequestwithdrawal "
                    "(uuid, request_id, withdrawn_by_id, created_at, updated_at) "
                    "VALUES (%s, %s, %s, statement_timestamp(), statement_timestamp())",
                    [uuid4(), self.proposal.pk, self.user.pk],
                )
        revoke_authority_request(requester=self.user, request_id=self.proposal.pk)
        with use_operator():
            revocation = CompanyAppointmentRevocation.objects.get(appointment=recorded)
            for model, instance in ((CompanyAppointment, recorded), (CompanyAppointmentRevocation, revocation)):
                table = model._meta.db_table
                for statement in (
                    f"UPDATE {table} SET created_at = created_at WHERE uuid = %s",
                    f"DELETE FROM {table} WHERE uuid = %s",
                ):
                    with self.subTest(model=model, statement=statement), self.assertRaises(DatabaseError), atomic():
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute(statement, [instance.pk])
                with self.assertRaises(DatabaseError), atomic():
                    model.objects.filter(pk=instance.pk).update(updated_at=timezone.now())
            with self.assertRaises(ProtectedError):
                self.proposal.delete()
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.assertEqual(CompanyAppointmentRevocation.objects.count(), 1)

    def test_concurrent_identical_admission_and_revocation_keep_one_of_each_effect(self):
        def admission(actor):
            return self.service_admit(requester=actor)

        results = self.concurrent((admission, admission))
        self.assertEqual(results, [("success", str(self.proposal.pk))] * 2)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)

        def revoke(actor):
            return revoke_authority_request(requester=actor, request_id=self.proposal.pk)

        self.assertEqual(self.concurrent((revoke, revoke)), [("success", str(self.proposal.pk))] * 2)
        with use_operator():
            self.assertEqual(CompanyAppointmentRevocation.objects.count(), 1)

    def test_concurrent_competing_requests_admit_only_one_company_bootstrap(self):
        competitor, _ = self.submit(idempotency_key=uuid4())
        results = self.concurrent(
            (
                lambda actor: self.service_admit(requester=actor),
                lambda actor: self.service_admit(requester=actor, request_id=competitor.pk),
            )
        )
        self.assertEqual(sorted(result[0] for result in results), ["refused", "success"])
        self.assertIn(("refused", 409), results)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)

    def test_concurrent_admission_and_withdrawal_commit_exclusive_outcomes(self):
        results = self.concurrent(
            (
                lambda actor: self.service_admit(requester=actor),
                lambda actor: withdraw_authority_request(requester=actor, request_id=self.proposal.pk),
            )
        )
        self.assertEqual(sorted(result[0] for result in results), ["refused", "success"])
        self.assertIn(("refused", 409), results)
        with use_operator():
            appointments = CompanyAppointment.objects.count()
            withdrawals = CompanyAuthorityRequestWithdrawal.objects.count()
            self.assertEqual(appointments + withdrawals, 1)

    def test_concurrent_retained_admission_and_revocation_do_not_restore_authority(self):
        self.service_admit()
        self.provider.reset_mock()
        results = self.concurrent(
            (
                lambda actor: self.service_admit(requester=actor),
                lambda actor: revoke_authority_request(requester=actor, request_id=self.proposal.pk),
            )
        )
        self.assertEqual(results, [("success", str(self.proposal.pk))] * 2)
        self.provider.assert_not_called()
        self.assertFalse(has_company_capability(requester=self.user, company_id=self.company.pk, capability="admin"))
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.assertEqual(CompanyAppointmentRevocation.objects.count(), 1)
