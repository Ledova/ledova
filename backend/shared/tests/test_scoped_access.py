from django.conf import settings
from django.db import connections
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient, APITransactionTestCase

from shared.db import (
    APP_ALIAS,
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
)
from tokens.models import RegisterGrant, RegisterPosition, ShareToken
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
        self.sign_in(self.foreign)
        response = self.client.post(
            f"/api/v1/tokens/register-grants/{identifier}/decision-preview/",
            {"appointment": str(self.foreign_appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(response.status_code, 404, response.content)
        creation = self.client.post("/api/v1/tokens/register-grants/", self.grant_payload(), format="json")
        self.assertEqual(creation.status_code, 404, creation.content)
        set_principal(self.foreign.pk, APP_ALIAS)
        self.assertEqual(RegisterGrant.objects.using(APP_ALIAS).filter(pk=identifier).count(), 0)
        self.assertEqual(RegisterGrant.objects.using(APP_ALIAS).filter(pk=identifier).update(status="applied"), 0)
        reset_principal(APP_ALIAS)
        with use_operator():
            self.assertIsNone(RegisterGrant.objects.get(pk=identifier).register_entry_id)
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_employee_issue_matches_holdings_and_retry_cannot_issue_twice(self):
        self.sign_in(self.owner)
        identifier = self.prepare_grant()
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
