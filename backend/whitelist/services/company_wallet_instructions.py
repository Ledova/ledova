from contextlib import contextmanager
from uuid import UUID, uuid4

from django.contrib.auth import get_user_model
from django.db import IntegrityError, OperationalError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from procrastinate import App
from procrastinate.contrib.django.django_connector import DjangoConnector
from rest_framework.exceptions import ValidationError

from blockchain.models import OutgoingOperation, OutgoingStatus
from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation, lock_company_actor
from companies.services.authority_requests import _requester_principal
from integrations.base_chain import get_base_chain_client
from operators.models import Operator
from shared.db import atomic, current_alias, use_operator
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterDecisionKind
from tokens.services.register_authority import register_appointment
from tokens.services.register_decisions import DecisionFamily, _scalar, decide, preview
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
    InvestorClassification,
    UserAccount,
    UserProfile,
)
from users.services.company_eligibility import _digest
from wallets.models import Wallet, WalletPossessionProof
from whitelist.exceptions import (
    WhitelistChangeConflict,
    WhitelistRegistryMissing,
    WhitelistRegistryUnreadable,
    WhitelistSigningHold,
)
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletInstructionDecision,
    CompanyWalletNomination,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistEntry,
)
from whitelist.services.changes import _intent, lock_target
from whitelist.services.wallet_nominations import _stamp, nomination_requirements
from whitelist.services.whitelist import open_approval, registry_for, resolve_entry


def _busy(exception):
    return getattr(exception.__cause__, "sqlstate", None) == "55P03"


def _readable_company(actor, company):
    return get_object_or_404(Company.objects.register_readable_by(actor), pk=company)


def _approval(proposal):
    return _scalar("SELECT whitelist_company_wallet_approval(%s, clock_timestamp())", [proposal.pk])


def _lock_context(company, actor_ids, associations, appointments):
    wallet = None
    profile_ids = {row.appointee_profile_id for row in appointments}
    if associations:
        wallet = Wallet.objects.select_for_update(nowait=True, of=("self",)).filter(pk=associations["wallet"]).first()
        account = (
            UserAccount.objects.select_for_update(nowait=True, of=("self",)).filter(pk=associations["account"]).first()
        )
        if (
            wallet is None
            or account is None
            or str(wallet.user_account_id) != associations["account"]
            or str(account.user_profile_id) != associations["profile"]
        ):
            raise WhitelistSigningHold(["wallet_source_changed"])
        actor_ids.add(associations["participant"])
        profile_ids.add(UUID(associations["profile"]))
    profiles = list(UserProfile.objects.filter(user_id__in=actor_ids).values_list("uuid", "user_id"))
    profile_ids.update(row[0] for row in profiles)
    list(get_user_model().objects.select_for_update(nowait=True, of=("self",)).filter(pk__in=actor_ids).order_by("pk"))
    locked_profiles = list(
        UserProfile.objects.select_for_update(nowait=True, of=("self",)).filter(pk__in=profile_ids).order_by("uuid")
    )
    if sorted((row.pk, row.user_id) for row in locked_profiles) != sorted(profiles):
        raise WhitelistSigningHold(["wallet_source_changed"])
    operator = Operator.objects.select_for_update().get(pk=1)
    list(
        CompanyAppointment.objects.select_for_update().filter(pk__in=[row.pk for row in appointments]).order_by("uuid")
    )
    if associations:
        if not any(
            str(row.pk) == associations["profile"] and row.user_id == associations["participant"]
            for row in locked_profiles
        ):
            raise WhitelistSigningHold(["wallet_source_changed"])
        WalletPossessionProof.objects.select_for_update().filter(pk=associations["proof"]).first()
        request = CompanyEligibilityRequest.objects.filter(pk=associations["request"]).first()
        if request is not None:
            InvestorClassification.objects.select_for_update().filter(pk=request.source_id).first()
            list(request.source.supporting_documents.select_for_update().order_by("uuid"))
            CompanyEligibilityRequest.objects.select_for_update().get(pk=request.pk)
            CompanyEligibilityDecision.objects.select_for_update().filter(pk=associations["decision"]).first()
    return operator, wallet


def _associations(proposal):
    return proposal.snapshot.get("associations")


