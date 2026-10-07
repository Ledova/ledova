import json
from contextlib import contextmanager
from uuid import UUID, uuid4

from django.contrib.auth import get_user_model
from django.db import IntegrityError, OperationalError
from procrastinate import App
from procrastinate.contrib.django.django_connector import DjangoConnector
from rest_framework.exceptions import NotFound, ValidationError

from blockchain.models import OutgoingOperation, OutgoingStatus, TransactionStatus
from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyStatus,
)
from companies.services.authority_requests import _requester_principal
from companies.services.company import primary_wallet_for
from operators.models import Operator
from shared.constants import BLOCKCHAIN_BASE
from shared.db import current_alias, use_operator
from tokens.exceptions import (
    DeploymentSigningHold,
    InvalidTokenStateException,
    RegisterChangeConflict,
    RegisterIntegrityError,
)
from tokens.models import (
    RegisterDecisionKind,
    RegisterDeployment,
    RegisterDeploymentDecision,
    RegisterEntry,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
    TokenDeployment,
)
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, _scalar, decide, preview
from tokens.services.register_events import verify_register
from users.models import UserAccount, UserProfile
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

INTENT_FIELDS = ("chain_id", "sender", "to", "value", "data")


def _busy(exception):
    return getattr(exception.__cause__, "sqlstate", None) == "55P03"


def _register_snapshot(token):
    register = ShareRegister.objects.filter(token_id=token.pk).first()
    if register is None:
        return {
            "present": False,
            "initialized": None,
            "uuid": None,
            "sequence": None,
            "head_hash": None,
            "issued_supply": None,
        }
    initialized = RegisterEntry.objects.filter(register=register).exists()
    if initialized:
        verified = verify_register(register.pk)
        if verified["entries"] != register.sequence or verified["head_hash"] != register.head_hash:
            raise RegisterChangeConflict()
    return {
        "present": True,
        "initialized": initialized,
        "uuid": str(register.pk),
        "sequence": register.sequence,
        "head_hash": register.head_hash,
        "issued_supply": str(int(register.issued_supply)) if initialized else None,
    }


def _lock_wallet(wallet_id, *, captured=None):
    wallet = Wallet.objects.select_for_update(no_key=True, nowait=True, of=("self",)).filter(pk=wallet_id).first()
    if wallet is None:
        raise ValidationError({"unmet_requirements": ["issuer_wallet_unavailable"]})
    if captured is not None and str(wallet.user_account_id) != captured["account"]:
        raise RegisterChangeConflict()
    account = UserAccount.objects.select_for_update(no_key=True, nowait=True, of=("self",)).get(
        pk=wallet.user_account_id
    )
    if captured is not None and str(account.user_profile_id) != captured["profile"]:
        raise RegisterChangeConflict()
    profile = UserProfile.objects.get(pk=account.user_profile_id)
    user_id = profile.user_id
    if captured is not None and user_id != captured["user"]:
        raise RegisterChangeConflict()
    get_user_model().objects.select_for_update(no_key=True, nowait=True, of=("self",)).get(pk=user_id)
    profile = UserProfile.objects.select_for_update(no_key=True, nowait=True, of=("self",)).get(pk=profile.pk)
    if profile.pk != account.user_profile_id or profile.user_id != user_id:
        raise RegisterChangeConflict()
    return wallet, account, profile


def _capture(token):
    from tokens.services.deployment import _intent

    selected = primary_wallet_for(token.company)
    if selected is None:
        raise ValidationError({"unmet_requirements": ["issuer_wallet_unavailable"]})
    wallet, account, profile = _lock_wallet(selected.pk)
    intent = _intent(token, wallet=wallet)
    snapshot = {
        "company": {
            "uuid": str(token.company_id),
            "name": token.company.name,
            "acn": token.company.acn,
            "status": token.company.status,
            "owner": token.company.owner_id,
        },
        "token": {
            "uuid": str(token.pk),
            "name": token.name,
            "symbol": token.symbol,
            "identifier": intent["identifier"],
            "authorised_shares": intent["authorized_shares"],
            "decimals": token.decimals,
        },
        "issuer_wallet": {
            "uuid": str(wallet.pk),
            "account": str(account.pk),
            "profile": str(profile.pk),
            "user": profile.user_id,
            "address": wallet.address.lower(),
            "chain": wallet.chain,
            "branch": "operator" if token.company.operator_wallet_id else "owner",
        },
        "register": _register_snapshot(token),
        "transaction": {field: intent[field] for field in INTENT_FIELDS},
    }
    return snapshot, intent


