import re
from collections import defaultdict
from datetime import date
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from companies.services.authority_requests import _requester_principal
from shared.db import use_operator
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    ImportedFormerMember,
    RegisterEntry,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterImportDecision,
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
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, decide, preview
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_instructions import APPROVED
from tokens.services.register_openings import (
    _authority_values,
    _check_uninitialized,
    _members_of,
)
from whitelist.services.identity import identities_for

MEMBER_FIELDS = {"member", "name", "residential_address", "shares", "entered_on", "amount_paid"}
FORMER_FIELDS = {"name", "residential_address", "shares", "ceased_on"}
TEXT_LIMITS = {
    "name": RegisterMemberParticulars._meta.get_field("name").max_length,
    "residential address": REGISTER_IMPORT_ADDRESS_LENGTH,
}
SHARE_DIGITS = RegisterPosition._meta.get_field("shares").max_digits
MONEY = re.compile(r"(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?")
EVIDENCE_REFUSAL = "Name the share register and the ASIC extract you uploaded for this company."


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


def _stated(asic_issued_total, asic_member_count, current):
    try:
        total, count = int(str(asic_issued_total)), int(str(asic_member_count))
    except (TypeError, ValueError):
        raise ValidationError("State the ASIC extract's issued total and member count for this class.") from None
    imported_total = sum(int(row["shares"]) for row in current)
    if (total, count) != (imported_total, len(current)):
        raise ValidationError(
            f"The ASIC extract shows {total} shares held by {count} members; the import has "
            f"{imported_total} shares held by {len(current)} members."
        )
    return total, count


def _company_of(actor, token_id):
    with use_operator(), _requester_principal(actor.pk):
        company_id = ShareToken.objects.filter(pk=token_id).values_list("company_id", flat=True).first()
    if company_id is None:
        raise NotFound("Share class not found.")
    return company_id


