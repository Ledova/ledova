import logging

from django.conf import settings
from django.core import signing
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from hexbytes import HexBytes
from web3 import Web3
from web3.logs import DISCARD

from blockchain.models import OutgoingOperation, OutgoingStatus
from blockchain.services import outgoing
from companies.models import Company, CompanyStatus
from companies.services.company import primary_wallet_for
from integrations.base_chain import get_base_chain_client
from shared.db import atomic, use_operator
from shared.registry_scope import refuse_deferred_execution
from shared.tasks.queue import defer
from tokens.exceptions import (
    CompanyNotReadyException,
    DeploymentSigningHold,
    InvalidTokenStateException,
    TokenDeploymentFailedException,
)
from tokens.models import ShareToken, ShareTokenStatus, TokenDeployment
from tokens.services import deployment_journal, share_token_service

logger = logging.getLogger(__name__)
INTENT_FIELDS = ("chain_id", "sender", "to", "value", "data")
RETRY_SALT = "tokens.deployment.retry"
ATTRIBUTION_REQUIRED = "This deployment requires operator attribution; its history has been retained."


def _eligible_wallet(token):
    if token.company.status != CompanyStatus.ACTIVE:
        raise CompanyNotReadyException("Company must be active before deploying tokens.")
    wallet = primary_wallet_for(token.company)
    if wallet is None:
        raise CompanyNotReadyException(
            "Company must have an operator wallet or verified owner wallet on Base before deploying tokens."
        )
    return wallet


def require_retryable(token):
    if token.status != ShareTokenStatus.DEPLOYING:
        raise InvalidTokenStateException(
            f"Cannot retry deployment of a token with status '{token.get_status_display()}'."
        )
    if token.deployment_id is None:
        raise InvalidTokenStateException(ATTRIBUTION_REQUIRED)


def retry_confirmation(token):
    require_retryable(token)
    with use_operator():
        deployment = TokenDeployment.objects.filter(pk=token.deployment_id).select_related("operation").first()
        if deployment and deployment.attribution_required:
            raise InvalidTokenStateException(ATTRIBUTION_REQUIRED)
        claim = str(deployment.operation.claim_id) if deployment and deployment.operation_id else None
    return signing.dumps(
        {"token": str(token.pk), "deployment": str(token.deployment_id), "claim": claim}, salt=RETRY_SALT
    )


def retry_deployment(token, *, principal_id, confirmation):
    refuse_deferred_execution()
    from tokens.tasks import deploy_share_token_task

    require_retryable(token)
    try:
        confirmed = signing.loads(confirmation, salt=RETRY_SALT)
    except (signing.BadSignature, TypeError):
        raise InvalidTokenStateException("Reload the deployment retry confirmation.") from None
    if confirmed.get("token") != str(token.pk) or confirmed.get("deployment") != str(token.deployment_id):
        raise InvalidTokenStateException("The confirmation identifies a different deployment.")
    defer(
        deploy_share_token_task,
        token_uuid=str(token.pk),
        deployment_id=str(token.deployment_id),
        principal_id=principal_id,
        retry_of=confirmed["claim"],
    )


def _intent(token, *, wallet=None):
    wallet = _eligible_wallet(token) if wallet is None else wallet
    try:
        sender = Account.from_key(settings.BLOCKCHAIN_OPERATOR_KEY).address
        authorized = int(token.total_supply)
        identifier = share_token_service.token_identifier(token)
        data = Web3.keccak(text="createShareToken(string,string,string,string,uint256,address)")[:4] + encode(
            ["string", "string", "string", "string", "uint256", "address"],
            [token.name, token.symbol, identifier, token.company.acn, authorized, sender],
        )
        intent = outgoing.transaction_intent(
            chain_id=settings.BLOCKCHAIN_CHAIN_ID, sender=sender, to=settings.SHARE_TOKEN_FACTORY_ADDRESS, data=data
        )
    except (ValueError, TypeError, AttributeError):
        raise InvalidTokenStateException("The deployment terms, factory or signing identity are invalid.") from None
    return intent | {
        "name": token.name,
        "symbol": token.symbol,
        "identifier": identifier,
        "authorized_shares": str(authorized),
        "issuer_wallet": wallet.address.lower(),
        "decimals": token.decimals,
    }


def _admit(token):
    if token.deployment_id is None:
        raise InvalidTokenStateException(ATTRIBUTION_REQUIRED)
    with use_operator(), atomic(durable=True):
        current = deployment_journal.lock_token(token.pk, token.company_id, None)
        if current.deployment_id != token.deployment_id or current.status != ShareTokenStatus.DEPLOYING:
            raise InvalidTokenStateException("The queued deployment no longer owns this token.")
        deployment = TokenDeployment.objects.filter(pk=current.deployment_id).first()
        if deployment is None:
            if current.deployment_tx_hash or current.deployment_transaction_id:
                raise InvalidTokenStateException(ATTRIBUTION_REQUIRED)
            from tokens.services.register_deployments import applied_source

            source = applied_source(current)
            if source is None:
                raise DeploymentSigningHold(["legacy_source_unavailable"])
            deployment = TokenDeployment.objects.create(
                pk=current.deployment_id,
                source_deployment=source,
                token_id=current.pk,
                company_id=current.company_id,
                principal_id=source.reviewed_by_id,
                intent=source.intent,
            )
        if deployment.token_id != current.pk or deployment.company_id != current.company_id:
            raise InvalidTokenStateException("This submission belongs to a different token or company.")
        return deployment


