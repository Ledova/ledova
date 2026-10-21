import json
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError, connections
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from companies.services.authority_requests import _requester_principal
from shared.db import current_alias, use_operator
from tokens.constants import MAX_UINT256, REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    ImportedFormerMember,
    MemberAssociation,
    MemberInvitation,
    MemberParticularsRequest,
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
    RegisterParticularsChange,
    RegisterPosition,
    ShareIssuanceRequest,
    ShareRegister,
    ShareToken,
)
from tokens.services.former_holders import retention_cutoff
from tokens.services.register import _member_identity, imported_membership_dates
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
    _check_uninitialized,
    _members_of,
)
from whitelist.services.identity import identities_for

MEMBER_FIELDS = {"member", "name", "residential_address", "shares", "entered_on", "allotments"}
ALLOTMENT_FIELDS = {
    "allotted_on",
    "shares",
    "share_reference",
    "certificate_reference",
    "amount_paid",
    "amount_unpaid",
    "fully_paid",
    "beneficially_held",
}
FORMER_FIELDS = {"name", "residential_address", "shares", "ceased_on"}
TEXT_LIMITS = {
    "name": RegisterMemberParticulars._meta.get_field("name").max_length,
    "residential address": REGISTER_IMPORT_ADDRESS_LENGTH,
}
SHARE_DIGITS = RegisterPosition._meta.get_field("shares").max_digits
MONEY = re.compile(r"(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?")
EVIDENCE_REFUSAL = "Choose a document you uploaded for this company, or name the original company records."


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError
    if len(value.strip()) > TEXT_LIMITS[label]:
        raise ValidationError(f"Each {label} in an import may have at most {TEXT_LIMITS[label]} characters.")
    return value.strip()


def _whole(value):
    if not isinstance(value, str) or not value.isdigit() or int(value) <= 0 or len(str(int(value))) > SHARE_DIGITS:
        raise ValueError
    if int(value) > MAX_UINT256:
        raise ValidationError("A share quantity cannot exceed the register limit.")
    return str(int(value))


def _day(value, as_at):
    day = date.fromisoformat(value)
    if day > as_at:
        raise ValueError
    return day.isoformat()


def _money(value):
    if not isinstance(value, str) or not MONEY.fullmatch(value):
        raise ValidationError("Enter known paid and unpaid amounts, such as 250.00, with at most two decimal places.")
    return format(Decimal(value), ".2f")


def _reference(value):
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 255:
        raise ValueError
    return value.strip()


def _allotments(rows, shares, as_at):
    if not isinstance(rows, list) or not rows or len(rows) > 10000:
        raise ValueError
    result = []
    for row in rows:
        if not isinstance(row, dict) or set(row) != ALLOTMENT_FIELDS:
            raise ValueError
        allotted_on = _day(row["allotted_on"], as_at)
        unpaid = _money(row["amount_unpaid"])
        if type(row["fully_paid"]) is not bool or type(row["beneficially_held"]) is not bool:
            raise ValueError
        if row["fully_paid"] != (Decimal(unpaid) == 0):
            raise ValidationError("Fully-paid status must match the recorded unpaid amount.")
        result.append(
            {
                "allotted_on": allotted_on,
                "shares": _whole(row["shares"]),
                "share_reference": _reference(row["share_reference"]),
                "certificate_reference": _reference(row["certificate_reference"]),
                "amount_paid": _money(row["amount_paid"]),
                "amount_unpaid": unpaid,
                "fully_paid": row["fully_paid"],
                "beneficially_held": row["beneficially_held"],
            }
        )
    if sum(int(row["shares"]) for row in result) != int(shares):
        raise ValidationError("Each member's allotments must add up to their current holding.")
    return sorted(
        result, key=lambda row: (row["allotted_on"], row["share_reference"] or "", row["certificate_reference"] or "")
    )


