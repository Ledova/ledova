import json
import tempfile
import time
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.db.models import F
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    RegistryCheckPurpose,
)
from companies.services.authority import DECLARATION_TEXT, DECLARATION_VERSION
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
    withdraw_authority_request,
)
from companies.services.registry import (
    begin_registry_check,
    complete_registry_check,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    URL,
    AuthorityRequestCases,
    authority_fixture,
    evidence,
)
from integrations.abr.client import RegistryObservation
from operators.models import Operator
from shared.db import atomic, current_alias, reset_principal, use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserProfile

ADMISSION_GUARD = "Initial company authority requires"
REVOCATION_GUARD = "Only the exact active appointee"
APPOINTMENT_SQL = (
    "INSERT INTO companies_companyappointment "
    "(uuid, created_at, updated_at, company_id, appointee_id, appointee_profile_id, request_id, registry_check_id, "
    "capabilities, delegatable_capabilities, expires_at, declaration_version, declaration_text) "
    "VALUES (%s, statement_timestamp(), statement_timestamp(), %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, "
    "%s, %s, %s)"
)
REVOCATION_SQL = (
    "INSERT INTO companies_companyappointmentrevocation "
    "(uuid, appointment_id, revoked_by_id, created_at, updated_at) "
    "VALUES (%s, %s, %s, statement_timestamp(), statement_timestamp())"
)


