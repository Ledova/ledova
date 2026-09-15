import hashlib
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation, localcontext
from uuid import UUID, uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import IntegrityError, connections
from django.db.models import Q
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from rest_framework.exceptions import PermissionDenied
from web3 import Web3

from assets.models import Asset
from assets.services import sync as asset_sync
from blockchain.models import OutgoingOperation
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias
from shared.utils.admin_display import format_units
from tokens.exceptions import NAVUpdateConflict
from tokens.models import NAVUpdate, NAVUpdateMode, NAVUpdateStatus, YieldToken

TRANSACTION_FIELDS = ("chain_id", "sender", "to", "value", "data")
TERM_FIELDS = ("new_nav_per_token", "total_reserve_value", "custodian_report_ref", "notes")
CONFIRMATION_SALT = "tokens.nav.submission"


def require_boundary():
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("NAV updates require operator authority.")
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise NAVUpdateConflict("NAV recovery requires autocommit outside every transaction block.")


def _actor(actor_id):
    actor = get_user_model().objects.select_for_update().filter(pk=actor_id).first()
    if actor is None or not actor.is_active or not actor.is_staff or not actor.has_perm("tokens.change_yieldtoken"):
        raise PermissionDenied("NAV updates require current permission to change the yield token.")
    return actor


def _amount(value, *, positive):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or (positive and amount == 0) or amount >= Decimal("1e14"):
            raise ValueError
        if amount != amount.quantize(Decimal("0.000001")):
            raise ValueError
        return amount
    except (InvalidOperation, ValueError, TypeError):
        raise NAVUpdateConflict("NAV values must fit the six-decimal valuation fields without rounding.") from None


def _terms(new_nav_per_token, total_reserve_value, custodian_report_ref, notes):
    if not isinstance(custodian_report_ref, str) or len(custodian_report_ref) > 200 or not isinstance(notes, str):
        raise NAVUpdateConflict("The NAV scenario reference or notes are invalid.")
    return {
        "new_nav_per_token": _amount(new_nav_per_token, positive=True),
        "total_reserve_value": _amount(total_reserve_value, positive=False),
        "custodian_report_ref": custodian_report_ref,
        "notes": notes,
    }


def _raw(amount, decimals):
    with localcontext() as context:
        context.prec = 100
        raw = amount * (Decimal(10) ** decimals)
    if raw != raw.to_integral_value() or not 0 <= raw < 2**256:
        raise NAVUpdateConflict("The NAV values cannot be represented exactly by the token's units.")
    return int(raw)


def _intent(token, mode, terms, asset_id):
    if not token.is_active or type(token.decimals) is not int or not 0 <= token.decimals <= 77:
        raise NAVUpdateConflict("The yield token is inactive or has unsupported units.")
    identity = {
        "token_id": str(token.pk),
        "symbol": token.symbol,
        "decimals": token.decimals,
        "contract_address": token.contract_address.lower(),
        "asset_id": str(asset_id) if asset_id else None,
    }
    if mode == NAVUpdateMode.LOCAL:
        return identity
    nav_raw = _raw(terms["new_nav_per_token"], token.decimals)
    reserve_raw = _raw(terms["total_reserve_value"], token.decimals)
    try:
        transaction = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            sender=Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address,
            to=token.contract_address,
            data=Web3.keccak(text="updateNAV(uint256,uint256)")[:4]
            + encode(["uint256", "uint256"], [nav_raw, reserve_raw]),
        )
        if transaction["to"] is None or transaction["to"] == "0x" + "0" * 40:
            raise ValueError
    except (TypeError, ValueError, AttributeError, outgoing.OutgoingTransactionError):
        raise NAVUpdateConflict("The NAV chain, contract or signer is not configured.") from None
    return identity | transaction | {"nav_raw": str(nav_raw), "reserve_raw": str(reserve_raw)}


@contextmanager
def target_transaction(contract_address):
    lock_id = int.from_bytes(
        hashlib.sha256(f"nav:{contract_address.lower()}".encode()).digest()[:8], "big", signed=True
    )
    with atomic(durable=True):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id])
        yield


def operation_key(update):
    return f"nav-update:{update.pk}"


def transaction_intent(update):
    return {field: update.intent[field] for field in TRANSACTION_FIELDS}


def _same_submission(previous, token, actor, mode, terms):
    if (
        previous.mode != mode
        or previous.yield_token_id != token.pk
        or previous.updated_by_id != actor.pk
        or any(getattr(previous, field) != terms[field] for field in TERM_FIELDS)
    ):
        raise NAVUpdateConflict("This NAV UUID already identifies different terms, authority or historical work.")


