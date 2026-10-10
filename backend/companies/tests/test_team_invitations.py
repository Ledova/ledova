import hashlib
import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from time import monotonic, sleep
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from drf_spectacular.generators import SchemaGenerator
from rest_framework.exceptions import APIException
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyAuthorityRequest,
    CompanyCapability,
    CompanyRegistryCheck,
    CompanyTeamInvitation,
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
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    AuthorityRequestCases,
    authority_fixture,
    evidence,
)
from operators.models import Operator
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserProfile

INVITATIONS = "/api/v1/company-authority/invitations/"
APPOINTMENTS = "/api/v1/company-authority/appointments/"


def raw_team_appointment(*, invitation, code, actor, profile):
    identifier = uuid4()
    with use_operator(), _requester_principal(actor.pk), atomic():
        now = timezone.now()
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT set_config('app.team_invitation_code', %s, true)", [code])
            cursor.execute(
                "INSERT INTO companies_companyappointment "
                "(uuid, created_at, updated_at, company_id, appointee_id, appointee_profile_id, "
                "invitation_id, capabilities, delegatable_capabilities, expires_at, "
                "declaration_version, declaration_text) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s, %s)",
                [
                    identifier,
                    now,
                    now,
                    invitation.company_id,
                    actor.pk,
                    profile.pk,
                    invitation.pk,
                    json.dumps(invitation.capabilities),
                    json.dumps(invitation.delegatable_capabilities),
                    invitation.appointment_expires_at,
                    DECLARATION_VERSION,
                    DECLARATION_TEXT,
                ],
            )
    return identifier


class CompanyTeamInvitationFixtures(StubUploadDependencies):
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.owner, self.owner_profile, self.company = authority_fixture("inviter", "114477880")
            self.invitee, self.invitee_profile, self.foreign_company = authority_fixture("invitee", "225588991")
            self.other, self.other_profile, self.other_company = authority_fixture("other-invitee", "336699002")
            UserProfile.objects.filter(
                pk__in=[self.owner_profile.pk, self.invitee_profile.pk, self.other_profile.pk]
            ).update(is_id_verified=True)
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        proposal, _ = submit_authority_request(
            requester=self.owner,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
        )
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            admitted = admit_authority_request(
                requester=self.owner,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        self.initial = admitted.appointment
        self.key = uuid4()
        self.client.force_authenticate(self.owner)

    def payload(self, **changes):
        return {
            "company": str(self.company.pk),
            "inviter_appointment": str(self.initial.pk),
            "idempotency_key": str(self.key),
            "capabilities": ["prepare"],
            "delegatable_capabilities": ["approve"],
            **changes,
        }

    def issue(self, **changes):
        return self.client.post(INVITATIONS, self.payload(**changes), format="json")

    def declaration(self, code, **changes):
        return {"code": code, "declaration_version": DECLARATION_VERSION, "accept_declaration": True, **changes}

    def accept(self, code, actor=None, **changes):
        self.client.force_authenticate(actor or self.invitee)
        return self.client.post(f"{INVITATIONS}accept/", self.declaration(code, **changes), format="json")

    def issue_and_accept(self, **changes):
        issued = self.issue(**changes)
        self.assertEqual(issued.status_code, 201, issued.content)
        accepted = self.accept(issued.json()["code"])
        self.assertEqual(accepted.status_code, 200, accepted.content)
        with use_operator():
            return issued, CompanyAppointment.objects.get(pk=accepted.json()["uuid"])

    def raw_acceptance(self, issued, actor, profile):
        with use_operator():
            invitation = CompanyTeamInvitation.objects.get(pk=issued.json()["uuid"])
        return raw_team_appointment(invitation=invitation, code=issued.json()["code"], actor=actor, profile=profile)

    def retained_history(self):
        with use_operator():
            records = {
                model._meta.label: list(model.objects.order_by("uuid").values())
                for model in (
                    CompanyAuthorityRequest,
                    CompanyRegistryCheck,
                    CompanyAppointment,
                    CompanyAppointmentRevocation,
                    CompanyTeamInvitation,
                )
            }
            files = {}
            for proposal in CompanyAuthorityRequest.objects.all():
                with proposal.file.open("rb") as retained:
                    files[str(proposal.pk)] = retained.read()
        return records, files

    def concurrent(self, actors, code):
        barrier = Barrier(len(actors))
        codes = code if isinstance(code, (list, tuple)) else [code] * len(actors)

        def consume(arguments):
            actor, invitation_code = arguments
            try:
                barrier.wait(timeout=20)
                appointment = accept_team_invitation(requester=actor, **self.declaration(invitation_code))
                return str(appointment.pk), appointment.appointee_id
            except APIException as error:
                return error.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(actors)) as pool:
            return list(pool.map(consume, zip(actors, codes)))


