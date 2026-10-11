import re
from datetime import date
from decimal import Decimal
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterAgreement,
    RegisterAllotment,
    RegisterAllotmentDecision,
    RegisterContribution,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareRegister,
    ShareToken,
)
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, decide, preview
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_grants import _state
from tokens.services.register_imports import _company_of


def _text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValidationError(f"An external allotment needs a {label} with at most {limit} characters.")
    return value.strip()


def _money(value):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,17})(?:[.][0-9]{1,2})?", value):
        raise ValidationError(
            "Record an exact positive AUD amount with at most eighteen whole digits and two decimals."
        )
    amount = Decimal(value)
    if amount <= 0:
        raise ValidationError("An external allotment needs positive AUD consideration and receipt.")
    return amount


def _retain(subject, reference, kind, company, actor):
    evidence = RegisterEvidence.objects.select_for_update().filter(pk=reference).first()
    raw = own_evidence_bytes(
        evidence, kind, company, actor, "Name the required evidence you uploaded for this company."
    )
    subject.evidence = evidence
    subject.evidence_fingerprint = evidence.sha256
    subject.evidence_snapshot = evidence_snapshot(evidence)
    subject.file.save("evidence.bin", ContentFile(raw), save=False)


def prepare_allotment(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    member,
    new_member,
    shares,
    consideration,
    currency,
    agreement_reference,
    agreement_on,
    terms,
    agreement_evidence,
    received_amount,
    received_on,
    receipt_evidence,
    approving_director,
    authority_reference,
    reason,
    authority_evidence,
    name="",
    residential_address="",
):
    try:
        operation_id, appointment, token_id, member, authority_evidence, agreement_evidence, receipt_evidence = (
            UUID(str(value))
            for value in (
                operation_id,
                appointment,
                token_id,
                member,
                authority_evidence,
                agreement_evidence,
                receipt_evidence,
            )
        )
        agreement_on, received_on = (date.fromisoformat(str(value)) for value in (agreement_on, received_on))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Allotment references must be UUIDs and agreement/receipt dates ISO dates.") from None
    if type(new_member) is not bool or currency != "AUD":
        raise ValidationError("State whether the member is new and record AUD consideration only.")
    if max(agreement_on, received_on) > timezone.now().date():
        raise ValidationError("Agreement and receipt dates cannot be in the future (UTC).")
    amount, received = _money(consideration), _money(received_amount)
    if amount != received:
        raise ValidationError(
            "The company-recorded receipt allocated to this fully paid allotment must equal its consideration."
        )
    if not isinstance(shares, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", shares) or int(shares) >= 2**256:
        raise ValidationError("An allotment needs positive whole shares within the share limit.")
    if not isinstance(name, str) or not isinstance(residential_address, str):
        raise ValidationError("Member identity fields must be text.")
    values = dict(
        shares=int(shares),
        new_member=new_member,
        consideration=amount,
        currency=currency,
        approving_director=_text(approving_director, "named approving director", 255),
        authority_reference=_text(authority_reference, "company authority reference", 255),
        reason=_text(reason, "reason", 1000),
    )
    agreement_values = dict(
        reference=_text(agreement_reference, "external agreement reference", 255),
        agreed_on=agreement_on,
        terms=_text(terms, "agreement terms summary", 1000),
    )
    contribution_values = dict(amount=received, currency=currency, received_on=received_on)
    saved = []
    try:
        with register_command(actor, _company_of(actor, token_id), "register_allotment_prepare") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            token = ShareToken.objects.select_for_update().filter(pk=token_id, company=company).first()
            if token is None:
                raise NotFound("Share class not found.")
            list(ShareRegister.objects.select_for_update().filter(token=token).values_list("uuid", flat=True))
            existing = (
                RegisterAllotment.objects.select_related("agreement", "contribution").filter(pk=operation_id).first()
            )
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "token_id": token.pk,
                    "member": member,
                    "name": name.strip() if name else existing.name,
                    "residential_address": (
                        residential_address.strip() if residential_address else existing.residential_address
                    ),
                    "authority_evidence_id": authority_evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if (
                    any(getattr(existing, key) != value for key, value in expected.items())
                    or any(
                        getattr(existing.agreement, key) != value
                        for key, value in {**agreement_values, "evidence_id": agreement_evidence}.items()
                    )
                    or any(
                        getattr(existing.contribution, key) != value
                        for key, value in {**contribution_values, "evidence_id": receipt_evidence}.items()
                    )
                ):
                    raise RegisterChangeConflict()
                return existing, False
            if not new_member:
                held = (
                    RegisterMemberParticulars.objects.select_for_update()
                    .filter(member_id=member, member__company=company)
                    .first()
                )
                if held is None:
                    raise ValidationError("Choose an identified member of this company's register.")
                if (name and name.strip() != held.name) or (
                    residential_address and residential_address.strip() != held.residential_address
                ):
                    raise ValidationError("An existing member's identity must match the retained particulars.")
                name, residential_address = held.name, held.residential_address
            proposal = RegisterAllotment(
                uuid=operation_id,
                company=company,
                token=token,
                member=member,
                preparing_appointment=source,
                submitted_by=current_actor,
                name=_text(name, "member name", 255),
                residential_address=_text(residential_address, "residential address", REGISTER_IMPORT_ADDRESS_LENGTH),
                **values,
            )
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            common = dict(company=company, preparing_appointment=source, recorded_by=current_actor)
            agreement = RegisterAgreement(**common, **agreement_values)
            saved.append(agreement)
            _retain(agreement, agreement_evidence, RegisterEvidenceKind.SUPPORTING, company, current_actor)
            agreement.save(force_insert=True)
            contribution = RegisterContribution(agreement=agreement, **common, **contribution_values)
            saved.append(contribution)
            _retain(contribution, receipt_evidence, RegisterEvidenceKind.SUPPORTING, company, current_actor)
            contribution.save(force_insert=True)
            proposal.agreement, proposal.contribution = agreement, contribution
            evidence = RegisterEvidence.objects.select_for_update().filter(pk=authority_evidence).first()
            raw = own_evidence_bytes(
                evidence,
                RegisterEvidenceKind.AUTHORITY,
                company,
                current_actor,
                "Name the company authority evidence you uploaded.",
            )
            saved.append(proposal)
            proposal.authority_evidence, proposal.evidence_fingerprint, proposal.evidence_snapshot = (
                evidence,
                evidence.sha256,
                evidence_snapshot(evidence),
            )
            proposal.file.save("evidence.bin", ContentFile(raw), save=False)
            proposal.save(force_insert=True)
            return proposal, True
    except BaseException as error:
        discard(*(subject.file for subject in saved))
        if isinstance(error, IntegrityError):
            raise RegisterChangeConflict() from None
        raise


def _effect_requirements(proposal):
    unmet = _state(proposal)
    if proposal.contribution.amount != proposal.consideration or proposal.contribution.currency != "AUD":
        unmet.append("fully_paid_company_receipt_required")
    try:
        for subject in (proposal, proposal.agreement, proposal.contribution):
            matching_bytes(subject.file, subject.evidence_snapshot["file_size"], subject.evidence_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    return unmet


def _details(proposal):
    token = ShareToken.objects.get(pk=proposal.token_id)
    register = ShareRegister.objects.filter(token=token).first()
    held = RegisterPosition.objects.filter(register=register, member_id=proposal.member).first()
    issued, shares = int(register.issued_supply) if register else 0, int(held.shares) if held else 0
    return dict(
        member=proposal.member,
        new_member=proposal.new_member,
        name=proposal.name,
        residential_address=proposal.residential_address,
        shares=str(proposal.shares),
        consideration=str(proposal.consideration),
        currency=proposal.currency,
        agreement=proposal.agreement,
        contribution=proposal.contribution,
        approving_director=proposal.approving_director,
        authority_reference=proposal.authority_reference,
        reason=proposal.reason,
        effective_on=timezone.now().date(),
        register_sequence=register.sequence if register else 0,
        issued_supply=str(issued),
        authorised_supply=token.total_supply,
        after_issued_supply=str(issued + int(proposal.shares)),
        current_shares=str(shares),
        after_shares=str(shares + int(proposal.shares)),
    )


def _lock(proposal):
    ShareToken.objects.select_for_update().get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    list(
        RegisterMemberParticulars.objects.select_for_update()
        .filter(member_id=proposal.member)
        .values_list("uuid", flat=True)
    )
    RegisterAgreement.objects.select_for_update().get(pk=proposal.agreement_id)
    RegisterContribution.objects.select_for_update().get(pk=proposal.contribution_id)
    return RegisterAllotment.objects.select_for_update().select_related("agreement", "contribution").get(pk=proposal.pk)


def _apply(proposal, actor, decision):
    effective_on = timezone.now().date()
    if proposal.new_member:
        create_member(company_id=proposal.company_id, member_id=proposal.member)
        RegisterMemberParticulars.objects.create(
            member_id=proposal.member,
            name=proposal.name,
            residential_address=proposal.residential_address,
            as_at=effective_on,
            source_allotment=proposal,
        )
    proposal.register_entry = record_entry(
        register_id=ShareRegister.objects.get(token_id=proposal.token_id).pk,
        operation_id=proposal.pk,
        kind=RegisterEntryKind.ISSUE,
        changes=[{"member": str(proposal.member), "shares": str(proposal.shares)}],
        effective_on=effective_on,
        recorded_by=actor,
    )
    proposal.status, proposal.reviewed_by, proposal.reviewed_at = "applied", actor, decision.decided_at
    proposal.save(update_fields=["status", "register_entry", "reviewed_by", "reviewed_at", "updated_at"])


ALLOTMENTS = DecisionFamily(
    model=RegisterAllotment,
    decision_model=RegisterAllotmentDecision,
    field="register_allotment",
    operation="register_allotment",
    approved_function="tokens_register_allotment_approved",
    digest_function="tokens_register_allotment_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
    noun="allotment",
)


def preview_allotment_decision(*, actor, allotment_id, appointment, kind, reason=""):
    return preview(
        ALLOTMENTS, _details, actor=actor, proposal_id=allotment_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_allotment(
    *, actor, allotment_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""
):
    try:
        return decide(
            ALLOTMENTS,
            actor=actor,
            proposal_id=allotment_id,
            appointment=appointment,
            kind=kind,
            idempotency_key=idempotency_key,
            preview_digest=preview_digest,
            confirmation=confirmation,
            reason=reason,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None
