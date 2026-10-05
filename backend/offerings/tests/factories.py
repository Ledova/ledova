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
from tokens.tests.instruction_fixtures import apply_instruction
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
    Subscription.objects.filter(pk=subscription.pk).update(
        status=SubscriptionStatus.PAID,
        amount_received=Decimal(quantity) * subscription.price_per_share,
        payment_received_on=timezone.now().date(),
        allotted_quantity=allotted,
        reference=f"PAY{str(subscription.uuid).replace('-', '')[:8].upper()}",
    )
    subscription.refresh_from_db()
    return subscription


def instruct(*subscriptions):
    for subscription in subscriptions:
        subscription.refresh_from_db()
    return apply_instruction(subscriptions[0].offering.token, *subscriptions)


def allottable_subscription(tenant, quantity=10, allotted=None, wallet=None):
    subscription = paid_subscription(tenant, quantity=quantity, allotted=allotted, wallet=wallet)
    instruct(subscription)
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
