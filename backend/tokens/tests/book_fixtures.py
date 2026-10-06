from datetime import timedelta
from decimal import Decimal
from itertools import count
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.core.cache import cache
from django.db.models import Q
from django.test import override_settings
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY, admitted_signer
from feature_flags.models import FeatureFlag
from operators.models import Operator
from shared.db import acting_for, use_operator
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.tenants import make_eligible, make_tenant
from shared.utils.typed_data import signable_message
from tokens.models import (
    OrderActionStatus,
    OrderSubmissionStatus,
    SwapOrder,
    TransferOrder,
    TransferOrderType,
)
from tokens.services import atomic_swap_service, swap_execution
from tokens.services.held_orders import place_held_orders
from tokens.services.market_data_service import market_summaries
from tokens.services.order_actions import execute_order_action, issue_order_action
from tokens.services.swap_expiry import expire_unclaimed_swap
from tokens.services.trading_order_create import (
    execute_order_submission,
    issue_order_submission,
)
from tokens.services.trading_order_service import TradingOrderService
from tokens.tests.swap_execution_fixtures import ExecutionNode
from tokens.tests.swap_state_fixtures import CONTRACT
from wallets.models import Wallet

BUY = TransferOrderType.BUY
SELL = TransferOrderType.SELL
FINALIZED = {f"evm:{CHAIN_ID}": {"mode": "finalized"}}
_keys = count(1)


def _key():
    return Account.from_key("0x" + "7a" * 30 + f"{next(_keys):04x}")


def _signature(key, challenge):
    return key.sign_message(
        signable_message(challenge["domain"], challenge["types"], challenge["message"])
    ).signature.to_0x_hex()


