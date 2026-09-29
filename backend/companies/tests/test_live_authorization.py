from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework.test import APITestCase

from companies.models import Company, CompanyDocument
from shared.tests.under_the_policies import what_the_policies_admit_to
from tokens.models import (
    CapitalIncreaseRequest,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.serializers import ShareTokenCreateSerializer

User = get_user_model()


class CompanyLiveAuthorizationTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice-company@example.test", password="pw-12345678")
        self.bob = User.objects.create_user(email="bob-company@example.test", password="pw-12345678")
        self.staff = User.objects.create_user(
            email="staff-company@example.test",
            password="pw-12345678",
            is_staff=True,
        )
        self.superuser = User.objects.create_superuser(email="super-company@example.test", password="pw-12345678")
        self.company = Company.objects.create(
            owner=self.alice,
            name="Alice Holdings Pty Ltd",
            trading_name="Alice Holdings",
            company_type="pty",
            acn="111111111",
            status="active",
            phone="0400000000",
            address_line_1="Private address",
        )
        self.document = CompanyDocument.objects.create(
            company=self.company,
            document_type="director_id",
            name="Director identity",
            external_url="https://private.example.test/director-id",
            file_size=123,
            mime_type="application/pdf",
        )
        self.token = ShareToken.objects.create(
            company=self.company,
            name="Alice Ordinary",
            symbol="ALICE",
            total_supply="1000",
        )
        self.capital_increase = CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=100,
            new_authorized_total=1100,
            purpose="Testing",
            board_resolution_reference="BOARD-1",
        )
        self.issuance_request = ShareIssuanceRequest.objects.create(
            token=self.token,
            recipient_address="0x" + "a" * 40,
            amount=10,
            reason="Testing",
        )

    def test_owner_is_live_authority_for_company_and_all_derived_resources(self):
        self.assertNotIn(self.company, what_the_policies_admit_to(self.bob, Company))
        self.assertNotIn(self.company, what_the_policies_admit_to(self.bob, Company))

        Company.objects.filter(pk=self.company.pk).update(owner=self.bob)
        self.company.refresh_from_db()

        former_owner_querysets = (
            what_the_policies_admit_to(self.alice, Company),
            what_the_policies_admit_to(self.alice, Company),
            what_the_policies_admit_to(self.alice, CompanyDocument),
            what_the_policies_admit_to(self.alice, CompanyDocument),
            what_the_policies_admit_to(self.alice, ShareToken),
            what_the_policies_admit_to(self.alice, ShareToken),
            what_the_policies_admit_to(self.alice, CapitalIncreaseRequest),
            what_the_policies_admit_to(self.alice, CapitalIncreaseRequest),
            what_the_policies_admit_to(self.alice, ShareIssuanceRequest),
            what_the_policies_admit_to(self.alice, ShareIssuanceRequest),
        )
        self.assertEqual([q.model._meta.label for q in former_owner_querysets if q.exists()], [])

        current_owner_querysets = (
            what_the_policies_admit_to(self.bob, Company),
            what_the_policies_admit_to(self.bob, Company),
            what_the_policies_admit_to(self.bob, CompanyDocument),
            what_the_policies_admit_to(self.bob, CompanyDocument),
            what_the_policies_admit_to(self.bob, ShareToken),
            what_the_policies_admit_to(self.bob, ShareToken),
            what_the_policies_admit_to(self.bob, CapitalIncreaseRequest),
            what_the_policies_admit_to(self.bob, CapitalIncreaseRequest),
            what_the_policies_admit_to(self.bob, ShareIssuanceRequest),
            what_the_policies_admit_to(self.bob, ShareIssuanceRequest),
        )
        self.assertEqual([q.model._meta.label for q in current_owner_querysets if not q.exists()], [])

        for user, expected in ((self.alice, set()), (self.bob, {self.company.uuid})):
            serializer = ShareTokenCreateSerializer(context={"request": SimpleNamespace(user=user)})
            self.assertEqual(set(serializer.fields["company"].queryset.values_list("uuid", flat=True)), expected)

    def test_querysets_fail_closed_and_follow_company_ownership_for_privileged_users(self):
        for user in (None, AnonymousUser()):
            with self.subTest(user=user):
                self.assertFalse(what_the_policies_admit_to(user, Company).exists())
                self.assertFalse(what_the_policies_admit_to(user, Company).exists())
                self.assertFalse(what_the_policies_admit_to(user, CompanyDocument).exists())
                self.assertFalse(what_the_policies_admit_to(user, CompanyDocument).exists())

        for index, privileged_user in enumerate((self.staff, self.superuser), start=4):
            company = Company.objects.create(
                owner=privileged_user,
                name=f"Privileged Company {index}",
                company_type="pty",
                acn=str(index) * 9,
                status="active",
            )
            document = CompanyDocument.objects.create(
                company=company,
                document_type="asic",
                name=f"Privileged ASIC {index}",
                external_url=f"https://private.example.test/privileged-{index}",
                file_size=123,
                mime_type="application/pdf",
            )

            with self.subTest(user=privileged_user.email):
                self.assertEqual(set(what_the_policies_admit_to(privileged_user, Company)), {company})
                self.assertEqual(set(what_the_policies_admit_to(privileged_user, Company)), {company})
                self.assertEqual(set(what_the_policies_admit_to(privileged_user, CompanyDocument)), {document})
                self.assertEqual(set(what_the_policies_admit_to(privileged_user, CompanyDocument)), {document})


