from django.db import connections
from web3 import Web3

from blockchain.models import BlockchainTransaction, TransactionStatus, TransactionType
from companies.models import Company
from shared.db import APP_ALIAS, atomic, current_alias, principal_of, use_operator
from tokens.exceptions import InvalidTokenStateException
from tokens.models import ShareToken


def create_deployment_record(token, identifier, signer_address, factory_address, issuer_address):
    with use_operator():
        return BlockchainTransaction.objects.create(
            tx_type=TransactionType.SHARE_TOKEN_DEPLOY,
            status=TransactionStatus.PENDING,
            from_address=signer_address,
            to_address=factory_address,
            function_name="createShareToken",
            function_args={
                "name": token.name,
                "symbol": token.symbol,
                "identifier": identifier,
                "authorizedShares": str(int(token.total_supply)),
                "tokenOwner": signer_address,
                "issuerWallet": issuer_address,
            },
            related_model="tokens.ShareToken",
            related_uuid=token.uuid,
        )


def load_deployment_record(token):
    if token.deployment_transaction_id is None:
        return None
    with use_operator():
        return BlockchainTransaction.objects.get(pk=token.deployment_transaction_id)


def _require_deployment_record(token, record):
    if record.pk == token.deployment_transaction_id and record.tx_type == TransactionType.SHARE_TOKEN_DEPLOY:
        return
    if (record.related_model, record.related_uuid, record.tx_type) != (
        "tokens.ShareToken",
        token.uuid,
        TransactionType.SHARE_TOKEN_DEPLOY,
    ):
        raise InvalidTokenStateException("The deployment journal belongs to another token.")


def record_signed_deployment(token, record, tx_hash):
    _require_deployment_record(token, record)
    caller = connections[current_alias()]
    principal = principal_of() if current_alias() == APP_ALIAS else None
    with use_operator():
        connection = connections[current_alias()]
        if (connection is not caller and not caller.get_autocommit()) or (
            not connection.get_autocommit() and not connection.in_atomic_block
        ):
            raise RuntimeError("Deployment signing requires autocommit before broadcast.")
        with atomic(durable=True):
            if principal:
                owner_unchanged = (
                    Company.objects.select_for_update().filter(pk=token.company_id, owner_id=int(principal)).exists()
                )
                company_unchanged = (
                    ShareToken.objects.select_for_update().filter(pk=token.pk, company_id=token.company_id).exists()
                )
                if not owner_unchanged or not company_unchanged:
                    raise InvalidTokenStateException("The issuer no longer owns this token.")
            record.mark_submitted(tx_hash)
            if not token.bind_deployment_transaction(tx_hash, record):
                raise InvalidTokenStateException("Another deployment transaction already owns this token.")


def confirm_deployment_record(token, record, receipt):
    _require_deployment_record(token, record)
    with use_operator():
        record.mark_confirmed(
            block_number=receipt["blockNumber"],
            block_hash=Web3.to_hex(receipt["blockHash"]),
            gas_used=receipt["gasUsed"],
        )


def fail_deployment_record(token, record, message, *, before_broadcast=False):
    _require_deployment_record(token, record)
    with use_operator():
        record.refresh_from_db()
        if before_broadcast and record.tx_hash:
            record.mark_outcome_unknown("The deployment broadcast could not be confirmed.")
        else:
            record.mark_failed(message)


def revert_deployment_record(token, record):
    _require_deployment_record(token, record)
    with use_operator():
        record.mark_reverted(f"Transaction reverted: {record.tx_hash}")
