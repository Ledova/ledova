import hashlib
import json
from datetime import date
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from companies.models import Company, CompanyDocument
from companies.services.document_review import (
    document_fingerprint,
    private_document_bytes,
    verified_document_snapshot,
)
from shared.db import APP_ALIAS, atomic, current_alias
from tokens.constants import REGISTER_CORRECTION_REVIEW_MAX_AGE
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterCorrection, RegisterEntry, ShareRegister
from tokens.services.register_events import record_entry


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _content(file):
    return private_document_bytes(file)


def _verified(document, content=None):
    return verified_document_snapshot(document, content=content)


def _reviewer(user):
    if current_alias() == APP_ALIAS:
        raise PermissionDenied("Register correction review requires the operator connection.")
    reviewer = get_user_model().objects.get(pk=user.pk)
    if not reviewer.is_active or not reviewer.is_staff or not reviewer.has_perm("tokens.change_registercorrection"):
        raise PermissionDenied("Register correction review requires an authorised staff reviewer.")
    return reviewer


def submit_correction(
    *,
    actor,
    operation_id,
    corrects_id,
    document_id,
    effective_on,
    authority,
    approving_director,
    authority_reference,
    reason
):
    if not get_user_model().objects.filter(pk=actor.pk, is_active=True).exists():
        raise PermissionDenied("An active company owner must submit the correction.")
    try:
        operation_id, corrects_id, document_id = (
            UUID(str(value)) for value in (operation_id, corrects_id, document_id)
        )
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Correction references must be UUIDs.") from None
    if type(effective_on) is not date:
        raise ValidationError("A correction requires an effective date.")
    values = {
        "authority": authority,
        "approving_director": approving_director,
        "authority_reference": authority_reference,
        "reason": reason,
    }
    if (
        authority not in ("director_resolution", "court_order")
        or any(not isinstance(value, str) for value in values.values())
        or not authority_reference.strip()
        or not reason.strip()
        or len(authority_reference) > 255
        or len(reason) > 1000
        or len(approving_director) > 255
        or (authority == "director_resolution") != bool(approving_director.strip())
    ):
        raise ValidationError(
            "Name the approving director for a resolution, or supply a court order, with a reference and reason."
        )
    with atomic():
        original = RegisterEntry.objects.filter(pk=corrects_id, register__company__owner=actor).first()
        if original is None:
            raise NotFound("Register entry not found.")
        company = Company.objects.select_for_update(no_key=True).get(pk=original.register.company_id)
        if company.owner_id != actor.pk:
            raise NotFound("Register entry not found.")
        register = ShareRegister.objects.select_for_update().get(pk=original.register_id)
        existing = RegisterCorrection.objects.filter(pk=operation_id).first()
        if existing:
            expected = {
                **values,
                "corrects_id": corrects_id,
                "source_document": document_id,
                "effective_on": effective_on,
                "submitted_by_id": actor.pk,
            }
            if any(getattr(existing, key) != value for key, value in expected.items()):
                raise RegisterChangeConflict()
            return existing
        if RegisterEntry.objects.filter(corrects=original).exists() or not original.changes:
            raise ValidationError("This entry cannot be compensated. Review the current register.")
        document = CompanyDocument.objects.select_for_update().filter(pk=document_id, company=company).first()
        if document is None:
            raise NotFound("Company authority document not found.")
        document.company = company
        raw = _content(document.file)
        snapshot = _verified(document, ContentFile(raw))
        proposal = RegisterCorrection(
            uuid=operation_id,
            company=company,
            register=register,
            corrects=original,
            base_sequence=register.sequence,
            base_hash=register.head_hash,
            effective_on=effective_on,
            changes=[
                {"member": change["member"], "shares": str(-int(change["shares"]))} for change in original.changes
            ],
            source_document=document.pk,
            evidence_fingerprint=document.verified_fingerprint,
            evidence_snapshot=snapshot,
            submitted_by=actor,
            **values,
        )
        proposal.file.save("authority.bin", ContentFile(raw), save=False)
        try:
            proposal.save(force_insert=True)
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return proposal


