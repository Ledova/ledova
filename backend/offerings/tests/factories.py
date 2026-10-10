from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth.models import Permission
from django.utils import timezone

from companies.services.editing import update_company
from offerings.models import Offering, OfferingStatus, Subscription, SubscriptionStatus
from offerings.services.subscription import create_draft
from operators.models import Operator
from shared.db import acting_for, use_migrate, use_operator
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.tenants import make_eligible
from users.models import InvestorCategory
from users.tests.factories import make_investor
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from whitelist.models import WhitelistEntry

BANK = {
    "bank_account_name": "Ledova Trust Account",
    "bank_bsb": "062000",
    "bank_account_number": "12345678",
    "payment_reference_prefix": "PAY",
    "receiving_wallet_address": "0x" + "d" * 40,
}


def forget_fixture_subscriptions():
    Subscription.objects.all().delete()


def configure_operator(stablecoin=None, **overrides):
    operator = Operator.get()
    for field, value in {**BANK, **overrides}.items():
        setattr(operator, field, value)
    operator.save()
    if stablecoin is not None:
        operator.supported_settlement_assets.add(stablecoin)
    return operator


def open_offering(tenant, stablecoin=None, **overrides):
    Offering.objects.filter(pk=tenant.offering.pk).update(
        status=OfferingStatus.APPROVED, opens_at=timezone.now() - timedelta(days=1), **overrides
    )
    tenant.offering.refresh_from_db()
    if stablecoin is not None:
        tenant.offering.settlement_assets.add(stablecoin)
    return tenant.offering


def eligible_subscriber(tenant, *, issuer_decision=None, category=InvestorCategory.PROFESSIONAL_INVESTOR):
    make_eligible(tenant)
    tenant.eligibility_decision = accept_company_eligibility(tenant, issuer_decision=issuer_decision, category=category)
    if issuer_decision is None:
        tenant.company = update_company(tenant.company, {"is_open_to_investors": True}, actor=tenant.user)
        assert tenant.company.is_open_to_investors
    tenant.account.refresh_from_db()
    return tenant.account


def subscription_technical_actor():
    with use_operator():
        actor, _ = make_investor(f"subscription-technical-{uuid4().hex}", staff=True)
    with use_migrate():
        actor.user_permissions.add(
            Permission.objects.get(content_type__app_label="offerings", codename="change_subscription")
        )
    return actor


def draft_subscription(tenant, quantity=10, offering=None, wallet=None, account=None):
    with acting_for(tenant.user.pk):
        return create_draft(
            offering or tenant.offering,
            account or tenant.account,
            wallet or tenant.wallet,
            quantity,
            submitted_by=tenant.user,
        )


def paid_subscription(tenant, quantity=10, allotted=None, wallet=None):
    subscription = draft_subscription(tenant, quantity=quantity, wallet=wallet)
    assert (subscription.eligibility_decision_id, subscription.submitted_at, subscription.accepted_at) == (
        None,
        None,
        None,
    )
    with use_migrate():
        Subscription.objects.filter(pk=subscription.pk).update(
            status=SubscriptionStatus.PAID,
            amount_received=Decimal(quantity) * subscription.price_per_share,
            payment_received_on=timezone.now().date(),
            allotted_quantity=allotted,
            reference=f"PAY{str(subscription.uuid).replace('-', '')[:8].upper()}",
        )
    subscription.refresh_from_db()
    assert (subscription.eligibility_decision_id, subscription.submitted_at, subscription.accepted_at) == (
        None,
        None,
        None,
    )
    return subscription


def extra_wallet(tenant, suffix):
    wallet = Wallet.objects.create(
        user_account=tenant.account,
        address="0x" + suffix * 40,
        chain="base",
        verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        verified_at=timezone.now(),
    )
    WhitelistEntry.objects.create(wallet=wallet)
    return wallet


def retained_paid_execution(subscription, actor, *, signed_client=None):
    from blockchain.services import outgoing
    from shared.db import atomic
    from shared.tests.retained_rows import retained_rows
    from tokens.models import (
        RegisterInstruction,
        ShareIssuanceExecution,
        ShareIssuanceRequest,
    )
    from tokens.services import issuance_execution
    from tokens.services.register_openings import _retain
    from tokens.tests.instruction_fixtures import (
        instruction_payload,
        instruction_reviewer,
        verified_authority,
    )
    from tokens.tests.issuance_fixtures import KEY
    from tokens.tests.retained_guards import INSTRUCTION_GUARDS, ISSUANCE_GUARDS

    with use_migrate(), retained_rows(*(ISSUANCE_GUARDS + INSTRUCTION_GUARDS)):
        with use_operator(), atomic(durable=True):
            subscription.refresh_from_db()
            request = ShareIssuanceRequest.objects.create(
                token=subscription.offering.token,
                recipient_address=subscription.wallet.address,
                amount=subscription.allotment_quantity,
                submitted_by=actor,
                reason="Retained paid subscription allotment",
            )
            request.approve(actor)
            subscription.issuance_request = request
            subscription.save(update_fields=["issuance_request", "updated_at"])
        with use_operator():
            reviewer = instruction_reviewer()
            document = verified_authority(subscription.company, reviewer)
            payload = instruction_payload(subscription.offering.token, document, [subscription])
            proposal = RegisterInstruction(
                uuid=payload["operation_id"],
                company_id=subscription.company_id,
                token_id=subscription.offering.token_id,
                kind="issue",
                items=payload["items"],
                approving_director=payload["approving_director"],
                authority_reference=payload["authority_reference"],
                reason=payload["reason"],
            )
            owner = subscription.company.owner
            with atomic():
                _retain(proposal, document.pk, owner)
                proposal.status = "applied"
                proposal.reviewed_by_id = reviewer.pk
                proposal.reviewed_at = timezone.now()
                proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
            command = ShareIssuanceExecution.objects.create(
                pk=request.dispatch_id,
                request_id=request.pk,
                subscription_id=subscription.pk,
                token_id=request.token_id,
                company_id=request.company_id,
                executed_by_id=actor.pk,
                authority=issuance_execution.SUBSCRIPTION_AUTHORITY,
                intent=issuance_execution._intent(request, subscription.offering.token),
            )
            if signed_client is not None:
                command = issuance_execution._start(ShareIssuanceExecution.objects.get(pk=command.pk))
                claim = issuance_execution._claim(command)
                prepared = outgoing.prepare_operation(claim, signed_client)
                outgoing.sign_operation(
                    claim,
                    prepared,
                    KEY,
                    on_signed=lambda attempt: issuance_execution._record_signed(command.pk, attempt),
                )
    return request, ShareIssuanceExecution.objects.get(pk=command.pk)