def prepare_import(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    register_evidence,
    asic_evidence,
    asic_issued_total,
    asic_member_count,
    as_at,
    members,
    former_members,
    authority,
    approving_director,
    authority_reference,
    reason,
):
    try:
        operation_id, appointment, token_id, register_evidence, asic_evidence = (
            UUID(str(value)) for value in (operation_id, appointment, token_id, register_evidence, asic_evidence)
        )
        as_at = date.fromisoformat(str(as_at))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Import references must be UUIDs and the register date an ISO date.") from None
    if as_at > timezone.localdate():
        raise ValidationError("The register date cannot be in the future.")
    values = _authority_values(authority, approving_director, authority_reference, reason)
    current, former = _rows(members, former_members, as_at)
    total, count = _stated(asic_issued_total, asic_member_count, current)
    proposal = None
    try:
        with register_command(actor, _company_of(actor, token_id), "register_import_prepare") as (
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
            existing = RegisterImport.objects.filter(pk=operation_id).first()
            if existing is not None:
                expected = {
                    **values,
                    "company_id": company.pk,
                    "token_id": token.pk,
                    "as_at": as_at,
                    "members": current,
                    "former_members": former,
                    "register_evidence_id": register_evidence,
                    "asic_evidence_id": asic_evidence,
                    "asic_issued_total": total,
                    "asic_member_count": count,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            register_copy = RegisterEvidence.objects.select_for_update().filter(pk=register_evidence).first()
            asic_copy = RegisterEvidence.objects.select_for_update().filter(pk=asic_evidence).first()
            register_raw = own_evidence_bytes(
                register_copy, RegisterEvidenceKind.SHARE_REGISTER, company, current_actor, EVIDENCE_REFUSAL
            )
            asic_raw = own_evidence_bytes(
                asic_copy, RegisterEvidenceKind.ASIC_EXTRACT, company, current_actor, EVIDENCE_REFUSAL
            )
            opening = _opening(token)
            _check_unapplied(token)
            _check_former(former, opening)
            if opening is None:
                _check_openable(token)
                _members_of(company, current)
            else:
                known = set(
                    RegisterMember.objects.filter(
                        company=company, uuid__in=[row["member"] for row in current]
                    ).values_list("uuid", flat=True)
                )
                if {row["member"] for row in current} != {str(member) for member in known}:
                    raise ValidationError("Every imported member must already be a member of this company.")
            proposal = RegisterImport(
                uuid=operation_id,
                company=company,
                token=token,
                as_at=as_at,
                members=current,
                former_members=former,
                preparing_appointment=source,
                register_evidence=register_copy,
                asic_evidence=asic_copy,
                evidence_fingerprint=register_copy.sha256,
                evidence_snapshot=evidence_snapshot(register_copy),
                asic_fingerprint=asic_copy.sha256,
                asic_snapshot=evidence_snapshot(asic_copy),
                asic_issued_total=total,
                asic_member_count=count,
                submitted_by=current_actor,
                **values,
            )
            proposal.file.save("register.bin", ContentFile(register_raw), save=False)
            proposal.asic_file.save("asic.bin", ContentFile(asic_raw), save=False)
            try:
                proposal.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return proposal, True
    except BaseException:
        if proposal is not None:
            discard(proposal.file, proposal.asic_file)
        raise


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


def _open(proposal, token, actor):
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
        recorded_by=actor,
    )


def _effect_requirements(proposal):
    unmet = []
    try:
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
        matching_bytes(proposal.asic_file, proposal.asic_snapshot["file_size"], proposal.asic_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    token = proposal.token
    if RegisterImport.objects.filter(token=token, status="applied").exists():
        unmet.append("class_has_applied_import")
    opening = _opening(token)
    if opening is None:
        try:
            _check_openable(token)
        except ValidationError:
            unmet.append("class_not_openable")
    elif any(row["imported"] != row["stored"] for row in _comparison(proposal)):
        unmet.append("holdings_differ")
    cutoff = retention_cutoff()
    for row in proposal.former_members:
        ceased_on = date.fromisoformat(row["ceased_on"])
        if opening is not None and ceased_on >= opening.effective_on:
            unmet.append("former_member_after_opening")
        if ceased_on < cutoff:
            unmet.append("former_member_before_retention")
    return unmet


def _details(proposal):
    register = ShareRegister.objects.filter(token_id=proposal.token_id).first()
    imported_total = sum(int(row["shares"]) for row in proposal.members)
    return {
        "opens_register": _opening(proposal.token) is None,
        "register_sequence": register.sequence if register is not None else 0,
        "comparison": _review_rows(proposal, _comparison(proposal)),
        "stated_total": None if proposal.asic_issued_total is None else str(proposal.asic_issued_total),
        "stated_member_count": proposal.asic_member_count,
        "imported_total": str(imported_total),
        "imported_member_count": len(proposal.members),
    }


def _lock(proposal):
    token = ShareToken.objects.select_for_update().get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token=token).values_list("uuid", flat=True))


def _apply(proposal, actor, decision):
    token = proposal.token
    if _opening(token) is None:
        _open(proposal, token, actor)
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
    proposal.register_sequence = ShareRegister.objects.get(token=token).sequence
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "register_sequence", "reviewed_by", "reviewed_at", "updated_at"])


IMPORTS = DecisionFamily(
    model=RegisterImport,
    decision_model=RegisterImportDecision,
    field="register_import",
    operation="register_import",
    approved_function="tokens_register_import_approved",
    digest_function="tokens_register_import_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
)


def preview_import_decision(*, actor, import_id, appointment, kind, reason=""):
    return preview(
        IMPORTS, _details, actor=actor, proposal_id=import_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_import(*, actor, import_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""):
    return decide(
        IMPORTS,
        actor=actor,
        proposal_id=import_id,
        appointment=appointment,
        kind=kind,
        idempotency_key=idempotency_key,
        preview_digest=preview_digest,
        confirmation=confirmation,
        reason=reason,
    )
