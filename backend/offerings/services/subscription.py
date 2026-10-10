import json
import logging
from contextlib import contextmanager
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal
from uuid import uuid4

from django.db import IntegrityError, connections
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from companies.models import CompanyStatus
from companies.services.authority_requests import _requester_principal
from offerings.exceptions import (
    InvalidSubscriptionTransitionException,
    SubscriptionRefusedException,
)
from offerings.models import (
    MONEY_ALREADY_IN,
    Offering,
    SettlementRail,
    Subscription,
    SubscriptionStatus,
)
from offerings.services.payments import (
    REFERENCE_ATTEMPTS,
    generate_reference,
    normalize_tx_hash,
    raw_settlement_amount,
)
from operators.models import Operator
from shared.db import atomic, current_alias, principal_of, use_operator
from tokens.models import (
    RequestStatus,
    ShareIssuanceRequest,
    ShareTokenStatus,
)
from tokens.services import share_token_service
from users.services.company_eligibility_consumption import (
    require_subscription_acceptance_eligibility,
    require_subscription_eligibility,
)
from wallets.models import Wallet

logger = logging.getLogger(__name__)

DEFAULT_PAYMENT_WINDOW = timedelta(days=7)
CLAIMED_STATUSES = (RequestStatus.EXECUTING, RequestStatus.EXECUTED)

OFFERING_NOT_OPEN = "The {symbol} offering is not open for subscription."
BELOW_MINIMUM = "The {symbol} offering asks for at least {minimum} shares; this subscription asks for {quantity}."
ABOVE_MAXIMUM = "The {symbol} offering allows at most {maximum} shares per investor; this one asks for {quantity}."
ABOVE_CAP = "The {symbol} offering is capped at {cap} shares; this one asks for {quantity}."
WALLET_NOT_ON_ACCOUNT = "That wallet does not belong to the subscribing account."
RAIL_NOT_OFFERED = "The {symbol} offering does not settle by {rail}."
ASSET_NOT_OFFERED = "{symbol} is not a settlement asset of this offering."
ASSET_REQUIRED = "A stablecoin settlement must name the settlement asset."
EXPIRY_NOTE = "Payment was not received by {due}; the subscription lapsed."
EXPIRY_LEFT_ALONE = (
    "Subscription {reference} is past its payment due date but money has landed against it since the sweep "
    "read the row; it stays open for an operator instead of being closed over the payment: {detail}"
)
TX_HASH_REQUIRED = "A stablecoin payment must carry the transfer hash, so one transfer cannot fund two subscriptions."
TX_HASH_ALREADY_USED = "{tx_hash} already funds another subscription."
RECEIVED_NOT_POSITIVE = "The amount received must be greater than zero."
REFUND_NOT_POSITIVE = (
    "A refund must be greater than zero. Recording a zero or negative refund would close the money out of the "
    "record without returning a cent of it."
)
REFUND_ABOVE_HELD = (
    "{amount} is more than the {refundable} still returnable against {reference}: {received} arrived and "
    "{refunded} has already gone back."
)
PAYMENT_RESTATED_DOWN = (
    "The amount received against {reference} was restated down from {before} to {after}. The row now carries only "
    "{after}; the earlier figure survives in the preceding entry of this row's admin history."
)
REFERENCE_SEEN_REUSED = (
    "That statement line is already recorded against {others}. Bank settlement is operator-attested so this is "
    "not refused, but one line must not fund two subscriptions: check the statement before allotting."
)
NOTHING_COVERED = (
    "{received} covers no whole share at {price} each. Refund it instead of accepting it as the final payment."
)
NO_REQUEST_TO_RETRY = "This subscription has no issuance request yet; allot it first."
ISSUANCE_ALREADY_CLAIMED = (
    "Issuance request {uuid} is {status}, so the shares are already claimed on chain. "
    "{verb} is refused while that mint stands; the money cannot go back while the shares stay out."
)
MINT_BROADCAST = (
    "Issuance request {uuid} broadcast mint {tx_hash} and never confirmed it, so those shares may be out. "
    "{verb} is refused until that mint is resolved: the executing sweep completes it if it was mined and "
    "clears the hash if it reverted, and only then is the money free to move."
)