def _created_address(deployment, operation, client):
    if client.assert_expected_chain() != deployment.intent["chain_id"]:
        raise InvalidTokenStateException("The deployment provider is on a different chain.")
    receipt = client.get_transaction_receipt(operation.current_attempt.tx_hash)
    if receipt is None:
        return ""
    if (
        Web3.to_hex(HexBytes(receipt["transactionHash"])) != operation.current_attempt.tx_hash
        or receipt["status"] != 1
        or receipt["blockNumber"] != operation.block_number
        or Web3.to_hex(HexBytes(receipt["blockHash"])) != operation.block_hash
    ):
        raise InvalidTokenStateException("The deployment receipt differs from the recorded outcome.")
    intent = deployment.intent
    contract = client.load_contract("ShareTokenFactory", Web3.to_checksum_address(intent["to"]))
    events = contract.events.ShareTokenCreated().process_receipt(receipt, errors=DISCARD)
    matches = [
        event
        for event in events
        if (
            event["address"].lower() == intent["to"]
            and event["args"]["identifier"] == intent["identifier"]
            and event["args"]["symbol"] == intent["symbol"]
            and int(event["args"]["authorizedShares"]) == int(intent["authorized_shares"])
        )
    ]
    if len(matches) != 1 or not Web3.is_address(matches[0]["args"]["tokenAddress"]):
        raise InvalidTokenStateException("The deployment receipt has no unique event matching the admitted intent.")
    address = Web3.to_checksum_address(matches[0]["args"]["tokenAddress"])
    if address.lower() == share_token_service.ZERO_ADDRESS:
        raise InvalidTokenStateException("The deployment receipt names the zero address.")
    return address


def _process(deployment, retry_of=None):
    with use_operator():
        if deployment.attribution_required:
            raise InvalidTokenStateException(ATTRIBUTION_REQUIRED)
        claim = outgoing.recovery_claim(deployment.operation_id, deployment.intent)
        if claim is None:
            return deployment
        operation = OutgoingOperation.objects.get(pk=claim.operation_id)
        if operation.status in (OutgoingStatus.FAILED, OutgoingStatus.REVERTED):
            return deployment_journal.record_outcome(deployment.pk, claim)
        client = get_base_chain_client()
        if operation.status == OutgoingStatus.SIGNED:
            outgoing.reconcile_operation(claim, client)
            operation.refresh_from_db()
        address = (
            _created_address(deployment, operation, client) if operation.status == OutgoingStatus.CONFIRMED else ""
        )
        return deployment_journal.record_outcome(deployment.pk, claim, contract_address=address)


def _project(deployment):
    if not deployment.contract_address or deployment.projected_at is not None:
        return deployment.contract_address
    intent = deployment.intent
    if (
        settings.BLOCKCHAIN_CHAIN_ID != intent["chain_id"]
        or settings.SHARE_TOKEN_FACTORY_ADDRESS.lower() != intent["to"]
    ):
        return ""
    with atomic():
        company = Company.objects.select_for_update().filter(pk=deployment.company_id).first()
        if company is None:
            return ""
        token = (
            ShareToken.objects.select_for_update(of=("self",))
            .filter(
                pk=deployment.token_id,
                company_id=deployment.company_id,
                deployment_id=deployment.pk,
                deployment_transaction_id=deployment.transaction_id,
            )
            .first()
        )
        if token is None:
            return ""
        token.company = company
        if token.contract_address:
            if token.contract_address.lower() != deployment.contract_address.lower():
                return ""
        else:
            if token.status != ShareTokenStatus.DEPLOYING or (
                token.name,
                token.symbol,
                str(int(token.total_supply)),
                token.decimals,
                share_token_service.token_identifier(token),
            ) != (
                intent["name"],
                intent["symbol"],
                intent["authorized_shares"],
                intent["decimals"],
                intent["identifier"],
            ):
                return ""
            token.mark_deployed(deployment.contract_address, share_token_service.SHARE_ASSET_CHAIN)
    if not share_token_service.bridge_share_asset(token, deployment.contract_address):
        return ""
    deployment_journal.mark_projected(deployment.pk)
    return deployment.contract_address


def deploy_token(token, *, retry_of=None):
    refuse_deferred_execution()
    deployment_journal.caller_principal()
    deployment = _admit(token)
    try:
        current = _process(deployment, retry_of)
        address = _project(current)
    except InvalidTokenStateException:
        raise
    except Exception:
        logger.exception("Deployment %s requires recovery", deployment.pk)
        raise TokenDeploymentFailedException(
            "The deployment outcome is unresolved; its recorded intent is retained."
        ) from None
    token.refresh_from_db()
    return {"contract_address": address or None, "identifier": current.intent["identifier"], "adopted": False}


def recover(deployment_id):
    principal = deployment_journal.caller_principal()
    if principal is not None:
        raise InvalidTokenStateException("Deployment recovery requires an operator connection.")
    deployment = TokenDeployment.objects.filter(pk=deployment_id).first()
    if deployment is None:
        return None
    try:
        result = _project(_process(deployment)) or None
    except Exception:
        logger.exception("Deployment %s remains unresolved", deployment_id)
        result = None
    if result is None:
        TokenDeployment.objects.filter(pk=deployment_id).update(updated_at=timezone.now())
    return result
