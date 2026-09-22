import re
from collections import defaultdict
from datetime import date
from uuid import UUID

from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from companies.models import Company, CompanyDocument, DocumentType
from shared.db import atomic
from tokens.constants import (
    REGISTER_IMPORT_ADDRESS_LENGTH,
    REGISTER_IMPORT_REVIEW_MAX_AGE,
)
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    ImportedFormerMember,
    RegisterEntry,
    RegisterEntryKind,
    RegisterImport,
    RegisterInstruction,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    RegisterPosition,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
)
from tokens.services.former_holders import retention_cutoff
from tokens.services.register import _member_identity
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_instructions import APPROVED
from tokens.services.register_openings import (
    _authority_values,
    _check_decision,
    _check_evidence,
    _check_uninitialized,
    _completed_decision,
    _confirm,
    _members_of,
    _replayed,
    _retain,
    _reviewer,
)
from whitelist.services.identity import identities_for

SALT = "tokens.register-import"
MEMBER_FIELDS = {"member", "name", "residential_address", "shares", "entered_on", "amount_paid"}
FORMER_FIELDS = {"name", "residential_address", "shares", "ceased_on"}
TEXT_LIMITS = {
    "name": RegisterMemberParticulars._meta.get_field("name").max_length,
    "residential address": REGISTER_IMPORT_ADDRESS_LENGTH,
}
SHARE_DIGITS = RegisterPosition._meta.get_field("shares").max_digits
MONEY = re.compile(r"(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?")


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError
    if len(value.strip()) > TEXT_LIMITS[label]:
        raise ValidationError(f"Each {label} in an import may have at most {TEXT_LIMITS[label]} characters.")
    return value.strip()


def _whole(value):
    if not isinstance(value, str) or not value.isdigit() or int(value) <= 0 or len(str(int(value))) > SHARE_DIGITS:
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
    if not isinstance(value, str) or not MONEY.fullmatch(value):
        raise ValidationError(
            "Enter each amount paid as a plain amount such as 250.00, with at most two decimal places and eighteen "
            "whole digits, or null when it is not known."
        )
    return value


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
                    "name": _text(row["name"], "name"),
                    "residential_address": _text(row["residential_address"], "residential address"),
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
                    "name": _text(row["name"], "name"),
                    "residential_address": _text(row["residential_address"], "residential address"),
                    "shares": _whole(row["shares"]),
                    "ceased_on": _day(row["ceased_on"], as_at),
                }
            )
    except (ValueError, TypeError, AttributeError):
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


def _opening(token):
    return RegisterEntry.objects.filter(register__token=token, kind=RegisterEntryKind.OPENING).first()


def _check_openable(token):
    if (
        ShareIssuanceRequest.objects.filter(token=token, status__in=APPROVED).exists()
        or RegisterInstruction.objects.filter(token=token, status="applied").exists()
    ):
        raise ValidationError(
            "An import opens only a share class not yet on chain, and this one has an approved issue or an applied "
            "register instruction. Open its register from the chain, then import its particulars."
        )


def _check_unapplied(token):
    if RegisterImport.objects.filter(token=token, status="applied").exists():
        raise ValidationError("This share class already has an applied import, and a class takes only one.")


def _check_former(former, opening):
    cutoff = retention_cutoff()
    for row in former:
        ceased_on = date.fromisoformat(row["ceased_on"])
        if opening is not None and ceased_on >= opening.effective_on:
            raise ValidationError(
                "Import only former members who ceased before the register's opening on "
                f"{opening.effective_on.isoformat()}."
            )
        if ceased_on < cutoff:
            raise ValidationError(
                f"Leave out former members who ceased before {cutoff.isoformat()}: the register keeps a former "
                "member for seven years from the date they ceased."
            )


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
        opening = _opening(token)
        _check_unapplied(token)
        _check_former(former, opening)
        if opening is None:
            _check_openable(token)
            _members_of(company, current)
        else:
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


def _holdings(token_id):
    return {
        str(position.member_id): position
        for position in RegisterPosition.objects.filter(register__token_id=token_id, shares__gt=0)
    }


def _comparison(proposal):
    stored = _holdings(proposal.token_id)
    imported = {row["member"]: int(row["shares"]) for row in proposal.members}
    return [
        {
            "member": member,
            "imported": imported.get(member),
            "stored": int(stored[member].shares) if member in stored else None,
            "entered_on": stored[member].entered_on if member in stored else None,
        }
        for member in sorted(set(stored) | set(imported))
    ]


