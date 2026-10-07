from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.db import connection
from rest_framework.test import APITestCase, APITransactionTestCase

from offerings.models import Subscription
from shared.db import use_operator
from shared.db.principal import PRINCIPAL_SETTING
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant, open_to_investors
from shared.tests.under_the_policies import what_the_policies_admit_to
from tokens.models import (
    RegisterInstruction,
    RequestStatus,
    ShareIssuanceExecution,
    ShareIssuanceRequest,
)
from tokens.tests.company_issue_fixtures import CompanyIssueCases

BASE = "/api/v1/tokens/issuance-requests/"


class AnIssuerCanSeeTheRequestItMadeTest(APITestCase):

    def setUp(self):
        self.tenant = make_tenant("issuer")
        self.stranger = make_tenant("stranger")
        self.request = self.a_request(self.tenant)
        self.client.force_authenticate(self.tenant.user)

    @staticmethod
    def a_request(tenant):
        return ShareIssuanceRequest.objects.create(
            token=tenant.deployed_token,
            recipient_address="0x" + "b" * 40,
            amount=10000,
            reason="Founder allocation",
            submitted_by=tenant.user,
        )

    def listed(self):
        return self.client.get(BASE).json()

    def test_the_request_it_made_is_listed(self):
        response = self.client.get(BASE)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row["uuid"] for row in response.json()["results"]], [str(self.request.uuid)])

    def test_the_retired_free_address_submission_creates_no_request(self):
        with patch("tokens.services.share_token_service.get_base_chain_client", side_effect=AssertionError("No RPC")):
            response = self.client.post(
                f"/api/v1/tokens/{self.tenant.deployed_token.uuid}/issue/",
                {"recipient": self.tenant.wallet.address, "amount": 10, "reason": "New allocation"},
            )
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(ShareIssuanceRequest.objects.count(), 1)
        listed = self.client.get(f"{BASE}?token={self.tenant.deployed_token.uuid}").json()["results"]
        self.assertEqual([row["uuid"] for row in listed], [str(self.request.pk)])

    def test_the_row_carries_the_status_the_issuer_is_waiting_on(self):
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(status=RequestStatus.SUBMITTED)

        row = self.listed()["results"][0]

        self.assertEqual(row["status"], RequestStatus.SUBMITTED)
        self.assertEqual(row["amount"], self.request.amount)
        self.assertEqual(row["recipientAddress"], self.request.recipient_address)

    def test_another_company_s_request_is_not_listed(self):
        foreign = self.a_request(self.stranger)
        body = self.listed()

        self.assertEqual(body["count"], 1)
        self.assertNotIn(str(foreign.uuid), [row["uuid"] for row in body["results"]])

    def test_the_list_keeps_operator_notes_private(self):
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(
            review_notes="Private provider credentials and reviewer deliberation",
            execution_notes="Execution failed. Operations review is required.",
        )

        response = self.client.get(BASE)
        self.assertEqual(response.status_code, 200)
        row = response.json()["results"][0]
        self.assertEqual(row["executionNotes"], "Execution failed. Operations review is required.")
        self.assertNotIn("reviewNotes", row)
        self.assertNotIn(b"Private provider", response.content)

    def test_the_history_endpoint_has_no_single_request_route_to_read_change_or_delete(self):
        detail = f"{BASE}{self.request.uuid}/"
        self.assertEqual(self.client.post(BASE, {}).status_code, 405)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.patch(detail, {"status": "approved"}).status_code, 404)
        self.assertEqual(self.client.delete(detail).status_code, 404)
        self.assertTrue(ShareIssuanceRequest.objects.filter(pk=self.request.pk).exists())

    def test_older_requests_remain_accessible_on_the_next_page(self):
        for _ in range(25):
            self.a_request(self.tenant)
        first = self.listed()
        self.assertEqual(first["count"], 26)
        self.assertEqual(len(first["results"]), 25)
        second = self.client.get(first["next"]).json()
        self.assertEqual([row["uuid"] for row in second["results"]], [str(self.request.uuid)])
        self.assertIsNone(second["next"])

    def test_it_can_be_narrowed_to_one_token(self):
        body = self.client.get(f"{BASE}?token={self.tenant.deployed_token.uuid}").json()

        self.assertEqual([row["uuid"] for row in body["results"]], [str(self.request.uuid)])

    def test_an_anonymous_caller_is_told_nothing(self):
        self.client.force_authenticate(None)

        self.assertIn(self.client.get(BASE).status_code, (401, 403))

    def test_the_visibility_reads_the_owner_column_rather_than_joining_to_the_token(self):
        sql = str(what_the_policies_admit_to(self.tenant.user, ShareIssuanceRequest).query)

        self.assertIn("company_id", sql)
        self.assertNotIn("tokens_sharetoken", sql)

    @skipUnless(connection.vendor == "postgresql", "PostgreSQL request policies")
    def test_subscriber_database_access_does_not_expose_another_issuers_history(self):
        foreign = ShareIssuanceRequest.objects.create(
            dispatch_id=None,
            token=self.stranger.deployed_token,
            recipient_address=self.tenant.wallet.address,
            amount=10,
            reason="Historical subscriber allotment",
        )
        open_to_investors(self.stranger)
        Subscription.objects.create(
            offering=self.stranger.offering,
            company_name=self.stranger.offering.token.company.display_name,
            token_name=self.stranger.offering.token.name,
            token_symbol=self.stranger.offering.token.symbol,
            currency=self.stranger.offering.price_currency,
            user_account=self.tenant.account,
            wallet=self.tenant.wallet,
            submitted_by=self.tenant.user,
            quantity=10,
            price_per_share=self.stranger.offering.price_per_share,
            amount_due=25,
            issuance_request=foreign,
        )
        self.addCleanup(self.restore_role)
        with connection.cursor() as cursor:
            cursor.execute(f"SET ROLE {settings.RLS_ROLES['app']}")
            cursor.execute("SELECT set_config(%s, %s, false)", [PRINCIPAL_SETTING, str(self.tenant.user.pk)])

        self.assertEqual(ShareIssuanceRequest.objects.get(pk=foreign.pk), foreign)
        self.assertEqual(self.client.get(f"{BASE}?token={foreign.token_id}").json()["results"], [])
        self.assertEqual(self.listed()["count"], 1)

    def restore_role(self):
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
            cursor.execute("SELECT set_config(%s, NULL, false)", [PRINCIPAL_SETTING])


