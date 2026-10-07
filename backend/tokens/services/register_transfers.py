import re
from datetime import date
from uuid import UUID

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import CompanyCapability
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterMember,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterMemberWallet,
    RegisterPosition,
    RegisterTransfer,
    RegisterTransferDecision,
    ShareRegister,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register import _snapshot
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_decisions import DecisionFamily, decide, preview
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_evidence import (
    discard,
    evidence_snapshot,
    matching_bytes,
    own_evidence_bytes,
)
from tokens.services.register_imports import _company_of
from tokens.services.register_instructions import _named


def particulars_snapshot(held):
    if held is None:
        return None
    return {
        "uuid": str(held.pk),
        "name": held.name,
        "residential_address": held.residential_address,
        "as_at": held.as_at.isoformat(),
        **{
            f"source_{kind}": str(getattr(held, f"source_{kind}_id")) if getattr(held, f"source_{kind}_id") else None
            for kind in ("import", "change", "grant", "transfer")
        },
    }


def register_members(token):
    with _snapshot():
        members = list(RegisterMember.objects.filter(company_id=token.company_id).order_by("uuid"))
        held = {
            row.member_id: row for row in RegisterMemberParticulars.objects.filter(member__company_id=token.company_id)
        }
        positions = {row.member_id: row for row in RegisterPosition.objects.filter(register__token=token)}
        linked = set(
            RegisterMemberWallet.objects.filter(company_id=token.company_id).values_list("member_id", flat=True)
        )
        cessations = {}
        for row in RegisterMemberCessation.objects.filter(register__token=token).order_by("entry__sequence"):
            cessations[row.member_id] = row.ceased_on
        return {
            "members": [
                {
                    "member": member.pk,
                    "name": held[member.pk].name if member.pk in held else None,
                    "residential_address": held[member.pk].residential_address if member.pk in held else None,
                    "current_shares": str(positions[member.pk].shares) if member.pk in positions else "0",
                    "entered_on": (
                        positions[member.pk].entered_on
                        if member.pk in positions and positions[member.pk].shares > 0
                        else None
                    ),
                    "last_ceased_on": cessations.get(member.pk),
                    "walletless": member.pk not in linked,
                    "particulars_retained": member.pk in held,
                }
                for member in members
            ]
        }