def _quantize(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


def amount_for(offering: Offering, quantity: int) -> Decimal:
    return _quantize(Decimal(quantity) * offering.price_per_share)


def _check_bounds(offering: Offering, quantity: int) -> None:
    symbol = offering.token.symbol
    if quantity < offering.minimum_shares:
        raise SubscriptionRefusedException(
            BELOW_MINIMUM.format(symbol=symbol, minimum=offering.minimum_shares, quantity=quantity)
        )
    if offering.maximum_shares is not None and quantity > offering.maximum_shares:
        raise SubscriptionRefusedException(
            ABOVE_MAXIMUM.format(symbol=symbol, maximum=offering.maximum_shares, quantity=quantity)
        )
    if quantity > offering.cap_shares:
        raise SubscriptionRefusedException(ABOVE_CAP.format(symbol=symbol, cap=offering.cap_shares, quantity=quantity))


def _require_open(offering: Offering) -> None:
    if not (
        offering.is_open
        and offering.token.status == ShareTokenStatus.DEPLOYED
        and offering.token.contract_address
        and offering.token.company.status == CompanyStatus.ACTIVE
        and offering.token.company.is_open_to_investors
    ):
        raise SubscriptionRefusedException(OFFERING_NOT_OPEN.format(symbol=offering.token.symbol))


@contextmanager
def subscription_admission_operation(operation, **command):
    with use_operator():
        command_connection = connections[current_alias()]
        setting = "app.subscription_admission_command"
        with command_connection.cursor() as cursor:
            cursor.execute("SELECT current_setting(%s, true)", [setting])
            previous = cursor.fetchone()[0] or ""
            cursor.execute(
                "SELECT set_config(%s, %s, false)",
                [setting, json.dumps({"operation": operation, **command}, default=str)],
            )
        try:
            try:
                with atomic():
                    yield
            except IntegrityError as error:
                if getattr(error.__cause__, "sqlstate", None) == "23514":
                    raise SubscriptionRefusedException(
                        "The exact subscription no longer has current admission."
                    ) from error
                raise
        finally:
            with command_connection.cursor() as cursor:
                cursor.execute("SELECT set_config(%s, %s, false)", [setting, previous])


def _admission_principal(actor):
    if actor is None or not actor.is_authenticated:
        raise PermissionDenied("A subscription requires its actual account holder.")
    principal = principal_of()
    if principal != str(actor.pk):
        raise PermissionDenied("The subscription actor differs from the current participant.")
    return actor.pk


def _admission_command(subscription, decision):
    offering = subscription.offering
    account = subscription.user_account
    return {
        "subscription": subscription.pk,
        "company": offering.company_id,
        "token": offering.token_id,
        "offering": offering.pk,
        "wallet": subscription.wallet_id,
        "account": account.pk,
        "profile": account.user_profile_id,
        "holder": account.user_profile.user_id,
        "decision": decision.pk,
        "request": decision.request_id,
        "source": decision.request.source_id,
        "quantity": subscription.quantity,
        "price_per_share": subscription.price_per_share,
        "currency": subscription.currency,
        "amount_due": subscription.amount_due,
    }


def _lock_admission():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT offerings_lock_subscription_admission()")


def _current_subscription(subscription):
    return Subscription.objects.select_related(
        "offering__token__company", "user_account__user_profile", "wallet", "eligibility_decision__request"
    ).get(pk=subscription.pk)


def _require_frozen_economics(subscription):
    offering = subscription.offering
    _require_open(offering)
    _check_bounds(offering, subscription.quantity)
    if (
        subscription.company_id != offering.company_id
        or offering.company_id != offering.token.company_id
        or subscription.price_per_share != offering.price_per_share
        or subscription.currency != offering.price_currency
        or subscription.amount_due != amount_for(offering, subscription.quantity)
    ):
        raise SubscriptionRefusedException("The subscription's frozen offering terms have changed.")


def _require_holder(account, actor_id):
    if account.user_profile.user_id != actor_id:
        raise PermissionDenied("A subscription requires its actual account holder.")


def _require_technical_acceptance():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT offerings_subscription_acceptance_authorized("
            "NULLIF(current_setting('app.user_id', true), '')::bigint)"
        )
        if cursor.fetchone()[0] is not True:
            raise PermissionDenied("Subscription acceptance requires the current technical change permission.")


def create_draft(offering: Offering, user_account, wallet, quantity: int, submitted_by=None) -> Subscription:
    actor_id = _admission_principal(submitted_by)
    with use_operator(), _requester_principal(actor_id), atomic():
        current_offering = Offering.objects.select_related("token__company").get(pk=offering.pk)
        current_wallet = Wallet.objects.get(pk=wallet.pk)
        current_account = type(user_account).objects.select_related("user_profile").get(pk=user_account.pk)
        _require_holder(current_account, actor_id)
        if current_wallet.user_account_id != current_account.pk:
            raise SubscriptionRefusedException(WALLET_NOT_ON_ACCOUNT)
        candidate = Subscription(
            uuid=uuid4(),
            offering=current_offering,
            company_id=current_offering.company_id,
            company_name=current_offering.token.company.display_name,
            token_name=current_offering.token.name,
            token_symbol=current_offering.token.symbol,
            currency=current_offering.price_currency,
            user_account=current_account,
            wallet=current_wallet,
            submitted_by=submitted_by,
            quantity=quantity,
            price_per_share=current_offering.price_per_share,
            amount_due=amount_for(current_offering, quantity),
        )
        _require_frozen_economics(candidate)
        outcome = require_subscription_eligibility(current_account, current_offering, quantity)
        with subscription_admission_operation("draft", **_admission_command(candidate, outcome.decision)):
            _lock_admission()
            candidate.offering = Offering.objects.select_related("token__company").get(pk=current_offering.pk)
            _require_frozen_economics(candidate)
            require_subscription_eligibility(
                current_account, candidate.offering, quantity, decision_id=outcome.decision.pk
            )
            candidate.save(force_insert=True)
            candidate.refresh_from_db()
            return candidate


def submit(subscription: Subscription, submitted_by=None) -> Subscription:
    actor_id = _admission_principal(submitted_by)
    with use_operator(), _requester_principal(actor_id), atomic():
        current = _current_subscription(subscription)
        _require_holder(current.user_account, actor_id)
        current._require_status([SubscriptionStatus.DRAFT], SubscriptionStatus.SUBMITTED)
        _require_frozen_economics(current)
        outcome = require_subscription_eligibility(current.user_account, current.offering, current.quantity)
        with subscription_admission_operation("submit", **_admission_command(current, outcome.decision)):
            _lock_admission()
            current = _current_subscription(current)
            _require_frozen_economics(current)
            outcome = require_subscription_eligibility(
                current.user_account, current.offering, current.quantity, decision_id=outcome.decision.pk
            )
            current.submit(submitted_by=submitted_by, eligibility_decision=outcome.decision)
            subscription.refresh_from_db()
            logger.info(f"Subscription {current.uuid} submitted for {current.offering.token.symbol}")
            return subscription


def accept(subscription: Subscription) -> Subscription:
    principal = principal_of()
    with use_operator(), _requester_principal(principal or ""), atomic():
        _require_technical_acceptance()
        current = _current_subscription(subscription)
        current._require_status([SubscriptionStatus.SUBMITTED], SubscriptionStatus.ACCEPTED)
        if current.eligibility_decision_id is None:
            require_subscription_acceptance_eligibility(current)
        with subscription_admission_operation("accept", **_admission_command(current, current.eligibility_decision)):
            _require_frozen_economics(current)
            require_subscription_acceptance_eligibility(current)
            _lock_admission()
            current = _current_subscription(current)
            _require_frozen_economics(current)
            require_subscription_acceptance_eligibility(current)
            current.accept()
            subscription.refresh_from_db()
            return subscription


def _rail_asset(offering: Offering, rail: str, settlement_asset):
    if rail == SettlementRail.BANK_TRANSFER:
        if not offering.accepts_bank_transfer:
            raise SubscriptionRefusedException(
                RAIL_NOT_OFFERED.format(symbol=offering.token.symbol, rail="bank transfer")
            )
        return None
    if settlement_asset is None:
        raise SubscriptionRefusedException(ASSET_REQUIRED)
    if not offering.settlement_assets.filter(pk=settlement_asset.pk).exists():
        raise SubscriptionRefusedException(ASSET_NOT_OFFERED.format(symbol=settlement_asset.symbol))
    return settlement_asset


def _due_at(offering: Offering, due_at):
    moment = due_at or timezone.now() + DEFAULT_PAYMENT_WINDOW
    if offering.closes_at is not None and moment > offering.closes_at:
        return offering.closes_at
    return moment


def issue_instruction(subscription: Subscription, rail: str, settlement_asset=None, due_at=None) -> Subscription:
    offering = subscription.offering
    asset = _rail_asset(offering, rail, settlement_asset)
    amount = None if asset is None else raw_settlement_amount(subscription.amount_due, asset)[0]
    moment = _due_at(offering, due_at)
    operator = Operator.get()

    for attempt in range(REFERENCE_ATTEMPTS):
        try:
            with atomic():
                subscription.mark_awaiting_payment(
                    rail=rail,
                    settlement_asset=asset,
                    settlement_amount=amount,
                    reference=generate_reference(operator),
                    due_at=moment,
                )
            return subscription
        except IntegrityError:
            logger.warning(f"Payment reference collided for subscription {subscription.uuid}, attempt {attempt + 1}")
            subscription.refresh_from_db()
    raise SubscriptionRefusedException(f"Could not issue a unique payment reference after {REFERENCE_ATTEMPTS} tries.")


def _scaled_quantity(subscription: Subscription, received: Decimal) -> int:
    covered = (received / subscription.price_per_share).to_integral_value(rounding=ROUND_DOWN)
    return min(subscription.quantity, int(covered))


def _locked(subscription: Subscription) -> Subscription:
    return Subscription.objects.select_for_update().get(pk=subscription.pk)


@atomic()
def confirm_payment(
    subscription: Subscription,
    confirmed_by,
    amount_received: Decimal,
    received_on,
    reference_seen: str = "",
    tx_hash: str = "",
    notes: str = "",
    accept_as_final: bool = False,
) -> Subscription:
    locked = _locked(subscription)
    received = _quantize(amount_received)
    if received <= 0:
        raise SubscriptionRefusedException(RECEIVED_NOT_POSITIVE)
    _refuse_if_issuance_claimed(locked, "Restating the payment")
    tx_hash = normalize_tx_hash(tx_hash)
    if locked.settlement_rail == SettlementRail.STABLECOIN and not tx_hash:
        raise SubscriptionRefusedException(TX_HASH_REQUIRED)
    if tx_hash and Subscription.objects.filter(payment_tx_hash=tx_hash).exclude(pk=locked.pk).exists():
        raise SubscriptionRefusedException(TX_HASH_ALREADY_USED.format(tx_hash=tx_hash))

    allotted, refund, status = _payment_outcome(locked, received, accept_as_final)
    try:
        with atomic():
            locked.record_payment(
                status=status,
                allotted_quantity=allotted,
                refund_amount=refund,
                confirmed_by=confirmed_by,
                amount_received=received,
                payment_received_on=received_on,
                payment_reference_seen=reference_seen,
                payment_tx_hash=tx_hash,
                payment_notes=notes,
            )
    except IntegrityError as exc:
        if not tx_hash:
            raise
        raise SubscriptionRefusedException(TX_HASH_ALREADY_USED.format(tx_hash=tx_hash)) from exc
    subscription.refresh_from_db()
    return subscription


def subscriptions_sharing_statement_line(subscription: Subscription) -> list[str]:
    line = (subscription.payment_reference_seen or "").strip()
    if not line:
        return []
    others = (
        Subscription.objects.filter(payment_reference_seen__iexact=line)
        .exclude(pk=subscription.pk)
        .exclude(status__in=[SubscriptionStatus.REJECTED, SubscriptionStatus.WITHDRAWN])
        .order_by("created_at")
    )
    return [row.reference or str(row.uuid) for row in others]


def payment_warnings(subscription: Subscription, previous_amount) -> list[str]:
    warnings = []
    if previous_amount is not None and subscription.amount_received < previous_amount:
        warnings.append(
            PAYMENT_RESTATED_DOWN.format(
                reference=subscription.reference or subscription.uuid,
                before=previous_amount,
                after=subscription.amount_received,
            )
        )
    others = subscriptions_sharing_statement_line(subscription)
    if others:
        warnings.append(REFERENCE_SEEN_REUSED.format(others=", ".join(others)))
    return warnings


def _payment_outcome(subscription: Subscription, received: Decimal, accept_as_final: bool):
    if received >= subscription.amount_due:
        overpaid = received - subscription.amount_due
        return subscription.allotted_quantity, (overpaid or None), SubscriptionStatus.PAID
    if not accept_as_final:
        return subscription.allotted_quantity, subscription.refund_amount, SubscriptionStatus.AWAITING_PAYMENT
    allotted = _scaled_quantity(subscription, received)
    if allotted < 1:
        raise SubscriptionRefusedException(
            NOTHING_COVERED.format(received=received, price=subscription.price_per_share)
        )
    residual = received - _quantize(Decimal(allotted) * subscription.price_per_share)
    return allotted, (residual or None), SubscriptionStatus.PAID


def _linked_request(subscription: Subscription):
    if subscription.issuance_request_id is None:
        return None
    return ShareIssuanceRequest.objects.get(pk=subscription.issuance_request_id)


def _already_claimed(request: ShareIssuanceRequest, verb: str) -> SubscriptionRefusedException:
    return SubscriptionRefusedException(
        ISSUANCE_ALREADY_CLAIMED.format(uuid=request.uuid, status=request.get_status_display().lower(), verb=verb)
    )


def _refuse_if_the_mint_is_out(request: ShareIssuanceRequest, verb: str) -> None:
    if request.status in CLAIMED_STATUSES:
        raise _already_claimed(request, verb)
    issuance = share_token_service.broadcast_mint(request)
    if issuance is not None:
        raise SubscriptionRefusedException(
            MINT_BROADCAST.format(uuid=request.uuid, tx_hash=issuance.tx_hash, verb=verb)
        )


def _refuse_if_issuance_claimed(subscription: Subscription, verb: str) -> None:
    request = _linked_request(subscription)
    if request is None:
        return
    _refuse_if_the_mint_is_out(request, verb)
    if request.status == RequestStatus.REJECTED:
        return
    raise _already_claimed(request, verb)


def _refuse_the_issuance(subscription: Subscription, verb: str) -> None:
    from tokens.exceptions import IssuanceExecutionConflict
    from tokens.services.issuance_execution import cancel_queued

    request = _linked_request(subscription)
    if request is None:
        return
    if request.status in CLAIMED_STATUSES:
        raise _already_claimed(request, verb)
    try:
        if cancel_queued(request, subscription):
            return
    except IssuanceExecutionConflict as exc:
        raise SubscriptionRefusedException(
            "The issuance cannot be cancelled. Resolve its recorded execution before refunding."
        ) from exc
    _refuse_if_the_mint_is_out(request, verb)
    if request.status == RequestStatus.REJECTED:
        return
    raise _already_claimed(request, verb)


@atomic()
def record_refund(subscription: Subscription, amount: Decimal, reference: str = "", notes: str = "") -> Subscription:
    locked = _locked(subscription)
    value = _quantize(amount)
    if value <= 0:
        raise SubscriptionRefusedException(REFUND_NOT_POSITIVE)
    refundable = locked.amount_refundable
    if not (locked.status == SubscriptionStatus.ALLOTTED and value <= refundable):
        _refuse_the_issuance(locked, "A refund")
    if value > refundable:
        raise SubscriptionRefusedException(
            REFUND_ABOVE_HELD.format(
                amount=value,
                refundable=refundable,
                reference=locked.reference or locked.uuid,
                received=locked.amount_received or Decimal("0.00"),
                refunded=locked.refunded_total,
            )
        )
    locked.mark_refunded(amount=value, reference=reference, notes=notes)
    subscription.refresh_from_db()
    logger.info(f"Refund of {value} recorded against subscription {subscription.uuid}")
    return subscription


def _refuse_if_money_in(subscription: Subscription) -> None:
    if subscription.has_money_in:
        raise SubscriptionRefusedException(
            MONEY_ALREADY_IN.format(
                amount=subscription.money_held, reference=subscription.reference or subscription.uuid
            )
        )


@atomic()
def reject(subscription: Subscription, reason: str) -> Subscription:
    locked = _locked(subscription)
    _refuse_if_issuance_claimed(locked, "Rejecting it")
    _refuse_if_money_in(locked)
    locked.reject(notes=reason)
    subscription.refresh_from_db()
    return subscription


@atomic()
def withdraw(subscription: Subscription, reason: str = "") -> Subscription:
    locked = _locked(subscription)
    _refuse_if_issuance_claimed(locked, "Withdrawing it")
    _refuse_if_money_in(locked)
    locked.withdraw(notes=reason)
    subscription.refresh_from_db()
    return subscription


def expire_overdue(moment, limit: int) -> dict:
    expired = 0
    left_alone = []
    for subscription in Subscription.objects.unpaid_past_due(moment)[:limit]:
        reference = subscription.reference or str(subscription.uuid)
        try:
            reject(subscription, EXPIRY_NOTE.format(due=subscription.payment_due_at.isoformat()))
        except (SubscriptionRefusedException, InvalidSubscriptionTransitionException) as exc:
            left_alone.append(reference)
            logger.warning(EXPIRY_LEFT_ALONE.format(reference=reference, detail=exc.detail))
            continue
        expired += 1
    return {"expired": expired, "left_alone": left_alone}


def cap_headroom(offering: Offering) -> int:
    committed = Subscription.objects.for_offering(offering).committed_to_shares().share_commitment()
    return offering.cap_shares - committed


def share_supply_snapshot(offering: Offering, service=None) -> tuple[int, int]:
    service = service or share_token_service
    return service.share_supply(offering.token.contract_address)


def _unminted(offering: Offering) -> int:
    return ShareIssuanceRequest.objects.unminted(offering.token).share_total()


def chain_snapshot(offering: Offering, service=None) -> tuple[int, int, int]:
    authorized, issued = share_supply_snapshot(offering, service)
    return authorized, issued, _unminted(offering)


def offering_headroom(offering: Offering, service=None, supply=None) -> tuple[int, int]:
    if supply is None:
        authorized, issued, unminted = chain_snapshot(offering, service)
    else:
        authorized, issued, unminted_when_read = supply
        unminted = max(unminted_when_read, _unminted(offering))
    return cap_headroom(offering), authorized - issued - unminted


def _residual_owed(subscription: Subscription, allotted: int):
    residual = subscription.money_held - _quantize(Decimal(allotted) * subscription.price_per_share)
    return residual if residual > 0 else None


@atomic()
def scale_back(offering: Offering) -> dict:
    locked = Offering.objects.select_for_update().get(pk=offering.pk)
    pending = list(Subscription.objects.for_offering(locked).awaiting_allotment().order_by("created_at"))
    requested = sum(subscription.allotment_quantity for subscription in pending)
    room = cap_headroom(locked)
    if requested <= room or requested == 0:
        return {"scaled": 0, "requested": requested, "room": room}

    scaled = 0
    for subscription in pending:
        base = subscription.allotment_quantity
        allotted = max(min(base, base * room // requested), 0)
        if allotted == base:
            continue
        subscription.allotted_quantity = allotted
        subscription.refund_amount = _residual_owed(subscription, allotted)
        subscription.save(update_fields=["allotted_quantity", "refund_amount", "updated_at"])
        scaled += 1
    logger.info(f"Scaled {scaled} subscriptions of {locked.token.symbol} from {requested} into {room} shares")
    return {"scaled": scaled, "requested": requested, "room": room}


def retry_allotment(subscription: Subscription, operator_user, *, confirmed) -> Subscription:
    from tokens.services.issuance_execution import admit

    request = subscription.issuance_request
    if request is None:
        raise SubscriptionRefusedException(NO_REQUEST_TO_RETRY)
    admit(request, operator_user, confirmed=confirmed, subscription=subscription)
    return subscription


def executed_requests_pending_allotment():
    return Subscription.objects.executed_but_not_allotted().select_related("issuance_request")