def _wallet_requirements(proposal, token):
    captured = proposal.snapshot["issuer_wallet"]
    wallet = Wallet.objects.filter(pk=captured["uuid"]).first()
    if wallet is None:
        return ["issuer_wallet_unavailable"], None
    profile = UserProfile.objects.filter(pk=captured["profile"]).first()
    account = UserAccount.objects.filter(pk=captured["account"]).first()
    if (
        wallet.chain != BLOCKCHAIN_BASE
        or wallet.address.lower() != captured["address"]
        or str(wallet.user_account_id) != captured["account"]
        or account is None
        or profile is None
        or str(account.user_profile_id) != captured["profile"]
        or profile.user_id != captured["user"]
    ):
        return ["issuer_wallet_changed"], wallet
    if captured["branch"] == "operator":
        valid = str(token.company.operator_wallet_id) == captured["uuid"]
    else:
        valid = (
            token.company.operator_wallet_id is None
            and token.company.owner_id == captured["user"]
            and token.company.owner_id == proposal.snapshot["company"]["owner"]
            and wallet.verification_status == WALLET_VERIFICATION_STATUS_VERIFIED
        )
    return ([] if valid else ["issuer_wallet_changed"]), wallet


def _state(proposal):
    from tokens.services.deployment import _intent

    token = ShareToken.objects.select_related("company").get(pk=proposal.token_id)
    unmet = []
    if token.company_id != proposal.company_id:
        return ["class_identity_changed"]
    if token.company.status != CompanyStatus.ACTIVE:
        unmet.append("company_not_active")
    if proposal.status == "applied":
        if token.deployment_id != proposal.deployment_id or token.status != ShareTokenStatus.DEPLOYING:
            unmet.append("class_deployment_changed")
    elif token.status != ShareTokenStatus.DRAFT:
        unmet.append("class_not_draft")
    elif (
        token.deployment_id
        or token.contract_address
        or token.deployment_tx_hash
        or token.deployment_transaction_id
        or token.deployed_at
        or token.chain
    ):
        unmet.append("class_deployment_exists")
    if (token.company.name, token.company.acn) != (
        proposal.snapshot["company"]["name"],
        proposal.snapshot["company"]["acn"],
    ):
        unmet.append("class_identity_changed")
    wallet_unmet, wallet = _wallet_requirements(proposal, token)
    unmet.extend(wallet_unmet)
    if wallet is not None:
        try:
            if _intent(token, wallet=wallet) != proposal.intent:
                unmet.append("deployment_configuration_changed")
        except (InvalidTokenStateException, ValueError, TypeError, AttributeError):
            unmet.append("deployment_configuration_changed")
    try:
        current = _register_snapshot(token)
        if current["present"] and not current["initialized"]:
            unmet.append("register_uninitialized")
        elif current["present"] and current["issued_supply"] != "0":
            unmet.append("register_not_empty")
        if current != proposal.snapshot["register"]:
            unmet.append("register_changed")
    except (RegisterChangeConflict, RegisterIntegrityError, ValidationError):
        unmet.append("register_unavailable")
    return sorted(set(unmet))


def _company_of(actor, token_id):
    with use_operator(), _requester_principal(actor.pk):
        company_id = (
            ShareToken.objects.register_readable_by(actor)
            .filter(pk=token_id)
            .values_list("company_id", flat=True)
            .first()
        )
    if company_id is None:
        raise NotFound("Share class not found.")
    return company_id