def _check_evidence(proposal, company, document):
    if company.owner_id != proposal.submitted_by_id or document is None or document.company_id != company.pk:
        raise ValidationError("The company or its authority document changed. Submit a fresh correction.")
    document.company = company
    if _digest(_verified(document)) != proposal.evidence_fingerprint:
        raise ValidationError("The authority evidence changed. Submit a fresh correction.")
    raw = _content(proposal.file)
    if (
        hashlib.sha256(raw).hexdigest() != proposal.evidence_snapshot["sha256"]
        or len(raw) != proposal.evidence_snapshot["file_size"]
        or document_fingerprint(document, content=ContentFile(raw)) != proposal.evidence_fingerprint
    ):
        raise ValidationError("The retained authority evidence no longer matches the proposal.")


def _check_head(proposal, register):
    if (register.sequence, register.head_hash) != (proposal.base_sequence, proposal.base_hash):
        raise ValidationError("The register changed after submission. Submit a fresh correction.")


def prepare_correction_review(*, proposal_id, reviewer):
    reviewer = _reviewer(reviewer)
    proposal = RegisterCorrection.objects.select_related("company", "register", "corrects").get(pk=proposal_id)
    if proposal.status != "submitted":
        raise ValidationError("This correction already has a decision.")
    document = CompanyDocument.objects.filter(pk=proposal.source_document).first()
    _check_head(proposal, proposal.register)
    _check_evidence(proposal, proposal.company, document)
    confirmation = signing.dumps(
        {"proposal": str(proposal.pk), "reviewer": reviewer.pk, "evidence": proposal.evidence_fingerprint},
        salt="tokens.register-correction",
    )
    return proposal, confirmation


def decide_correction(*, proposal_id, reviewer, confirmation, decision, rejection_reason=""):
    reviewer = _reviewer(reviewer)
    if (
        decision not in ("apply", "reject")
        or (decision == "reject" and not rejection_reason.strip())
        or len(rejection_reason) > 1000
    ):
        raise ValidationError("Choose application or rejection with a reason.")
    with atomic():
        initial = RegisterCorrection.objects.get(pk=proposal_id)
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        register = ShareRegister.objects.select_for_update().get(pk=initial.register_id)
        document = CompanyDocument.objects.select_for_update().filter(pk=initial.source_document).first()
        proposal = RegisterCorrection.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            if proposal.reviewed_by_id == reviewer.pk and (
                (decision == "apply" and proposal.status == "applied")
                or (
                    decision == "reject"
                    and proposal.status == "rejected"
                    and proposal.rejection_reason == rejection_reason
                )
            ):
                return proposal
            raise RegisterChangeConflict()
        if decision == "apply":
            try:
                preview = signing.loads(
                    confirmation, salt="tokens.register-correction", max_age=REGISTER_CORRECTION_REVIEW_MAX_AGE
                )
            except signing.BadSignature:
                raise ValidationError("The review confirmation is invalid or expired. Open a fresh review.") from None
            if preview.get("proposal") != str(proposal_id) or preview.get("reviewer") != reviewer.pk:
                raise ValidationError("The confirmation belongs to another proposal or reviewer.")
            if preview.get("evidence") != proposal.evidence_fingerprint:
                raise ValidationError("The review confirmation does not match this evidence.")
            _check_head(proposal, register)
            _check_evidence(proposal, company, document)
            proposal.applied_entry = record_entry(
                register_id=register.pk,
                operation_id=proposal.pk,
                kind="correction",
                changes=proposal.changes,
                effective_on=proposal.effective_on,
                recorded_by=reviewer,
                corrects_id=proposal.corrects_id,
            )
            proposal.status = "applied"
        else:
            proposal.status = "rejected"
            proposal.rejection_reason = rejection_reason
        proposal.reviewed_by = reviewer
        proposal.reviewed_at = timezone.now()
        proposal.save(
            update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason", "applied_entry", "updated_at"]
        )
        return proposal
