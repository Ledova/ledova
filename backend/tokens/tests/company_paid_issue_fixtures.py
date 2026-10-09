from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.utils import timezone

from companies.services.authority_requests import _requester_principal
from companies.services.editing import update_company
from offerings.models import Offering, OfferingExemption, SettlementRail
from offerings.services.offering import submit_offering, transition_offering
from offerings.services.subscription import (
    accept,
    confirm_payment,
    create_draft,
    issue_instruction,
    submit,
)
from offerings.tests.factories import configure_operator, subscription_technical_actor
from shared.db import use_operator
from tokens.models import RegisterEvidenceKind, ShareIssuanceExecution
from tokens.services import issuance_execution
from tokens.services.register_paid_issues import (
    decide_paid_issue,
    prepare_paid_issue,
    preview_paid_issue_decision,
)
from tokens.tests.company_issue_fixtures import CompanyIssueCases
from tokens.tests.evidence_fixtures import upload_evidence


class CompanyPaidIssueCases(CompanyIssueCases):
    def setUp(self):
        super().setUp()
        self.technical = subscription_technical_actor()
        self.company = update_company(self.company, {"is_open_to_investors": True}, actor=self.owner)
        with use_operator():
            configure_operator()
            self.offer = Offering.objects.create(
                token=self.token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=Decimal("2.50"),
                minimum_shares=1,
                target_shares=100,
                cap_shares=100,
                maximum_shares=100,
                opens_at=timezone.now(),
                summary="Exact paid company issue terms",
            )
            submit_offering(self.offer, submitted_by=self.owner)
            transition_offering(self.offer, "approve", reviewed_by=self.technical)
            self.offer.refresh_from_db()
        self.enterContext(patch("tokens.services.register_paid_issues.chain_snapshot", return_value=(100, 0, 0)))
        self.enterContext(patch("tokens.services.issuance_execution._enqueue"))
        self.subscription = self.genuine_paid_subscription()

    def genuine_paid_subscription(self, *, quantity=25, received=None, final=False):
        with use_operator(), _requester_principal(self.participant.pk):
            subscription = create_draft(self.offer, self.account, self.wallet, quantity, submitted_by=self.participant)
            submit(subscription, submitted_by=self.participant)
        with use_operator(), _requester_principal(self.technical.pk):
            accept(subscription)
            issue_instruction(subscription, SettlementRail.BANK_TRANSFER)
            confirm_payment(
                subscription,
                amount_received=received if received is not None else Decimal(quantity) * Decimal("2.50"),
                received_on=timezone.now().date(),
                confirmed_by=self.technical,
                reference_seen=subscription.reference,
                accept_as_final=final,
            )
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, "paid")
        self.assertIsNotNone(subscription.eligibility_decision_id)
        self.assertIsNotNone(subscription.accepted_at)
        self.assertIsNotNone(subscription.payment_confirmed_at)
        return subscription

    def paid_payload(self, **changes):
        actor = changes.get("actor", self.owner)
        appointment = changes.get("appointment", self.initial)
        evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
        values = dict(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.initial.pk,
            subscription=changes["subscription"] if "subscription" in changes else self.subscription.pk,
            approving_director="Synthetic Director",
            authority_reference="PAID-ISSUE-RESOLUTION",
            reason="Allot the actual paid whole shares",
            authority_evidence=evidence.pk,
        )
        values.update(changes)
        values["appointment"] = getattr(values["appointment"], "pk", values["appointment"])
        return values

    def prepare_paid_issue(self, **changes):
        return prepare_paid_issue(**self.paid_payload(**changes))

    def paid_decide(self, proposal, kind, **changes):
        actor = changes.pop("actor", self.owner)
        appointment = changes.pop("appointment", self.initial.pk)
        reason = changes.pop("reason", "")
        _, prepared = preview_paid_issue_decision(
            actor=actor, paid_issue_id=proposal.pk, appointment=appointment, kind=kind, reason=reason
        )
        values = dict(
            actor=actor,
            paid_issue_id=proposal.pk,
            appointment=appointment,
            kind=kind,
            reason=reason,
            idempotency_key=uuid4(),
            preview_digest=prepared["preview_digest"],
            confirmation=True,
        )
        values.update(changes)
        return decide_paid_issue(**values), values

    def applied_paid_issue(self, **changes):
        proposal = self.prepare_paid_issue(**changes)
        self.paid_decide(proposal, "approve")
        return self.paid_decide(proposal, "apply")[0]

    def execute_paid_issue(self, proposal):
        with use_operator():
            execution = ShareIssuanceExecution.objects.get(source_instruction=proposal)
            return issuance_execution.recover(execution.pk)


def admit_paid_for_company_case(case, *, quantity=10):
    case.technical = subscription_technical_actor()
    case.company = update_company(case.company, {"is_open_to_investors": True}, actor=case.owner)
    with use_operator():
        configure_operator()
        case.offer = Offering.objects.create(
            token=case.token,
            exemption=OfferingExemption.PROFESSIONAL,
            price_per_share=Decimal("2.50"),
            minimum_shares=1,
            target_shares=100,
            cap_shares=100,
            maximum_shares=100,
            opens_at=timezone.now(),
            summary="Actual paid compatibility issue",
        )
        submit_offering(case.offer, submitted_by=case.owner)
        transition_offering(case.offer, "approve", reviewed_by=case.technical)
        case.offer.refresh_from_db()
    subscription = CompanyPaidIssueCases.genuine_paid_subscription(case, quantity=quantity)
    with patch("tokens.services.register_paid_issues.chain_snapshot", return_value=(100, 0, 0)), patch(
        "tokens.services.issuance_execution._enqueue"
    ):
        payload = CompanyPaidIssueCases.paid_payload(case, subscription=subscription.pk)
        proposal = prepare_paid_issue(**payload)
        for kind in ("approve", "apply"):
            _, preview = preview_paid_issue_decision(
                actor=case.owner, paid_issue_id=proposal.pk, appointment=case.initial.pk, kind=kind
            )
            proposal = decide_paid_issue(
                actor=case.owner,
                paid_issue_id=proposal.pk,
                appointment=case.initial.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
    return subscription, proposal
