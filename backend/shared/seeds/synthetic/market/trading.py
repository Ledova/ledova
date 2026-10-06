from datetime import timedelta
from decimal import Decimal

from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from companies.services.authority_requests import _requester_principal
from integrations.base_chain import get_base_chain_client
from operators.settlement import require_deployment
from shared.db import use_operator
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.settlement import (
    BALANCE_METHODS,
    NOT_FUNDED,
    _set_balance,
)
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.market.context import seeded_id
from shared.seeds.synthetic.market.story import HELD
from shared.utils.token_amounts import token_base_units
from shared.utils.typed_data import signable_message
from tokens.models import (
    OrderActionPurpose,
    OrderActionStatus,
    OrderSubmissionStatus,
    SwapOrder,
    SwapOrderStatus,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.services import atomic_swap_service, swap_execution
from tokens.services.order_actions import execute_order_action, issue_order_action
from tokens.services.swap_expiry import expire_unclaimed_swap
from tokens.services.trading_order_access import resolve_exact_swap_context
from tokens.services.trading_order_create import (
    execute_order_submission,
    issue_order_submission,
)

TRANSACTION_INTEGERS = ("value", "gas", "gasPrice", "nonce", "chainId")
EXPIRY_DELAY = timedelta(seconds=1)
REFUSED = "The {side} order {key} was not created: {code} {detail}"
MISMATCHED = "The {side} order {key} matched {actual}, and the plan has it match {planned}."
NOT_CANCELLED = "The cancellation of {key} ended {status}."
NOT_EXPIRED = "The lapsed match of {key} did not expire."
NOT_HELD = "The order {key} ended {status} after its match lapsed, and the plan has it held back."
NOT_COMPLETED = "The trade {taker} against {maker} ended {status}."


def _sign(key, signable):
    return Account.sign_message(signable, private_key=key).signature.to_0x_hex()


def _party(order, market):
    wallet = market.wallet(order.investor, order.address)
    account = wallet.user_account
    return wallet, account, account.user_profile.user


def place(order, market):
    token = market.tokens[order.listing]
    wallet, account, user = _party(order, market)
    data = {
        "submission_id": seeded_id("order", order.key),
        "owner_account_uuid": account.pk,
        "token": token.pk,
        "order_type": order.side,
        "wallet_uuid": wallet.pk,
        "wallet_address": Web3.to_checksum_address(wallet.address),
        "quantity": order.quantity,
        "min_quantity": 0,
        "price_per_share": order.price,
        "wallet": wallet,
        "owner_account": account,
    }
    key = market.keyring.key(wallet.address)
    with use_operator(), _requester_principal(user.pk):
        issued = issue_order_submission(user, data)
        challenge = issued.challenge
        signature = _sign(key, signable_message(challenge["domain"], challenge["types"], challenge["message"]))
        result = execute_order_submission(user, {**data, "digest": challenge["digest"], "signature": signature})
    submission = result.submission
    if submission.status != OrderSubmissionStatus.CREATED:
        raise ChainStepFailed(
            REFUSED.format(
                side=order.side, key=order.key, code=submission.refusal_code, detail=submission.refusal_detail
            )
        )
    market.orders[order.key] = submission.order_id
    return submission


def matched(order, submission, maker_key, market):
    planned = market.orders.get(maker_key)
    if submission.initial_counter_order_id != planned:
        raise ChainStepFailed(
            MISMATCHED.format(
                side=order.side, key=order.key, actual=submission.initial_counter_order_id, planned=planned
            )
        )
    return SwapOrder.objects.get(pk=submission.initial_swap_id)


def cancel(order, market):
    transfer = TransferOrder.objects.get(pk=market.orders[order.key])
    _, account, user = _party(order, market)
    data = {"action_id": seeded_id("cancel", order.key), "owner_account_uuid": account.pk}
    key = market.keyring.key(order.address)
    with use_operator(), _requester_principal(user.pk):
        issued = issue_order_action(user, transfer.pk, OrderActionPurpose.CANCEL, data)
        challenge = issued.challenge
        signature = _sign(key, signable_message(challenge["domain"], challenge["types"], challenge["message"]))
        result = execute_order_action(
            user,
            transfer.pk,
            OrderActionPurpose.CANCEL,
            data,
            {"digest": challenge["digest"], "signature": signature},
        )
    if result.action.status != OrderActionStatus.APPLIED:
        raise ChainStepFailed(NOT_CANCELLED.format(key=order.key, status=result.action.status))
    return result.action


def lapse(fill, market):
    taker = market.plan.order(fill.taker)
    submission = place(taker, market)
    swap = matched(taker, submission, fill.maker, market)
    with frozen(swap.expires_at + EXPIRY_DELAY) as moment:
        if not expire_unclaimed_swap(swap, moment):
            raise ChainStepFailed(NOT_EXPIRED.format(key=fill.taker))
    if taker.fate == HELD:
        status = TransferOrder.objects.get(pk=market.orders[fill.taker]).status
        if status != TransferOrderStatus.HELD:
            raise ChainStepFailed(NOT_HELD.format(key=fill.taker, status=status))
    return swap


def fund(addresses, wei, provider):
    for address in sorted(addresses):
        if not _set_balance(provider, Web3.to_checksum_address(address), wei(address)):
            raise ChainStepFailed(NOT_FUNDED.format(methods=" nor ".join(BALANCE_METHODS), address=address))


def _approve(swap, role, order, wallet, user, market):
    allowance = atomic_swap_service.check_swap_allowances(swap)[role]
    if allowance["has_sufficient_allowance"]:
        return None
    prepared = atomic_swap_service.get_approval_transaction_data(swap, role, unlimited=True)
    transaction = {
        name: int(value, 16) if name in TRANSACTION_INTEGERS else value
        for name, value in prepared["transaction"].items()
        if name != "from"
    }
    raw = get_base_chain_client().sign_transaction(transaction, market.keyring.key(wallet.address))
    identity = {
        "swap_uuid": swap.pk,
        "owner_account_uuid": order.owner_account_id,
        "wallet_uuid": order.wallet_id,
        "settlement_digest": swap.settlement_digest,
    }
    return atomic_swap_service.broadcast_settlement_approval(
        swap,
        role,
        Web3.to_hex(raw),
        lambda snapshot: resolve_exact_swap_context(user, order.pk, identity, snapshot)[0],
        user.pk,
    )


def settle(swap, market):
    for role, order in (("seller", swap.sell_order), ("buyer", swap.buy_order)):
        wallet = order.wallet
        user = wallet.user_account.user_profile.user
        with use_operator(), _requester_principal(user.pk):
            _approve(swap, role, order, wallet, user, market)
            typed = atomic_swap_service.get_typed_data(swap)
            signature = _sign(market.keyring.key(wallet.address), encode_typed_data(full_message=typed))
            swap = swap_execution.submit_signature(swap, signature, wallet.address, user=user, participant=role)
    market.run()
    swap.refresh_from_db()
    if swap.status == SwapOrderStatus.EXECUTING and swap.transaction_id:
        swap_execution.settle(swap.transaction_id)
        swap.refresh_from_db()
    return swap


def trade(fill, market):
    taker = market.plan.order(fill.taker)
    submission = place(taker, market)
    swap = matched(taker, submission, fill.maker, market)
    payment = token_base_units(Decimal(fill.quantity) * fill.price, require_deployment(market.audy).decimals)
    if (swap.share_amount, swap.payment_amount) != (fill.quantity, payment):
        raise ChainStepFailed(NOT_COMPLETED.format(taker=fill.taker, maker=fill.maker, status="mispriced"))
    swap = settle(swap, market)
    if swap.status != SwapOrderStatus.COMPLETED:
        raise ChainStepFailed(NOT_COMPLETED.format(taker=fill.taker, maker=fill.maker, status=swap.status))
    market.swaps.append(swap.pk)
    return swap
