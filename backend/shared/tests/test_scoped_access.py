from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, ProgrammingError, connections
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from companies.services.team import revoke_company_appointment
from shared.db import (
    APP_ALIAS,
    atomic,
    principal_of,
    reset_principal,
    set_principal,
    use_operator,
)
from shared.tests.core_fixtures import (
    PASSWORD,
    CoreFixtures,
    import_payload,
    populated_register,
    retained_evidence,
)
from tokens.models import (
    MemberAssociation,
    MemberAssociationRevocation,
    MemberCertificateRequest,
    MemberCertificateWithdrawal,
    MemberInvitation,
    MemberParticularsRequest,
    RegisterAgreement,
    RegisterAllotment,
    RegisterAllotmentDecision,
    RegisterAward,
    RegisterAwardVesting,
    RegisterContribution,
    RegisterEvidenceKind,
    RegisterGrant,
    RegisterMember,
    RegisterParticularsChange,
    RegisterPosition,
    ShareToken,
)
from users.models import UserProfile


@override_settings(RLS_AMBIENT_ALIAS=APP_ALIAS, RLS_ROLE_PER_REQUEST=False)
class ScopedAccessTest(CoreFixtures, APITransactionTestCase):
    databases = {"default", "app", "operator"}

    def sign_in(self, user):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/signin/", {"email": user.email, "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("access", response.cookies)
        with connections[APP_ALIAS].cursor() as cursor:
            cursor.execute(
                "SELECT session_user, current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
            )
            self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES["app"], settings.RLS_ROLES["app"], False, False))
        self.addCleanup(reset_principal, APP_ALIAS)

    def test_real_app_login_keeps_its_session_and_clears_the_request_principal(self):
        with CaptureQueriesContext(connections[APP_ALIAS]) as queries:
            self.sign_in(self.owner)
        self.assertTrue(any('"users_userprofile"' in item["sql"] for item in queries))
        response = self.client.get("/api/auth/verify/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["valid"])
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        anonymous = APIClient().get(f"/api/user-profiles/{self.profile.pk}/")
        self.assertEqual(anonymous.status_code, 401, anonymous.content)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def test_own_profile_edit_and_foreign_api_database_reads_and_writes_are_isolated(self):
        self.sign_in(self.owner)
        response = self.client.patch(
            f"/api/user-profiles/{self.profile.pk}/",
            {"fullName": "Synthetic Updated Member", "residentialAddress": "4 Example Street, Sydney NSW 2000"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        foreign = self.client.patch(
            f"/api/user-profiles/{self.foreign_profile.pk}/", {"fullName": "Forged"}, format="json"
        )
        self.assertEqual(foreign.status_code, 404, foreign.content)
        listed = self.client.get("/api/user-profiles/")
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertIn(str(self.profile.pk), str(listed.json()))
        self.assertNotIn(str(self.foreign_profile.pk), str(listed.json()))
        set_principal(self.owner.pk, APP_ALIAS)
        self.assertEqual(list(UserProfile.objects.using(APP_ALIAS).values_list("pk", flat=True)), [self.profile.pk])
        self.assertEqual(
            UserProfile.objects.using(APP_ALIAS).filter(pk=self.foreign_profile.pk).update(full_name="Forged"), 0
        )
        reset_principal(APP_ALIAS)
        with use_operator():
            self.profile.refresh_from_db()
            self.foreign_profile.refresh_from_db()
        self.assertEqual(self.profile.full_name, "Synthetic Updated Member")
        self.assertEqual(self.foreign_profile.full_name, "Synthetic core-foreign")

    def test_register_import_and_member_reads_bind_the_exact_company_in_api_and_database(self):
        with use_operator():
            token = ShareToken.objects.create(
                company=self.company, name="Imported ordinary", symbol="NEW", total_supply="1000"
            )
        payload = import_payload(self.owner, self.appointment, token)
        foreign_token, foreign_member = populated_register(
            self.foreign, self.foreign_company, self.foreign_appointment, "FOREIGN"
        )
        self.sign_in(self.owner)
        response = self.client.post("/api/v1/tokens/register-imports/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        self.decision("/api/v1/tokens/register-imports/", identifier, "approve")
        self.decision("/api/v1/tokens/register-imports/", identifier, "apply")
        own = self.client.get(f"/api/v1/tokens/{token.pk}/holders/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertIn("Synthetic Member", str(own.json()))
        hidden = self.client.get(f"/api/v1/tokens/{foreign_token.pk}/holders/")
        self.assertEqual(hidden.status_code, 404, hidden.content)
        set_principal(self.owner.pk, APP_ALIAS)
        self.assertEqual(
            RegisterPosition.objects.using(APP_ALIAS).filter(member_id=payload["members"][0]["member"]).count(), 1
        )
        self.assertEqual(RegisterPosition.objects.using(APP_ALIAS).filter(member=foreign_member).count(), 0)
        reset_principal(APP_ALIAS)

    def test_foreign_company_cannot_approve_issue_or_write_the_private_grant(self):
        identifier = self.prepare_grant()
        award = self.award_payload()
        recorded = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        vesting = self.vesting_payload(award["operation_id"])
        recorded_vesting = self.client.post("/api/v1/tokens/register-award-vestings/", vesting, format="json")
        self.assertEqual(recorded_vesting.status_code, 201, recorded_vesting.content)
        allotment = self.allotment_payload()
        capital = self.client.post("/api/v1/tokens/register-allotments/", allotment, format="json")
        self.assertEqual(capital.status_code, 201, capital.content)
        capital_detail = f"/api/v1/tokens/register-allotments/{allotment['operation_id']}/"
        for suffix in ("", "file/", "agreement-file/", "receipt-file/"):
            healthy = self.client.get(f"{capital_detail}{suffix}")
            self.assertEqual(healthy.status_code, 200, getattr(healthy, "content", b""))
            healthy.close()
        with use_operator():
            opening_entry = self.token.stored_register.entries.get(kind="opening").pk
        invitation_payload = self.invitation_payload()
        invitation = self.client.post("/api/v1/tokens/member-invitations/", invitation_payload, format="json")
        self.assertEqual(invitation.status_code, 201, invitation.content)
        acceptance = {
            "code": invitation.json()["code"],
            "user_account": str(self.foreign_profile.user_account.pk),
            "confirmation": True,
        }
        wrong_recipient = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {**acceptance, "user_account": str(self.profile.user_account.pk)},
            format="json",
        )
        self.assertEqual(wrong_recipient.status_code, 400, wrong_recipient.content)
        self.sign_in(self.foreign)
        forged_account = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {**acceptance, "user_account": str(self.profile.user_account.pk)},
            format="json",
        )
        self.assertEqual(forged_account.status_code, 404, forged_account.content)
        accepted = self.client.post("/api/v1/tokens/member-invitations/accept/", acceptance, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        association_id = accepted.json()["uuid"]
        own = self.client.get(f"/api/v1/tokens/member-records/{association_id}/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual(own.json()["classes"][0]["shares"], "100")
        self.assertEqual(self.client.get("/api/v1/tokens/member-invitations/").json()["count"], 0)
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/member-invitations/{invitation_payload['operation_id']}/").status_code, 404
        )
        false_certificate = self.client.post(
            "/api/v1/tokens/member-certificate-requests/",
            {
                "operation_id": str(uuid4()),
                "association": association_id,
                "entry": str(opening_entry),
            },
            format="json",
        )
        self.assertEqual(false_certificate.status_code, 400, false_certificate.content)
        no_confirmation = self.client.post(
            "/api/v1/tokens/member-particulars-requests/",
            {
                "operation_id": str(uuid4()),
                "association": association_id,
                "name": "Proposed",
                "residential_address": "Proposed address",
                "confirmation": False,
            },
            format="json",
        )
        self.assertEqual(no_confirmation.status_code, 400, no_confirmation.content)
        pending_request = self.client.post(
            "/api/v1/tokens/member-particulars-requests/",
            {
                "operation_id": str(uuid4()),
                "association": association_id,
                "name": "Proposed Member",
                "residential_address": "Proposed address",
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(pending_request.status_code, 201, pending_request.content)
        with use_operator(), self.assertRaises(IntegrityError), atomic():
            MemberAssociation.objects.filter(pk=association_id).update(member=uuid4())
        set_principal(self.foreign.pk, APP_ALIAS)
        for model in (
            MemberInvitation,
            MemberAssociation,
            MemberAssociationRevocation,
            MemberParticularsRequest,
            MemberCertificateRequest,
            MemberCertificateWithdrawal,
        ):
            with self.assertRaises(ProgrammingError) as read:
                model.objects.using(APP_ALIAS).count()
            self.assertEqual(read.exception.__cause__.sqlstate, "42501")
        reset_principal(APP_ALIAS)
        response = self.client.post(
            f"/api/v1/tokens/register-grants/{identifier}/decision-preview/",
            {"appointment": str(self.foreign_appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(response.status_code, 404, response.content)
        creation = self.client.post("/api/v1/tokens/register-grants/", self.grant_payload(), format="json")
        self.assertEqual(creation.status_code, 404, creation.content)
        for endpoint, payload in (("register-awards", award), ("register-award-vestings", vesting)):
            detail = f"/api/v1/tokens/{endpoint}/{payload['operation_id']}/"
            self.assertEqual(self.client.get(detail).status_code, 404)
            self.assertEqual(self.client.get(f"{detail}file/").status_code, 404)
            rejected = self.client.post(f"/api/v1/tokens/{endpoint}/", payload, format="json")
            self.assertEqual(rejected.status_code, 404, rejected.content)
        set_principal(self.foreign.pk, APP_ALIAS)
        self.assertEqual(RegisterGrant.objects.using(APP_ALIAS).filter(pk=identifier).count(), 0)
        self.assertEqual(RegisterGrant.objects.using(APP_ALIAS).filter(pk=identifier).update(status="applied"), 0)
        for model, payload in ((RegisterAward, award), (RegisterAwardVesting, vesting)):
            with self.assertRaises(ProgrammingError) as read:
                model.objects.using(APP_ALIAS).filter(pk=payload["operation_id"]).count()
            self.assertEqual(read.exception.__cause__.sqlstate, "42501")
            with self.assertRaises(ProgrammingError) as write:
                model.objects.using(APP_ALIAS).filter(pk=payload["operation_id"]).update(shares=1)
            self.assertEqual(write.exception.__cause__.sqlstate, "42501")
        for suffix in ("", "file/", "agreement-file/", "receipt-file/"):
            self.assertEqual(self.client.get(f"{capital_detail}{suffix}").status_code, 404)
        foreign_preview = self.client.post(
            f"{capital_detail}decision-preview/",
            {"appointment": str(self.foreign_appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(foreign_preview.status_code, 404, foreign_preview.content)
        for model in (RegisterAgreement, RegisterContribution, RegisterAllotment, RegisterAllotmentDecision):
            with self.assertRaises(ProgrammingError) as private_read:
                model.objects.using(APP_ALIAS).count()
            self.assertEqual(private_read.exception.__cause__.sqlstate, "42501")
        reset_principal(APP_ALIAS)
        with use_operator():
            self.assertIsNone(RegisterGrant.objects.get(pk=identifier).register_entry_id)
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        self.sign_in(self.owner)
        set_principal(self.owner.pk, APP_ALIAS)
        for model in (RegisterAgreement, RegisterContribution, RegisterAllotment, RegisterAllotmentDecision):
            with self.assertRaises(ProgrammingError) as owner_read:
                model.objects.using(APP_ALIAS).count()
            self.assertEqual(owner_read.exception.__cause__.sqlstate, "42501")
        reset_principal(APP_ALIAS)
        supporting = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        prepared_request = self.client.post(
            f"/api/v1/tokens/member-particulars-requests/{pending_request.json()['uuid']}/prepare/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "supporting_evidence": str(supporting.pk),
                "as_at": timezone.now().date().isoformat(),
                "reason": "Company review of proposed particulars",
            },
            format="json",
        )
        self.assertEqual(prepared_request.status_code, 201, prepared_request.content)
        change_id = prepared_request.json()["uuid"]
        self.decision("/api/v1/tokens/register-particulars-changes/", change_id, "approve")
        set_principal(self.owner.pk, APP_ALIAS)
        self.assertEqual(RegisterParticularsChange.objects.using(APP_ALIAS).filter(pk=change_id).count(), 0)
        reset_principal(APP_ALIAS)
        self.assertEqual(self.client.get(f"/api/v1/tokens/member-records/{association_id}/").status_code, 404)
        revoked_association = self.client.post(
            f"/api/v1/tokens/member-associations/{association_id}/revoke/",
            {"appointment": str(self.appointment.pk), "idempotency_key": str(uuid4()), "reason": "End member access"},
            format="json",
        )
        self.assertEqual(revoked_association.status_code, 200, revoked_association.content)
        lapsed = self.client.post(
            f"/api/v1/tokens/register-particulars-changes/{change_id}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertEqual(lapsed.status_code, 200, lapsed.content)
        self.assertFalse(lapsed.json()["canDecide"])
        self.assertIn("member_request_no_longer_current", lapsed.json()["unmetRequirements"])
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        for suffix in ("", "file/", "agreement-file/", "receipt-file/"):
            self.assertEqual(self.client.get(f"{capital_detail}{suffix}").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/tokens/register-allotments/").json()["count"], 0)
        self.assertEqual(self.client.get("/api/v1/tokens/member-invitations/").json()["count"], 0)
        self.assertEqual(self.client.get("/api/v1/tokens/member-associations/").json()["count"], 0)

    def test_employee_issue_matches_holdings_and_retry_cannot_issue_twice(self):
        self.sign_in(self.owner)
        award = self.award_payload()
        endpoint = "/api/v1/tokens/register-awards/"
        recorded = self.client.post(endpoint, award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        replayed = self.client.post(endpoint, award, format="json")
        self.assertEqual(replayed.status_code, 200, replayed.content)
        self.assertEqual(replayed.json()["uuid"], recorded.json()["uuid"])
        changed = self.client.post(endpoint, {**award, "shares": "31"}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        vesting = self.vesting_payload(award["operation_id"])
        vesting_endpoint = "/api/v1/tokens/register-award-vestings/"
        vested = self.client.post(vesting_endpoint, vesting, format="json")
        self.assertEqual(vested.status_code, 201, vested.content)
        self.assertEqual(self.client.post(vesting_endpoint, vesting, format="json").status_code, 200)
        entitlement = self.client.get(f"{endpoint}{award['operation_id']}/").json()
        self.assertEqual(
            (entitlement["vestedShares"], entitlement["issuedShares"], entitlement["availableShares"]),
            ("25", "0", "25"),
        )
        with use_operator():
            self.assertFalse(RegisterMember.objects.filter(pk=award["member"]).exists())
            self.assertEqual(int(self.token.stored_register.issued_supply), 100)
        prepared = self.client.post("/api/v1/tokens/register-grants/", self.linked_grant_payload(award), format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        identifier = prepared.json()["uuid"]
        endpoint = "/api/v1/tokens/register-grants/"
        self.decision(endpoint, identifier, "approve")
        first, payload = self.decision(endpoint, identifier, "apply")
        repeated = self.client.post(f"{endpoint}{identifier}/decide/", payload, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(repeated.json()["registerEntry"], first.json()["registerEntry"])
        with use_operator():
            proposal = RegisterGrant.objects.get(pk=identifier)
            register = proposal.register_entry.register
            positions = RegisterPosition.objects.filter(register=register)
            self.assertEqual(int(register.issued_supply), sum(int(position.shares) for position in positions))
            self.assertEqual(int(register.issued_supply), 125)
            self.assertEqual(positions.get(member_id=proposal.member).shares, 25)
            self.assertEqual(register.entries.filter(kind="issue").count(), 1)
            self.assertEqual(RegisterAward.objects.filter(pk=award["operation_id"]).count(), 1)
            self.assertEqual(RegisterAwardVesting.objects.filter(award_id=award["operation_id"]).count(), 1)
        entitlement = self.client.get(f"/api/v1/tokens/register-awards/{award['operation_id']}/").json()
        self.assertEqual(
            (entitlement["vestedShares"], entitlement["issuedShares"], entitlement["availableShares"]),
            ("25", "25", "0"),
        )
