from datetime import timedelta
from unittest.mock import Mock, patch

from django.conf import settings
from django.db import DatabaseError
from django.test import TestCase, TransactionTestCase

from integrations.base_chain.client import (
    HTTP_TIMEOUT_SECONDS,
    BaseChainClient,
)
from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.models import (
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.serializers import CapitalIncreaseDetailSerializer
from tokens.services.dilution import dilution_for

RECIPIENT = "0x" + "a" * 40


def issuance_request(token, amount=10, **fields):
    return ShareIssuanceRequest.objects.create(
        token=token, recipient_address=RECIPIENT, recipient_name="Alice", amount=amount, reason="Bonus", **fields
    )


class ReviewableRequestModelTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("owner")
        self.token = self.tenant.deployed_token

    def test_completed_supply_feeds_dilution_for_both_request_types(self):
        self.assertEqual(dilution_for(self.tenant.capital_increase), 0.0)
        ShareIssuance.objects.create(token=self.token, recipient_address=RECIPIENT, amount="900", status="completed")
        ShareIssuance.objects.create(token=self.token, recipient_address=RECIPIENT, amount="500", status="pending")

        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 900)
        self.assertEqual(dilution_for(self.tenant.capital_increase), 10.0)
        self.assertEqual(dilution_for(issuance_request(self.token, amount=100)), 10.0)

    def test_new_request_requires_admission_before_claiming_execution(self):
        request = issuance_request(self.token)
        staff = make_tenant("staff", staff=True).user
        with self.assertRaisesMessage(
            DatabaseError, "Fresh paid and nonpaid approval requires its retained company decision"
        ), atomic():
            request.approve(staff)
        with self.assertRaises(ValueError):
            request.mark_executing()
        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.filter(pk=request.pk).update(status=RequestStatus.EXECUTING)
        request.refresh_from_db()
        self.assertEqual((request.status, request.reviewed_by_id), (RequestStatus.SUBMITTED, None))

    def test_issuance_request_starts_submitted_and_can_be_rejected(self):
        request = issuance_request(self.token)
        self.assertEqual(request.status, RequestStatus.SUBMITTED)
        request.start_review(self.tenant.user)
        request.reject(self.tenant.user, reason="Not now")
        self.assertEqual((request.status, request.rejection_reason), (RequestStatus.REJECTED, "Not now"))
        with self.assertRaises(ValueError):
            request.mark_executing()

    def test_the_detail_says_a_draft_can_be_submitted_and_offers_no_edit(self):
        data = CapitalIncreaseDetailSerializer(self.tenant.capital_increase).data
        self.assertEqual(data["status"], "draft")
        self.assertTrue(data["can_be_submitted"])
        self.assertNotIn("can_be_edited", data)
        self.assertIsNone(data["dilution_percentage"])


class BaseChainClientTimeoutTest(TestCase):

    def test_the_http_provider_uses_the_configured_timeout(self):
        with patch("integrations.base_chain.client.Web3") as web3:
            web3.HTTPProvider.return_value = Mock()
            web3.return_value.eth.chain_id = settings.BLOCKCHAIN_CHAIN_ID
            BaseChainClient._web3 = None
            try:
                BaseChainClient()
            finally:
                BaseChainClient._web3 = None

        self.assertEqual(web3.HTTPProvider.call_args.kwargs["request_kwargs"], {"timeout": HTTP_TIMEOUT_SECONDS})


class CompanyReviewRequestAdmissionTest(TransactionTestCase):
    def setUp(self):
        from tokens.tests.issuance_fixtures import install_issuance

        install_issuance(self)

    def test_the_exact_company_decision_and_retained_admission_are_required_before_execution(self):
        from tokens.services import issuance_execution
        from tokens.tests.issuance_fixtures import admit

        with self.assertRaises(ValueError):
            self.request.mark_executing()
        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(status=RequestStatus.APPROVED)
        command = admit(self.request, self.actor)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.APPROVED)
        with self.assertRaises(DatabaseError), atomic():
            self.request.mark_executing()
        self.assertEqual(issuance_execution._start(command).status, "executing")
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.EXECUTING)
        self.assertFalse(self.attempts.exists())
        self.assertFalse(self.node.broadcasts)


class CompanyCapitalRequestAdmissionTest(TransactionTestCase):
    def setUp(self):
        from tokens.tests.capital_fixtures import install_capital

        install_capital(self)

    def test_human_approval_retains_the_request_and_only_the_exact_apply_admits_execution(self):
        from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest
        from tokens.tests.capital_fixtures import admit

        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.UNDER_REVIEW)
        self.assertIsNone(self.request.reviewed_by_id)
        self.assertFalse(self.request.can_be_submitted)
        self.assertFalse(CapitalIncreaseExecution.objects.filter(request_id=self.request.pk).exists())
        with self.assertRaises(DatabaseError), atomic():
            self.request.approve(self.actor, notes="Staff approval cannot replace the company decision")
        with self.assertRaises(DatabaseError), atomic():
            CapitalIncreaseRequest.objects.filter(pk=self.request.pk).update(status=RequestStatus.APPROVED)
        command = admit(self.request, self.actor)
        self.request.refresh_from_db()
        self.proposal.refresh_from_db()
        self.assertEqual((self.request.status, self.request.reviewed_by_id), (RequestStatus.EXECUTING, self.actor.pk))
        self.assertEqual(command.source_increase_id, self.proposal.pk)
        self.assertEqual(self.proposal.status, "applied")
        self.assertIsNotNone(self.proposal.approval_decision_id)
        self.assertTrue(self.request.reviewed_at)
        self.assertFalse(self.attempts.exists())
        self.assertFalse(self.node.broadcasts)