def submit(
    token,
    user,
    submission_id,
    new_nav_per_token,
    total_reserve_value,
    *,
    update_on_chain=False,
    custodian_report_ref="",
    notes="",
):
    from tokens.tasks.nav import recover_nav_update

    require_boundary()
    try:
        submission_id = UUID(str(submission_id))
    except (TypeError, ValueError):
        raise NAVUpdateConflict("A NAV submission requires a valid UUID.") from None
    if type(update_on_chain) is not bool:
        raise NAVUpdateConflict("The NAV execution mode must be a boolean.")
    mode = NAVUpdateMode.CHAIN if update_on_chain else NAVUpdateMode.LOCAL
    terms = _terms(new_nav_per_token, total_reserve_value, custodian_report_ref, notes)
    try:
        with target_transaction(token.contract_address):
            current = YieldToken.objects.select_for_update().get(pk=token.pk)
            actor = _actor(user.pk)
            previous = NAVUpdate.objects.select_for_update().filter(pk=submission_id).first()
            if previous:
                _same_submission(previous, current, actor, mode, terms)
                return previous
            if current.contract_address.lower() != token.contract_address.lower():
                raise NAVUpdateConflict("The NAV target changed while waiting for admission.")
            asset_id = Asset.objects.filter(symbol=current.symbol).values_list("pk", flat=True).first()
            intent = _intent(current, mode, terms, asset_id)
            refused = (
                NAVUpdate.objects.unresolved()
                .filter(Q(yield_token=current) | Q(intent__contract_address=intent["contract_address"]))
                .exists()
            )
            update = NAVUpdate.objects.create(
                pk=submission_id,
                yield_token=current,
                updated_by=actor,
                old_nav_per_token=current.nav_per_token or Decimal("0"),
                mode=mode,
                intent=intent,
                **terms,
                status=NAVUpdateStatus.FAILED if refused else NAVUpdateStatus.QUEUED,
                completed_at=timezone.now() if refused else None,
            )
            if not refused:
                if mode == NAVUpdateMode.CHAIN:
                    recover_nav_update.defer(submission_id=str(update.pk))
                else:
                    update.status = NAVUpdateStatus.APPLIED
                    update.save(update_fields=["status", "updated_at"])
                    _apply(update, current)
            return update
    except IntegrityError:
        raise NAVUpdateConflict("A competing NAV submission already owns this identity or target.") from None


def locked_update(update_id, *, authorize=False):
    saved = NAVUpdate.objects.get(pk=update_id)
    token = YieldToken.objects.select_for_update().get(pk=saved.yield_token_id)
    if authorize:
        _actor(saved.updated_by_id)
    update = NAVUpdate.objects.select_for_update().get(pk=update_id)
    if update.intent is None or update.yield_token_id != token.pk:
        raise NAVUpdateConflict("Historical NAV work has no admitted execution identity.")
    identity = update.intent
    if (str(token.pk), token.symbol, token.decimals, token.contract_address.lower()) != (
        identity["token_id"],
        identity["symbol"],
        identity["decimals"],
        identity["contract_address"],
    ):
        raise NAVUpdateConflict("The admitted NAV token identity changed.")
    if (
        authorize
        and _intent(token, update.mode, {field: getattr(update, field) for field in TERM_FIELDS}, identity["asset_id"])
        != identity
    ):
        raise NAVUpdateConflict("The NAV configuration changed after admission.")
    return update, token


def decide(update_id):
    with atomic(durable=True):
        update, _ = locked_update(update_id, authorize=True)
        if update.status == NAVUpdateStatus.QUEUED:
            update.status = NAVUpdateStatus.EXECUTING
            update.save(update_fields=["status", "updated_at"])
        return update


def refuse_unsigned(update_id):
    with atomic(durable=True):
        update, _ = locked_update(update_id)
        if (
            update.status == NAVUpdateStatus.QUEUED
            and not OutgoingOperation.objects.filter(operation_key=operation_key(update)).exists()
        ):
            update.status = NAVUpdateStatus.FAILED
            update.completed_at = timezone.now()
            update.save(update_fields=["status", "completed_at", "updated_at"])
        return update


def _apply(update, token):
    completed = timezone.now()
    if update.status in (NAVUpdateStatus.APPLIED, NAVUpdateStatus.CONFIRMED):
        token.nav_per_token = update.new_nav_per_token
        token.total_reserve_value = update.total_reserve_value
        token.last_nav_update = completed
        token.save(update_fields=["nav_per_token", "total_reserve_value", "last_nav_update", "updated_at"])
        if update.intent["asset_id"]:
            asset = (
                Asset.objects.select_for_update()
                .filter(pk=update.intent["asset_id"], symbol=update.intent["symbol"])
                .first()
            )
            if asset is None:
                raise NAVUpdateConflict("The admitted NAV asset identity is no longer available.")
            snapshot = asset_sync.update_price(asset, update.new_nav_per_token, source="nav_update")
            snapshot.market_data = {
                "total_reserve_value": str(update.total_reserve_value),
                "custodian_report_ref": update.custodian_report_ref,
            }
            snapshot.save(update_fields=["market_data", "updated_at"])
    update.completed_at = completed
    update.save(update_fields=["completed_at", "updated_at"])


def project(update_id):
    with atomic(durable=True):
        saved = NAVUpdate.objects.get(pk=update_id)
        if saved.completed_at is not None or saved.mode == NAVUpdateMode.HISTORICAL:
            return saved
        if saved.operation_id:
            OutgoingOperation.objects.select_for_update().get(pk=saved.operation_id)
        update, token = locked_update(update_id)
        if update.completed_at is None and update.status in (NAVUpdateStatus.CONFIRMED, NAVUpdateStatus.FAILED):
            _apply(update, token)
        return update


def confirmation(token, user):
    return signing.dumps({"token": str(token.pk), "actor": user.pk, "submission": str(uuid4())}, salt=CONFIRMATION_SALT)


def submission_from_confirmation(value, token, user):
    try:
        payload = signing.loads(value, salt=CONFIRMATION_SALT)
        if payload["token"] != str(token.pk) or payload["actor"] != user.pk:
            raise ValueError
        return UUID(payload["submission"])
    except (signing.BadSignature, ValueError, TypeError, KeyError):
        raise NAVUpdateConflict("The NAV form belongs to a different token or staff session.") from None


def chain_info(token):
    client = get_base_chain_client()
    contract = client.load_contract("AUSG", Web3.to_checksum_address(token.contract_address))
    decimals = contract.functions.decimals().call()
    sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
    return {
        "navPerToken": format_units(contract.functions.navPerToken().call(), decimals),
        "totalSupplyFormatted": format_units(contract.functions.totalSupply().call(), decimals),
        "is_nav_updater": contract.functions.navUpdaters(sender).call(),
    }
