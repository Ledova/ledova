from companies.models import CompanyAppointment, CompanyDocument
from tokens.exceptions import RegisterIntegrityError
from tokens.models import (
    RegisterAgreement,
    RegisterAllotment,
    RegisterAward,
    RegisterAwardVesting,
    RegisterCapitalIncrease,
    RegisterContribution,
    RegisterCorrection,
    RegisterDeployment,
    RegisterEntryKind,
    RegisterGrant,
    RegisterImport,
    RegisterInstruction,
    RegisterMember,
    RegisterOpening,
    RegisterParticularsChange,
    RegisterPauseChange,
    RegisterTransfer,
    RegisterWalletLink,
)
from tokens.services.company_pack_documents import retained_evidence_path
from tokens.services.company_pack_history import _name
from whitelist.models import (
    CompanyWalletInstruction,
    CompanyWalletNomination,
    WhitelistChange,
)


def _refuse(record):
    raise RegisterIntegrityError(f"The company source of {record._meta.verbose_name} {record.pk} is inconsistent.")


def _appointment(record, appointment, actor_id):
    if appointment is not None and (
        appointment.company_id != record.company_id or appointment.appointee_id != actor_id
    ):
        _refuse(record)
    return None if appointment is None else appointment.pk


def _source(record, evidence_field, fingerprint_field, snapshot_field, document_field=None):
    evidence = getattr(record, evidence_field) if evidence_field else None
    document_id = getattr(record, document_field) if document_field else None
    snapshot = getattr(record, snapshot_field) or {}
    if evidence is not None and (
        evidence.company_id != record.company_id
        or evidence.sha256 != getattr(record, fingerprint_field)
        or evidence.sha256 != snapshot.get("sha256")
    ):
        _refuse(record)
    if (
        document_id is not None
        and CompanyDocument.objects.filter(pk=document_id).exclude(company_id=record.company_id).exists()
    ):
        _refuse(record)
    if snapshot.get("company") is not None and snapshot["company"] != str(record.company_id):
        _refuse(record)
    return {
        "evidence": None if evidence is None else evidence.pk,
        "company_document": document_id,
        "fingerprint": getattr(record, fingerprint_field),
        "sha256": snapshot.get("sha256"),
        "name": snapshot.get("name"),
        "mime_type": snapshot.get("mime_type"),
        "size": snapshot.get("file_size"),
        "path": retained_evidence_path(record, snapshot_field),
    }


def _authority(record):
    return _source(record, "authority_evidence", "evidence_fingerprint", "evidence_snapshot", "source_document")


def _decisions(record):
    return [
        {
            "uuid": decision.pk,
            "kind": decision.kind,
            "appointment": _appointment(record, decision.appointment, decision.decided_by_id),
            "decided_by": _name(decision.decided_by),
            "decided_by_id": decision.decided_by_id,
            "decided_at": decision.decided_at,
            "digest": decision.digest,
            "reason": decision.reason,
        }
        for decision in record.decisions.select_related("appointment", "decided_by__userprofile").order_by(
            "decided_at", "uuid"
        )
    ]


def _record(record, *, token=None, sources=None, command=None, result=None):
    if token is not None and token.company_id != record.company_id:
        _refuse(record)
    decisions = _decisions(record)
    approval = getattr(record, "approval_decision_id", None)
    if approval is not None and not any(
        decision["uuid"] == approval and decision["kind"] == "approve" for decision in decisions
    ):
        _refuse(record)
    return {
        "uuid": record.pk,
        "company": record.company_id,
        "token": None if token is None else token.pk,
        "provided_by": "company" if record.preparing_appointment_id else "legacy_staff_workflow",
        "preparing_appointment": _appointment(record, record.preparing_appointment, record.submitted_by_id),
        "prepared_by": _name(record.submitted_by),
        "prepared_by_id": record.submitted_by_id,
        "prepared_at": record.created_at,
        "status": record.status,
        "approval_decision": approval,
        "reviewer": _name(record.reviewed_by),
        "reviewed_at": record.reviewed_at,
        "rejection_reason": record.rejection_reason,
        "decisions": decisions,
        "sources": sources or {},
        "command": {
            "authority": getattr(record, "authority", None),
            "approving_director": getattr(record, "approving_director", None),
            "authority_reference": getattr(record, "authority_reference", None),
            "reason": getattr(record, "reason", None),
            **(command or {}),
        },
        "result": result or {},
    }


def _records(model, company):
    return (
        model.objects.filter(company=company)
        .select_related("preparing_appointment", "submitted_by__userprofile", "reviewed_by__userprofile")
        .order_by("created_at", "uuid")
    )


