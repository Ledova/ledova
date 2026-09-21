from datetime import date
from decimal import Decimal, InvalidOperation
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from companies.models import Company, CompanyDocument, DocumentType
from shared.db import atomic
from tokens.constants import REGISTER_IMPORT_REVIEW_MAX_AGE
from tokens.models import (
    ImportedFormerMember,
    RegisterEntry,
    RegisterImport,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareRegister,
    ShareToken,
)
from tokens.services.register_openings import (
    _authority_values,
    _check_decision,
    _check_evidence,
    _completed_decision,
    _confirm,
    _replayed,
    _retain,
    _reviewer,
)

SALT = "tokens.register-import"
MEMBER_FIELDS = {"member", "name", "residential_address", "shares", "entered_on", "amount_paid"}
FORMER_FIELDS = {"name", "residential_address", "shares", "ceased_on"}


def _text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 1000:
        raise ValueError
    return value.strip()


def _whole(value):
    if not isinstance(value, str) or not value.isdigit() or int(value) <= 0:
        raise ValueError
    return str(int(value))


def _day(value, as_at):
    day = date.fromisoformat(value)
    if day > as_at:
        raise ValueError
    return day.isoformat()


def _money(value):
    if value is None:
        return None
    amount = Decimal(value)
    if not isinstance(value, str) or amount < 0 or amount != amount.quantize(Decimal("0.01")):
        raise ValueError
    return str(amount)


def _rows(members, former_members, as_at):
    try:
        if not isinstance(members, list) or not members or not isinstance(former_members, list):
            raise ValueError
        current = []
        for row in members:
            if not isinstance(row, dict) or set(row) != MEMBER_FIELDS:
                raise ValueError
            current.append(
                {
                    "member": str(UUID(str(row["member"]))),
                    "name": _text(row["name"]),
                    "residential_address": _text(row["residential_address"]),
                    "shares": _whole(row["shares"]),
                    "entered_on": _day(row["entered_on"], as_at),
                    "amount_paid": _money(row["amount_paid"]),
                }
            )
        former = []
        for row in former_members:
            if not isinstance(row, dict) or set(row) != FORMER_FIELDS:
                raise ValueError
            former.append(
                {
                    "name": _text(row["name"]),
                    "residential_address": _text(row["residential_address"]),
                    "shares": _whole(row["shares"]),
                    "ceased_on": _day(row["ceased_on"], as_at),
                }
            )
    except (ValueError, TypeError, AttributeError, InvalidOperation):
        raise ValidationError(
            "Each current member needs a member ID, name, residential address, whole shares, a date entered no later "
            "than the register date and an amount paid or null; each former member needs a name, residential "
            "address, whole shares and a date ceased no later than the register date."
        ) from None
    if len({row["member"] for row in current}) != len(current):
        raise ValidationError("The import names a member more than once.")
    return (
        sorted(current, key=lambda row: row["member"]),
        sorted(former, key=lambda row: (row["ceased_on"], row["name"], row["residential_address"])),
    )


def _asic_document(company, document_id):
    document = CompanyDocument.objects.filter(
        pk=document_id, company=company, document_type=DocumentType.ASIC_EXTRACT, is_verified=True
    ).first()
    if document is None or not document.verified_fingerprint:
        raise ValidationError("Name a staff-verified ASIC extract of this company.")
    return document


def _opened_register(token):
    register = ShareRegister.objects.filter(token=token).first()
    if register is None or not RegisterEntry.objects.filter(register=register).exists():
        raise ValidationError("An import supplements an opened register; open this share class first.")
    return register


def submit_import(
    *,
    actor,
    operation_id,
    token_id,
    document_id,
    asic_document_id,
    as_at,
    members,
    former_members,
    authority,
    approving_director,
    authority_reference,
    reason,
):
    if not get_user_model().objects.filter(pk=actor.pk, is_active=True).exists():
        raise PermissionDenied("An active company owner must submit the register import.")
    try:
        operation_id, token_id, document_id, asic_document_id = (
            UUID(str(value)) for value in (operation_id, token_id, document_id, asic_document_id)
        )
        as_at = date.fromisoformat(str(as_at))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Import references must be UUIDs and the register date an ISO date.") from None
    if as_at > timezone.localdate():
        raise ValidationError("The register date cannot be in the future.")
    values = _authority_values(authority, approving_director, authority_reference, reason)
    current, former = _rows(members, former_members, as_at)
    with atomic():
        token = ShareToken.objects.select_related("company").filter(pk=token_id).first()
        if token is None:
            raise NotFound("Share class not found.")
        company = Company.objects.select_for_update(no_key=True).filter(pk=token.company_id, owner=actor).first()
        if company is None:
            raise NotFound("Share class not found.")
        existing = _replayed(
            RegisterImport,
            operation_id,
            {
                **values,
                "token_id": token.pk,
                "as_at": as_at,
                "members": current,
                "former_members": former,
                "source_document": document_id,
                "asic_document": asic_document_id,
                "submitted_by_id": actor.pk,
            },
        )
        if existing:
            return existing
        _opened_register(token)
        known = set(
            RegisterMember.objects.filter(company=company, uuid__in=[row["member"] for row in current]).values_list(
                "uuid", flat=True
            )
        )
        if {row["member"] for row in current} != {str(member) for member in known}:
            raise ValidationError("Every imported member must already be a member of this company.")
        if not CompanyDocument.objects.filter(
            pk=document_id, company=company, document_type=DocumentType.SHARE_REGISTER
        ).exists():
            raise ValidationError("The import's evidence must be the company's current share register document.")
        asic = _asic_document(company, asic_document_id)
        return _retain(
            RegisterImport(
                uuid=operation_id,
                company=company,
                token=token,
                as_at=as_at,
                members=current,
                former_members=former,
                asic_document=asic.pk,
                asic_fingerprint=asic.verified_fingerprint,
                **values,
            ),
            document_id,
            actor,
        )


