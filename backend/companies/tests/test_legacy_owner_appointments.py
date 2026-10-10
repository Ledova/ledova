import tempfile
from datetime import timedelta
from time import monotonic, sleep
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from companies.exceptions import AuthorityAdmissionConflictException
from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyCapability,
    CompanyLegacyOwnerSource,
    CompanyRegistryCheck,
    CompanyTeamInvitation,
    RegistryCheckPurpose,
)
from companies.services.authority import (
    DECLARATION_TEXT,
    DECLARATION_VERSION,
    admit_authority_request,
    has_company_capability,
)
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
)
from companies.services.registry import begin_registry_check, perform_registry_check
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests import test_team_invitations as invitation_cases
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    AuthorityRequestCases,
    authority_fixture,
    evidence,
)
from companies.tests.test_document_file_access import legacy_company_administrators
from companies.tests.test_team_invitations import raw_team_appointment
from operators.models import Operator
from shared.db import MIGRATE_ALIAS, atomic, current_alias, use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserProfile

APPOINTMENTS = "/api/v1/company-authority/appointments/"
INVITATIONS = "/api/v1/company-authority/invitations/"
APPOINTMENT = CompanyAppointment._meta.db_table
SOURCE = CompanyLegacyOwnerSource._meta.db_table
PROVENANCE = "companies.0019_legacy_owner_appointments"