def _rows(members, former_members, as_at):
    try:
        if not isinstance(members, list) or not isinstance(former_members, list):
            raise ValueError
        current = []
        for row in members:
            if not isinstance(row, dict) or set(row) != MEMBER_FIELDS:
                raise ValueError
            shares = _whole(row["shares"])
            entered_on = _day(row["entered_on"], as_at)
            allotments = _allotments(row["allotments"], shares, as_at)
            current.append(
                {
                    "member": str(UUID(str(row["member"]))),
                    "name": _text(row["name"], "name"),
                    "residential_address": _text(row["residential_address"], "residential address"),
                    "shares": shares,
                    "entered_on": entered_on,
                    "allotments": allotments,
                    "amount_paid": format(sum(Decimal(item["amount_paid"]) for item in allotments), ".2f"),
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
            "than the mirror date and complete allotments with dates, references where present, paid/unpaid amounts "
            "and beneficial status; each former member needs a name, residential "
            "address, whole shares and a date ceased no later than the register date."
        ) from None
    if sum(int(row["shares"]) for row in current) > MAX_UINT256:
        raise ValidationError("The mirrored share total cannot exceed the register limit.")
    if len({row["member"] for row in current}) != len(current):
        raise ValidationError("The import names a member more than once.")
    return (
        sorted(current, key=lambda row: row["member"]),
        sorted(former, key=lambda row: (row["ceased_on"], row["name"], row["residential_address"])),
    )


def _opening(token):
    return RegisterEntry.objects.filter(register__token=token, kind=RegisterEntryKind.OPENING).first()


def _empty_opening_requirements(proposal):
    if proposal.members:
        return []
    token = proposal.token
    if (
        proposal.correction_of_id is not None
        or proposal.former_members
        or _opening(token) is not None
        or token.status != "draft"
        or token.contract_address
        or token.deployment_id
        or token.deployment_transaction_id
        or token.deployment_tx_hash
        or token.deployed_at
        or token.chain
    ):
        return ["empty_non_tokenised_opening_required"]
    return []


def _check_openable(token):
    from tokens.services.register_deployments import applied_source

    if applied_source(token) is not None:
        raise ValidationError(
            "Open the original company deployment from its confirmed chain before importing particulars."
        )
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


def _stated(asic_issued_total, asic_member_count, current, asic_evidence):
    if asic_evidence is None and (asic_issued_total is not None or asic_member_count is not None):
        raise ValidationError("ASIC cross-check figures need their optional extract copy.")
    total = None if asic_issued_total is None else int(str(asic_issued_total))
    count = None if asic_member_count is None else int(str(asic_member_count))
    if total is not None and total != sum(int(row["shares"]) for row in current):
        raise ValidationError("The optional ASIC issued total differs from the mirrored holdings.")
    return total, count


def _latest_import(token):
    return RegisterImport.objects.filter(token=token, status="applied").order_by("-reviewed_at", "-uuid").first()


def _correction_requirements(proposal):
    from tokens.services.register_deployments import applied_source, pending_deployment

    unmet = []
    token = proposal.token
    register = ShareRegister.objects.filter(token=token).first()
    latest = _latest_import(token)
    if latest is None or latest.pk != proposal.correction_of_id:
        unmet.append("mirror_snapshot_changed")
    if register is None or (register.sequence, register.head_hash) != (proposal.base_sequence, proposal.base_hash):
        unmet.append("register_changed")
    opening = _opening(token)
    if (
        opening is None
        or latest is None
        or not RegisterImport.objects.filter(token=token, uuid=opening.operation_id, status="applied").exists()
        or bool(token.contract_address)
        or token.deployment_id is not None
        or token.deployment_transaction_id is not None
        or bool(token.deployment_tx_hash)
        or applied_source(token) is not None
        or pending_deployment(token)
        or RegisterEntry.objects.filter(register__token=token)
        .exclude(kind__in=[RegisterEntryKind.OPENING, RegisterEntryKind.MIRROR_CORRECTION])
        .exists()
        or ShareIssuanceRequest.objects.filter(token=token, status__in=APPROVED).exists()
        or RegisterInstruction.objects.filter(token=token, status="applied").exists()
    ):
        unmet.append("mirror_correction_activity")
    if (
        MemberInvitation.objects.filter(company_id=token.company_id).exists()
        or MemberAssociation.objects.filter(company_id=token.company_id).exists()
        or MemberParticularsRequest.objects.filter(company_id=token.company_id).exists()
        or RegisterParticularsChange.objects.filter(member__company_id=token.company_id).exists()
    ):
        unmet.append("mirror_correction_member_activity")

    return unmet


def correction_allowed(proposal):
    if proposal.status != "applied":
        return False
    register = ShareRegister.objects.filter(token_id=proposal.token_id).first()
    if register is None:
        return False
    candidate = RegisterImport(
        token=proposal.token, correction_of=proposal, base_sequence=register.sequence, base_hash=register.head_hash
    )
    return not _correction_requirements(candidate)


def _company_of(actor, token_id):
    with use_operator(), _requester_principal(actor.pk):
        company_id = ShareToken.objects.filter(pk=token_id).values_list("company_id", flat=True).first()
    if company_id is None:
        raise NotFound("Share class not found.")
    return company_id


def _award_identities_valid(company_id, operation_id, members):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_mirror_award_identities_valid(%s, %s, %s::jsonb)",
            [company_id, operation_id, json.dumps(members)],
        )
        return cursor.fetchone()[0]