def _review_rows(proposal, comparison):
    imported = {row["member"]: row for row in proposal.members}
    wallets = defaultdict(list)
    for link in RegisterMemberWallet.objects.filter(
        company_id=proposal.company_id, member_id__in=[row["member"] for row in comparison]
    ).order_by("address"):
        wallets[str(link.member_id)].append(link.address)
    identities = identities_for([address for addresses in wallets.values() for address in addresses])
    rows = []
    for row in comparison:
        _, name, residential_address, _, _ = _member_identity(wallets[row["member"]], identities, {})
        submitted = imported.get(row["member"], {})
        rows.append(
            {
                **row,
                "name": submitted.get("name"),
                "imported_entered_on": submitted.get("entered_on"),
                "wallets": wallets[row["member"]],
                "live_name": name,
                "live_address": residential_address,
            }
        )
    return rows


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
    _check_unapplied(proposal.token)
    if _opening(proposal.token) is None:
        _check_openable(proposal.token)
    comparison = _review_rows(proposal, _comparison(proposal))
    return proposal, comparison, signing.dumps(_preview(proposal, reviewer), salt=SALT)


def _figures(asic_issued_total, asic_member_count):
    try:
        total, count = int(str(asic_issued_total)), int(str(asic_member_count))
    except (TypeError, ValueError):
        raise ValidationError("Enter the ASIC extract's issued total and member count for this class.") from None
    if total < 0 or count < 0:
        raise ValidationError("Enter the ASIC extract's issued total and member count for this class.")
    return total, count


def _open(proposal, token, reviewer):
    _check_openable(token)
    register = _check_uninitialized(token)
    for row in proposal.members:
        create_member(company_id=token.company_id, member_id=row["member"])
    record_entry(
        register_id=register.pk,
        operation_id=proposal.pk,
        kind=RegisterEntryKind.OPENING,
        changes=[{"member": row["member"], "shares": row["shares"]} for row in proposal.members],
        effective_on=proposal.as_at,
        recorded_by=reviewer,
    )


def _completed_import(proposal, reviewer, decision, rejection_reason, figures):
    if figures is not None and figures != (proposal.asic_issued_total, proposal.asic_member_count):
        raise RegisterChangeConflict()
    return _completed_decision(proposal, reviewer, decision, rejection_reason)


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
    figures = _figures(asic_issued_total, asic_member_count) if decision == "apply" else None
    initial = RegisterImport.objects.get(pk=proposal_id)
    if initial.status != "submitted":
        return _completed_import(initial, reviewer, decision, rejection_reason, figures)
    with atomic():
        company = Company.objects.select_for_update(no_key=True).get(pk=initial.company_id)
        token = ShareToken.objects.select_for_update().get(pk=initial.token_id)
        document = CompanyDocument.objects.select_for_update().filter(pk=initial.source_document).first()
        proposal = RegisterImport.objects.select_for_update().get(pk=proposal_id)
        if proposal.status != "submitted":
            return _completed_import(proposal, reviewer, decision, rejection_reason, figures)
        if decision == "apply":
            _confirm(confirmation, SALT, REGISTER_IMPORT_REVIEW_MAX_AGE, _preview(proposal, reviewer))
            _check_evidence(proposal, company, document)
            _check_asic(proposal, company)
            _check_unapplied(token)
            total, count = figures
            imported_total = sum(int(row["shares"]) for row in proposal.members)
            if (total, count) != (imported_total, len(proposal.members)):
                raise ValidationError(
                    f"The ASIC extract shows {total} shares held by {count} members; the import has "
                    f"{imported_total} shares held by {len(proposal.members)} members."
                )
            opening = _opening(token)
            _check_former(proposal.former_members, opening)
            if opening is None:
                _open(proposal, token, reviewer)
            else:
                _check_holdings(_comparison(proposal))
            newer = {
                str(member)
                for member in RegisterMemberParticulars.objects.filter(
                    member_id__in=[row["member"] for row in proposal.members], source_import__as_at__gt=proposal.as_at
                ).values_list("member_id", flat=True)
            }
            for row in proposal.members:
                if row["member"] in newer:
                    continue
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
            proposal.register_sequence = ShareRegister.objects.get(token=token).sequence
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