def _entry(record, entry, kind):
    if entry is not None and (
        entry.register.company_id != record.company_id
        or (getattr(record, "token_id", None) is not None and entry.register.token_id != record.token_id)
        or (getattr(record, "register_id", None) is not None and entry.register_id != record.register_id)
        or entry.kind != kind
        or entry.operation_id != record.pk
    ):
        _refuse(record)
    return None if entry is None else {"uuid": entry.pk, "sequence": entry.sequence}


def _related(record, related):
    if related is not None and (
        related.company_id != record.company_id
        or (
            getattr(related, "token_id", None) is not None
            and getattr(record, "token_id", None) is not None
            and related.token_id != record.token_id
        )
    ):
        _refuse(record)
    return None if related is None else related.pk


def _member(record, member_id):
    if RegisterMember.objects.filter(pk=member_id).exclude(company_id=record.company_id).exists():
        _refuse(record)
    return member_id


def _subscription(record):
    subscription = record.paid_subscription
    if subscription is not None:
        _related(record, subscription.offering)
    return _related(record, subscription)


def _execution(record, execution):
    if execution is None:
        return None
    _related(record, execution)
    if getattr(execution, "request_id", None) is not None and execution.request_id != record.request_id:
        _refuse(record)
    return {
        "uuid": execution.pk,
        "operation": None if execution.operation is None else execution.operation.operation_key,
        "status": getattr(execution, "status", None),
        "issuance": getattr(execution, "issuance_id", None),
        "projected_at": getattr(execution, "projected_at", None),
    }


def _correction(record):
    if record.corrects.register_id != record.register_id:
        _refuse(record)
    return _record(
        record,
        token=record.register.token,
        sources={"authority": _authority(record)},
        command={"base_sequence": record.base_sequence, "base_hash": record.base_hash},
        result={
            "entry": _entry(record, record.applied_entry, RegisterEntryKind.CORRECTION),
            "corrects": record.corrects_id,
        },
    )


def _wallet_change(record):
    if record.change_id is None:
        return None
    change = WhitelistChange.objects.get(pk=record.change_id)
    if change.source_instruction_id != record.pk:
        _refuse(record)
    return _related(record, change)


def _nomination(record):
    _related(record, record.request)
    if record.decision.request_id != record.request_id:
        _refuse(record)
    return {
        "uuid": record.pk,
        "company": record.company_id,
        "request": record.request_id,
        "decision": record.decision_id,
        "submitted_by": _name(record.submitted_by),
        "submitted_at": record.submitted_at,
        "sharing_accepted": record.sharing_accepted,
        "digest": record.digest,
        "address": record.snapshot.get("address"),
        "chain": record.snapshot.get("chain"),
        "proof_completed_at": record.snapshot.get("proof_completed_at"),
        "eligibility_expires_at": record.snapshot.get("eligibility_expires_at"),
    }


def _appointment_record(appointment):
    for source in (appointment.request, appointment.invitation, appointment.legacy_owner, appointment.registry_check):
        _related(appointment, source)
    revocation = getattr(appointment, "revocation", None)
    return {
        "uuid": appointment.pk,
        "company": appointment.company_id,
        "appointee": _name(appointment.appointee),
        "appointee_id": appointment.appointee_id,
        "capabilities": appointment.capabilities,
        "delegatable_capabilities": appointment.delegatable_capabilities,
        "created_at": appointment.created_at,
        "expires_at": appointment.expires_at,
        "source": {
            "request": appointment.request_id,
            "invitation": appointment.invitation_id,
            "legacy_owner": appointment.legacy_owner_id,
            "declaration_version": appointment.declaration_version,
            "declaration_text": appointment.declaration_text,
        },
        "revocation": (
            None
            if revocation is None
            else {
                "uuid": revocation.pk,
                "revoked_by": _name(revocation.revoked_by),
                "revoked_at": revocation.created_at,
            }
        ),
    }


def _fact(record, actor, *, sources, data):
    return {
        "uuid": record.pk,
        "company": record.company_id,
        "recorded_at": record.created_at,
        "recorded_by": actor.pk,
        "recorded_by_name": _name(actor),
        "provided_by": "company",
        "preparing_appointment": _appointment(record, record.preparing_appointment, actor.pk),
        "sources": sources,
        "data": data,
    }


def _facts(model, company):
    return model.objects.filter(company=company).select_related("preparing_appointment").order_by("created_at", "uuid")


