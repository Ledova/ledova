import logging
from collections.abc import Mapping
from uuid import UUID

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connections
from django.db.models import Q
from django.utils import timezone
from eth_account import Account
from eth_utils import event_abi_to_log_topic
from rest_framework.exceptions import NotFound
from web3 import Web3

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    OutgoingStatus,
    TransactionStatus,
    TransactionType,
)
from blockchain.services import outgoing
from integrations.base_chain import get_base_chain_client
from shared.constants import BLOCKCHAIN_BASE
from shared.db import APP_ALIAS, atomic, current_alias, principal_of, use_operator
from shared.utils.blockchain import decode_exception_to_message
from tokens.constants import MAX_SWAP_RECEIPT_VALUE
from tokens.events import publish_trading_event
from tokens.exceptions import (
    AtomicSwapNotConfiguredException,
    SettlementContextChanged,
    SwapExpiredException,
    SwapNotReadyException,
    SwapSignatureException,
)
from tokens.models import (
    ShareToken,
    SwapOrder,
    SwapOrderStatus,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.services import atomic_swap_service
from tokens.services.register_inclusions import record_completed_effects
from tokens.services.settlement_context import (
    assert_current_settlement,
    recorded_settlement_context,
    settlement_execution_arguments,
    settlement_execution_calldata,
)
from tokens.services.trading_locks import lock_orders, swap_terms
from users.models import UserAccount, UserProfile
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import ChainObservationFinality, ChainObservationResult, Wallet
from wallets.services.chain_evidence import collect_chain_evidence
from wallets.services.chain_observations import finality_policy
from wallets.services.nonce_evidence import collect_nonce_evidence

logger = logging.getLogger(__name__)
REVERTED_ON_CHAIN = "Swap execution reverted on chain"


def require_autocommit():
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise SwapNotReadyException("Swap execution requires autocommit outside every transaction block.")


def operation_key(transaction):
    return f"swap-execution:{transaction.pk}"


def _admission(transaction):
    try:
        admission = transaction.function_args["admission"]
        actor_id = admission["actor_id"]
        if (
            set(admission) != {"version", "actor_id", "participant"}
            or type(admission["version"]) is not int
            or admission["version"] != 1
            or admission["participant"] not in ("seller", "buyer")
            or not isinstance(actor_id, str)
            or not 0 < int(actor_id) <= 2**63 - 1
            or str(int(actor_id)) != actor_id
            or transaction.tx_type != TransactionType.ATOMIC_SWAP
            or transaction.related_model != "tokens.SwapOrder"
            or transaction.function_name != "executeSwap"
        ):
            raise ValueError
    except (KeyError, TypeError, ValueError, AttributeError):
        raise SwapNotReadyException("The swap has no original execution admission.") from None
    return admission


def transaction_intent(transaction):
    _admission(transaction)
    arguments = transaction.function_args
    return outgoing.transaction_intent(
        chain_id=int(arguments["settlement"]["domain"]["chainId"]),
        sender=transaction.from_address,
        to=transaction.to_address,
        data=settlement_execution_calldata(arguments),
    )


def _lock_authority(swap, actor_id, participant):
    context = recorded_settlement_context(swap)
    if participant not in ("seller", "buyer"):
        raise NotFound("Swap not found.")
    party = context[participant]
    wallet = Wallet.objects.select_for_update(of=("self",), no_key=True).filter(pk=party["wallet_uuid"]).first()
    account = UserAccount.objects.select_for_update(no_key=True).filter(pk=party["owner_account_uuid"]).first()
    profile = UserProfile.objects.select_for_update().filter(pk=account.user_profile_id).first() if account else None
    actor = get_user_model().objects.select_for_update().filter(pk=actor_id).first()
    if (
        wallet is None
        or account is None
        or profile is None
        or actor is None
        or not actor.is_active
        or profile.user_id != actor.pk
        or wallet.user_account_id != account.pk
        or wallet.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED
        or wallet.chain not in ("ethereum", "base")
        or wallet.address.casefold() != party["address"].casefold()
    ):
        raise NotFound("Swap not found.")


def _lock_swap(snapshot):
    orders = {
        order.pk: order
        for order in lock_orders(TransferOrder.objects.filter(pk__in=[snapshot.sell_order_id, snapshot.buy_order_id]))
    }
    swap = SwapOrder.objects.select_for_update(of=("self",)).get(pk=snapshot.pk)
    if swap_terms(swap) != swap_terms(snapshot) or len(orders) != 2:
        raise SwapNotReadyException()
    swap.sell_order = orders[swap.sell_order_id]
    swap.buy_order = orders[swap.buy_order_id]
    return swap


def _lock_share_class(snapshot):
    return ShareToken.objects.select_for_update().get(pk=snapshot.share_token_id)


def _lock_command(transaction, *, authority=False):
    admission = _admission(transaction)
    snapshot = SwapOrder.objects.get(pk=transaction.related_uuid)
    if authority:
        _lock_authority(snapshot, admission["actor_id"], admission["participant"])
    swap = _lock_swap(snapshot)
    current = BlockchainTransaction.objects.select_for_update().get(pk=transaction.pk)
    if (
        swap.transaction_id != current.pk
        or current.function_args != {**settlement_execution_arguments(swap), "admission": admission}
        or current.function_args != transaction.function_args
        or current.from_address != transaction.from_address
        or current.to_address != recorded_settlement_context(swap)["typed_data"]["domain"]["verifyingContract"]
        or current.value != 0
    ):
        raise SwapNotReadyException("The original swap execution identity no longer matches.")
    if authority:
        if swap.status != SwapOrderStatus.EXECUTING:
            raise SwapNotReadyException()
        assert_current_settlement(swap)
        if swap.deadline_passed:
            raise SwapExpiredException()
    return swap, current


def submit_signature(swap_order, signature, signer_address, *, user, participant):
    from tokens.tasks.swap_reconciler import recover_swap_execution

    require_autocommit()
    if current_alias() == APP_ALIAS and principal_of() != str(user.pk):
        raise NotFound("Swap not found.")
    snapshot = SwapOrder.objects.get(pk=swap_order.pk)
    recorded_settlement_context(snapshot)
    terms = swap_terms(snapshot)
    signer = Web3.to_checksum_address(signer_address)
    if signer == Web3.to_checksum_address(snapshot.seller_address):
        is_seller = True
    elif signer == Web3.to_checksum_address(snapshot.buyer_address):
        is_seller = False
    else:
        raise SwapSignatureException("Signer is neither the buyer nor seller")
    if not atomic_swap_service.verify_signature(snapshot, signature, signer):
        raise SwapSignatureException("Invalid signature")
    if swap_terms(snapshot) != terms:
        raise SwapSignatureException("The swap changed while its signature was being checked")
    with use_operator(), atomic(durable=True):
        _lock_authority(snapshot, user.pk, participant)
        swap = _lock_swap(snapshot)
        stored = swap.seller_signature if is_seller else swap.buyer_signature
        if stored and stored != signature:
            raise SwapSignatureException("This party has already signed the swap")
        if stored and (swap.transaction_id is not None or swap.status != SwapOrderStatus.READY):
            if swap.transaction_id is not None:
                original = BlockchainTransaction.objects.get(pk=swap.transaction_id)
                try:
                    _admission(original)
                except SwapNotReadyException:
                    return swap
                _lock_command(original)
                recover_swap_execution.defer(transaction_id=str(original.pk))
            return swap
        assert_current_settlement(swap)
        if swap.deadline_passed:
            raise SwapExpiredException()
        if not stored:
            allowed = (
                (SwapOrderStatus.CREATED, SwapOrderStatus.BUYER_SIGNED)
                if is_seller
                else (SwapOrderStatus.CREATED, SwapOrderStatus.SELLER_SIGNED)
            )
            if swap.status not in allowed or swap.transaction_id is not None or swap.tx_hash:
                raise SwapNotReadyException()
            if is_seller:
                swap.add_seller_signature(signature)
            else:
                swap.add_buyer_signature(signature)
            publish_trading_event("swap_signed", str(swap.share_token_id))
        if not swap.is_ready:
            return swap
        if (
            swap.transaction_id is not None
            or swap.tx_hash
            or BlockchainTransaction.objects.filter(
                Q(related_model="tokens.SwapOrder") | Q(tx_type=TransactionType.ATOMIC_SWAP), related_uuid=swap.pk
            ).exists()
        ):
            raise SwapNotReadyException()
        try:
            relayer = Account.from_key(atomic_swap_service.configured_relayer_key())
        except (AtomicSwapNotConfiguredException, TypeError, ValueError):
            return swap
        arguments = {
            **settlement_execution_arguments(swap),
            "admission": {"version": 1, "actor_id": str(user.pk), "participant": participant},
        }
        transaction = BlockchainTransaction.objects.create(
            tx_type=TransactionType.ATOMIC_SWAP,
            status=TransactionStatus.PENDING,
            from_address=relayer.address,
            to_address=arguments["settlement"]["domain"]["verifyingContract"],
            function_name="executeSwap",
            function_args=arguments,
            related_model="tokens.SwapOrder",
            related_uuid=swap.pk,
        )
        swap.mark_executing(transaction=transaction)
        recover_swap_execution.defer(transaction_id=str(transaction.pk))
        return swap


def _claim(transaction):
    intent = transaction_intent(transaction)
    claim = outgoing.open_operation(
        operation_key(transaction),
        **{field: intent[field] for field in ("chain_id", "sender", "to", "data")},
        restart_of=UUID(int=0),
    )
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        _swap, current = _lock_command(transaction)
        if (
            operation.claim_id != claim.claim_id
            or operation.intent != intent
            or current.outgoing_operation_id not in (None, operation.pk)
        ):
            raise SwapNotReadyException()
        if current.outgoing_operation_id is None:
            current.outgoing_operation = operation
            current.save(update_fields=["outgoing_operation", "updated_at"])
    return claim


def _configuration(transaction):
    intent = transaction_intent(transaction)
    if Account.from_key(atomic_swap_service.configured_relayer_key()).address.lower() != intent["sender"]:
        raise SettlementContextChanged()
    with atomic(durable=True):
        _lock_command(transaction, authority=True)


def _signed(transaction, attempt):
    swap, current = _lock_command(transaction, authority=True)
    if current.outgoing_operation_id != attempt.operation_id:
        raise SwapNotReadyException()
    if (
        Account.from_key(atomic_swap_service.configured_relayer_key()).address.lower()
        != transaction_intent(current)["sender"]
    ):
        raise SettlementContextChanged()
    current.mark_submitted(attempt.tx_hash)
    swap.mark_executing(attempt.tx_hash, transaction=current)


def _original_chain(transaction, client):
    actual = client.w3.eth.chain_id
    if type(actual) is not int or actual != transaction_intent(transaction)["chain_id"]:
        raise SettlementContextChanged()


def _before_send(transaction, claim, client):
    _original_chain(transaction, client)
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        if operation.claim_id != claim.claim_id or operation.status != OutgoingStatus.SIGNED:
            raise SwapNotReadyException()
        outgoing._admitted_signer(operation.intent, lock=True)
        swap, current = _lock_command(transaction, authority=True)
        attempt = operation.current_attempt
        if (
            current.outgoing_operation_id != operation.pk
            or current.tx_hash != attempt.tx_hash
            or swap.tx_hash != attempt.tx_hash
        ):
            raise SwapNotReadyException()


def _verify_receipt(transaction, operation, client, receipt):
    intent = operation.intent
    if (
        not isinstance(receipt, Mapping)
        or outgoing._hex(receipt["transactionHash"], 32) != operation.current_attempt.tx_hash
        or not isinstance(receipt.get("from"), str)
        or receipt["from"].lower() != intent["sender"]
        or not isinstance(receipt.get("to"), str)
        or receipt["to"].lower() != intent["to"]
        or type(receipt["status"]) is not int
        or receipt["status"] not in (0, 1)
    ):
        raise SwapNotReadyException("The receipt does not identify the original swap transaction.")
    outgoing._integer(receipt["blockNumber"])
    outgoing._hex(receipt["blockHash"], 32)
    outgoing._integer(receipt["gasUsed"])
    if not isinstance(receipt["logs"], (list, tuple)):
        raise SwapNotReadyException()
    if receipt["status"] == 0:
        if receipt["logs"]:
            raise SwapNotReadyException()
        return
    event = client.load_contract("AtomicSwap", Web3.to_checksum_address(intent["to"])).events.SwapExecuted()
    topic = Web3.to_hex(event_abi_to_log_topic(event.abi))
    matches = [
        log
        for log in receipt["logs"]
        if log["address"].lower() == intent["to"] and log["topics"] and outgoing._hex(log["topics"][0], 32) == topic
    ]
    if len(matches) != 1:
        raise SwapNotReadyException("The receipt has no unique original swap event.")
    log = matches[0]
    if (
        outgoing._hex(log["transactionHash"], 32) != operation.current_attempt.tx_hash
        or outgoing._hex(log["blockHash"], 32) != outgoing._hex(receipt["blockHash"], 32)
        or type(log["blockNumber"]) is not int
        or log["blockNumber"] != receipt["blockNumber"]
        or log.get("removed", False) is not False
    ):
        raise SwapNotReadyException("The swap event does not belong to the original receipt.")
    values = event.process_log(log)["args"]
    arguments = transaction.function_args
    if outgoing._hex(values["orderHash"], 32) != arguments["settlement"]["digest"]:
        raise SwapNotReadyException()
    for field in ("seller", "buyer", "shareToken", "paymentToken"):
        if values[field].lower() != arguments[field].lower():
            raise SwapNotReadyException()
    for field in ("shareAmount", "paymentAmount", "nonce"):
        if type(values[field]) is not int or values[field] != int(arguments[field]):
            raise SwapNotReadyException()


def _observe(transaction, claim, client):
    operation = OutgoingOperation.objects.select_related("current_attempt").get(pk=claim.operation_id)
    if operation.claim_id != claim.claim_id or operation.status != OutgoingStatus.SIGNED:
        return
    _original_chain(transaction, client)
    receipt = client.get_transaction_receipt(operation.current_attempt.tx_hash)
    if receipt is None:
        return
    _verify_receipt(transaction, operation, client, receipt)
    outgoing.record_receipt(claim, operation.current_attempt.tx_hash, receipt)


def _consumed(transaction, operation, client):
    attempt = operation.current_attempt
    sender = Web3.to_checksum_address(operation.intent["sender"])
    if outgoing._integer(client.w3.eth.get_transaction_count(sender, "latest")) <= attempt.nonce:
        return False
    spend = collect_nonce_evidence(client, attempt.raw_transaction)
    candidate = spend.get("candidate", {})
    logger.warning(
        "Swap execution %s nonce %s consumed by %s (%s); held for operator attribution",
        transaction.pk,
        attempt.nonce,
        candidate.get("tx_hash", "an unattributed transaction"),
        candidate.get("intent_kind", spend["reason"]),
    )
    return True


def _project(transaction, claim, refusal="Swap execution could not be prepared"):
    with atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        swap, current = _lock_command(transaction)
        if operation.claim_id != claim.claim_id or current.outgoing_operation_id != operation.pk:
            raise SwapNotReadyException()
        if operation.status == OutgoingStatus.FAILED and operation.current_attempt_id is None:
            if (
                swap.status == SwapOrderStatus.EXECUTING
                and current.status == TransactionStatus.PENDING
                and not current.tx_hash
                and not swap.tx_hash
            ):
                current.mark_failed(refusal)
                swap.mark_failed(refusal)
                publish_trading_event("swap_failed", str(swap.share_token_id))
            return
        if operation.status not in (OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
            return
        if current.tx_hash != operation.current_attempt.tx_hash or swap.tx_hash != current.tx_hash:
            raise SwapNotReadyException()
        if current.status in (TransactionStatus.CONFIRMED, TransactionStatus.REVERTED):
            return
        if any(
            type(value) is not int or not 0 <= value <= MAX_SWAP_RECEIPT_VALUE
            for value in (operation.block_number, operation.gas_used)
        ):
            raise SwapNotReadyException("The retained receipt cannot fit the transaction projection.")
        current.status = (
            TransactionStatus.CONFIRMED if operation.status == OutgoingStatus.CONFIRMED else TransactionStatus.REVERTED
        )
        current.block_number = operation.block_number
        current.block_hash = operation.block_hash
        current.gas_used = operation.gas_used
        current.confirmed_at = timezone.now()
        current.save(update_fields=["status", "block_number", "block_hash", "gas_used", "confirmed_at", "updated_at"])


def recover(transaction_id, *, client=None):
    require_autocommit()
    if current_alias() == APP_ALIAS:
        raise SwapNotReadyException("Swap recovery requires the operator connection.")
    transaction = BlockchainTransaction.objects.filter(pk=transaction_id).first()
    if transaction is None:
        return None
    _admission(transaction)
    BlockchainTransaction.objects.filter(pk=transaction.pk).update(updated_at=timezone.now())
    claim = _claim(transaction)
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.status in (OutgoingStatus.FAILED, OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED):
        _project(transaction, claim)
        return operation.status
    client = client or get_base_chain_client()
    if operation.status == OutgoingStatus.PREPARING:
        try:
            _configuration(transaction)
            _original_chain(transaction, client)
            prepared = outgoing.prepare_operation(claim, client)
            _configuration(transaction)
            outgoing.sign_operation(
                claim,
                prepared,
                settings.BLOCKCHAIN_OPERATOR_KEY,
                on_signed=lambda attempt: _signed(transaction, attempt),
            )
        except Exception as exc:
            refusal = decode_exception_to_message(exc, "Swap execution could not be prepared")
            if isinstance(exc, outgoing.OutgoingPreparationError) and exc.revert_message:
                refusal = exc.revert_message
            if outgoing.fail_preparing(claim):
                _project(transaction, claim, refusal)
                return OutgoingStatus.FAILED
            operation.refresh_from_db()
            if operation.claim_id != claim.claim_id or operation.status not in (
                OutgoingStatus.SIGNED,
                OutgoingStatus.CONFIRMED,
                OutgoingStatus.REVERTED,
            ):
                raise
    try:
        _observe(transaction, claim, client)
    except Exception as exc:
        logger.warning("Swap execution %s receipt remains unavailable: %s", transaction.pk, type(exc).__name__)
        return None
    operation.refresh_from_db()
    if operation.status == OutgoingStatus.SIGNED and not _consumed(transaction, operation, client):
        outgoing.broadcast_operation(claim, client, before_send=lambda: _before_send(transaction, claim, client))
        try:
            _observe(transaction, claim, client)
        except Exception as exc:
            logger.warning("Swap execution %s receipt remains unavailable: %s", transaction.pk, type(exc).__name__)
    _project(transaction, claim)
    operation.refresh_from_db()
    return operation.status


def _retained(transaction):
    if transaction.status not in (TransactionStatus.CONFIRMED, TransactionStatus.REVERTED):
        return None
    operation = (
        OutgoingOperation.objects.select_related("current_attempt").filter(pk=transaction.outgoing_operation_id).first()
    )
    if operation is None or operation.status != transaction.status or operation.block_number is None:
        return None
    if operation.current_attempt.tx_hash != transaction.tx_hash:
        return None
    return operation


def _summary(operation):
    return (
        operation.claim_id,
        operation.status,
        operation.current_attempt_id,
        operation.block_number,
        operation.block_hash,
        operation.gas_used,
    )


def _finalized_receipt(transaction, operation, client, network, policy):
    _original_chain(transaction, client)
    verdict = collect_chain_evidence(
        client,
        chain=BLOCKCHAIN_BASE,
        network=network,
        tx_hash=transaction.tx_hash,
        previous_block={"hash": operation.block_hash, "height": operation.block_number},
        policy=policy,
    )
    if verdict["result"] == ChainObservationResult.ORPHANED:
        logger.warning("Swap execution %s inclusion left the canonical chain: %s", transaction.pk, verdict["reason"])
        return None
    if (
        verdict["result"] != ChainObservationResult.INCLUDED
        or verdict["finality"] != ChainObservationFinality.SATISFIED
    ):
        logger.info("Swap execution %s awaits finality: %s", transaction.pk, verdict["reason"])
        return None
    included = verdict["evidence"]["receipt"]
    if included["succeeded"] is not (operation.status == OutgoingStatus.CONFIRMED):
        logger.warning(
            "Swap execution %s hash %s was first seen %s and finalized %s; held for operator attribution",
            transaction.pk,
            transaction.tx_hash,
            operation.status,
            OutgoingStatus.CONFIRMED if included["succeeded"] else OutgoingStatus.REVERTED,
        )
        return None
    receipt = client.get_transaction_receipt(transaction.tx_hash)
    _verify_receipt(transaction, operation, client, receipt)
    if (
        outgoing._hex(receipt["blockHash"], 32) != included["hash"]
        or receipt["blockNumber"] != included["height"]
        or (receipt["status"] == 1) is not included["succeeded"]
    ):
        raise SwapNotReadyException("The receipt no longer matches its finalized inclusion.")
    if (included["height"], included["hash"]) != (operation.block_number, operation.block_hash):
        logger.info("Swap execution %s finalized in a later block than its first receipt", transaction.pk)
    if any(
        type(value) is not int or not 0 <= value <= MAX_SWAP_RECEIPT_VALUE
        for value in (included["height"], receipt["gasUsed"])
    ):
        raise SwapNotReadyException("The finalized receipt cannot fit the supported range.")
    _original_chain(transaction, client)
    return {
        "block_number": included["height"],
        "block_hash": included["hash"],
        "gas_used": receipt["gasUsed"],
        "policy": policy,
    }


def _complete(swap):
    swap.status = SwapOrderStatus.COMPLETED
    swap.completed_at = timezone.now()
    swap.save(update_fields=["status", "completed_at", "finalized_receipt", "updated_at"])
    for order in (swap.sell_order, swap.buy_order):
        order.tx_hash = swap.tx_hash
        if order.filled_quantity >= order.quantity:
            order.status = TransferOrderStatus.COMPLETED
            order.completed_at = swap.completed_at
        else:
            order.status = TransferOrderStatus.PARTIALLY_FILLED
        order.save(update_fields=["status", "tx_hash", "completed_at", "updated_at"])
    publish_trading_event("swap_completed", str(swap.share_token_id))


def settle(transaction_id, *, client=None):
    require_autocommit()
    if current_alias() == APP_ALIAS:
        raise SwapNotReadyException("Swap settlement requires the operator connection.")
    transaction = BlockchainTransaction.objects.filter(pk=transaction_id).first()
    if transaction is None:
        return None
    _admission(transaction)
    operation = _retained(transaction)
    if operation is None:
        return None
    snapshot = SwapOrder.objects.filter(pk=transaction.related_uuid).first()
    if (
        snapshot is None
        or snapshot.status != SwapOrderStatus.EXECUTING
        or snapshot.transaction_id != transaction.pk
        or snapshot.tx_hash != transaction.tx_hash
    ):
        return None
    network = f"evm:{transaction_intent(transaction)['chain_id']}"
    policy = finality_policy(network, BLOCKCHAIN_BASE)
    if policy["mode"] not in ("finalized", "depth"):
        logger.warning("Swap execution %s holds without an approved finality policy for %s", transaction.pk, network)
        return None
    BlockchainTransaction.objects.filter(pk=transaction.pk).update(updated_at=timezone.now())
    finalized = _finalized_receipt(transaction, operation, client or get_base_chain_client(), network, policy)
    if finalized is None:
        return None
    with atomic(durable=True):
        _lock_share_class(snapshot)
        swap, current = _lock_command(transaction)
        if swap.status != SwapOrderStatus.EXECUTING:
            return None
        if (
            _summary(OutgoingOperation.objects.get(pk=operation.pk)) != _summary(operation)
            or current.outgoing_operation_id != operation.pk
            or current.status != transaction.status
            or swap.tx_hash != current.tx_hash
            or current.tx_hash != operation.current_attempt.tx_hash
            or finalized["policy"] != finality_policy(network, BLOCKCHAIN_BASE)
        ):
            raise SwapNotReadyException("The original swap execution identity or finality policy no longer matches.")
        swap.finalized_receipt = finalized
        if operation.status == OutgoingStatus.CONFIRMED:
            _complete(swap)
            record_completed_effects(swap.share_token_id)
        else:
            swap.mark_failed(REVERTED_ON_CHAIN)
            publish_trading_event("swap_failed", str(swap.share_token_id))
        return swap.status