def _text(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValidationError(f"A direct transfer needs a {label} with at most {limit} characters.")
    return value.strip()


def _state(proposal):
    unmet = []
    token = ShareToken.objects.get(pk=proposal.token_id)
    register = ShareRegister.objects.filter(token=token, sequence__gt=0).first()
    if (
        token.status != ShareTokenStatus.DRAFT
        or token.contract_address
        or token.deployment_id
        or token.deployment_transaction_id
        or token.deployment_tx_hash
        or token.deployed_at
        or token.chain
        or not RegisterImport.objects.filter(token=token, status="applied").exists()
        or register is None
    ):
        unmet.append("imported_non_tokenised_register_required")
    if register is not None:
        positions = dict(
            RegisterPosition.objects.filter(
                register=register, member_id__in=[proposal.from_member, proposal.to_member]
            ).values_list("member_id", "shares")
        )
        if positions.get(proposal.from_member, 0) < proposal.shares:
            unmet.append("sufficient_holding_required")
        if positions.get(proposal.to_member, 0) + proposal.shares >= 2**256:
            unmet.append("share_limit_required")
        if RegisterEntry.objects.filter(
            register=register, sequence=register.sequence, effective_on__gt=timezone.now().date()
        ).exists():
            unmet.append("effective_date_before_latest_entry")
    members = {row.pk: row for row in RegisterMember.objects.filter(pk__in=[proposal.from_member, proposal.to_member])}
    held = {row.member_id: row for row in RegisterMemberParticulars.objects.filter(member_id__in=members)}
    sender = members.get(proposal.from_member)
    if sender is None or sender.company_id != proposal.company_id or proposal.from_member not in held:
        unmet.append("identified_company_member_required")
    elif particulars_snapshot(held[proposal.from_member]) != proposal.from_particulars:
        unmet.append("member_particulars_changed")
    recipient = members.get(proposal.to_member)
    if proposal.new_member:
        if recipient is not None:
            unmet.append("member_reference_conflict")
    elif recipient is None or recipient.company_id != proposal.company_id:
        unmet.append("identified_company_member_required")
    if particulars_snapshot(held.get(proposal.to_member)) != proposal.to_particulars:
        unmet.append("member_particulars_changed")
    if (
        proposal.new_particulars
        and RegisterPosition.objects.filter(member_id=proposal.to_member, shares__gt=0).exists()
    ):
        unmet.append("member_particulars_changed")
    if RegisterMemberWallet.objects.filter(
        company_id=proposal.company_id, member_id__in=[proposal.from_member, proposal.to_member]
    ).exists():
        unmet.append("member_wallet_linked")
    if _named(proposal.approving_director) in {_named(proposal.from_name), _named(proposal.name)}:
        unmet.append("director_is_party")
    return sorted(set(unmet))


def prepare_transfer(
    *,
    actor,
    operation_id,
    appointment,
    token_id,
    from_member,
    to_member,
    new_member,
    shares,
    signed_on,
    lodged_on,
    terms,
    approving_director,
    authority_reference,
    reason,
    authority_evidence,
    instrument_evidence,
    name="",
    residential_address="",
    authority="director_resolution",
):
    try:
        operation_id, appointment, token_id, from_member, to_member, authority_evidence, instrument_evidence = (
            UUID(str(value))
            for value in (
                operation_id,
                appointment,
                token_id,
                from_member,
                to_member,
                authority_evidence,
                instrument_evidence,
            )
        )
        signed_on, lodged_on = (date.fromisoformat(str(value)) for value in (signed_on, lodged_on))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Transfer references must be UUIDs and its dates ISO dates.") from None
    if type(new_member) is not bool or from_member == to_member:
        raise ValidationError("Choose two distinct members and state whether the recipient is new.")
    if not isinstance(shares, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", shares) or int(shares) >= 2**256:
        raise ValidationError("A direct transfer needs positive whole shares within the share limit.")
    if signed_on > lodged_on or lodged_on > timezone.now().date():
        raise ValidationError("The instrument must be signed by lodgement, and lodgement cannot be after today (UTC).")
    if authority != "director_resolution":
        raise ValidationError("This direct transfer requires a named approving director and a director resolution.")
    if not isinstance(name, str) or not isinstance(residential_address, str):
        raise ValidationError("Member identity fields must be text.")
    if new_member:
        name = _text(name, "recipient name", 255)
        residential_address = _text(residential_address, "residential address", REGISTER_IMPORT_ADDRESS_LENGTH)
    values = {
        "from_member": from_member,
        "to_member": to_member,
        "new_member": new_member,
        "shares": int(shares),
        "signed_on": signed_on,
        "lodged_on": lodged_on,
        "authority": authority,
        "terms": _text(terms, "non-paid terms summary", 1000),
        "approving_director": _text(approving_director, "approving director", 255),
        "authority_reference": _text(authority_reference, "company authority reference", 255),
        "reason": _text(reason, "reason", 1000),
    }
    proposal = None
    try:
        with register_command(actor, _company_of(actor, token_id), "register_transfer_prepare") as (
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
            existing = RegisterTransfer.objects.filter(pk=operation_id).first()
            if existing is not None:
                if existing.new_particulars and (not name.strip() or not residential_address.strip()):
                    raise ValidationError("Retain the explicit recipient identity on this transfer retry.")
                expected = {
                    **values,
                    "company_id": company.pk,
                    "token_id": token.pk,
                    "name": name.strip() if name else existing.name,
                    "residential_address": (
                        residential_address.strip() if residential_address else existing.residential_address
                    ),
                    "authority_evidence_id": authority_evidence,
                    "instrument_evidence_id": instrument_evidence,
                    "preparing_appointment_id": source.pk,
                    "submitted_by_id": current_actor.pk,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return existing, False
            particulars = {
                row.member_id: row
                for row in RegisterMemberParticulars.objects.select_for_update().filter(
                    member_id__in=[from_member, to_member]
                )
            }
            sender = particulars.get(from_member)
            if sender is None:
                raise ValidationError("Choose an identified transferor of this company's register.")
            recipient = particulars.get(to_member)
            if recipient is not None:
                if (name and name.strip() != recipient.name) or (
                    residential_address and residential_address.strip() != recipient.residential_address
                ):
                    raise ValidationError("An existing member's identity must match the retained particulars.")
                name, residential_address = recipient.name, recipient.residential_address
            values.update(
                name=_text(name, "recipient name", 255),
                residential_address=_text(residential_address, "residential address", REGISTER_IMPORT_ADDRESS_LENGTH),
                from_name=sender.name,
                from_residential_address=sender.residential_address,
                from_particulars=particulars_snapshot(sender),
                to_particulars=particulars_snapshot(recipient),
                new_particulars=recipient is None,
            )
            proposal = RegisterTransfer(
                uuid=operation_id,
                company=company,
                token=token,
                preparing_appointment=source,
                submitted_by=current_actor,
                **values,
            )
            unmet = _state(proposal)
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            for prefix, reference, kind in (
                ("", authority_evidence, RegisterEvidenceKind.AUTHORITY),
                ("instrument_", instrument_evidence, RegisterEvidenceKind.SUPPORTING),
            ):
                evidence = RegisterEvidence.objects.select_for_update().filter(pk=reference).first()
                raw = own_evidence_bytes(
                    evidence, kind, company, current_actor, "Name the document you uploaded for this company."
                )
                setattr(proposal, f"{prefix}evidence" if prefix else "authority_evidence", evidence)
                setattr(proposal, f"{prefix}fingerprint" if prefix else "evidence_fingerprint", evidence.sha256)
                setattr(proposal, f"{prefix}snapshot" if prefix else "evidence_snapshot", evidence_snapshot(evidence))
                getattr(proposal, f"{prefix}file").save("evidence.bin", ContentFile(raw), save=False)
            try:
                proposal.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            return proposal, True
    except BaseException:
        if proposal is not None:
            discard(proposal.file, proposal.instrument_file)
        raise


def _effect_requirements(proposal):
    unmet = _state(proposal)
    try:
        matching_bytes(proposal.file, proposal.evidence_snapshot["file_size"], proposal.evidence_fingerprint)
        matching_bytes(
            proposal.instrument_file, proposal.instrument_snapshot["file_size"], proposal.instrument_fingerprint
        )
    except ValidationError:
        unmet.append("evidence_unavailable")
    return unmet


def _details(proposal):
    token = ShareToken.objects.get(pk=proposal.token_id)
    register = ShareRegister.objects.filter(token=token).first()
    positions = dict(
        RegisterPosition.objects.filter(
            register=register, member_id__in=[proposal.from_member, proposal.to_member]
        ).values_list("member_id", "shares")
    )
    sender, recipient = int(positions.get(proposal.from_member, 0)), int(positions.get(proposal.to_member, 0))
    issued = str(register.issued_supply) if register else "0"
    return {
        **{
            key: getattr(proposal, key)
            for key in (
                "from_member",
                "to_member",
                "new_member",
                "new_particulars",
                "from_name",
                "from_residential_address",
                "name",
                "residential_address",
                "signed_on",
                "lodged_on",
                "terms",
                "authority",
                "approving_director",
            )
        },
        "shares": str(proposal.shares),
        "effective_on": proposal.register_entry.effective_on if proposal.register_entry_id else timezone.now().date(),
        "register_sequence": register.sequence if register else 0,
        "issued_supply": issued,
        "authorised_supply": token.total_supply,
        "after_issued_supply": issued,
        "from_current_shares": str(sender),
        "from_after_shares": str(sender - int(proposal.shares)),
        "to_current_shares": str(recipient),
        "to_after_shares": str(recipient + int(proposal.shares)),
    }


def _lock(proposal):
    ShareToken.objects.select_for_update().get(pk=proposal.token_id)
    list(ShareRegister.objects.select_for_update().filter(token_id=proposal.token_id).values_list("uuid", flat=True))
    list(
        RegisterMemberParticulars.objects.select_for_update()
        .filter(member_id__in=[proposal.from_member, proposal.to_member])
        .order_by("member_id")
        .values_list("uuid", flat=True)
    )
    return RegisterTransfer.objects.select_for_update().get(pk=proposal.pk)


def _apply(proposal, actor, decision):
    entered_on = timezone.now().date()
    if proposal.new_member:
        create_member(company_id=proposal.company_id, member_id=proposal.to_member)
    if proposal.new_particulars:
        RegisterMemberParticulars.objects.create(
            member_id=proposal.to_member,
            name=proposal.name,
            residential_address=proposal.residential_address,
            as_at=entered_on,
            source_transfer=proposal,
        )
    proposal.register_entry = record_entry(
        register_id=ShareRegister.objects.get(token_id=proposal.token_id).pk,
        operation_id=proposal.pk,
        kind=RegisterEntryKind.TRANSFER,
        changes=[
            {"member": str(proposal.from_member), "shares": str(-int(proposal.shares))},
            {"member": str(proposal.to_member), "shares": str(proposal.shares)},
        ],
        effective_on=entered_on,
        recorded_by=actor,
    )
    proposal.status = "applied"
    proposal.reviewed_by = actor
    proposal.reviewed_at = decision.decided_at
    proposal.save(update_fields=["status", "register_entry", "reviewed_by", "reviewed_at", "updated_at"])


TRANSFERS = DecisionFamily(
    model=RegisterTransfer,
    decision_model=RegisterTransferDecision,
    field="register_transfer",
    operation="register_transfer",
    approved_function="tokens_register_transfer_approved",
    digest_function="tokens_register_transfer_decision_digest",
    effect_requirements=_effect_requirements,
    lock=_lock,
    apply=_apply,
    noun="transfer",
)


def preview_transfer_decision(*, actor, transfer_id, appointment, kind, reason=""):
    return preview(
        TRANSFERS, _details, actor=actor, proposal_id=transfer_id, appointment=appointment, kind=kind, reason=reason
    )


def decide_transfer(*, actor, transfer_id, appointment, kind, idempotency_key, preview_digest, confirmation, reason=""):
    try:
        return decide(
            TRANSFERS,
            actor=actor,
            proposal_id=transfer_id,
            appointment=appointment,
            kind=kind,
            idempotency_key=idempotency_key,
            preview_digest=preview_digest,
            confirmation=confirmation,
            reason=reason,
        )
    except IntegrityError:
        raise RegisterChangeConflict() from None