class CompanyEndpointIsolationTest(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice-company-api@example.test", password="pw-12345678")
        self.bob = User.objects.create_user(email="bob-company-api@example.test", password="pw-12345678")
        self.alice_company = Company.objects.create(
            owner=self.alice,
            name="Alice Company",
            company_type="pty",
            acn="222222222",
            status="active",
        )
        self.bob_company = Company.objects.create(
            owner=self.bob,
            name="Bob Company",
            company_type="pty",
            acn="333333333",
            status="active",
            phone="0411111111",
            address_line_1="Bob private address",
        )
        self.bob_document = CompanyDocument.objects.create(
            company=self.bob_company,
            document_type="bank_statement",
            name="Bob bank statement",
            external_url="https://private.example.test/bob-bank",
            file_size=456,
            mime_type="application/pdf",
        )

    @staticmethod
    def _rows(response):
        body = response.json()
        return body.get("results", body) if isinstance(body, dict) else body

    def test_authenticated_reads_are_owner_only(self):
        self.client.force_authenticate(self.alice)

        own_detail = self.client.get(f"/api/v1/companies/{self.alice_company.uuid}/")
        self.assertEqual(own_detail.status_code, 200)
        self.assertIn("email", own_detail.json())
        self.assertIn("documents", own_detail.json())

        list_response = self.client.get("/api/v1/companies/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual({row["uuid"] for row in self._rows(list_response)}, {str(self.alice_company.uuid)})

        foreign_detail = self.client.get(f"/api/v1/companies/{self.bob_company.uuid}/")
        self.assertEqual(foreign_detail.status_code, 404)
        self.assertNotIn(self.bob_document.external_url, foreign_detail.content.decode())
        self.assertNotIn("Bob private address", foreign_detail.content.decode())

    def test_anonymous_reads_are_rejected(self):
        for url in ("/api/v1/companies/", f"/api/v1/companies/{self.bob_company.uuid}/"):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 401)
                self.assertNotIn(str(self.bob_company.uuid), response.content.decode())

    def test_explicit_admin_actions_keep_global_scope(self):
        staff = User.objects.create_user(
            email="company-admin@example.test",
            password="pw-12345678",
            is_staff=True,
        )
        self.client.force_authenticate(staff)

        status_url = f"/api/v1/companies/{self.bob_company.uuid}/status/"
        status_response = self.client.post(
            status_url, {"status": "warning", "reason": "Administrative review"}, format="json"
        )

        self.assertEqual(status_response.status_code, 200)
        self.bob_company.refresh_from_db()
        self.assertEqual(self.bob_company.status, "warning")

        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.post(status_url, {"status": "suspended"}, format="json").status_code, 403)

        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(status_url, {"status": "suspended"}, format="json").status_code, 401)
        self.bob_company.refresh_from_db()
        self.assertEqual(self.bob_company.status, "warning")