def prepare_deployment(*, actor, operation_id, appointment, token):
    try:
        operation_id, appointment, token_id = (UUID(str(value)) for value in (operation_id, appointment, token))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Deployment references must be UUIDs.") from None
    try:
        with register_command(actor, _company_of(actor, token_id), "register_deployment_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            existing = RegisterDeployment.objects.filter(pk=operation_id).first()
            if existing is not None:
                if (
                    existing.company_id,
                    existing.token_id,
                    existing.submitted_by_id,
                    existing.preparing_appointment_id,
                ) != (
                    company.pk,
                    token_id,
                    current_actor.pk,
                    appointment,
                ) or not RegisterDeployment.objects.register_readable_by(
                    current_actor
                ).filter(
                    pk=existing.pk
                ).exists():
                    raise RegisterChangeConflict()
                return existing
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            current = ShareToken.objects.select_for_update(of=("self",)).get(pk=token_id, company=company)
            current.company = company
            list(ShareRegister.objects.select_for_update().filter(token=current).values_list("uuid", flat=True))
            snapshot, intent = _capture(current)
            proposal = RegisterDeployment(
                uuid=operation_id,
                company=company,
                token=current,
                snapshot=snapshot,
                intent=intent,
                intent_digest=_scalar(
                    "SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(intent)]
                ),
                submitted_by=current_actor,
                preparing_appointment=source,
            )
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            proposal.save(force_insert=True)
            return proposal
    except IntegrityError:
        raise RegisterChangeConflict() from None
    except OperationalError as exception:
        if _busy(exception):
            raise ValidationError({"unmet_requirements": ["source_lock_busy"]}) from None
        raise


def selected_approval(proposal):
    return _scalar("SELECT tokens_register_deployment_approval(%s, clock_timestamp())", [proposal.pk])


def _details(proposal):
    return {
        "snapshot": proposal.snapshot,
        "intent_digest": proposal.intent_digest,
        "deployment_id": proposal.deployment_id,
        "approval_decision": proposal.approval_decision_id or selected_approval(proposal),
    }


def _lock(proposal):
    if _scalar("SELECT current_setting('app.company_operation', true)", []) != "register_deployment_reject":
        captured = proposal.snapshot["issuer_wallet"]
        _lock_wallet(captured["uuid"], captured=captured)
    ShareToken.objects.select_for_update(of=("self",)).get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    return RegisterDeployment.objects.select_for_update().get(pk=proposal.pk)


def queue_deployment(**arguments):
    from tokens.tasks import deploy_share_token_task

    queue = App(connector=DjangoConnector(alias=current_alias()))
    return queue.configure_task(deploy_share_token_task.name).defer(**arguments)


def _apply(proposal, actor, decision):

    approval_id = selected_approval(proposal)
    if approval_id is None:
        raise RegisterChangeConflict()
    token = ShareToken.objects.get(pk=proposal.token_id)
    proposal.approval_decision_id = approval_id
    proposal.deployment_id = uuid4()
    token.deployment_id = proposal.deployment_id
    token.status = ShareTokenStatus.DEPLOYING
    token.save(update_fields=["deployment_id", "status", "updated_at"])
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(
        update_fields=["approval_decision", "deployment_id", "status", "reviewed_by", "reviewed_at", "updated_at"]
    )
    queue_deployment(token_uuid=str(token.pk), deployment_id=str(proposal.deployment_id), principal_id=actor.pk)


DEPLOYMENTS = DecisionFamily(
    model=RegisterDeployment,
    decision_model=RegisterDeploymentDecision,
    field="register_deployment",
    operation="register_deployment",
    approved_function="tokens_register_deployment_approved",
    digest_function="tokens_register_deployment_decision_digest",
    effect_requirements=_state,
    lock=_lock,
    apply=_apply,
)


def preview_deployment_decision(*, actor, deployment_id, appointment, kind, reason=""):
    return preview(
        DEPLOYMENTS, _details, actor=actor, proposal_id=deployment_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_deployment(
    *, actor, deployment_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    try:
        return decide(
            DEPLOYMENTS,
            actor=actor,
            proposal_id=deployment_id,
            appointment=appointment,
            kind=kind,
            idempotency_key=idempotency_key,
            preview_digest=preview_digest,
            confirmation=confirmation,
            reason=reason,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None
    except OperationalError as exception:
        if _busy(exception):
            raise ValidationError({"unmet_requirements": ["source_lock_busy"]}) from None
        raise


def applied_source(token):
    if token.deployment_id is None:
        return None
    return RegisterDeployment.objects.filter(
        company_id=token.company_id, token_id=token.pk, deployment_id=token.deployment_id, status="applied"
    ).first()


def pending_deployment(token):
    source = applied_source(token)
    if source is None:
        return False
    journal = TokenDeployment.objects.filter(
        pk=source.deployment_id, source_deployment=source, company_id=source.company_id, token_id=source.token_id
    ).first()
    if journal is None:
        return True
    from tokens.exceptions import RegisterUnavailableException
    from tokens.services.register_snapshot import _target

    try:
        return _target(token.pk).deployment_id != source.deployment_id
    except RegisterUnavailableException:
        return True


def execution_receipt(proposal):
    if proposal.deployment_id is None:
        return None
    journal = (
        TokenDeployment.objects.select_related("operation__current_attempt", "transaction")
        .filter(
            pk=proposal.deployment_id,
            source_deployment=proposal,
            token_id=proposal.token_id,
            company_id=proposal.company_id,
        )
        .first()
    )
    if journal is None:
        return None
    operation = journal.operation
    attempt = operation.current_attempt if operation else None
    matched = attempt is not None and attempt.claim_id == operation.claim_id and attempt.operation_id == operation.pk
    confirmed = (
        matched
        and operation.status == OutgoingStatus.CONFIRMED
        and journal.transaction is not None
        and journal.transaction.status == TransactionStatus.CONFIRMED
        and journal.transaction.tx_hash == attempt.tx_hash
    )
    return {
        "deployment": journal.pk,
        "operation_id": operation.pk if operation else None,
        "claim_id": operation.claim_id if operation else None,
        "operation_status": operation.status if operation else None,
        "tx_hash": attempt.tx_hash if matched else None,
        "contract_address": journal.contract_address if confirmed and journal.contract_address else None,
        "attribution_required": journal.attribution_required,
        "projected_at": journal.projected_at,
        "swap_approval_outcome": journal.approval_outcome or None,
    }


def _authority_requirements(proposal):
    approval = RegisterDeploymentDecision.objects.filter(
        pk=proposal.approval_decision_id, register_deployment=proposal, kind=RegisterDecisionKind.APPROVE
    ).first()
    application = RegisterDeploymentDecision.objects.filter(
        register_deployment=proposal, kind=RegisterDecisionKind.APPLY
    ).first()
    if approval is None or application is None:
        return ["company_source_expired"]
    for decision, capability in ((approval, "approve"), (application, "apply")):
        if not _scalar(
            "SELECT tokens_register_appointment_current(%s, %s, %s, %s, clock_timestamp())",
            [decision.appointment_id, proposal.company_id, decision.decided_by_id, capability],
        ):
            return ["company_source_expired"]
    return []


def execution_requirements(proposal):
    if proposal.status != "applied":
        return []
    journal = TokenDeployment.objects.select_related("operation").filter(source_deployment=proposal).first()
    if journal and journal.operation and journal.operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        return []
    return sorted(set(_state(proposal) + _authority_requirements(proposal)))


@contextmanager
def signing_source(deployment, claim):
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.claim_id == claim.claim_id and operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        yield None
        return
    source = RegisterDeployment.objects.filter(
        pk=deployment.source_deployment_id,
        status="applied",
        token_id=deployment.token_id,
        company_id=deployment.company_id,
        deployment_id=deployment.pk,
    ).first()
    if source is None:
        raise DeploymentSigningHold(["legacy_source_unavailable"])
    try:
        Company.objects.select_for_update().get(pk=source.company_id)
        operation = OutgoingOperation.objects.get(pk=claim.operation_id)
        if operation.claim_id == claim.claim_id and operation.status in (
            OutgoingStatus.SIGNED,
            OutgoingStatus.CONFIRMED,
        ):
            yield None
            return
        captured = source.snapshot["issuer_wallet"]
        wallet = (
            Wallet.objects.select_for_update(no_key=True, nowait=True, of=("self",)).filter(pk=captured["uuid"]).first()
        )
        account = (
            UserAccount.objects.select_for_update(no_key=True, nowait=True, of=("self",))
            .filter(pk=captured["account"])
            .first()
        )
        if (
            wallet is None
            or account is None
            or str(wallet.user_account_id) != captured["account"]
            or str(account.user_profile_id) != captured["profile"]
        ):
            raise DeploymentSigningHold(["issuer_wallet_changed"])
        decisions = list(
            RegisterDeploymentDecision.objects.filter(register_deployment=source).filter(
                kind=RegisterDecisionKind.APPLY
            )
            | RegisterDeploymentDecision.objects.filter(pk=source.approval_decision_id)
        )
        appointments = list(CompanyAppointment.objects.filter(pk__in=[row.appointment_id for row in decisions]))
        user_ids = {captured["user"], *(row.decided_by_id for row in decisions)}
        profile_ids = {UUID(captured["profile"]), *(row.appointee_profile_id for row in appointments)}
        list(
            get_user_model()
            .objects.select_for_update(no_key=True, nowait=True, of=("self",))
            .filter(pk__in=user_ids)
            .order_by("pk")
        )
        list(
            UserProfile.objects.select_for_update(no_key=True, nowait=True, of=("self",))
            .filter(pk__in=profile_ids)
            .order_by("uuid")
        )
        Operator.objects.select_for_update().get(pk=1)
        list(
            CompanyAppointment.objects.select_for_update()
            .filter(pk__in=[row.pk for row in appointments])
            .order_by("uuid")
        )
        ShareToken.objects.select_for_update(of=("self",)).get(pk=source.token_id)
        list(ShareRegister.objects.select_for_update().filter(token_id=source.token_id).values_list("uuid", flat=True))
        source = RegisterDeployment.objects.select_for_update().get(pk=source.pk)

        def validate(operation):
            unmet = _state(source) + _authority_requirements(source)
            if unmet:
                raise DeploymentSigningHold(sorted(set(unmet)))

        yield validate
    except OperationalError as exception:
        if _busy(exception):
            raise DeploymentSigningHold(["source_lock_busy"]) from None
        raise