class CompanyIssueRequestHistoryTest(CompanyIssueCases, APITransactionTestCase):
    def submitted_issue(self):
        payload = self.issue_payload(shares=10, reason="New allocation")
        del payload["actor"]
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/v1/tokens/register-issues/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual(row["status"], "submitted")
        with use_operator():
            proposal = RegisterInstruction.objects.get(pk=row["uuid"])
        self.assertEqual(row["request"], str(proposal.request_id))
        return proposal

    def listed(self):
        response = self.client.get(f"{BASE}?token={self.token.pk}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_a_genuine_company_submission_appears_in_the_exact_token_history(self):
        proposal = self.submitted_issue()
        (row,) = self.listed()
        self.assertEqual(row["uuid"], str(proposal.request_id))
        self.assertEqual(
            (row["status"], row["amount"], row["recipientAddress"]),
            (RequestStatus.UNDER_REVIEW, 10, self.wallet.address.lower()),
        )
        with use_operator():
            self.assertEqual(proposal.request.submitted_by_id, self.owner.pk)
        self.assertFalse(self.issuance_node.broadcasts)

    def test_the_actual_company_apply_is_listed_without_a_fabricated_paid_source(self):
        proposal = self.submitted_issue()
        self.issue_decide(proposal, "approve")
        self.issue_decide(proposal, "apply")
        (row,) = self.listed()
        self.assertEqual((row["uuid"], row["status"]), (str(proposal.request_id), RequestStatus.APPROVED))
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(request_id=proposal.request_id)
            self.assertEqual(
                (execution.source_instruction_id, execution.authority, execution.executed_by_id),
                (proposal.pk, "company", self.owner.pk),
            )
            self.assertFalse(Subscription.objects.filter(issuance_request_id=proposal.request_id).exists())
        self.assertFalse(self.issuance_node.broadcasts)

    def test_the_nominee_cannot_read_issuer_history_for_its_own_wallet(self):
        proposal = self.submitted_issue()
        self.assertEqual([row["uuid"] for row in self.listed()], [str(proposal.request_id)])
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.listed(), [])
        self.assertEqual(self.client.get(BASE).json()["results"], [])


class ScopedCompanyIssueRequestHistoryTest(RunsOnTheScopedConnection, CompanyIssueRequestHistoryTest):
    pass
