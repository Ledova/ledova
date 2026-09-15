from django.db import connections
from django.utils import timezone

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    OutgoingStatus,
    TransactionStatus,
    TransactionType,
)
from companies.models import Company
from shared.db import APP_ALIAS, atomic, current_alias, principal_of, use_operator
from tokens.exceptions import InvalidTokenStateException
from tokens.models import (
    ShareToken,
    ShareTokenStatus,
    SwapApprovalOutcome,
    TokenDeployment,
)


def caller_principal():
    connection = connections[current_alias()]
    if not connection.get_autocommit() or connection.in_atomic_block:
        raise InvalidTokenStateException("Deployment execution requires autocommit before broadcast.")
    return int(principal_of()) if current_alias() == APP_ALIAS else None


def lock_token(token_id, company_id, principal):
    company = Company.objects.select_for_update().filter(pk=company_id).first()
    token = ShareToken.objects.select_for_update().filter(pk=token_id, company_id=company_id).first()
    if company is None or token is None or (principal is not None and company.owner_id != principal):
        raise InvalidTokenStateException("The issuer no longer owns this token.")
    token.company = company
    return token


def record_signed_deployment(deployment, principal, attempt, validate_intent):
    token = lock_token(deployment.token_id, deployment.company_id, principal)
    current = TokenDeployment.objects.select_for_update().get(pk=deployment.pk)
    if (
        current.attribution_required
        or token.deployment_id != current.pk
        or current.operation_id != attempt.operation_id
        or token.status != ShareTokenStatus.DEPLOYING
        or validate_intent(token) != current.intent
    ):
        raise InvalidTokenStateException("The admitted deployment identity or authority changed before signing.")
    previous_hash = None
    if token.deployment_tx_hash:
        previous = current.transaction
        if (
            previous is None
            or previous.status != TransactionStatus.REVERTED
            or token.deployment_transaction_id != previous.pk
            or token.deployment_tx_hash != previous.tx_hash
        ):
            raise InvalidTokenStateException("Another deployment transaction already owns this token.")
        previous_hash = previous.tx_hash
    intent = current.intent
    record = BlockchainTransaction.objects.create(
        tx_hash=attempt.tx_hash,
        tx_type=TransactionType.SHARE_TOKEN_DEPLOY,
        status=TransactionStatus.SUBMITTED,
        from_address=intent["sender"],
        to_address=intent["to"],
        function_name="createShareToken",
        function_args={
            "name": intent["name"],
            "symbol": intent["symbol"],
            "identifier": intent["identifier"],
            "authorizedShares": intent["authorized_shares"],
            "tokenOwner": intent["sender"],
            "issuerWallet": intent["issuer_wallet"],
        },
        related_model="tokens.ShareToken",
        related_uuid=current.token_id,
        submitted_at=attempt.created_at,
    )
    current.transaction = record
    current.save(update_fields=["transaction", "updated_at"])
    if not token.bind_deployment_transaction(attempt.tx_hash, record, previous_hash=previous_hash):
        raise InvalidTokenStateException("Another deployment transaction already owns this token.")


def record_outcome(deployment_id, claim, *, contract_address=""):
    with use_operator(), atomic(durable=True):
        operation = OutgoingOperation.objects.select_for_update().get(pk=claim.operation_id)
        deployment = TokenDeployment.objects.select_for_update().get(pk=deployment_id)
        if operation.claim_id != claim.claim_id or deployment.operation_id != operation.pk:
            raise InvalidTokenStateException("A newer deployment attempt owns this outcome.")
        if operation.current_attempt_id is None:
            return deployment
        record = deployment.transaction
        if record is None or record.tx_hash != operation.current_attempt.tx_hash:
            raise InvalidTokenStateException("The deployment is missing its original transaction association.")
        if operation.status == OutgoingStatus.CONFIRMED:
            if record.status != TransactionStatus.CONFIRMED:
                record.mark_confirmed(
                    block_number=operation.block_number, block_hash=operation.block_hash, gas_used=operation.gas_used
                )
            if contract_address:
                if deployment.contract_address and deployment.contract_address != contract_address:
                    raise InvalidTokenStateException("The deployment receipt now identifies a different contract.")
                deployment.contract_address = contract_address
                deployment.save(update_fields=["contract_address", "updated_at"])
        elif operation.status == OutgoingStatus.REVERTED and record.status != TransactionStatus.REVERTED:
            record.mark_reverted("The recorded deployment reverted on chain.")
        return deployment


def mark_projected(deployment_id):
    from tokens.services.swap_approval import approval_intent
    from tokens.tasks.deployment import recover_swap_approval

    with use_operator(), atomic(durable=True):
        deployment = TokenDeployment.objects.select_for_update().get(pk=deployment_id)
        if deployment.projected_at is not None:
            return
        deployment.approval_intent = approval_intent(deployment)
        deployment.approval_outcome = (
            SwapApprovalOutcome.PENDING if deployment.approval_intent else SwapApprovalOutcome.NOT_CONFIGURED
        )
        deployment.projected_at = timezone.now()
        deployment.save(update_fields=["approval_intent", "approval_outcome", "projected_at", "updated_at"])
        if deployment.approval_intent:
            recover_swap_approval.defer(deployment_id=str(deployment.pk))