def section(company):
    openings = [
        _record(
            record,
            token=record.token,
            sources={"authority": _authority(record)},
            result={"entry": _entry(record, record.applied_entry, RegisterEntryKind.OPENING)},
        )
        for record in _records(RegisterOpening, company)
    ]
    imports = [
        _record(
            record,
            token=record.token,
            sources={
                "register": _source(
                    record, "register_evidence", "evidence_fingerprint", "evidence_snapshot", "source_document"
                ),
                "asic": _source(record, "asic_evidence", "asic_fingerprint", "asic_snapshot", "asic_document"),
            },
            result={"register_sequence": record.register_sequence},
        )
        for record in _records(RegisterImport, company)
    ]
    corrections = [_correction(record) for record in _records(RegisterCorrection, company)]
    links = [
        _record(record, sources={"authority": _authority(record)}) for record in _records(RegisterWalletLink, company)
    ]
    particulars = [
        _record(
            record,
            sources={"supporting": _source(record, "supporting_evidence", "evidence_fingerprint", "evidence_snapshot")},
            command={
                "member": _related(record, record.member),
                "as_at": record.as_at,
                "member_request": record.member_request_id,
            },
        )
        for record in _records(RegisterParticularsChange, company)
    ]
    grants = [
        _record(
            record,
            token=record.token,
            sources={
                "authority": _source(record, "authority_evidence", "evidence_fingerprint", "evidence_snapshot"),
                "terms": _source(record, "terms_evidence", "terms_fingerprint", "terms_snapshot"),
                "acceptance": _source(record, "acceptance_evidence", "acceptance_fingerprint", "acceptance_snapshot"),
            },
            command={
                "member": _member(record, record.member),
                "shares": str(record.shares),
                "terms_on": record.terms_on,
                "terms": record.terms,
                "acceptance_required": record.acceptance_required,
                "award": _related(record, record.award),
                "authority_reference": record.authority_reference,
            },
            result={"entry": _entry(record, record.register_entry, RegisterEntryKind.ISSUE)},
        )
        for record in _records(RegisterGrant, company)
    ]
    transfers = [
        _record(
            record,
            token=record.token,
            sources={
                "authority": _source(record, "authority_evidence", "evidence_fingerprint", "evidence_snapshot"),
                "instrument": _source(record, "instrument_evidence", "instrument_fingerprint", "instrument_snapshot"),
            },
            command={
                "from_member": _member(record, record.from_member),
                "to_member": _member(record, record.to_member),
                "shares": str(record.shares),
                "signed_on": record.signed_on,
                "lodged_on": record.lodged_on,
                "terms": record.terms,
                "authority_reference": record.authority_reference,
            },
            result={"entry": _entry(record, record.register_entry, RegisterEntryKind.TRANSFER)},
        )
        for record in _records(RegisterTransfer, company)
    ]
    instructions = [
        _record(
            record,
            token=record.token,
            sources={
                "authority": _authority(record),
                "terms": _source(record, "terms_evidence", "terms_fingerprint", "terms_snapshot"),
                "acceptance": _source(record, "acceptance_evidence", "acceptance_fingerprint", "acceptance_snapshot"),
            },
            command={
                "kind": record.kind,
                "terms_on": record.terms_on,
                "terms": record.terms,
                "acceptance_required": record.acceptance_required,
                "intent_digest": record.intent_digest,
                "items": record.items,
                "member": _related(record, record.member),
                "nomination": _related(record, record.nomination),
                "wallet_approval": _related(record, record.wallet_approval),
                "paid_subscription": _subscription(record),
            },
            result={
                "request": _related(record, record.request),
                "executions": [
                    _execution(record, execution)
                    for execution in record.executions.select_related("operation").order_by("created_at", "uuid")
                ],
            },
        )
        for record in _records(RegisterInstruction, company)
    ]
    deployments = [
        _record(
            record,
            token=record.token,
            command={"intent_digest": record.intent_digest},
            result={
                "deployment": record.deployment_id,
                "execution": _execution(record, getattr(record, "execution", None)),
            },
        )
        for record in _records(RegisterDeployment, company)
    ]
    capital = [
        _record(
            record,
            token=record.token,
            sources={"authority": _source(record, "authority_evidence", "evidence_fingerprint", "evidence_snapshot")},
            command={
                "intent_digest": record.intent_digest,
                "additional_shares": str(record.request.additional_shares),
                "new_authorized_total": str(record.request.new_authorized_total),
                "purpose": record.request.purpose,
                "board_resolution_reference": record.request.board_resolution_reference,
                "shareholder_approval_reference": record.request.shareholder_approval_reference,
            },
            result={
                "request": _related(record, record.request),
                "executions": [
                    _execution(record, execution)
                    for execution in record.executions.select_related("operation").order_by("created_at", "uuid")
                ],
            },
        )
        for record in _records(RegisterCapitalIncrease, company)
    ]
    pauses = [
        _record(
            record,
            token=record.token,
            sources={"authority": _source(record, "authority_evidence", "evidence_fingerprint", "evidence_snapshot")},
            command={
                "intent_digest": record.intent_digest,
                "paused": record.paused,
                "authority_reference": record.authority_reference,
                "reason": record.reason,
            },
            result={"execution": _execution(record, getattr(record, "execution", None))},
        )
        for record in _records(RegisterPauseChange, company)
    ]
    wallet_instructions = [
        _record(
            record,
            command={
                "action": record.action,
                "nomination": _related(record, record.nomination),
                "target_change": _related(record, record.target_change),
                "expires_at": record.expires_at,
                "intent_digest": record.intent_digest,
            },
            result={"change": _wallet_change(record)},
        )
        for record in _records(CompanyWalletInstruction, company)
    ]
    nominations = [
        _nomination(record)
        for record in CompanyWalletNomination.objects.filter(company=company)
        .select_related("submitted_by__userprofile", "request", "decision")
        .order_by("submitted_at", "uuid")
    ]
    awards = [
        _fact(
            record,
            record.submitted_by,
            sources={"agreement": _source(record, "agreement_evidence", "agreement_fingerprint", "agreement_snapshot")},
            data={
                "token": record.token_id,
                "member": _member(record, record.member),
                "name": record.name,
                "residential_address": record.residential_address,
                "shares": str(record.shares),
                "terms_on": record.terms_on,
                "terms": record.terms,
                "schedule": record.schedule,
                "is_entitlement": True,
            },
        )
        for record in _facts(RegisterAward, company)
    ]
    vestings = [
        _fact(
            record,
            record.submitted_by,
            sources={"evidence": _source(record, "evidence", "evidence_fingerprint", "evidence_snapshot")},
            data={"award": _related(record, record.award), "shares": str(record.shares), "vested_on": record.vested_on},
        )
        for record in _facts(RegisterAwardVesting, company)
    ]
    agreements = [
        _fact(
            record,
            record.recorded_by,
            sources={"agreement": _source(record, "evidence", "evidence_fingerprint", "evidence_snapshot")},
            data={"reference": record.reference, "agreed_on": record.agreed_on, "terms": record.terms},
        )
        for record in _facts(RegisterAgreement, company)
    ]
    contributions = [
        _fact(
            record,
            record.recorded_by,
            sources={"receipt": _source(record, "evidence", "evidence_fingerprint", "evidence_snapshot")},
            data={
                "amount": str(record.amount),
                "currency": record.currency,
                "received_on": record.received_on,
                "company_recorded": True,
                "verified_by_ledova": False,
            },
        )
        for record in _facts(RegisterContribution, company)
    ]
    allotments = [
        _record(
            record,
            token=record.token,
            sources={"authority": _source(record, "authority_evidence", "evidence_fingerprint", "evidence_snapshot")},
            command={
                "member": _member(record, record.member),
                "new_member": record.new_member,
                "name": record.name,
                "residential_address": record.residential_address,
                "shares": str(record.shares),
                "consideration": str(record.consideration),
                "currency": record.currency,
                "agreement": _related(record, record.agreement),
                "contribution": _related(record, record.contribution),
            },
            result={"entry": _entry(record, record.register_entry, RegisterEntryKind.ISSUE)},
        )
        for record in _records(RegisterAllotment, company)
    ]
    records = {
        "openings": openings,
        "imports": imports,
        "corrections": corrections,
        "wallet_links": links,
        "particulars_changes": particulars,
        "grants": grants,
        "transfers": transfers,
        "instructions": instructions,
        "deployments": deployments,
        "capital_increases": capital,
        "pause_changes": pauses,
        "wallet_instructions": wallet_instructions,
    }
    appointment_ids = {
        appointment
        for rows in [*records.values(), awards, vestings, agreements, contributions, allotments]
        for record in rows
        for appointment in [
            record["preparing_appointment"],
            *(decision["appointment"] for decision in record.get("decisions", [])),
        ]
        if appointment is not None
    }
    appointments = [
        _appointment_record(appointment)
        for appointment in CompanyAppointment.objects.filter(company=company, pk__in=appointment_ids)
        .select_related("appointee__userprofile", "revocation__revoked_by__userprofile")
        .order_by("created_at", "uuid")
    ]
    return {
        "company": company.pk,
        "appointments": appointments,
        "wallet_nominations": nominations,
        "awards": awards,
        "vestings": vestings,
        "agreements": agreements,
        "contributions": contributions,
        "allotments": allotments,
        **records,
    }