def prepare_import(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    source_reference,
    source_confirmed,
    as_at,
    members,
    former_members,
    reason,
    correction_of=None,
    register_evidence=None,
    asic_evidence=None,
    asic_issued_total=None,
    asic_member_count=None,
):
    try:
        operation_id, appointment, token_id = (UUID(str(value)) for value in (operation_id, appointment, token_id))
        register_evidence = None if register_evidence is None else UUID(str(register_evidence))
        asic_evidence = None if asic_evidence is None else UUID(str(asic_evidence))
        correction_of = None if correction_of is None else UUID(str(correction_of))
        as_at = date.fromisoformat(str(as_at))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Mirror references must be UUIDs and the mirror date an ISO date.") from None
    if as_at > timezone.localdate():
        raise ValidationError("The mirror date cannot be in the future.")
    if (
        source_confirmed is not True
        or not isinstance(source_reference, str)
        or not source_reference.strip()
        or len(source_reference.strip()) > 255
        or not isinstance(reason, str)
        or not reason.strip()
        or len(reason.strip()) > 1000
    ):
        raise ValidationError(
            "Confirm the original company records, name their reference and explain the setup or correction."
        )
    source_reference, reason = source_reference.strip(), reason.strip()
    current, former = _rows(members, former_members, as_at)
    total, count = _stated(asic_issued_total, asic_member_count, current, asic_evidence)
    values = {
        "authority": "company_records",
        "approving_director": "",
        "authority_reference": source_reference,
        "source_reference": source_reference,
        "source_confirmed": True,
        "reason": reason,
    }
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
            if not _award_identities_valid(company.pk, operation_id, current):
                raise ValidationError(
                    "An award recipient must retain their exact company, name and residential address."
                )
            expected = {
                **values,
                "company_id": company.pk,
                "token_id": token.pk,
                "as_at": as_at,
                "members": current,
                "former_members": former,
                "correction_of_id": correction_of,
                "register_evidence_id": register_evidence,
                "asic_evidence_id": asic_evidence,
                "asic_issued_total": total,
                "asic_member_count": count,
                "preparing_appointment_id": source.pk,
                "submitted_by_id": current_actor.pk,
            }
            existing = RegisterImport.objects.filter(pk=operation_id).first()
            if existing is not None:
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            unmet = _empty_opening_requirements(
                RegisterImport(token=token, members=current, former_members=former, correction_of_id=correction_of)
            )
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            opening = _opening(token)
            base_sequence, base_hash = None, ""
            if correction_of is not None:
                prior = RegisterImport.objects.filter(
                    pk=correction_of, company=company, token=token, status="applied"
                ).first()
                if prior is None:
                    raise NotFound("Confirmed mirror snapshot not found.")
                register = ShareRegister.objects.select_for_update().get(token=token)
                base_sequence, base_hash = register.sequence, register.head_hash
                candidate = RegisterImport(
                    token=token, correction_of=prior, base_sequence=base_sequence, base_hash=base_hash
                )
                if _correction_requirements(candidate):
                    raise ValidationError(
                        "Correct only the latest opening mirror before later share or deployment activity."
                    )
                if as_at < prior.as_at:
                    raise ValidationError("A correction cannot precede the mirror snapshot it corrects.")
                _members_of(company, current)
            else:
                _check_unapplied(token)
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
            _check_former(former, None if correction_of is not None else opening)
            register_copy = (
                None
                if register_evidence is None
                else RegisterEvidence.objects.select_for_update().filter(pk=register_evidence).first()
            )
            asic_copy = (
                None
                if asic_evidence is None
                else RegisterEvidence.objects.select_for_update().filter(pk=asic_evidence).first()
            )
            register_raw = (
                None
                if register_evidence is None
                else own_evidence_bytes(
                    register_copy, RegisterEvidenceKind.SHARE_REGISTER, company, current_actor, EVIDENCE_REFUSAL
                )
            )
            asic_raw = (
                None
                if asic_evidence is None
                else own_evidence_bytes(
                    asic_copy, RegisterEvidenceKind.ASIC_EXTRACT, company, current_actor, EVIDENCE_REFUSAL
                )
            )
            proposal = RegisterImport(
                uuid=operation_id,
                base_sequence=base_sequence,
                base_hash=base_hash,
                evidence_fingerprint="" if register_copy is None else register_copy.sha256,
                evidence_snapshot=None if register_copy is None else evidence_snapshot(register_copy),
                asic_fingerprint="" if asic_copy is None else asic_copy.sha256,
                asic_snapshot=None if asic_copy is None else evidence_snapshot(asic_copy),
                **expected,
            )
            if register_raw is not None:
                proposal.file.save("register.bin", ContentFile(register_raw), save=False)
            if asic_raw is not None:
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
    member_dates = imported_membership_dates(proposal.token)
    imported = {row["member"]: int(row["shares"]) for row in proposal.members}
    return [
        {
            "member": member,
            "imported": imported.get(member),
            "stored": int(stored[member].shares) if member in stored else None,
            "entered_on": member_dates.get(member, stored[member].entered_on) if member in stored else None,
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
    from tokens.services.register_deployments import pending_deployment

    unmet = _empty_opening_requirements(proposal)
    if not _award_identities_valid(proposal.company_id, proposal.pk, proposal.members):
        unmet.append("award_recipient_identity_changed")
    if pending_deployment(proposal.token):
        unmet.append("deployment_pending")
    try:
        if proposal.register_evidence_id is not None:
            matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
        if proposal.asic_evidence_id is not None:
            matching_bytes(proposal.asic_file, proposal.asic_snapshot["file_size"], proposal.asic_fingerprint)
    except ValidationError:
        unmet.append("evidence_unavailable")
    token = proposal.token
    if proposal.correction_of_id is not None:
        unmet.extend(_correction_requirements(proposal))
    elif RegisterImport.objects.filter(token=token, status="applied").exists():
        unmet.append("class_has_applied_import")
    opening = _opening(token)
    if opening is None:
        try:
            _check_openable(token)
        except ValidationError:
            unmet.append("class_not_openable")
    elif proposal.correction_of_id is None and any(row["imported"] != row["stored"] for row in _comparison(proposal)):
        unmet.append("holdings_differ")
    cutoff = retention_cutoff()
    for row in proposal.former_members:
        ceased_on = date.fromisoformat(row["ceased_on"])
        if proposal.correction_of_id is None and opening is not None and ceased_on >= opening.effective_on:
            unmet.append("former_member_after_opening")
        if ceased_on < cutoff:
            unmet.append("former_member_before_retention")
    return unmet


def _details(proposal):
    register = ShareRegister.objects.filter(token_id=proposal.token_id).first()
    imported_total = sum(int(row["shares"]) for row in proposal.members)
    return {
        "opens_register": _opening(proposal.token) is None,
        "correction_of": proposal.correction_of_id,
        "correction_allowed": (
            not _correction_requirements(proposal) if proposal.correction_of_id is not None else False
        ),
        "source_reference": proposal.source_reference,
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
    return RegisterImport.objects.select_for_update().get(pk=proposal.pk)


def _apply(proposal, actor, decision):
    token = proposal.token
    if _opening(token) is None:
        _open(proposal, token, actor)
    elif proposal.correction_of_id is not None:
        held = _holdings(token.pk)
        replacement = {row["member"]: int(row["shares"]) for row in proposal.members}
        changes = [
            {
                "member": member,
                "shares": str(replacement.get(member, 0) - int(held[member].shares if member in held else 0)),
            }
            for member in sorted(set(replacement) | set(held))
            if replacement.get(member, 0) != int(held[member].shares if member in held else 0)
        ]
        for row in proposal.members:
            create_member(company_id=token.company_id, member_id=row["member"])
        if changes:
            record_entry(
                register_id=token.stored_register.pk,
                operation_id=proposal.pk,
                kind=RegisterEntryKind.MIRROR_CORRECTION,
                changes=changes,
                effective_on=proposal.as_at,
                recorded_by=actor,
            )
    newer = {
        str(member)
        for member in RegisterMemberParticulars.objects.filter(
            member_id__in=[row["member"] for row in proposal.members], as_at__gt=proposal.as_at
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
                "as_at": proposal.as_at,
                "source_import": proposal,
                "source_change": None,
                "source_grant": None,
                "source_allotment": None,
                "source_transfer": None,
                "source_award": None,
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