class CompanyAuthorityAdmissionGuardTest(StubUploadDependencies, APITransactionTestCase):
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("guard", "135792468")
            self.other, self.other_profile, self.other_company = authority_fixture("other-guard", "246813579")
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=True)
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.proposal = self.submit()
        self.check = self.registry_check()
        self.client.force_authenticate(self.user)

    def submit(self, **changes):
        proposal, created = submit_authority_request(
            **{
                "requester": self.user,
                "company_id": self.company.pk,
                "idempotency_key": uuid4(),
                "file": evidence(),
                "requested_capabilities": ["admin", "prepare"],
                "delegatable_capabilities": ["approve"],
                **changes,
            }
        )
        self.assertTrue(created)
        return proposal

    def registry_check(self, purpose=RegistryCheckPurpose.AUTHORITY, observation=None):
        with use_operator():
            actor = (
                self.user
                if purpose == RegistryCheckPurpose.AUTHORITY
                else get_user_model().objects.create_user(
                    email="guard-reviewer@example.test", is_active=True, is_staff=True
                )
            )
            check = begin_registry_check(self.company, purpose, actor)
            return complete_registry_check(check, observation or matching_observation(self.company))

    def row(self, **changes):
        return {
            "company_id": self.company.pk,
            "appointee_id": self.user.pk,
            "appointee_profile_id": self.profile.pk,
            "request_id": self.proposal.pk,
            "registry_check_id": self.check.pk,
            "capabilities": self.proposal.requested_capabilities,
            "delegatable_capabilities": self.proposal.delegatable_capabilities,
            "expires_at": self.proposal.requested_expires_at,
            "declaration_version": DECLARATION_VERSION,
            "declaration_text": DECLARATION_TEXT,
            **changes,
        }

    def forge(self, **changes):
        with use_operator(), atomic():
            return CompanyAppointment.objects.create(**self.row(**changes))

    def forge_sql(self, **changes):
        row = self.row(**changes)
        with use_operator(), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    APPOINTMENT_SQL,
                    [
                        uuid4(),
                        row["company_id"],
                        row["appointee_id"],
                        row["appointee_profile_id"],
                        row["request_id"],
                        row["registry_check_id"],
                        json.dumps(row["capabilities"]),
                        json.dumps(row["delegatable_capabilities"]),
                        row["expires_at"],
                        row["declaration_version"],
                        row["declaration_text"],
                    ],
                )

    def revoke(self, appointment):
        with use_operator(), atomic():
            return CompanyAppointmentRevocation.objects.create(appointment=appointment, revoked_by=self.user)

    def revoke_sql(self, appointment):
        with use_operator(), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(REVOCATION_SQL, [uuid4(), appointment.pk, self.user.pk])

    def assert_refused(self, **changes):
        for attempt in (self.forge, self.forge_sql):
            with (
                self.subTest(attempt=attempt.__name__),
                use_operator(),
                _requester_principal(self.user.pk),
                self.assertRaisesMessage(DatabaseError, ADMISSION_GUARD),
            ):
                attempt(**changes)
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())

    def admitted(self, **changes):
        with use_operator(), _requester_principal(self.user.pk):
            appointment = self.forge(**changes)
        with use_operator():
            self.assertEqual(list(CompanyAppointment.objects.values_list("pk", flat=True)), [appointment.pk])
        return appointment

    def change(self, model, identity, changes):
        with use_migrate() if model is Company else use_operator():
            original = model.objects.values(*changes).get(pk=identity)
            model.objects.filter(pk=identity).update(**changes)
        return original

    def restore(self, model, identity, original):
        with use_migrate() if model is Company else use_operator():
            model.objects.filter(pk=identity).update(**original)

    def test_matching_operator_sql_insert_records_the_appointment(self):
        with use_operator(), _requester_principal(self.user.pk):
            self.forge_sql()
        with use_operator():
            recorded = CompanyAppointment.objects.get(company=self.company)
            self.assertEqual(
                (recorded.request_id, recorded.registry_check_id, recorded.capabilities, recorded.expires_at),
                (self.proposal.pk, self.check.pk, ["admin", "prepare"], None),
            )

    def test_withdrawn_request_cannot_seed_an_appointment(self):
        withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
        self.assert_refused()
        self.proposal = self.submit()
        self.admitted()

    def test_company_ownership_and_draft_status_are_rechecked_on_insert(self):
        for changes in ({"owner": self.other}, {"status": "submitted"}):
            with self.subTest(changes=changes):
                original = self.change(Company, self.company.pk, changes)
                self.assert_refused()
                self.restore(Company, self.company.pk, original)
        self.admitted()

    def test_expired_proposal_and_mismatched_expiry_are_refused_on_insert(self):
        with self.subTest(expiry="mismatched"):
            self.assert_refused(expires_at=timezone.now() + timedelta(days=1))
        expiry = timezone.now() + timedelta(seconds=3)
        expiring = self.submit(requested_expires_at=expiry)
        time.sleep(max(0.0, (expiry - timezone.now()).total_seconds()) + 0.05)
        with self.subTest(expiry="passed"):
            self.assert_refused(request_id=expiring.pk, expires_at=expiry)
        self.admitted()

    def test_capabilities_without_admin_are_refused_on_insert(self):
        delegated = self.submit(requested_capabilities=["prepare"], delegatable_capabilities=["admin"])
        self.assert_refused(request_id=delegated.pk, capabilities=["prepare"], delegatable_capabilities=["admin"])
        self.admitted()

    def test_configured_identity_gate_is_enforced_on_insert(self):
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
        self.assert_refused()
        with use_operator():
            operator = Operator.get()
            operator.issuer_kyc_required = False
            operator.save(update_fields=["issuer_kyc_required"])
        self.admitted()
        with use_operator():
            self.assertFalse(UserProfile.objects.get(pk=self.profile.pk).is_id_verified)

    def test_registry_check_purpose_status_and_lifecycle_revision_are_bound_on_insert(self):
        activation = self.registry_check(purpose=RegistryCheckPurpose.ACTIVATION)
        failed = self.registry_check(observation=RegistryObservation(reason="not_found"))
        self.assertEqual((activation.purpose, activation.status), ("activation", "passed"))
        self.assertEqual((failed.purpose, failed.status), ("authority", "failed"))
        for check in (activation, failed):
            with self.subTest(purpose=check.purpose, status=check.status):
                self.assert_refused(registry_check_id=check.pk)
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(lifecycle_revision=F("lifecycle_revision") + 1)
        with self.subTest(lifecycle_revision="stale"):
            self.assert_refused()
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(lifecycle_revision=F("lifecycle_revision") - 1)
        self.admitted()

    def test_service_admission_refuses_a_lifecycle_revision_changed_while_the_provider_ran(self):
        def bump_then_return(**kwargs):
            with use_migrate():
                Company.objects.filter(pk=self.company.pk).update(lifecycle_revision=F("lifecycle_revision") + 1)
            return matching_observation(self.company)

        declaration = {"declaration_version": DECLARATION_VERSION, "accept_declaration": True}
        with patch("companies.services.registry.lookup_company", side_effect=bump_then_return) as provider:
            response = self.client.post(f"{URL}{self.proposal.pk}/admit/", declaration, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("company", response.json())
        provider.assert_called_once()
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())

    def test_changed_company_and_person_snapshots_are_refused_on_insert(self):
        for model, identity, changes in (
            (Company, self.company.pk, {"company_type": "public"}),
            (UserProfile, self.profile.pk, {"full_name": "Changed representative"}),
            (get_user_model(), self.user.pk, {"email": "changed-guard@example.test"}),
        ):
            with self.subTest(model=model, changes=changes):
                original = self.change(model, identity, changes)
                self.assert_refused()
                self.restore(model, identity, original)
        self.admitted()

    def test_principal_must_match_the_requester_on_insert(self):
        for attempt in (self.forge, self.forge_sql):
            with (
                self.subTest(attempt=attempt.__name__, principal="other"),
                use_operator(),
                _requester_principal(self.other.pk),
                self.assertRaisesMessage(DatabaseError, ADMISSION_GUARD),
            ):
                attempt()
            with (
                self.subTest(attempt=attempt.__name__, principal=None),
                use_operator(),
                self.assertRaisesMessage(DatabaseError, ADMISSION_GUARD),
            ):
                reset_principal()
                attempt()
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())
        self.admitted()

    def test_appointee_and_profile_must_be_the_requester_and_their_profile_on_insert(self):
        for changes in ({"appointee_id": self.other.pk}, {"appointee_profile_id": self.other_profile.pk}):
            with self.subTest(changes=changes):
                self.assert_refused(**changes)
        self.admitted()

    def test_revocation_insert_requires_the_matching_principal_and_an_active_actor(self):
        appointment = self.admitted()
        for attempt in (self.revoke, self.revoke_sql):
            with (
                self.subTest(attempt=attempt.__name__, principal="other"),
                use_operator(),
                _requester_principal(self.other.pk),
                self.assertRaisesMessage(DatabaseError, REVOCATION_GUARD),
            ):
                attempt(appointment)
            original = self.change(get_user_model(), self.user.pk, {"is_active": False})
            with (
                self.subTest(attempt=attempt.__name__, actor="inactive"),
                use_operator(),
                _requester_principal(self.user.pk),
                self.assertRaisesMessage(DatabaseError, REVOCATION_GUARD),
            ):
                attempt(appointment)
            self.restore(get_user_model(), self.user.pk, original)
        with use_operator():
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())
        with use_operator(), _requester_principal(self.user.pk):
            revocation = self.revoke(appointment)
        with use_operator():
            self.assertEqual(
                list(CompanyAppointmentRevocation.objects.values_list("pk", "revoked_by_id")),
                [(revocation.pk, self.user.pk)],
            )

    def test_appointment_and_revocation_rows_are_immutable_for_the_appointee_and_the_app(self):
        appointment = self.admitted()
        with use_operator(), _requester_principal(self.user.pk):
            revocation = self.revoke(appointment)
        later = timezone.now() + timedelta(days=1)
        for model, instance, guard in (
            (CompanyAppointment, appointment, "Retain immutable company appointments"),
            (CompanyAppointmentRevocation, revocation, "Retain immutable company appointment revocations"),
        ):
            table = model._meta.db_table
            for statement, params in (
                (f"UPDATE {table} SET created_at = %s, updated_at = %s WHERE uuid = %s", [later, later, instance.pk]),
                (f"DELETE FROM {table} WHERE uuid = %s", [instance.pk]),
            ):
                with (
                    self.subTest(model=model, role="operator", statement=statement.split()[0]),
                    use_operator(),
                    _requester_principal(self.user.pk),
                    self.assertRaisesMessage(DatabaseError, guard),
                    atomic(),
                ):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(statement, params)
            with (
                self.subTest(model=model, role="operator", statement="ORM update"),
                use_operator(),
                _requester_principal(self.user.pk),
                self.assertRaisesMessage(DatabaseError, guard),
                atomic(),
            ):
                model.objects.filter(pk=instance.pk).update(created_at=later)
            with (
                self.subTest(model=model, role="app", statement="ORM update"),
                self.app_as(self.user),
                self.assertRaisesMessage(DatabaseError, guard),
                atomic(),
            ):
                model.objects.filter(pk=instance.pk).update(created_at=later)
            with self.subTest(model=model, role="app", statement="DELETE"), self.app_as(self.user), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f"DELETE FROM {table} WHERE uuid = %s", [instance.pk])
                    self.assertEqual(cursor.rowcount, 0)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.get(pk=appointment.pk).created_at, appointment.created_at)
            self.assertEqual(
                CompanyAppointmentRevocation.objects.get(pk=revocation.pk).created_at, revocation.created_at
            )

    def test_app_reads_of_appointments_and_revocations_are_requester_only(self):
        appointment = self.admitted()
        with use_operator(), _requester_principal(self.user.pk):
            revocation = self.revoke(appointment)
        for reader, expected in ((self.other, 0), (self.user, 1)):
            with self.subTest(reader=reader.email), self.app_as(reader):
                self.assertEqual(CompanyAppointment.objects.filter(pk=appointment.pk).count(), expected)
                self.assertEqual(CompanyAppointmentRevocation.objects.filter(pk=revocation.pk).count(), expected)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT count(*) FROM companies_companyappointment")
                    self.assertEqual(cursor.fetchone()[0], expected)
                    cursor.execute("SELECT count(*) FROM companies_companyappointmentrevocation")
                    self.assertEqual(cursor.fetchone()[0], expected)

    def test_admitted_request_reports_self_declared_company_provided_information(self):
        self.admitted()
        for revoked in (False, True):
            if revoked:
                revoke = self.client.post(f"{URL}{self.proposal.pk}/revoke/", {}, format="json")
                self.assertEqual(revoke.status_code, 200, revoke.content)
            with self.subTest(revoked=revoked):
                body = self.client.get(f"{URL}{self.proposal.pk}/").json()
                self.assertEqual((body["status"], body["verificationStatus"]), ("admitted", "self_declared"))
                self.assertIn("provided by the company", body["verificationMessage"])
                self.assertIn("not current" if revoked else "is current", body["verificationMessage"])
                self.assertNotIn("verified by ledova", body["verificationMessage"].casefold())
                self.assertEqual(body["appointment"]["status"], "revoked" if revoked else "active")

    def test_retained_request_receipt_stays_revoked_after_a_distinct_admin_reappoints_the_requester(self):
        self.proposal = self.submit(delegatable_capabilities=["admin"])
        declaration = {"declaration_version": DECLARATION_VERSION, "accept_declaration": True}
        invitations = "/api/v1/company-authority/invitations/"
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            admitted = self.client.post(f"{URL}{self.proposal.pk}/admit/", declaration, format="json")
        self.assertEqual(admitted.status_code, 200, admitted.content)
        initial_id = admitted.json()["appointment"]["uuid"]
        with use_operator():
            UserProfile.objects.filter(pk=self.other_profile.pk).update(is_id_verified=True)
            initial = CompanyAppointment.objects.get(pk=initial_id)
            initial_values = {field.attname: getattr(initial, field.attname) for field in initial._meta.fields}
            request_values = {
                field.attname: getattr(self.proposal, field.attname) for field in self.proposal._meta.fields
            }
            with self.proposal.file.open("rb") as retained_file:
                retained_bytes = retained_file.read()
        issued = self.client.post(
            invitations,
            {
                "company": str(self.company.pk),
                "inviter_appointment": initial_id,
                "idempotency_key": str(uuid4()),
                "capabilities": ["admin"],
                "delegatable_capabilities": ["admin"],
            },
            format="json",
        )
        self.assertEqual(issued.status_code, 201, issued.content)
        self.client.force_authenticate(self.other)
        administrator = self.client.post(
            f"{invitations}accept/", {**declaration, "code": issued.json()["code"]}, format="json"
        )
        self.assertEqual(administrator.status_code, 200, administrator.content)
        self.assertTrue(administrator.json()["isEffective"])
        self.client.force_authenticate(self.user)
        revoked = self.client.post(f"{URL}{self.proposal.pk}/revoke/", {}, format="json")
        self.assertEqual(revoked.status_code, 200, revoked.content)
        with use_operator():
            revocation = CompanyAppointmentRevocation.objects.get(appointment=initial)
            revocation_values = {field.attname: getattr(revocation, field.attname) for field in revocation._meta.fields}
            self.assertEqual(revocation.revoked_by_id, self.user.pk)
        self.client.force_authenticate(self.other)
        replacement = self.client.post(
            invitations,
            {
                "company": str(self.company.pk),
                "inviter_appointment": administrator.json()["uuid"],
                "idempotency_key": str(uuid4()),
                "capabilities": ["admin"],
            },
            format="json",
        )
        self.assertEqual(replacement.status_code, 201, replacement.content)
        self.client.force_authenticate(self.user)
        accepted = self.client.post(
            f"{invitations}accept/", {**declaration, "code": replacement.json()["code"]}, format="json"
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual((accepted.json()["status"], accepted.json()["source"]), ("active", "invitation"))
        self.assertTrue(accepted.json()["isEffective"])
        self.assertEqual(accepted.json()["capabilities"], ["admin"])
        self.assertNotEqual(accepted.json()["uuid"], initial_id)
        response = self.client.get(f"{URL}{self.proposal.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["verificationStatus"]), ("admitted", "self_declared"))
        self.assertEqual((body["appointment"]["uuid"], body["appointment"]["status"]), (initial_id, "revoked"))
        self.assertFalse(body["appointment"]["isEffective"])
        with use_operator():
            initial.refresh_from_db()
            revocation.refresh_from_db()
            self.proposal.refresh_from_db()
            self.assertEqual(
                {field.attname: getattr(initial, field.attname) for field in initial._meta.fields}, initial_values
            )
            self.assertEqual(
                {field.attname: getattr(revocation, field.attname) for field in revocation._meta.fields},
                revocation_values,
            )
            self.assertEqual(
                {field.attname: getattr(self.proposal, field.attname) for field in self.proposal._meta.fields},
                request_values,
            )
            with self.proposal.file.open("rb") as retained_file:
                self.assertEqual(retained_file.read(), retained_bytes)
        self.assertIn("not current", body["verificationMessage"])
