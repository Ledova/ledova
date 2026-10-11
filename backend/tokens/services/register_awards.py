import re
from datetime import date
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError, connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from shared.db import current_alias, use_operator
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterAward,
    RegisterAwardVesting,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    ShareRegister,
    ShareToken,
)
from tokens.models.choices import ShareTokenStatus
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_imports import _company_of


def _text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValidationError(f"Record {label} with at most {limit} characters.")
    return value.strip()


def _shares(value):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", value) or int(value) >= 2**256:
        raise ValidationError("Record positive whole shares within the share limit.")
    return int(value)


def _date(value):
    try:
        held = date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise ValidationError("Record an ISO date.") from None
    if held > timezone.now().date():
        raise ValidationError("A company-recorded fact cannot have a future date (UTC).")
    return held


def _references(*values):
    try:
        return tuple(UUID(str(value)) for value in values)
    except (TypeError, ValueError, AttributeError):
        raise ValidationError("Award references must be UUIDs.") from None


def _require_class(token):
    if (
        token.status != ShareTokenStatus.DRAFT
        or token.contract_address
        or token.deployment_id
        or token.deployment_transaction_id
        or token.deployment_tx_hash
        or token.deployed_at
        or token.chain
        or not RegisterImport.objects.filter(token=token, status="applied").exists()
        or not ShareRegister.objects.filter(token=token, sequence__gt=0).exists()
    ):
        raise ValidationError({"unmet_requirements": ["imported_non_tokenised_register_required"]})


def award_quantities(award, excluding_grant=None):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_employee_award_vested(%s), tokens_employee_award_issued(%s, %s)",
            [award.pk, award.pk, excluding_grant],
        )
        vested, issued = (int(value) for value in cursor.fetchone())
    return {"vested_shares": str(vested), "issued_shares": str(issued), "available_shares": str(vested - issued)}


def _lock_award(award_id, company):
    initial = RegisterAward.objects.filter(pk=award_id, company=company).first()
    if initial is None:
        raise NotFound("Employee award not found.")
    token = ShareToken.objects.select_for_update().get(pk=initial.token_id, company=company)
    list(ShareRegister.objects.select_for_update().filter(token=token).values_list("uuid", flat=True))
    return RegisterAward.objects.select_for_update().get(pk=initial.pk), token


def _agreement_available(award):
    matching_bytes(award.file, award.agreement_snapshot["file_size"], award.agreement_fingerprint)


def record_award(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    member,
    new_member,
    shares,
    terms_on,
    terms,
    schedule,
    agreement_evidence,
    name="",
    residential_address="",
):
    operation_id, appointment, token_id, member, agreement_evidence = _references(
        operation_id, appointment, token_id, member, agreement_evidence
    )
    if type(new_member) is not bool:
        raise ValidationError("State whether the promised recipient is a new member.")
    if not isinstance(name, str) or not isinstance(residential_address, str):
        raise ValidationError("Recipient identity fields must be text.")
    values = {
        "shares": _shares(shares),
        "terms_on": _date(terms_on),
        "terms": _text(terms, "the agreement summary", 1000),
        "schedule": _text(schedule, "the recorded vesting schedule", 1000),
        "new_member": new_member,
    }
    if new_member:
        name = _text(name, "the recipient name", 255)
        residential_address = _text(residential_address, "the residential address", REGISTER_IMPORT_ADDRESS_LENGTH)
    award = None
    try:
        with register_command(actor, _company_of(actor, token_id), "register_award_record") as (
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
            prior = RegisterAward.objects.select_for_update().filter(pk=operation_id).first()
            if prior is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "token_id": token.pk,
                    "member": member,
                    "name": name.strip() if name else prior.name,
                    "residential_address": (
                        residential_address.strip() if residential_address else prior.residential_address
                    ),
                    "agreement_evidence_id": agreement_evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(prior, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return prior, False
            _require_class(token)
            existing = RegisterMember.objects.filter(pk=member).first()
            if new_member and existing is not None:
                raise ValidationError("The new recipient UUID already identifies a member.")
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
                    raise ValidationError("The existing recipient must match current retained particulars.")
                name, residential_address = held.name, held.residential_address
            if RegisterMemberWallet.objects.filter(member_id=member).exists():
                raise ValidationError("This award path requires a walletless recipient.")
            evidence = RegisterEvidence.objects.select_for_update().filter(pk=agreement_evidence).first()
            raw = own_evidence_bytes(
                evidence,
                RegisterEvidenceKind.SUPPORTING,
                company,
                current_actor,
                "Name the agreement evidence you uploaded for this company.",
            )
            award = RegisterAward(
                uuid=operation_id,
                company=company,
                token=token,
                member=member,
                name=_text(name, "the recipient name", 255),
                residential_address=_text(
                    residential_address, "the residential address", REGISTER_IMPORT_ADDRESS_LENGTH
                ),
                agreement_evidence=evidence,
                agreement_fingerprint=evidence.sha256,
                agreement_snapshot=evidence_snapshot(evidence),
                preparing_appointment=source,
                submitted_by=current_actor,
                **values,
            )
            award.file.save("agreement.bin", ContentFile(raw), save=False)
            try:
                award.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return award, True
    except BaseException:
        if award is not None:
            discard(award.file)
        raise


def record_award_vesting(*, actor, operation_id, appointment, award, shares, vested_on, evidence):
    operation_id, appointment, award, evidence = _references(operation_id, appointment, award, evidence)
    values = {"shares": _shares(shares), "vested_on": _date(vested_on)}
    with use_operator():
        initial = RegisterAward.objects.readable_by(actor).filter(pk=award).first()
    if initial is None:
        raise NotFound("Employee award not found.")
    vesting = None
    try:
        with register_command(actor, initial.company_id, "register_award_vesting_record") as (
            company,
            current_actor,
            profile,
            operator,
        ):
            source = register_appointment(
                company, current_actor, profile, operator, appointment, CompanyCapability.PREPARE
            )
            held, token = _lock_award(award, company)
            prior = RegisterAwardVesting.objects.filter(pk=operation_id).first()
            if prior is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "award_id": held.pk,
                    "evidence_id": evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(prior, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return prior, False
            _require_class(token)
            _agreement_available(held)
            if values["vested_on"] < held.terms_on:
                raise ValidationError("A vesting fact cannot precede the recorded agreement date.")
            if int(award_quantities(held)["vested_shares"]) + values["shares"] > int(held.shares):
                raise ValidationError("Recorded vesting exceeds the promised award quantity.")
            source_evidence = RegisterEvidence.objects.select_for_update().filter(pk=evidence).first()
            raw = own_evidence_bytes(
                source_evidence,
                RegisterEvidenceKind.SUPPORTING,
                company,
                current_actor,
                "Name the vesting evidence you uploaded for this company.",
            )
            vesting = RegisterAwardVesting(
                uuid=operation_id,
                company=company,
                award=held,
                evidence=source_evidence,
                evidence_fingerprint=source_evidence.sha256,
                evidence_snapshot=evidence_snapshot(source_evidence),
                preparing_appointment=source,
                submitted_by=current_actor,
                **values,
            )
            vesting.file.save("vesting.bin", ContentFile(raw), save=False)
            try:
                vesting.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return vesting, True
    except BaseException:
        if vesting is not None:
            discard(vesting.file)
        raise