class CompanyTeamInvitationTest(CompanyTeamInvitationFixtures, APITransactionTestCase):
    def test_self_acceptance_cannot_convert_delegatable_approve_into_personal_authority(self):
        _, delegated = self.issue_and_accept()
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        issued = self.issue(
            inviter_appointment=str(delegated.pk),
            idempotency_key=str(uuid4()),
            capabilities=["approve"],
            delegatable_capabilities=[],
        )
        self.assertEqual(issued.status_code, 201, issued.content)
        history = self.retained_history()
        response = self.accept(issued.json()["code"])
        with use_operator():
            effects = list(
                CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).values(
                    "appointee_id", "capabilities", "delegatable_capabilities"
                )
            )
        self.assertEqual((response.status_code, effects), (400, []))
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        self.assertEqual(self.retained_history(), history)

    def test_distinct_invitation_cannot_add_an_overlapping_live_appointment_for_the_same_person_and_company(self):
        self.issue_and_accept()
        self.client.force_authenticate(self.owner)
        issued = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual(issued.status_code, 201, issued.content)
        history = self.retained_history()
        response = self.accept(issued.json()["code"])
        with use_operator():
            effects = list(
                CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).values(
                    "appointee_id", "capabilities", "delegatable_capabilities"
                )
            )
        self.assertEqual((response.status_code, effects), (400, []))
        self.assertEqual(self.retained_history(), history)

    def test_raw_exact_code_cannot_convert_the_inviters_delegatable_approve_into_personal_authority(self):
        _, delegated = self.issue_and_accept()
        issued = self.issue(
            inviter_appointment=str(delegated.pk),
            idempotency_key=str(uuid4()),
            capabilities=["approve"],
            delegatable_capabilities=[],
        )
        self.assertEqual(issued.status_code, 201, issued.content)
        history = self.retained_history()
        refused = False
        try:
            self.raw_acceptance(issued, self.invitee, self.invitee_profile)
        except DatabaseError:
            refused = True
        with use_operator():
            effects = list(
                CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).values(
                    "appointee_id", "capabilities", "delegatable_capabilities"
                )
            )
        self.assertEqual((refused, effects), (True, []))
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        self.assertEqual(self.retained_history(), history)

    def test_raw_exact_code_cannot_add_an_overlapping_live_appointment_for_the_same_person_and_company(self):
        self.issue_and_accept()
        self.client.force_authenticate(self.owner)
        issued = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual(issued.status_code, 201, issued.content)
        history = self.retained_history()
        refused = False
        try:
            self.raw_acceptance(issued, self.invitee, self.invitee_profile)
        except DatabaseError:
            refused = True
        with use_operator():
            effects = list(
                CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).values(
                    "appointee_id", "capabilities", "delegatable_capabilities"
                )
            )
        self.assertEqual((refused, effects), (True, []))
        self.assertEqual(self.retained_history(), history)

    def test_distinct_people_and_companies_receive_separate_exact_mandates(self):
        _, first = self.issue_and_accept()
        self.client.force_authenticate(self.owner)
        second = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual(second.status_code, 201, second.content)
        self.assertEqual(self.accept(second.json()["code"], actor=self.other).status_code, 200)
        proposal, _ = submit_authority_request(
            requester=self.other,
            company_id=self.other_company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
        )
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.other_company)):
            administrator = admit_authority_request(
                requester=self.other,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment
        self.client.force_authenticate(self.other)
        foreign = self.issue(
            company=str(self.other_company.pk),
            inviter_appointment=str(administrator.pk),
            idempotency_key=str(uuid4()),
            capabilities=["approve"],
            delegatable_capabilities=[],
        )
        self.assertEqual(foreign.status_code, 201, foreign.content)
        accepted = self.accept(foreign.json()["code"])
        self.assertEqual(accepted.status_code, 200, accepted.content)
        with use_operator():
            self.assertEqual(
                set(CompanyAppointment.objects.filter(appointee=self.invitee).values_list("company_id", flat=True)),
                {self.company.pk, self.other_company.pk},
            )
            self.assertEqual(
                CompanyAppointment.objects.filter(appointee=self.invitee, company=self.company).get(), first
            )
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        self.assertTrue(
            has_company_capability(requester=self.invitee, company_id=self.other_company.pk, capability="approve")
        )

    def test_new_appointment_after_revocation_keeps_old_code_retry_revoked_without_recreating_authority(self):
        issued, first = self.issue_and_accept()
        response = self.client.post(f"{APPOINTMENTS}{first.pk}/revoke/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_authenticate(self.owner)
        replacement = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual(replacement.status_code, 201, replacement.content)
        accepted = self.accept(replacement.json()["code"])
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertNotEqual(accepted.json()["uuid"], str(first.pk))
        revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
        history = self.retained_history()
        retained = self.accept(issued.json()["code"])
        self.assertEqual(retained.status_code, 200, retained.content)
        self.assertEqual(
            (retained.json()["uuid"], retained.json()["status"], retained.json()["isEffective"]),
            (str(first.pk), "revoked", False),
        )
        self.assertEqual(self.accept(replacement.json()["code"]).json()["uuid"], accepted.json()["uuid"])
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="prepare")
        )
        self.assertTrue(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        self.assertEqual(self.retained_history(), history)

    def test_new_appointment_after_actual_expiry_keeps_old_code_retry_expired_without_recreating_authority(self):
        expires = timezone.now() + timedelta(seconds=2)
        issued, first = self.issue_and_accept(appointment_expires_at=expires.isoformat())
        limit = monotonic() + 5
        while timezone.now() <= expires and monotonic() < limit:
            sleep(0.01)
        self.assertGreater(timezone.now(), expires)
        self.client.force_authenticate(self.owner)
        replacement = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual(replacement.status_code, 201, replacement.content)
        accepted = self.accept(replacement.json()["code"])
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertNotEqual(accepted.json()["uuid"], str(first.pk))
        history = self.retained_history()
        retained = self.accept(issued.json()["code"])
        self.assertEqual(retained.status_code, 200, retained.content)
        self.assertEqual(
            (retained.json()["uuid"], retained.json()["status"], retained.json()["isEffective"]),
            (str(first.pk), "expired", False),
        )
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="prepare")
        )
        self.assertTrue(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        self.assertEqual(self.retained_history(), history)

    def test_live_mandate_remains_recorded_while_identity_temporarily_makes_it_ineffective(self):
        self.issue_and_accept()
        self.client.force_authenticate(self.owner)
        issued = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual(issued.status_code, 201, issued.content)
        with use_operator():
            UserProfile.objects.filter(pk=self.invitee_profile.pk).update(is_id_verified=False)
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="prepare")
        )
        history = self.retained_history()
        response = self.accept(issued.json()["code"])
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("code", response.json())
        self.assertEqual(self.retained_history(), history)
        with use_operator():
            UserProfile.objects.filter(pk=self.invitee_profile.pk).update(is_id_verified=True)
        self.assertEqual(self.accept(issued.json()["code"]).status_code, 400)
        self.assertEqual(self.retained_history(), history)

    def test_issue_displays_code_once_keeps_only_hash_and_returns_retained_identical_retry(self):
        issued = self.issue()
        self.assertEqual(issued.status_code, 201, issued.content)
        body = issued.json()
        self.assertEqual(len(body["code"]), 43)
        self.assertEqual(issued["Cache-Control"], "private, no-store")
        with use_operator():
            invitation = CompanyTeamInvitation.objects.get(pk=body["uuid"])
            self.assertEqual(invitation.code_sha256, hashlib.sha256(body["code"].encode()).hexdigest())
            self.assertEqual(
                (invitation.inviter_id, invitation.inviter_appointment_id), (self.owner.pk, self.initial.pk)
            )
            self.assertLess(abs((invitation.acceptance_deadline - timezone.now()).total_seconds() - 7 * 86400), 20)
        retry = self.issue()
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json(), {**body, "code": None})
        listing = self.client.get(INVITATIONS).json()["results"]
        self.assertEqual(listing, [{key: value for key, value in body.items() if key != "code"}])
        self.assertNotIn("codeSha256", listing[0])
        self.assertNotIn(body["code"], str(listing))
        with use_operator():
            self.assertEqual(CompanyTeamInvitation.objects.count(), 1)

    def test_changed_issuance_retry_conflicts_without_regenerating_code_or_terms(self):
        issued = self.issue()
        self.assertEqual(issued.status_code, 201, issued.content)
        for changes in (
            {"capabilities": ["approve"]},
            {"delegatable_capabilities": []},
            {"acceptance_deadline": (timezone.now() + timedelta(days=2)).isoformat()},
            {"appointment_expires_at": (timezone.now() + timedelta(days=3)).isoformat()},
        ):
            with self.subTest(changes=changes):
                response = self.issue(**changes)
                self.assertEqual(response.status_code, 409, response.content)
        with use_operator():
            self.assertEqual(CompanyTeamInvitation.objects.count(), 1)

    def test_scope_bounds_deadlines_duplicates_unknown_fields_and_empty_grants_are_refused(self):
        for changes in (
            {"capabilities": [], "delegatable_capabilities": []},
            {"capabilities": ["prepare", "prepare"]},
            {"capabilities": ["superuser"]},
            {"capabilities": None},
            {"delegatable_capabilities": {}},
            {"acceptance_deadline": (timezone.now() - timedelta(seconds=1)).isoformat()},
            {"acceptance_deadline": (timezone.now() + timedelta(days=31)).isoformat()},
            {"appointment_expires_at": (timezone.now() - timedelta(seconds=1)).isoformat()},
            {"inviter": self.other.pk},
            {"code": "owned-code"},
        ):
            with self.subTest(changes=changes):
                response = self.issue(**changes)
                self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(CompanyTeamInvitation.objects.exists())

    def test_invitation_is_inviter_private_and_foreign_references_match_missing_for_staff_and_shared_owner(self):
        self.assertEqual(self.issue().status_code, 201)
        for staff, superuser in ((False, False), (True, False), (True, True)):
            with use_operator():
                get_user_model().objects.filter(pk=self.other.pk).update(is_staff=staff, is_superuser=superuser)
                self.other.refresh_from_db()
            with use_migrate():
                Company.objects.filter(pk=self.company.pk).update(owner=self.other)
            self.client.force_authenticate(self.other)
            self.assertEqual(self.client.get(INVITATIONS).json()["results"], [])
            self.assertEqual(self.client.get(APPOINTMENTS).json()["results"], [])
            foreign = self.issue()
            missing = self.issue(inviter_appointment=str(uuid4()))
            self.assertEqual((foreign.status_code, foreign.content), (missing.status_code, missing.content))
            self.assertEqual(foreign.status_code, 404)
            self.assertEqual(self.client.get(f"{APPOINTMENTS}team/?company={self.company.pk}").status_code, 404)
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.issue(idempotency_key=str(uuid4()), company=str(self.foreign_company.pk)).status_code, 404
        )

    def test_acceptance_records_actual_appointee_exact_terms_and_prepare_only_effectiveness(self):
        issued, appointment = self.issue_and_accept()
        self.assertEqual(
            (appointment.appointee_id, appointment.appointee_profile_id), (self.invitee.pk, self.invitee_profile.pk)
        )
        self.assertEqual(str(appointment.invitation_id), issued.json()["uuid"])
        self.assertIsNone(appointment.request_id)
        self.assertIsNone(appointment.registry_check_id)
        self.assertEqual(appointment.declaration_text, DECLARATION_TEXT)
        own = self.client.get(APPOINTMENTS)
        self.assertEqual(own.status_code, 200, own.content)
        record = own.json()["results"][0]
        self.assertTrue(record["isEffective"])
        self.assertEqual(record["source"], "invitation")
        self.assertEqual(record["companyName"], self.company.name)
        self.assertEqual(record["capabilities"], ["prepare"])
        self.assertNotIn("request", record)
        self.assertNotIn("fileSha256", record)
        self.assertTrue(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="prepare")
        )
        for capability in ("admin", "approve", "apply", "finance"):
            self.assertFalse(
                has_company_capability(requester=self.invitee, company_id=self.company.pk, capability=capability)
            )
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.foreign_company.pk, capability="prepare")
        )
        self.assertEqual(self.client.get(INVITATIONS).json()["results"], [])
        self.client.force_authenticate(self.owner)
        self.assertIsNotNone(self.client.get(INVITATIONS).json()["results"][0]["acceptedAt"])

    def test_acceptance_requires_exact_declaration_known_code_current_identity_and_own_profile(self):
        issued = self.issue()
        code = issued.json()["code"]
        self.client.force_authenticate(self.invitee)
        for changes in (
            {"declaration_version": "old"},
            {"accept_declaration": False},
            {"accept_declaration": "true"},
            {"capabilities": ["admin"]},
            {"appointee": self.other.pk},
            {"declaration_text": "changed"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.accept(code, **changes).status_code, 400)
        self.assertEqual(self.accept("unknown").status_code, 400)
        self.assertEqual(self.accept("a" * 43).status_code, 404)
        with use_operator():
            UserProfile.objects.filter(pk=self.invitee_profile.pk).update(is_id_verified=False)
        self.assertEqual(self.accept(code).status_code, 400)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            operator = Operator.get()
            operator.issuer_kyc_required = False
            operator.save(update_fields=["issuer_kyc_required"])
        self.assertEqual(self.accept(code).status_code, 200)

    def test_acceptance_retries_retain_same_appointment_and_different_actor_cannot_consume_code(self):
        issued, appointment = self.issue_and_accept()
        code = issued.json()["code"]
        first = self.accept(code)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(self.accept(code).json(), first.json())
        self.assertEqual(self.accept(code, actor=self.other).status_code, 400)
        revoke_company_appointment(requester=self.invitee, appointment_id=appointment.pk)
        retained = self.accept(code)
        self.assertEqual(retained.status_code, 200, retained.content)
        self.assertEqual(retained.json()["status"], "revoked")
        self.assertFalse(retained.json()["isEffective"])
        self.assertEqual(retained.json()["uuid"], str(appointment.pk))
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 2)

    def test_revoked_inviter_blocks_pending_acceptance_but_does_not_revoke_delivered_child(self):
        issued, child = self.issue_and_accept()
        self.client.force_authenticate(self.owner)
        pending = self.issue(idempotency_key=str(uuid4()))
        self.assertEqual(pending.status_code, 201, pending.content)
        revoke_company_appointment(requester=self.owner, appointment_id=self.initial.pk)
        self.assertEqual(self.accept(pending.json()["code"]).status_code, 400)
        self.assertTrue(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="prepare")
        )
        self.assertEqual(self.accept(issued.json()["code"]).json()["uuid"], str(child.pk))
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.issue(idempotency_key=str(uuid4())).status_code, 400)

    def test_current_inviter_account_profile_and_configured_policy_are_rechecked_before_new_effect(self):
        for kind in ("is_active", "is_email_verified", "identity"):
            issued = self.issue(idempotency_key=str(uuid4()))
            self.assertEqual(issued.status_code, 201, issued.content)
            with use_operator():
                if kind == "identity":
                    UserProfile.objects.filter(pk=self.owner_profile.pk).update(is_id_verified=False)
                else:
                    get_user_model().objects.filter(pk=self.owner.pk).update(**{kind: False})
            self.assertEqual(self.accept(issued.json()["code"]).status_code, 400)
            with use_operator():
                if kind == "identity":
                    UserProfile.objects.filter(pk=self.owner_profile.pk).update(is_id_verified=True)
                else:
                    get_user_model().objects.filter(pk=self.owner.pk).update(**{kind: True})
                self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.client.force_authenticate(self.owner)

    def test_delegation_uses_explicit_envelope_without_granting_personal_approve_and_admin_changes_require_admin(self):
        issued, child = self.issue_and_accept(delegatable_capabilities=["admin", "approve"])
        self.assertEqual(child.capabilities, ["prepare"])
        response = self.issue(
            inviter_appointment=str(child.pk),
            idempotency_key=str(uuid4()),
            capabilities=["approve"],
            delegatable_capabilities=[],
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(
            has_company_capability(requester=self.invitee, company_id=self.company.pk, capability="approve")
        )
        self.assertEqual(
            self.issue(
                inviter_appointment=str(child.pk), idempotency_key=str(uuid4()), capabilities=["apply"]
            ).status_code,
            400,
        )
        self.assertEqual(
            self.issue(
                inviter_appointment=str(child.pk),
                idempotency_key=str(uuid4()),
                capabilities=["admin"],
                delegatable_capabilities=[],
            ).status_code,
            404,
        )
        self.client.force_authenticate(self.owner)
        administrator = self.issue(idempotency_key=str(uuid4()), capabilities=["admin"], delegatable_capabilities=[])
        self.assertEqual(self.accept(administrator.json()["code"], actor=self.other).status_code, 200)

    def test_team_read_requires_current_admin_and_contains_only_permitted_account_and_scope_fields(self):
        self.issue_and_accept()
        team_url = f"{APPOINTMENTS}team/?company={self.company.pk}"
        self.assertEqual(self.client.get(team_url).status_code, 404)
        self.client.force_authenticate(self.owner)
        response = self.client.get(team_url)
        self.assertEqual(response.status_code, 200, response.content)
        records = response.json()
        self.assertEqual(len(records), 2)
        expected = {
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
        }
        for record in records:
            self.assertEqual(set(record), expected)
        self.assertEqual({record["email"] for record in records}, {self.owner.email, self.invitee.email})
        self.assertEqual(self.client.get(f"{team_url}&ordering=name").status_code, 400)
        document = SchemaGenerator().get_schema(request=None, public=True)
        parameters = document["paths"][f"{APPOINTMENTS}team/"]["get"]["parameters"]
        self.assertEqual({parameter["name"] for parameter in parameters if parameter["in"] == "query"}, {"company"})
        company_parameter = next(parameter for parameter in parameters if parameter["name"] == "company")
        self.assertTrue(company_parameter["required"])
        self.assertEqual(company_parameter["schema"], {"type": "string", "format": "uuid"})
        self.assertEqual(self.client.get(f"{APPOINTMENTS}team/?company={self.foreign_company.pk}").status_code, 404)
        with use_operator():
            UserProfile.objects.filter(pk=self.owner_profile.pk).update(is_id_verified=False)
        self.assertEqual(self.client.get(team_url).status_code, 404)

    def test_current_admin_can_revoke_initial_and_other_admin_without_last_admin_rule(self):
        issued, appointed = self.issue_and_accept(capabilities=["admin"], delegatable_capabilities=[])
        response = self.client.post(f"{APPOINTMENTS}{self.initial.pk}/revoke/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "revoked")
        self.assertFalse(has_company_capability(requester=self.owner, company_id=self.company.pk, capability="admin"))
        with use_operator():
            self.assertEqual(
                CompanyAppointmentRevocation.objects.get(appointment=self.initial).revoked_by_id, self.invitee.pk
            )
        self.assertEqual(self.client.post(f"{APPOINTMENTS}{appointed.pk}/revoke/", {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"{APPOINTMENTS}{appointed.pk}/revoke/", {}, format="json").status_code, 200)
        self.assertEqual(self.accept(issued.json()["code"]).json()["status"], "revoked")

    def test_nonadmin_foreign_and_staff_cannot_revoke_but_self_revocation_survives_lost_identity(self):
        _, appointed = self.issue_and_accept()
        url = f"{APPOINTMENTS}{self.initial.pk}/revoke/"
        foreign = self.client.post(url, {}, format="json")
        missing = self.client.post(f"{APPOINTMENTS}{uuid4()}/revoke/", {}, format="json")
        self.assertEqual((foreign.status_code, foreign.content), (missing.status_code, missing.content))
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(
            self.client.post(
                f"{APPOINTMENTS}{appointed.pk}/revoke/", {"revoked_by": self.owner.pk}, format="json"
            ).status_code,
            400,
        )
        with use_operator():
            UserProfile.objects.filter(pk=self.invitee_profile.pk).update(is_id_verified=False)
        response = self.client.post(f"{APPOINTMENTS}{appointed.pk}/revoke/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["isEffective"])

    def test_concurrent_distinct_codes_for_the_same_person_deliver_one_live_appointment(self):
        first = self.issue()
        second = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual((first.status_code, second.status_code), (201, 201))
        results = self.concurrent([self.invitee, self.invitee], [first.json()["code"], second.json()["code"]])
        self.assertEqual(sum(isinstance(result, tuple) for result in results), 1, results)
        self.assertIn(400, results)
        with use_operator():
            delivered = CompanyAppointment.objects.get(appointee=self.invitee, company=self.company)
            self.assertIn(str(delivered.invitation_id), [first.json()["uuid"], second.json()["uuid"]])
        history = self.retained_history()
        for index, result in enumerate(results):
            issued = (first, second)[index]
            response = self.accept(issued.json()["code"])
            self.assertEqual(response.status_code, 200 if isinstance(result, tuple) else 400)
            if isinstance(result, tuple):
                self.assertEqual(response.json()["uuid"], str(delivered.pk))
        self.assertEqual(self.retained_history(), history)

    def test_concurrent_raw_distinct_code_inserts_for_the_same_person_deliver_one_live_appointment(self):
        first = self.issue()
        second = self.issue(idempotency_key=str(uuid4()), capabilities=["approve"], delegatable_capabilities=[])
        self.assertEqual((first.status_code, second.status_code), (201, 201))
        barrier = Barrier(2)

        def consume(issued):
            try:
                barrier.wait(timeout=20)
                return self.raw_acceptance(issued, self.invitee, self.invitee_profile)
            except DatabaseError as error:
                return error
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(consume, [first, second]))
        self.assertEqual(sum(isinstance(result, DatabaseError) for result in results), 1, results)
        error = next(result for result in results if isinstance(result, DatabaseError))
        self.assertIn("Appointment requires the exact current invitation", str(error))
        with use_operator():
            delivered = CompanyAppointment.objects.get(appointee=self.invitee, company=self.company)
            self.assertIn(delivered.pk, results)
        history = self.retained_history()
        for issued in (first, second):
            response = self.accept(issued.json()["code"])
            self.assertEqual(
                response.status_code, 200 if issued.json()["uuid"] == str(delivered.invitation_id) else 400
            )
        self.assertEqual(self.retained_history(), history)

    def test_concurrent_same_actor_acceptance_returns_one_effect(self):
        issued = self.issue()
        results = self.concurrent([self.invitee, self.invitee], issued.json()["code"])
        self.assertEqual(results[0], results[1])
        self.assertIsInstance(results[0], tuple)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).count(), 1)

    def test_concurrent_different_actors_consume_only_one_invitation(self):
        issued = self.issue()
        results = self.concurrent([self.invitee, self.other], issued.json()["code"])
        self.assertEqual(sum(isinstance(value, tuple) for value in results), 1, results)
        self.assertIn(400, results)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).count(), 1)

    def test_invitation_issuance_and_authority_submission_share_company_first_lock_order(self):
        company_locked = Event()
        submission_waiting = Event()

        def issue_after_company_lock(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if 'FROM "companies_company"' in sql and "FOR UPDATE" in sql:
                company_locked.set()
                self.assertTrue(submission_waiting.wait(timeout=5))
            return result

        def submit_at_company_lock(execute, sql, params, many, context):
            if 'FROM "companies_company"' in sql and "FOR UPDATE" in sql:
                submission_waiting.set()
            return execute(sql, params, many, context)

        def run(wrapper, operation):
            try:
                with use_operator():
                    connection = connections[current_alias()]
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT set_config('lock_timeout', '3s', false)")
                    with connection.execute_wrapper(wrapper):
                        return operation()
            finally:
                connections.close_all()

        def issue():
            invitation, _code, created = issue_team_invitation(
                requester=self.owner,
                company_id=self.company.pk,
                inviter_appointment_id=self.initial.pk,
                idempotency_key=self.key,
                capabilities=["prepare"],
            )
            return invitation.pk, created

        def submit():
            proposal, created = submit_authority_request(
                requester=self.owner,
                company_id=self.company.pk,
                idempotency_key=uuid4(),
                file=evidence(),
                requested_capabilities=["prepare"],
            )
            return proposal.pk, created

        with ThreadPoolExecutor(max_workers=2) as pool:
            issued = pool.submit(run, issue_after_company_lock, issue)
            self.assertTrue(company_locked.wait(timeout=5))
            submitted = pool.submit(run, submit_at_company_lock, submit)
            self.assertTrue(issued.result(timeout=15)[1])
            self.assertTrue(submitted.result(timeout=15)[1])
        with use_operator():
            self.assertEqual(CompanyTeamInvitation.objects.count(), 1)
            self.assertEqual(CompanyAuthorityRequest.objects.count(), 2)

    def test_raw_acceptance_waiting_on_company_lock_cannot_outlive_invitation_deadline(self):
        deadline = timezone.now() + timedelta(seconds=2)
        issued = self.issue(acceptance_deadline=deadline.isoformat())
        self.assertEqual(issued.status_code, 201, issued.content)
        worker_ready = Event()
        worker_pid = []

        def consume():
            try:
                with use_operator(), _requester_principal(self.invitee.pk), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), set_config('lock_timeout', '5s', true)")
                        worker_pid.append(cursor.fetchone()[0])
                        cursor.execute(
                            "SELECT set_config('app.team_invitation_code', %s, true)", [issued.json()["code"]]
                        )
                    worker_ready.set()
                    appointment = CompanyAppointment.objects.create(
                        company=self.company,
                        appointee=self.invitee,
                        appointee_profile=self.invitee_profile,
                        invitation_id=issued.json()["uuid"],
                        capabilities=["prepare"],
                        delegatable_capabilities=["approve"],
                        declaration_version=DECLARATION_VERSION,
                        declaration_text=DECLARATION_TEXT,
                    )
                    return str(appointment.pk)
            except DatabaseError as error:
                return error
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_operator(), atomic():
                Company.objects.select_for_update().get(pk=self.company.pk)
                result = pool.submit(consume)
                self.assertTrue(worker_ready.wait(timeout=5))
                waiting = False
                limit = monotonic() + 1
                with connections[current_alias()].cursor() as cursor:
                    while monotonic() < limit:
                        cursor.execute("SELECT pg_stat_clear_snapshot()")
                        cursor.execute(
                            "SELECT wait_event_type = 'Lock' AND pg_backend_pid() = ANY(pg_blocking_pids(pid)) "
                            "FROM pg_stat_activity WHERE pid = %s",
                            [worker_pid[0]],
                        )
                        waiting = cursor.fetchone()[0]
                        if waiting:
                            break
                        sleep(0.01)
                self.assertTrue(waiting)
                self.assertLess(timezone.now(), deadline)
                while timezone.now() <= deadline + timedelta(milliseconds=50):
                    sleep(0.01)
            error = result.result(timeout=10)
        self.assertIsInstance(error, DatabaseError)
        self.assertIn("Appointment requires the exact current invitation", str(error))
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).exists())

    def test_nested_acceptance_restores_prior_code_setting_on_success_and_failure(self):
        issued = self.issue()
        original = CompanyAppointment.save

        def fail_after_save(instance, *args, **kwargs):
            original(instance, *args, **kwargs)
            raise RuntimeError("synthetic failure after nested appointment insert")

        with use_operator(), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT set_config('app.team_invitation_code', 'outer-sentinel', true)")
            with patch.object(CompanyAppointment, "save", fail_after_save), self.assertRaises(RuntimeError):
                accept_team_invitation(requester=self.invitee, **self.declaration(issued.json()["code"]))
            self.assertFalse(CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_setting('app.team_invitation_code', true)")
                self.assertEqual(cursor.fetchone()[0], "outer-sentinel")
            appointed = accept_team_invitation(requester=self.invitee, **self.declaration(issued.json()["code"]))
            self.assertEqual(str(appointed.invitation_id), issued.json()["uuid"])
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_setting('app.team_invitation_code', true)")
                self.assertEqual(cursor.fetchone()[0], "outer-sentinel")

    def test_malformed_appointment_references_return_not_found(self):
        malformed = self.client.post(f"{APPOINTMENTS}not-a-uuid/revoke/", {}, format="json")
        missing = self.client.post(f"{APPOINTMENTS}{uuid4()}/revoke/", {}, format="json")
        self.assertEqual((malformed.status_code, missing.status_code), (404, 404))
        self.assertEqual(malformed.json(), {"detail": "Not found."})

    def test_raw_invitation_forgery_and_immutable_changes_fail_on_operator_connection(self):
        values = {
            "company": self.company,
            "company_name": self.company.name,
            "inviter": self.owner,
            "inviter_appointment": self.initial,
            "idempotency_key": uuid4(),
            "capabilities": ["prepare"],
            "delegatable_capabilities": [],
            "acceptance_deadline": timezone.now() + timedelta(days=1),
            "code_sha256": "a" * 64,
        }
        for changes in (
            {"inviter": self.invitee},
            {"company": self.foreign_company},
            {"company_name": "forged"},
            {"capabilities": ["prepare", "prepare"]},
            {"capabilities": ["unknown"]},
            {"capabilities": {}},
            {"capabilities": ["prepare", "admin"]},
            {"code_sha256": "bad"},
            {"acceptance_deadline": timezone.now() - timedelta(seconds=1)},
        ):
            with self.subTest(changes=changes), use_operator(), _requester_principal(self.owner.pk), self.assertRaises(
                DatabaseError
            ), atomic():
                CompanyTeamInvitation.objects.create(**{**values, **changes})
        issued = self.issue()
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanyTeamInvitation.objects.filter(pk=issued.json()["uuid"]).update(capabilities=["apply"])
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanyTeamInvitation.objects.filter(pk=issued.json()["uuid"]).delete()

    def test_raw_acceptance_requires_code_actor_profile_exact_scope_source_and_declaration(self):
        issued = self.issue()
        with use_operator():
            invitation = CompanyTeamInvitation.objects.get(pk=issued.json()["uuid"])
        values = {
            "company": self.company,
            "appointee": self.invitee,
            "appointee_profile": self.invitee_profile,
            "invitation": invitation,
            "capabilities": invitation.capabilities,
            "delegatable_capabilities": invitation.delegatable_capabilities,
            "expires_at": invitation.appointment_expires_at,
            "declaration_version": DECLARATION_VERSION,
            "declaration_text": DECLARATION_TEXT,
        }
        with use_operator(), _requester_principal(self.invitee.pk), self.assertRaises(DatabaseError), atomic():
            CompanyAppointment.objects.create(**values)
        for changes in (
            {"company": self.foreign_company},
            {"appointee": self.other},
            {"appointee_profile": self.other_profile},
            {"capabilities": ["admin"]},
            {"delegatable_capabilities": []},
            {"declaration_version": "old"},
            {"declaration_text": "forged"},
            {"expires_at": timezone.now() + timedelta(days=1)},
            {"request_id": self.initial.request_id},
            {"registry_check_id": self.initial.registry_check_id},
        ):
            with self.subTest(changes=changes), use_operator(), _requester_principal(
                self.invitee.pk
            ), self.assertRaises(DatabaseError), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT set_config('app.team_invitation_code', %s, true)", [issued.json()["code"]])
                CompanyAppointment.objects.create(**{**values, **changes})
        self.assertEqual(self.accept(issued.json()["code"]).status_code, 200)

    def test_raw_nonadmin_revocation_fails_and_retained_appointment_and_revocation_cannot_change(self):
        _, appointed = self.issue_and_accept()
        with use_operator(), _requester_principal(self.invitee.pk), self.assertRaises(DatabaseError), atomic():
            CompanyAppointmentRevocation.objects.create(appointment=self.initial, revoked_by=self.invitee)
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanyAppointment.objects.filter(pk=appointed.pk).update(capabilities=["admin"])
        revoke_company_appointment(requester=self.owner, appointment_id=appointed.pk)
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanyAppointmentRevocation.objects.filter(appointment=appointed).update(revoked_by=self.other)

    def test_acceptance_insert_failure_rolls_back_consumption_and_restores_code_context(self):
        issued = self.issue()
        original = CompanyAppointment.save

        def fail_after_save(instance, *args, **kwargs):
            original(instance, *args, **kwargs)
            raise RuntimeError("synthetic failure after appointment insert")

        with patch.object(CompanyAppointment, "save", fail_after_save), self.assertRaises(RuntimeError):
            accept_team_invitation(requester=self.invitee, **self.declaration(issued.json()["code"]))
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.filter(invitation_id=issued.json()["uuid"]).exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_setting('app.team_invitation_code', true)")
                self.assertIn(cursor.fetchone()[0], (None, ""))
        self.assertEqual(self.accept(issued.json()["code"]).status_code, 200)
