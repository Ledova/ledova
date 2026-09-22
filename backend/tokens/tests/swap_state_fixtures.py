import secrets
from unittest.mock import Mock, patch

from django.conf import settings
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from blockchain.models import BlockchainTransaction
from shared.db import use_operator
from shared.tests.settlement import save_swap_with_context
from shared.tests.tenants import make_eligible, make_tenant
from tokens.models import (
    SwapOrder,
    SwapOrderStatus,
    TransferOrder,
    TransferOrderStatus,
    TransferOrderType,
)
from tokens.services import atomic_swap_service, swap_execution
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

CONTRACT = "0x" + "9d" * 20
TX_HASH = "0x" + "ab" * 32
SELLER = Account.from_key("0x" + "31" * 32)
BUYER = Account.from_key("0x" + "32" * 32)
CONFIRMED = {"status": 1, "blockNumber": 7, "blockHash": "0x" + "ef" * 32, "gasUsed": 21000}


def swap_service(test_case):
    client = Mock(chain_id=settings.BLOCKCHAIN_CHAIN_ID)
    client.assert_expected_chain = Mock(return_value=settings.BLOCKCHAIN_CHAIN_ID)
    client.w3.eth.chain_id = settings.BLOCKCHAIN_CHAIN_ID
    client.to_checksum_address.side_effect = Web3.to_checksum_address
    test_case.enterContext(patch.object(atomic_swap_service, "get_base_chain_client", return_value=client))
    return atomic_swap_service


def make_swap(label, *, ready=False):
    with use_operator():
        return _make_swap(label, ready=ready)


def _make_swap(label, *, ready=False):
    tenant = make_tenant(label)
    make_eligible(tenant)
    orders = []
    for key, order_type in ((SELLER, TransferOrderType.SELL), (BUYER, TransferOrderType.BUY)):
        wallet = Wallet.objects.create(
            user_account=tenant.account,
            address=key.address,
            chain="base",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
        )
        orders.append(
            TransferOrder.objects.create(
                token=tenant.deployed_token,
                payment_asset=tenant.refs.stablecoin,
                wallet=wallet,
                owner_account=tenant.account,
                wallet_address=wallet.address,
                order_type=order_type,
                quantity=40,
                filled_quantity=30,
                price_per_share="1.50",
                status=TransferOrderStatus.PENDING_SIGNATURE,
            )
        )
    swap = SwapOrder(
        sell_order=orders[0],
        buy_order=orders[1],
        share_token=tenant.deployed_token,
        payment_asset=tenant.refs.stablecoin,
        seller_address=SELLER.address,
        buyer_address=BUYER.address,
        share_amount=10,
        payment_amount=1500,
        nonce=secrets.randbits(63),
        order_hash="0x" + secrets.token_hex(32),
    )
    save_swap_with_context(swap)
    if ready:
        signable = encode_typed_data(full_message=atomic_swap_service.get_typed_data(swap))
        swap.seller_signature = SELLER.sign_message(signable).signature.hex()
        swap.buyer_signature = BUYER.sign_message(signable).signature.hex()
        swap.status = SwapOrderStatus.READY
    swap.save()
    return swap


def persisted_outcome(swap):
    return (
        SwapOrder.objects.filter(pk=swap.pk).values().get(),
        list(BlockchainTransaction.objects.filter(related_uuid=swap.pk).order_by("pk").values()),
        list(TransferOrder.objects.filter(pk__in=[swap.sell_order_id, swap.buy_order_id]).order_by("pk").values()),
    )


def sign_swap(swap, signature, signer_address, participant="seller"):
    party = swap.sell_order if participant == "seller" else swap.buy_order
    return swap_execution.submit_signature(
        swap, signature, signer_address, user=party.owner_account.user_profile.user, participant=participant
    )