class SyntheticCompanyCapitalSeedTest(TransactionTestCase):
    def setUp(self):
        from tokens.tests.capital_fixtures import install_capital

        install_capital(self)
        self.company_capital.capital_decide(self.proposal, "reject", reason="Use the seed's exact proposal")

    def item(self, status):
        from types import SimpleNamespace

        from django.utils import timezone

        prior = timezone.now() - timedelta(days=30)
        return SimpleNamespace(
            key="demo-capital",
            share_class="demo/ORD",
            status=status,
            additional=100,
            new_total=1100,
            purpose="Synthetic company cap-only raise",
            board_reference="SYNTHETIC-BOARD",
            created_at=prior,
            submitted_at=None if status == "draft" else prior + timedelta(hours=1),
            decided_at=prior + timedelta(days=1),
            decision="A smaller replacement is needed",
        )

    def records(self):
        from types import SimpleNamespace

        return SimpleNamespace(classes={"demo/ORD": self.token}, owner=lambda key: self.owner, run=lambda: None)

    def test_a_retained_synthetic_draft_has_no_company_decision_or_execution(self):
        from shared.seeds.synthetic.chain.classes import apply_raise
        from tokens.models import CapitalIncreaseExecution, RegisterCapitalIncrease

        item = self.item("draft")
        request = apply_raise(item, self.records())
        self.assertEqual((request.status, request.created_at), ("draft", item.created_at))
        self.assertFalse(RegisterCapitalIncrease.objects.filter(request=request).exists())
        self.assertFalse(CapitalIncreaseExecution.objects.filter(request_id=request.pk).exists())

    def test_a_synthetic_rejection_is_the_companys_evidenced_decision(self):
        from shared.seeds.synthetic.chain.classes import apply_raise
        from tokens.models import CapitalIncreaseExecution, RegisterCapitalIncrease

        records = self.records()
        request = apply_raise(self.item("rejected"), records)
        proposal = RegisterCapitalIncrease.objects.get(request=request)
        self.assertEqual((request.status, request.rejection_reason), ("rejected", "A smaller replacement is needed"))
        self.assertEqual(proposal.reviewed_by_id, self.owner.pk)
        self.assertEqual(proposal.authority_evidence.uploaded_by_id, self.owner.pk)
        self.assertTrue(proposal.file.read())
        self.assertFalse(CapitalIncreaseExecution.objects.filter(request_id=request.pk).exists())

    def test_a_synthetic_raise_runs_the_original_company_job_without_staff_capital_approval(self):
        from blockchain.models import SignedAttempt
        from shared.seeds.synthetic.chain.classes import apply_raise
        from shared.seeds.synthetic.chain.deferred import captured
        from tokens.models import CapitalIncreaseExecution, RegisterCapitalIncrease
        from tokens.tasks import execute_review_request_task

        records = self.records()
        with captured() as deferrals, patch("tokens.services.capital_execution._enqueue", self.company_capital.enqueue):
            records.run = lambda: deferrals.run({execute_review_request_task.name: execute_review_request_task})
            request = apply_raise(self.item("executed"), records)
        proposal = RegisterCapitalIncrease.objects.get(request=request)
        execution = CapitalIncreaseExecution.objects.get(request_id=request.pk)
        self.token.refresh_from_db()
        self.assertEqual((request.status, self.token.total_supply), ("executed", "1100"))
        self.assertEqual((request.reviewed_by_id, execution.executed_by_id), (self.owner.pk, self.owner.pk))
        self.assertEqual(execution.source_increase_id, proposal.pk)
        self.assertIsNotNone(proposal.approval_decision_id)
        self.assertEqual(SignedAttempt.objects.filter(operation=execution.operation).count(), 1)
        self.assertFalse(ShareIssuance.objects.filter(token=self.token).exists())


class ScopedSyntheticCompanyCapitalSeedTest(RunsOnTheScopedConnection, SyntheticCompanyCapitalSeedTest):
    def setUp(self):
        with use_operator():
            super().setUp()

    def test_a_retained_synthetic_draft_has_no_company_decision_or_execution(self):
        with use_operator():
            super().test_a_retained_synthetic_draft_has_no_company_decision_or_execution()

    def test_a_synthetic_rejection_is_the_companys_evidenced_decision(self):
        with use_operator():
            super().test_a_synthetic_rejection_is_the_companys_evidenced_decision()

    def test_a_synthetic_raise_runs_the_original_company_job_without_staff_capital_approval(self):
        with use_operator():
            super().test_a_synthetic_raise_runs_the_original_company_job_without_staff_capital_approval()