@contextmanager
def wallet_command(actor, proposal, operation, recorded=False):
    target = proposal.snapshot["target"]
    with company_operation(actor, proposal.company_id, operation), atomic(durable=True):
        lock_target(target["chain_id"], target["registry_address"], target["address"])
        company = get_object_or_404(Company.objects.select_for_update(), pk=proposal.company_id)
        if recorded or operation.endswith("_reject"):
            yield lock_company_actor(actor, company.pk)
            return
        approval_id = (
            _approval(proposal)
            if proposal.pk and proposal.status == "submitted" and not proposal._state.adding
            else proposal.approval_decision_id
        )
        decision_rows = list(CompanyWalletInstructionDecision.objects.filter(pk=approval_id))
        appointments = list(
            CompanyAppointment.objects.filter(company=company).filter(
                appointee_id__in={actor.pk, *(row.decided_by_id for row in decision_rows)}
            )
        )
        try:
            operator, _ = _lock_context(
                company,
                {actor.pk, *(row.decided_by_id for row in decision_rows)},
                _associations(proposal),
                appointments,
            )
        except WhitelistSigningHold as error:
            raise ValidationError({"unmet_requirements": error.unmet_requirements}) from None
        current_actor = get_user_model().objects.get(pk=actor.pk)
        profile = UserProfile.objects.filter(user=current_actor).first()
        yield company, current_actor, profile, operator


def _source_terms(company, nomination, target_change, expires_at, registry):
    if nomination is not None:
        captured = nomination.snapshot
        address = captured["address"]
        source = {key: captured[key] for key in ("request", "decision", "proof_completed_at", "eligibility_expires_at")}
        source |= {"nomination": str(nomination.pk), "target_change": None}
        associations = captured
    else:
        address = target_change.address
        source = dict.fromkeys(("nomination", "request", "decision", "proof_completed_at", "eligibility_expires_at"))
        source["target_change"] = str(target_change.pk)
        associations = None
    action = "add" if nomination else "remove"
    intent = _intent(action, address, registry, expires_at)
    snapshot = {
        "company": {"uuid": str(company.pk), "name": company.name, "acn": company.acn, "status": company.status},
        "target": {
            "address": address,
            "chain": "base",
            "chain_id": intent["chain_id"],
            "registry_address": registry,
            "expires_at": _stamp(expires_at) if expires_at else None,
        },
        "source": source,
        "transaction": {key: intent[key] for key in ("chain_id", "sender", "to", "value", "data")},
        "associations": associations,
    }
    return snapshot, intent


def _state(proposal):
    unmet = []
    company = Company.objects.get(pk=proposal.company_id)
    if {
        "uuid": str(company.pk),
        "name": company.name,
        "acn": company.acn,
        "status": company.status,
    } != proposal.snapshot["company"] or company.status != "active":
        unmet.append("whitelist_target_changed")
    target = proposal.snapshot["target"]
    if proposal.nomination_id:
        nomination = CompanyWalletNomination.objects.select_related("company", "request__user_account").get(
            pk=proposal.nomination_id
        )
        if nomination.company_id != proposal.company_id or nomination.snapshot != _associations(proposal):
            unmet.append("wallet_source_changed")
        unmet.extend(nomination_requirements(nomination))
        if proposal.expires_at is None:
            unmet.append("expiry_required")
        elif proposal.expires_at <= timezone.now():
            unmet.append("expiry_lapsed")
        elif proposal.expires_at > nomination.decision.expires_at:
            unmet.append("expiry_exceeds_eligibility")
    else:
        retained = WhitelistChange.objects.filter(
            pk=proposal.target_change_id,
            company_id=proposal.company_id,
            action="add",
            status__in=["confirmed", "unchanged"],
        ).first()
        if retained is None:
            unmet.append("target_outcome_required")
        elif (retained.chain_id, retained.registry_address, retained.address) != (
            target["chain_id"],
            target["registry_address"],
            target["address"],
        ):
            unmet.append("whitelist_target_changed")
    try:
        if (
            _intent(proposal.action, target["address"], target["registry_address"], proposal.expires_at)
            != proposal.intent
            or _digest(proposal.intent) != proposal.intent_digest
        ):
            unmet.append("whitelist_configuration_changed")
    except WhitelistChangeConflict:
        unmet.append("whitelist_configuration_changed")
    return sorted(set(unmet))


def _before_command(actor, proposal, kind, appointment):
    if kind == RegisterDecisionKind.REJECT:
        return []
    try:
        with use_operator():
            company = Company.objects.get(pk=proposal.company_id)
        if registry_for(company, get_base_chain_client()) != proposal.snapshot["target"]["registry_address"]:
            return ["whitelist_target_changed"]
    except (WhitelistRegistryMissing, WhitelistRegistryUnreadable):
        return ["registry_unavailable"]
    return []