class BookFixtures:
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)
        self.enterContext(
            override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, ATOMIC_SWAP_ADDRESS=CONTRACT)
        )
        self.keys = {}
        self.events = []
        chain = Mock(chain_id=CHAIN_ID)
        chain.is_valid_address.side_effect = Web3.is_address
        chain.to_checksum_address.side_effect = Web3.to_checksum_address
        whitelist = Mock()
        whitelist.is_whitelisted.return_value = True
        balances = Mock()
        balances.get_token_balance.return_value = 10**30
        for target, replacement in (
            ("tokens.services.token_transfer_service.get_base_chain_client", Mock(return_value=chain)),
            ("tokens.services.token_transfer_service.whitelist", whitelist),
            ("tokens.services.share_token_service", balances),
            ("tokens.services.order_modification_service.share_token_service", balances),
            ("tokens.events._publish", Mock(side_effect=lambda event, payload: self.events.append(event))),
            ("rest_framework.throttling.SimpleRateThrottle.allow_request", Mock(return_value=True)),
        ):
            self.enterContext(patch(target, new=replacement))
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.traders = [self.trader(f"book-{index}") for index in range(4)]
            issuer = self.traders[0].tenant
            Operator.get().supported_settlement_assets.set([issuer.refs.stablecoin])
            TransferOrder.objects.all().delete()
            admitted_signer(chain_id=CHAIN_ID)
        self.token = issuer.deployed_token
        self.issuer_decision = accept_company_eligibility(issuer)
        for trader in self.traders[1:]:
            accept_company_eligibility(trader.tenant, issuer_decision=self.issuer_decision)

    def trader(self, label):
        tenant = make_tenant(label, with_swap=False)
        make_eligible(tenant)
        trader = SimpleNamespace(tenant=tenant, user=tenant.user, account=tenant.account)
        trader.wallet = self.wallet(trader)
        return trader

    def wallet(self, trader):
        key = _key()
        self.keys[key.address.lower()] = (key, trader)
        return Wallet.objects.create(
            user_account=trader.account, address=key.address, chain="base", verification_status="VERIFIED"
        )

    def signed_submission(self, trader, side, quantity, price, *, minimum=0, wallet=None):
        wallet = wallet or trader.wallet
        data = {
            "submission_id": uuid4(),
            "owner_account_uuid": trader.account.pk,
            "token": self.token.pk,
            "order_type": side,
            "wallet_uuid": wallet.pk,
            "wallet_address": Web3.to_checksum_address(wallet.address),
            "quantity": quantity,
            "min_quantity": minimum,
            "price_per_share": Decimal(price),
            "wallet": wallet,
            "owner_account": trader.account,
        }
        key = self.keys[wallet.address.lower()][0]
        with acting_for(trader.user.pk):
            challenge = issue_order_submission(trader.user, data).challenge
        return trader.user, {**data, "digest": challenge["digest"], "signature": _signature(key, challenge)}

    def created(self, result):
        self.assertEqual(result.submission.status, OrderSubmissionStatus.CREATED, result.submission.refusal_detail)
        with use_operator():
            return TransferOrder.objects.get(pk=result.submission.order_id)

    def place(self, trader, side, quantity, price, *, minimum=0, wallet=None):
        user, data = self.signed_submission(trader, side, quantity, price, minimum=minimum, wallet=wallet)
        with acting_for(user.pk):
            result = execute_order_submission(user, data)
        return self.created(result)

    def act(self, order, purpose, **values):
        key, trader = self.keys[order.wallet_address.lower()]
        data = {"action_id": uuid4(), "owner_account_uuid": trader.account.pk}
        if values:
            data.update(
                new_quantity=values.get("quantity", order.quantity),
                new_min_quantity=values.get("minimum", order.min_quantity),
                new_price_per_share=Decimal(values.get("price", order.price_per_share)),
            )
        with acting_for(trader.user.pk):
            challenge = issue_order_action(trader.user, order.pk, purpose, data).challenge
            result = execute_order_action(
                trader.user,
                order.pk,
                purpose,
                data,
                {"digest": challenge["digest"], "signature": _signature(key, challenge)},
            )
        self.assertEqual(result.action.status, OrderActionStatus.APPLIED, result.action.refusal_detail)
        return self.current(order)

    def cancel(self, order):
        return self.act(order, "cancel")

    def modify(self, order, **values):
        return self.act(order, "modify", **values)

    def pending(self, order):
        with use_operator():
            return SwapOrder.objects.pending().get(Q(sell_order_id=order.pk) | Q(buy_order_id=order.pk))

    def lapse(self, swap):
        with use_operator():
            snapshot = SwapOrder.objects.get(pk=swap.pk)
            self.assertTrue(expire_unclaimed_swap(snapshot, snapshot.expires_at + timedelta(seconds=1)))

    def execute(self, swap, *, status=1):
        with use_operator():
            swap = SwapOrder.objects.get(pk=swap.pk)
            signable = encode_typed_data(full_message=atomic_swap_service.get_typed_data(swap))
            for participant, address in (("seller", swap.seller_address), ("buyer", swap.buyer_address)):
                key, trader = self.keys[address.lower()]
                with acting_for(trader.user.pk):
                    swap = swap_execution.submit_signature(
                        swap,
                        key.sign_message(signable).signature.to_0x_hex(),
                        key.address,
                        user=trader.user,
                        participant=participant,
                    )
            record = swap.transaction
            node = ExecutionNode(record.function_args)
            node.status = status
            self.assertEqual(
                swap_execution.recover(record.pk, client=node.client), "confirmed" if status else "reverted"
            )
            node.advance(head=20, finalized=12)
            with override_settings(WALLET_CHAIN_FINALITY_POLICIES=FINALIZED):
                return swap_execution.settle(record.pk, client=node.client)

    def settle_match(self, swap):
        self.assertEqual(self.execute(swap), "completed")

    def revert_match(self, swap):
        self.assertEqual(self.execute(swap, status=0), "failed")

    def current(self, order):
        with use_operator():
            return TransferOrder.objects.get(pk=order.pk)

    def sweep(self):
        with use_operator():
            return place_held_orders()

    def book(self):
        with use_operator():
            book = TradingOrderService.get_order_book(self.token)
        return (
            [(Decimal(level["price"]), level["quantity"]) for level in book["buy_orders"]],
            [(Decimal(level["price"]), level["quantity"]) for level in book["sell_orders"]],
        )

    def assert_uncrossed(self):
        bids, asks = self.book()
        if bids and asks:
            self.assertLess(bids[0][0], asks[0][0], f"The book is crossed: bids {bids}, asks {asks}")
        with use_operator():
            summary = market_summaries([self.token])[self.token.pk]
        self.assertEqual(
            (summary["best_bid"], summary["best_ask"]),
            tuple(f"{side[0][0]:.2f}" if side else None for side in (bids, asks)),
        )

    def assert_state(self, order, status, filled):
        order = self.current(order)
        self.assertEqual((order.status, order.filled_quantity), (status, filled))
        return order