def _holdings(register):
    return {
        str(position.member_id): int(position.shares)
        for position in RegisterPosition.objects.filter(register=register, shares__gt=0)
    }


def _comparison(proposal, register):
    stored = _holdings(register)
    imported = {row["member"]: int(row["shares"]) for row in proposal.members}
    return [
        {"member": member, "imported": imported.get(member), "stored": stored.get(member)}
        for member in sorted(set(stored) | set(imported))
    ]


def _check_holdings(comparison):
    differing = [row for row in comparison if row["imported"] != row["stored"]]
    if differing:
        raise ValidationError(
            "The import's holdings differ from the stored register for "
            + ", ".join(f"{row['member']} (import {row['imported']}, stored {row['stored']})" for row in differing)
            + ". Reject it and submit an import as at the stored holdings."
        )


def _check_asic(proposal, company):
    document = _asic_document(company, proposal.asic_document)
    if document.verified_fingerprint != proposal.asic_fingerprint:
        raise ValidationError("The ASIC extract changed after submission. Submit a fresh import.")


def _preview(proposal, reviewer):
    return {"proposal": str(proposal.pk), "reviewer": reviewer.pk, "evidence": proposal.evidence_fingerprint}


def prepare_import_review(*, proposal_id, reviewer):
    reviewer = _reviewer(reviewer, RegisterImport)
    proposal = RegisterImport.objects.select_related("company", "token").get(pk=proposal_id)
    if proposal.status != "submitted":
        raise ValidationError("This register import already has a decision.")
    _check_evidence(proposal, proposal.company, CompanyDocument.objects.filter(pk=proposal.source_document).first())
    _check_asic(proposal, proposal.company)
    comparison = _comparison(proposal, _opened_register(proposal.token))
    return proposal, comparison, signing.dumps(_preview(proposal, reviewer), salt=SALT)


def _figures(asic_issued_total, asic_member_count):
    try:
        total, count = int(str(asic_issued_total)), int(str(asic_member_count))
    except (TypeError, ValueError):
        raise ValidationError("Enter the ASIC extract's issued total and member count for this class.") from None
    if total < 0 or count < 0:
        raise ValidationError("Enter the ASIC extract's issued total and member count for this class.")
    return total, count


def decide_import(
    *,
    proposal_id,
    reviewer,
    confirmation,
    decision,
    rejection_reason="",
    asic_issued_total=None,
    asic_member_count=None,
):
    reviewer = _reviewer(reviewer, RegisterImport)
    _check_decision(decision, rejection_reason)
    initial = RegisterImport.objects.get(pk=proposal_id)
    if initial.status != "submitted":
        return _completed_decision(initial, reviewer, decision, rejection_reason)
    with atomic():
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        token = ShareToken.objects.select_for_update().get(pk=initial.token_id)
        document = CompanyDocument.objects.select_for_update().filter(pk=initial.source_document).first()
        proposal = RegisterImport.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            return _completed_decision(proposal, reviewer, decision, rejection_reason)
        if decision == "apply":
            _confirm(confirmation, SALT, REGISTER_IMPORT_REVIEW_MAX_AGE, _preview(proposal, reviewer))
            _check_evidence(proposal, company, document)
            _check_asic(proposal, company)
            total, count = _figures(asic_issued_total, asic_member_count)
            imported_total = sum(int(row["shares"]) for row in proposal.members)
            if (total, count) != (imported_total, len(proposal.members)):
                raise ValidationError(
                    f"The ASIC extract shows {total} shares held by {count} members; the import has "
                    f"{imported_total} shares held by {len(proposal.members)} members."
                )
            register = _opened_register(token)
            _check_holdings(_comparison(proposal, register))
            for row in proposal.members:
                RegisterMemberParticulars.objects.update_or_create(
                    member_id=row["member"],
                    defaults={
                        "name": row["name"],
                        "residential_address": row["residential_address"],
                        "source_import": proposal,
                    },
                )
            ImportedFormerMember.objects.bulk_create(
                ImportedFormerMember(
                    token=token,
                    name=row["name"],
                    residential_address=row["residential_address"],
                    shares_at_cessation=row["shares"],
                    ceased_on=row["ceased_on"],
                    source_import=proposal,
                )
                for row in proposal.former_members
            )
            proposal.status = "applied"
            proposal.asic_issued_total = total
            proposal.asic_member_count = count
            proposal.register_sequence = register.sequence
        else:
            proposal.status = "rejected"
            proposal.rejection_reason = rejection_reason
        proposal.reviewed_by = reviewer
        proposal.reviewed_at = timezone.now()
        proposal.save(
            update_fields=[
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
                "asic_issued_total",
                "asic_member_count",
                "register_sequence",
                "updated_at",
            ]
        )
        return proposal