def prepare_wallet_instruction(
    *, actor, operation_id, appointment, company, action, nomination=None, target_change=None, expires_at=None
):
    if (
        action not in ("add", "remove")
        or (action == "add") != (nomination is not None)
        or (action == "remove") != (target_change is not None)
        or (action == "add") != (expires_at is not None)
    ):
        raise ValidationError("An ADD names a nomination and finite expiry; a REMOVE names a retained ADD target.")
    if expires_at is not None and timezone.is_naive(expires_at):
        raise ValidationError("Wallet approval expiry requires a time zone.")
    if expires_at is not None and expires_at.microsecond:
        raise ValidationError("Wallet approval expiry must use whole seconds.")
    try:
        with use_operator(), _requester_principal(actor.pk):
            company_row = _readable_company(actor, company)
            existing = CompanyWalletInstruction.objects.filter(pk=operation_id).first()
            if existing is not None:
                if (
                    existing.company_id,
                    existing.submitted_by_id,
                    existing.preparing_appointment_id,
                    existing.action,
                    existing.nomination_id,
                    existing.target_change_id,
                    existing.expires_at,
                ) != (
                    UUID(str(company)),
                    actor.pk,
                    UUID(str(appointment)),
                    action,
                    UUID(str(nomination)) if nomination else None,
                    UUID(str(target_change)) if target_change else None,
                    expires_at,
                ):
                    raise WhitelistChangeConflict()
                return existing
            nomination_row = (
                get_object_or_404(CompanyWalletNomination, pk=nomination, company=company_row) if nomination else None
            )
            target_row = (
                get_object_or_404(
                    WhitelistChange.objects.company_targets(actor), pk=target_change, company_id=company_row.pk
                )
                if target_change
                else None
            )
            snapshot, intent = _source_terms(
                company_row, nomination_row, target_row, expires_at, registry_for(company_row, get_base_chain_client())
            )
            proposal = CompanyWalletInstruction(
                uuid=operation_id,
                company=company_row,
                action=action,
                nomination=nomination_row,
                target_change=target_row,
                expires_at=expires_at,
                snapshot=snapshot,
                intent=intent,
                intent_digest=_digest(intent),
                submitted_by=actor,
                preparing_appointment_id=appointment,
            )
        with wallet_command(actor, proposal, "company_wallet_instruction_prepare") as (
            company_row,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company_row, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            existing = CompanyWalletInstruction.objects.filter(pk=operation_id).first()
            if existing is not None:
                raise WhitelistChangeConflict()
            proposal.submitted_by = current_actor
            proposal.preparing_appointment = source
            proposal.save(force_insert=True)
            return proposal
    except (IntegrityError, OperationalError, RegisterChangeConflict):
        raise WhitelistChangeConflict() from None


def _lock(proposal):
    if proposal.nomination_id:
        CompanyWalletNomination.objects.select_for_update().get(pk=proposal.nomination_id)
    if proposal.target_change_id:
        WhitelistChange.objects.select_for_update().get(pk=proposal.target_change_id)
    return CompanyWalletInstruction.objects.select_for_update().get(pk=proposal.pk)


def queue_wallet_change(change):
    from whitelist.tasks.company_wallet import execute_company_wallet_change

    queue = App(connector=DjangoConnector(alias=current_alias()))
    return queue.configure_task(execute_company_wallet_change.name).defer(change_id=str(change.pk))


def _apply(proposal, actor, decision):
    target = proposal.snapshot["target"]
    if (
        WhitelistChange.objects.for_target(target["chain_id"], target["registry_address"], target["address"])
        .unresolved()
        .exists()
    ):
        raise WhitelistChangeConflict("Recover the original unresolved target first.")
    entry = (
        resolve_entry(target["address"], wallet_uuid=proposal.nomination.wallet_id)
        if proposal.nomination_id
        else WhitelistEntry.objects.filter(pk=proposal.target_change.entry_id).first()
    )
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.approval_decision_id = _approval(proposal)
    proposal.change_id = uuid4()
    proposal.save(
        update_fields=["status", "reviewed_by", "reviewed_at", "approval_decision", "change_id", "updated_at"]
    )
    change = WhitelistChange.objects.create(
        uuid=proposal.change_id,
        action=proposal.action,
        address=target["address"],
        chain_id=target["chain_id"],
        registry_address=target["registry_address"],
        company_id=proposal.company_id,
        expires_at=proposal.expires_at,
        intent=proposal.intent,
        initiated_by=actor,
        authority=WhitelistAuthority.COMPANY,
        source_instruction=proposal,
        requested_wallet_id=proposal.nomination.wallet_id if proposal.nomination_id else None,
        entry_id=entry.pk if entry else None,
    )
    if entry is not None:
        open_approval(entry, proposal.company, target["registry_address"])
    queue_wallet_change(change)


WALLET_INSTRUCTIONS = DecisionFamily(
    model=CompanyWalletInstruction,
    decision_model=CompanyWalletInstructionDecision,
    field="instruction",
    operation="company_wallet_instruction",
    noun="wallet_instruction",
    approved_function="whitelist_company_wallet_approved",
    digest_function="whitelist_company_wallet_decision_digest",
    effect_requirements=_state,
    lock=_lock,
    apply=_apply,
    before_command=_before_command,
    command=wallet_command,
)


def preview_wallet_instruction_decision(*, actor, instruction_id, **data):
    return preview(WALLET_INSTRUCTIONS, _details, actor=actor, proposal_id=instruction_id, **data)


def decide_wallet_instruction(*, actor, instruction_id, **data):
    try:
        return decide(WALLET_INSTRUCTIONS, actor=actor, proposal_id=instruction_id, **data)
    except (IntegrityError, OperationalError, RegisterChangeConflict):
        raise WhitelistChangeConflict() from None


def _details(proposal):
    return {
        "snapshot": proposal.snapshot,
        "intent_digest": proposal.intent_digest,
        "approval_decision": proposal.approval_decision_id,
        "change_id": proposal.change_id,
    }


def execution_receipt(proposal):
    if proposal.change_id is None:
        return None
    change = (
        WhitelistChange.objects.select_related("operation__current_attempt", "transaction")
        .filter(pk=proposal.change_id, source_instruction=proposal)
        .first()
    )
    if change is None:
        return None
    operation = change.operation
    attempt = operation.current_attempt if operation else None
    return {
        "change": change.pk,
        "status": change.status,
        "operation_id": operation.pk if operation else None,
        "claim_id": operation.claim_id if operation else None,
        "operation_status": operation.status if operation else None,
        "tx_hash": attempt.tx_hash if attempt else None,
        "transaction": change.transaction_id,
        "block_number": operation.block_number if operation else None,
        "block_hash": operation.block_hash if operation and operation.block_hash else None,
        "completed_at": change.completed_at,
        "failure_code": change.failure_code,
    }


def _authority_requirements(proposal):
    return (
        []
        if _scalar("SELECT whitelist_company_wallet_source_current(%s, clock_timestamp())", [proposal.pk])
        else ["approval_lapsed"]
    )


def execution_requirements(proposal):
    if proposal.status != "applied":
        return []
    operation = OutgoingOperation.objects.filter(whitelist_change__uuid=proposal.change_id).first()
    if operation and operation.status in (
        OutgoingStatus.SIGNED,
        OutgoingStatus.CONFIRMED,
        OutgoingStatus.FAILED,
        OutgoingStatus.REVERTED,
    ):
        return []
    return sorted(set(_state(proposal) + _authority_requirements(proposal)))


@contextmanager
def signing_source(change, claim):
    operation = OutgoingOperation.objects.get(pk=claim.operation_id)
    if operation.claim_id == claim.claim_id and operation.status in (OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED):
        yield None
        return
    source = CompanyWalletInstruction.objects.filter(
        pk=change.source_instruction_id, company_id=change.company_id, change_id=change.pk, status="applied"
    ).first()
    if source is None:
        raise WhitelistSigningHold(["legacy_source_unavailable"])
    target = source.snapshot["target"]
    try:
        lock_target(target["chain_id"], target["registry_address"], target["address"])
        company = Company.objects.select_for_update().get(pk=source.company_id)
        operation = OutgoingOperation.objects.get(pk=claim.operation_id)
        if operation.claim_id == claim.claim_id and operation.status in (
            OutgoingStatus.SIGNED,
            OutgoingStatus.CONFIRMED,
        ):
            yield None
            return
        decisions = list(
            CompanyWalletInstructionDecision.objects.filter(instruction=source, kind="apply")
            | CompanyWalletInstructionDecision.objects.filter(pk=source.approval_decision_id)
        )
        appointments = list(CompanyAppointment.objects.filter(pk__in=[row.appointment_id for row in decisions]))
        _lock_context(company, {row.decided_by_id for row in decisions}, _associations(source), appointments)
        source = CompanyWalletInstruction.objects.select_for_update().get(pk=source.pk)
        WhitelistChange.objects.select_for_update().get(pk=change.pk)

        def validate(operation):
            unmet = _state(source) + _authority_requirements(source)
            if (
                source.intent != change.intent
                or source.action != change.action
                or source.company_id != change.company_id
            ):
                unmet.append("whitelist_target_changed")
            if unmet:
                raise WhitelistSigningHold(sorted(set(unmet)))

        yield validate
    except OperationalError as error:
        if _busy(error):
            raise WhitelistSigningHold(["source_lock_busy"]) from None
        raise