class CompanyLegacyOwnerAppointmentTest(StubUploadDependencies, APITransactionTestCase):
    app_as = AuthorityRequestCases.app_as
    concurrent = invitation_cases.CompanyTeamInvitationTest.concurrent
    declaration = invitation_cases.CompanyTeamInvitationTest.declaration
    retained_history = invitation_cases.CompanyTeamInvitationTest.retained_history

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.owner, self.profile, self.company = authority_fixture("legacy-runtime", "114477880")
            self.other, self.other_profile, self.foreign_company = authority_fixture("legacy-foreign", "225588991")
            UserProfile.objects.filter(pk__in=[self.profile.pk, self.other_profile.pk]).update(is_id_verified=True)
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.proposal = self.submit()
        legacy_company_administrators(self.company, self.foreign_company, provenance=PROVENANCE)
        with use_operator():
            self.source = CompanyLegacyOwnerSource.objects.get(company=self.company)
            self.initial = CompanyAppointment.objects.get(legacy_owner=self.source)
        self.client.force_authenticate(self.owner)

    def submit(self, **changes):
        proposal, created = submit_authority_request(
            **{
                "requester": self.owner,
                "company_id": self.company.pk,
                "idempotency_key": uuid4(),
                "file": evidence(),
                "requested_capabilities": ["admin"],
                **changes,
            }
        )
        self.assertTrue(created)
        return proposal

    def issue(self, **changes):
        return issue_team_invitation(
            **{
                "requester": self.owner,
                "company_id": self.company.pk,
                "inviter_appointment_id": self.initial.pk,
                "idempotency_key": uuid4(),
                "capabilities": ["prepare"],
                "delegatable_capabilities": ["approve"],
                **changes,
            }
        )

    def accept(self, code, **changes):
        return accept_team_invitation(
            **{
                "requester": self.other,
                "code": code,
                "declaration_version": DECLARATION_VERSION,
                "accept_declaration": True,
                **changes,
            }
        )

    def appointment_values(self):
        return {
            **{field.attname: getattr(self.initial, field.attname) for field in self.initial._meta.fields},
            "uuid": uuid4(),
        }

    def legacy_history(self):
        with use_operator():
            sources = list(CompanyLegacyOwnerSource.objects.order_by("uuid").values())
        return self.retained_history(), sources

    def test_legacy_delegation_cannot_become_personal_authority_by_self_acceptance_at_api_or_raw_guard(self):
        invitation, code, _ = self.issue(capabilities=["approve"], delegatable_capabilities=[])
        before = self.legacy_history()
        response = self.client.post(f"{INVITATIONS}accept/", self.declaration(code), format="json")
        self.assertEqual(response.status_code, 400, response.content)
        with self.assertRaises(DatabaseError):
            raw_team_appointment(invitation=invitation, code=code, actor=self.owner, profile=self.profile)
        self.assertFalse(has_company_capability(requester=self.owner, company_id=self.company.pk, capability="approve"))
        self.assertEqual(self.legacy_history(), before)

    def test_legacy_root_blocks_distinct_inviter_overlap_until_revoked_without_reseeding_or_bootstrap(self):
        _, admin_code, _ = self.issue(capabilities=["admin"], delegatable_capabilities=list(CompanyCapability.values))
        admin = self.accept(admin_code)
        invitation, code, _ = self.issue(
            requester=self.other,
            inviter_appointment_id=admin.pk,
            capabilities=["approve"],
            delegatable_capabilities=[],
        )
        before = self.legacy_history()
        response = self.client.post(f"{INVITATIONS}accept/", self.declaration(code), format="json")
        self.assertEqual(response.status_code, 400, response.content)
        with self.assertRaises(DatabaseError):
            raw_team_appointment(invitation=invitation, code=code, actor=self.owner, profile=self.profile)
        self.assertEqual(self.legacy_history(), before)
        revoke_company_appointment(requester=self.other, appointment_id=self.initial.pk)
        replacement = self.accept(code, requester=self.owner)
        self.assertEqual((replacement.invitation_id, replacement.legacy_owner_id), (invitation.pk, None))
        self.assertTrue(has_company_capability(requester=self.owner, company_id=self.company.pk, capability="approve"))
        retained = self.legacy_history()
        self.assertEqual(self.accept(admin_code).pk, admin.pk)
        self.assertEqual(self.accept(code, requester=self.owner).pk, replacement.pk)
        with patch("companies.services.authority.begin_registry_check") as begin:
            with self.assertRaises(AuthorityAdmissionConflictException):
                admit_authority_request(
                    requester=self.owner,
                    request_id=self.proposal.pk,
                    declaration_version=DECLARATION_VERSION,
                    accept_declaration=True,
                )
            begin.assert_not_called()
        self.assertEqual(self.legacy_history(), retained)
        self.assertEqual(retained[1], before[1])

    def test_replaced_legacy_child_exact_old_code_retry_retains_revocation_and_new_scope(self):
        old_invitation, old_code, _ = self.issue(capabilities=["prepare"], delegatable_capabilities=[])
        original = self.accept(old_code)
        revoke_company_appointment(requester=self.other, appointment_id=original.pk)
        new_invitation, new_code, _ = self.issue(capabilities=["approve"], delegatable_capabilities=[])
        replacement = self.accept(new_code)
        retained = self.legacy_history()
        old = self.accept(old_code)
        self.assertEqual((old.pk, old.invitation_id, old.status), (original.pk, old_invitation.pk, "revoked"))
        self.assertEqual(self.accept(new_code).pk, replacement.pk)
        self.assertEqual(replacement.invitation_id, new_invitation.pk)
        self.assertEqual(self.legacy_history(), retained)

    def test_expired_legacy_child_allows_new_mandate_and_exact_old_retry_retains_actual_expiry(self):
        expiry = timezone.now() + timedelta(seconds=2)
        old_invitation, old_code, _ = self.issue(
            capabilities=["prepare"], delegatable_capabilities=[], appointment_expires_at=expiry
        )
        original = self.accept(old_code)
        limit = monotonic() + 5
        while timezone.now() <= expiry and monotonic() < limit:
            sleep(0.01)
        self.assertGreater(timezone.now(), expiry)
        new_invitation, new_code, _ = self.issue(capabilities=["approve"], delegatable_capabilities=[])
        replacement = self.accept(new_code)
        retained = self.legacy_history()
        old = self.accept(old_code)
        self.assertEqual((old.pk, old.invitation_id, old.status), (original.pk, old_invitation.pk, "expired"))
        self.assertEqual(self.accept(new_code).pk, replacement.pk)
        self.assertEqual(replacement.invitation_id, new_invitation.pk)
        self.assertEqual(self.legacy_history(), retained)

    def test_concurrent_distinct_legacy_invitation_codes_deliver_one_mandate_and_keep_exact_retries(self):
        first, first_code, _ = self.issue()
        second, second_code, _ = self.issue(capabilities=["approve"], delegatable_capabilities=[])
        results = self.concurrent([self.other, self.other], [first_code, second_code])
        self.assertEqual(sum(isinstance(result, tuple) for result in results), 1, results)
        self.assertIn(400, results)
        with use_operator():
            delivered = CompanyAppointment.objects.get(appointee=self.other, company=self.company)
        self.assertIn(delivered.invitation_id, (first.pk, second.pk))
        retained = self.legacy_history()
        for invitation, code in ((first, first_code), (second, second_code)):
            if invitation.pk == delivered.invitation_id:
                self.assertEqual(self.accept(code).pk, delivered.pk)
            else:
                with self.assertRaises(ValidationError):
                    self.accept(code)
        self.assertEqual(self.legacy_history(), retained)

    def test_only_personal_administration_is_granted_while_delegation_is_explicit_and_company_bound(self):
        self.assertEqual(self.initial.capabilities, ["admin"])
        self.assertEqual(self.initial.delegatable_capabilities, sorted(CompanyCapability.values))
        self.assertEqual(self.source.provenance, PROVENANCE)
        self.assertEqual((self.source.owner_id, self.source.owner_profile_id), (self.owner.pk, self.profile.pk))
        for capability in CompanyCapability.values:
            self.assertEqual(
                has_company_capability(requester=self.owner, company_id=self.company.pk, capability=capability),
                capability == "admin",
                capability,
            )
        self.assertFalse(
            has_company_capability(requester=self.owner, company_id=self.foreign_company.pk, capability="admin")
        )
        with use_operator():
            self.owner.refresh_from_db()
            self.company.refresh_from_db()
            self.assertFalse(self.owner.is_staff)
            self.assertFalse(self.owner.is_superuser)
            self.assertEqual(self.company.status, "draft")
            self.assertIsNone(self.company.registry_check_id)
            self.assertFalse(CompanyRegistryCheck.objects.exists())

    def test_live_account_email_profile_and_configured_identity_gate_every_new_effect(self):
        for model, identity, field in (
            (get_user_model(), self.owner.pk, "is_active"),
            (get_user_model(), self.owner.pk, "is_email_verified"),
            (UserProfile, self.profile.pk, "is_id_verified"),
        ):
            with self.subTest(field=field):
                with use_operator():
                    model.objects.filter(pk=identity).update(**{field: False})
                self.assertFalse(
                    has_company_capability(requester=self.owner, company_id=self.company.pk, capability="admin")
                )
                response = self.client.post(
                    INVITATIONS,
                    {
                        "company": str(self.company.pk),
                        "inviter_appointment": str(self.initial.pk),
                        "idempotency_key": str(uuid4()),
                        "capabilities": ["prepare"],
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, 400 if field == "is_id_verified" else 403, response.content)
                if field == "is_id_verified":
                    self.assertIn("no longer current", str(response.json()))
                with use_operator():
                    self.assertFalse(CompanyTeamInvitation.objects.exists())
                    model.objects.filter(pk=identity).update(**{field: True})
                self.assertTrue(
                    has_company_capability(requester=self.owner, company_id=self.company.pk, capability="admin")
                )
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
            Operator.objects.filter(pk=1).update(issuer_kyc_required=False)
        self.assertTrue(has_company_capability(requester=self.owner, company_id=self.company.pk, capability="admin"))
        self.assertTrue(self.issue()[2])

    def test_existing_legacy_root_refuses_bootstrap_before_any_provider_work_even_after_revocation(self):
        for revoked in (False, True):
            if revoked:
                revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
            with (
                self.subTest(revoked=revoked),
                patch("companies.services.authority.begin_registry_check") as begin,
                patch("companies.services.authority.perform_registry_check") as perform,
                patch("companies.services.registry.lookup_company") as lookup,
                self.assertRaises(AuthorityAdmissionConflictException),
            ):
                admit_authority_request(
                    requester=self.owner,
                    request_id=self.proposal.pk,
                    declaration_version=DECLARATION_VERSION,
                    accept_declaration=True,
                )
            begin.assert_not_called()
            perform.assert_not_called()
            lookup.assert_not_called()
        with use_operator():
            self.assertFalse(CompanyRegistryCheck.objects.exists())
            self.assertEqual(CompanyAppointment.objects.filter(company=self.company).count(), 1)

    def test_new_companies_and_changed_owners_never_receive_a_runtime_legacy_seed(self):
        with use_migrate():
            fresh = Company.objects.create(owner=self.owner, name="Post-upgrade company Pty Ltd", acn="336699002")
            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
        with use_operator():
            self.assertFalse(CompanyLegacyOwnerSource.objects.filter(company=fresh).exists())
            self.assertEqual(CompanyLegacyOwnerSource.objects.get(pk=self.source.pk).owner_id, self.owner.pk)
            self.assertFalse(CompanyAppointment.objects.filter(company=self.company, appointee=self.other).exists())
        self.assertTrue(has_company_capability(requester=self.owner, company_id=self.company.pk, capability="admin"))
        self.assertFalse(has_company_capability(requester=self.other, company_id=self.company.pk, capability="admin"))
        self.assertFalse(has_company_capability(requester=self.owner, company_id=fresh.pk, capability="admin"))
        proposal = self.submit(company_id=fresh.pk)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(fresh)):
            admitted = admit_authority_request(
                requester=self.owner,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        with (
            patch("companies.services.authority.begin_registry_check") as begin,
            patch("companies.services.authority.perform_registry_check") as perform,
        ):
            repeated = admit_authority_request(
                requester=self.owner,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        self.assertEqual(repeated.appointment.pk, admitted.appointment.pk)
        self.assertIsNone(admitted.appointment.legacy_owner_id)
        begin.assert_not_called()
        perform.assert_not_called()

    def test_expired_legacy_root_still_conflicts_before_provider_work(self):
        with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute(f"ALTER TABLE {APPOINTMENT} DISABLE TRIGGER companies_initial_appointment_identity")
            cursor.execute(
                f"UPDATE {APPOINTMENT} SET expires_at = %s WHERE uuid = %s",
                [timezone.now() - timedelta(days=1), self.initial.pk],
            )
            cursor.execute(f"ALTER TABLE {APPOINTMENT} ENABLE TRIGGER companies_initial_appointment_identity")
        with (
            patch("companies.services.authority.begin_registry_check") as begin,
            patch("companies.services.authority.perform_registry_check") as perform,
            self.assertRaises(AuthorityAdmissionConflictException),
        ):
            admit_authority_request(
                requester=self.owner,
                request_id=self.proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        begin.assert_not_called()
        perform.assert_not_called()

    def test_permanent_initial_root_unique_constraint_refuses_a_second_request_independently(self):
        with use_operator(), _requester_principal(self.owner.pk):
            check = begin_registry_check(self.company, RegistryCheckPurpose.AUTHORITY, self.owner)
            with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
                check = perform_registry_check(check)
        values = {
            **self.appointment_values(),
            "legacy_owner_id": None,
            "request_id": self.proposal.pk,
            "registry_check_id": check.pk,
            "declaration_version": DECLARATION_VERSION,
            "declaration_text": DECLARATION_TEXT,
        }
        for revoked in (False, True):
            if revoked:
                revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
            with (
                self.subTest(revoked=revoked),
                use_migrate(),
                self.assertRaisesMessage(DatabaseError, "companies_one_initial_appointment_per_company"),
                atomic(),
            ):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f"ALTER TABLE {APPOINTMENT} DISABLE TRIGGER companies_initial_appointment_identity")
                CompanyAppointment.objects.create(**values)

    def test_legacy_source_delegates_real_declared_child_without_cascading_parent_revocation(self):
        pending, pending_code, _ = self.issue()
        accepted, code, _ = self.issue(capabilities=["approve", "prepare"], delegatable_capabilities=[])
        child = self.accept(code)
        self.assertEqual(
            (child.invitation_id, child.request_id, child.legacy_owner_id, child.registry_check_id),
            (accepted.pk, None, None, None),
        )
        self.assertEqual((child.declaration_version, child.declaration_text), (DECLARATION_VERSION, DECLARATION_TEXT))
        self.assertTrue(has_company_capability(requester=self.other, company_id=self.company.pk, capability="approve"))
        revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
        self.assertTrue(has_company_capability(requester=self.other, company_id=self.company.pk, capability="approve"))
        self.assertEqual(self.accept(code).pk, child.pk)
        with self.assertRaises(ValidationError):
            self.accept(pending_code)
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.filter(invitation=pending).exists())
            self.assertFalse(CompanyRegistryCheck.objects.exists())

    def test_own_and_bounded_team_history_use_truthful_null_declaration_without_private_source_fields(self):
        own = self.client.get(APPOINTMENTS)
        self.assertEqual(own.status_code, 200, own.content)
        receipt = own.json()["results"][0]
        self.assertEqual(receipt["source"], "legacy_owner")
        self.assertIsNone(receipt["declarationVersion"])
        self.assertIsNone(receipt["declarationText"])
        for private in ("legacyOwner", "ownerProfile", "provenance", "requestDigest", "fileSha256", "personIdentity"):
            self.assertNotIn(private, receipt)
        team = self.client.get(f"{APPOINTMENTS}team/?company={self.company.pk}")
        self.assertEqual(team.status_code, 200, team.content)
        self.assertEqual(
            set(team.json()[0]),
            {
                "uuid",
                "company",
                "name",
                "email",
                "capabilities",
                "delegatableCapabilities",
                "expiresAt",
                "createdAt",
                "revokedAt",
                "status",
                "isEffective",
                "source",
            },
        )
        self.assertEqual(team.json()[0]["source"], "legacy_owner")
        self.assertEqual((team.json()[0]["name"], team.json()[0]["email"]), (self.profile.full_name, self.owner.email))
        self.client.force_authenticate(self.other)
        self.assertEqual(
            {row["uuid"] for row in self.client.get(APPOINTMENTS).json()["results"]},
            {str(CompanyAppointment.objects.using(MIGRATE_ALIAS).get(company=self.foreign_company).pk)},
        )
        foreign = self.client.get(f"{APPOINTMENTS}team/?company={self.company.pk}")
        missing = self.client.get(f"{APPOINTMENTS}team/?company={uuid4()}")
        self.assertEqual((foreign.status_code, foreign.content), (missing.status_code, missing.content))

    def test_current_admin_revoke_receipt_retains_first_actor_time_and_needs_no_last_admin_rule(self):
        _, code, _ = self.issue(capabilities=["admin"], delegatable_capabilities=[])
        child = self.accept(code)
        self.client.force_authenticate(self.other)
        response = self.client.post(f"{APPOINTMENTS}{self.initial.pk}/revoke/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["source"], response.json()["status"]), ("legacy_owner", "revoked"))
        self.assertIsNone(response.json()["declarationVersion"])
        self.assertIsNone(response.json()["declarationText"])
        with use_operator():
            first = CompanyAppointmentRevocation.objects.get(appointment=self.initial)
            values = {field.attname: getattr(first, field.attname) for field in first._meta.fields}
            self.assertEqual(first.revoked_by_id, self.other.pk)
        self.client.force_authenticate(self.owner)
        repeated = self.client.post(f"{APPOINTMENTS}{self.initial.pk}/revoke/", {}, format="json")
        self.assertEqual(repeated.json(), response.json())
        with use_operator():
            retained = CompanyAppointmentRevocation.objects.get(appointment=self.initial)
            self.assertEqual(
                {field.attname: getattr(retained, field.attname) for field in retained._meta.fields}, values
            )
        revoke_company_appointment(requester=self.other, appointment_id=child.pk)
        self.assertFalse(has_company_capability(requester=self.other, company_id=self.company.pk, capability="admin"))

    def test_self_revoke_survives_lost_identity_but_foreign_and_missing_targets_match(self):
        self.client.force_authenticate(self.other)
        foreign = self.client.post(f"{APPOINTMENTS}{self.initial.pk}/revoke/", {}, format="json")
        missing = self.client.post(f"{APPOINTMENTS}{uuid4()}/revoke/", {}, format="json")
        self.assertEqual((foreign.status_code, foreign.content), (missing.status_code, missing.content))
        with use_operator():
            UserProfile.objects.filter(pk=self.profile.pk).update(is_id_verified=False)
        self.client.force_authenticate(self.owner)
        response = self.client.post(f"{APPOINTMENTS}{self.initial.pk}/revoke/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "revoked")
        self.assertFalse(response.json()["isEffective"])

    def test_source_writes_and_legacy_appointment_replay_are_refused_for_every_runtime_principal(self):
        source_values = {field.attname: getattr(self.source, field.attname) for field in self.source._meta.fields}
        source_values.update(uuid=uuid4())
        for role in (use_migrate, use_operator):
            for actor in (self.owner, self.other):
                with self.subTest(role=role.__name__, actor=actor.pk), role(), _requester_principal(actor.pk):
                    with self.assertRaisesMessage(DatabaseError, "Retain immutable legacy owner sources"), atomic():
                        CompanyLegacyOwnerSource.objects.create(**source_values)
                    with self.assertRaisesMessage(DatabaseError, "Retain immutable legacy owner sources"), atomic():
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute(
                                f"INSERT INTO {SOURCE} "
                                "(uuid, created_at, updated_at, company_id, owner_id, owner_profile_id, provenance) "
                                "VALUES (%s, statement_timestamp(), statement_timestamp(), %s, %s, %s, %s)",
                                [uuid4(), self.company.pk, actor.pk, self.profile.pk, PROVENANCE],
                            )
                    with self.assertRaisesMessage(DatabaseError, "Legacy owner appointments"), atomic():
                        CompanyAppointment.objects.create(**self.appointment_values())
                    for statement in (
                        f"UPDATE {SOURCE} SET provenance = provenance WHERE uuid = %s",
                        f"DELETE FROM {SOURCE} WHERE uuid = %s",
                    ):
                        with (
                            self.subTest(statement=statement),
                            self.assertRaisesMessage(DatabaseError, "Retain immutable legacy owner sources"),
                            atomic(),
                        ):
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute(statement, [self.source.pk])
        with self.app_as(self.owner):
            self.assertFalse(CompanyLegacyOwnerSource.objects.exists())
            with self.assertRaises(DatabaseError), atomic():
                CompanyLegacyOwnerSource.objects.create(**source_values)
            with self.assertRaises(DatabaseError), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        f"INSERT INTO {SOURCE} "
                        "(uuid, created_at, updated_at, company_id, owner_id, owner_profile_id, provenance) "
                        "VALUES (%s, statement_timestamp(), statement_timestamp(), %s, %s, %s, %s)",
                        [uuid4(), self.company.pk, self.owner.pk, self.profile.pk, PROVENANCE],
                    )
            with self.assertRaises(DatabaseError), atomic():
                CompanyAppointment.objects.create(**self.appointment_values())
            for statement in (
                f"UPDATE {SOURCE} SET provenance = provenance WHERE uuid = %s",
                f"DELETE FROM {SOURCE} WHERE uuid = %s",
            ):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(statement, [self.source.pk])
                    self.assertEqual(cursor.rowcount, 0)
        with use_operator():
            self.assertEqual(CompanyLegacyOwnerSource.objects.get(pk=self.source.pk).provenance, PROVENANCE)

    def test_exact_source_and_declaration_shape_constraints_refuse_raw_forgery_independently(self):
        for changed in (
            {"legacy_owner_id": None},
            {"request_id": self.proposal.pk},
            {"invitation_id": uuid4()},
            {"registry_check_id": uuid4()},
            {"declaration_version": DECLARATION_VERSION},
            {"declaration_text": DECLARATION_TEXT},
            {
                "legacy_owner_id": None,
                "request_id": self.proposal.pk,
                "declaration_version": DECLARATION_VERSION,
                "declaration_text": DECLARATION_TEXT,
            },
            {"legacy_owner_id": None, "invitation_id": uuid4()},
        ):
            with (
                self.subTest(changed=changed),
                use_migrate(),
                self.assertRaisesMessage(DatabaseError, "companies_appointment_exact_source"),
                atomic(),
            ):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(f"ALTER TABLE {APPOINTMENT} DISABLE TRIGGER companies_initial_appointment_identity")
                    cursor.execute(f"DELETE FROM {APPOINTMENT} WHERE uuid = %s", [self.initial.pk])
                CompanyAppointment.objects.create(**{**self.appointment_values(), **changed})
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.get(pk=self.initial.pk).legacy_owner_id, self.source.pk)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT tgenabled FROM pg_trigger WHERE tgname = 'companies_initial_appointment_identity'"
                )
                self.assertEqual(cursor.fetchone()[0], "O")
