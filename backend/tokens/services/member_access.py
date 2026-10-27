import hashlib
import json
import re
import secrets
from datetime import timedelta
from decimal import Decimal
from smtplib import SMTPException
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import BadHeaderError
from django.core.validators import URLValidator
from django.db import IntegrityError, connections
from django.db.models import BooleanField, F, Func, Q, Value
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from django.utils.http import urlsafe_base64_encode
from rest_framework.exceptions import NotFound, ValidationError

from authentication.email import normalize_email
from companies.constants import TEAM_INVITATION_DEFAULT_DAYS, TEAM_INVITATION_MAX_DAYS
from companies.models import REGISTER_READERS, CompanyAppointment, CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority_requests import _require_requester
from integrations.sendgrid_email import sendgrid_client
from operators.models import Operator
from shared.db import current_alias
from tokens.exceptions import InvitationEmailUnavailable, RegisterChangeConflict
from tokens.models import (
    MemberAssociation,
    MemberAssociationRevocation,
    MemberCertificateFulfilment,
    MemberCertificateRequest,
    MemberCertificateWithdrawal,
    MemberInvitation,
    MemberParticularsRequest,
    RegisterAward,
    RegisterEntry,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterParticularsChange,
    RegisterPosition,
)
from tokens.services.former_holders import retention_cutoff
from tokens.services.ownership import _ownership_summary
from tokens.services.register import (
    _snapshot,
    _stored_register,
    imported_membership_dates,
)
from tokens.services.register_authority import register_appointment, register_command
from tokens.services.register_awards import award_quantities
from tokens.services.register_events import with_company_event_dates
from users.models import UserAccount

NOT_FOUND = "Member association or retained company record not found."


def _query(function, *values):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(f"SELECT {function}({', '.join(['%s'] * len(values))})", values)
        result = cursor.fetchone()[0]
        return json.loads(result) if isinstance(result, str) and result.startswith("{") else result


def _identity(company, member):
    identity = _query("tokens_member_identity", company, member)
    if identity is None:
        raise NotFound(NOT_FOUND)
    return identity


def _appointment_companies(actor, capability=None):
    if not actor.is_authenticated:
        return CompanyAppointment.objects.none().values("company_id")
    return (
        CompanyAppointment.objects.current_of(
            actor, at=timezone.now(), identity_required=Operator.get().issuer_kyc_required
        )
        .holding_any([capability] if capability else REGISTER_READERS)
        .values("company_id")
    )


def company_readable(queryset, actor, *, admin=False):
    return queryset.filter(company_id__in=_appointment_companies(actor, CompanyCapability.ADMIN if admin else None))


def own_associations(queryset, actor):
    if not actor.is_authenticated:
        return queryset.none()
    return queryset.annotate(
        access_current=Func(
            F("uuid"), Value(actor.pk), function="tokens_member_association_current", output_field=BooleanField()
        )
    ).filter(access_current=True)


def request_readable(queryset, actor):
    if not actor.is_authenticated or not actor.is_active or not actor.is_email_verified:
        return queryset.none()
    return queryset.filter(
        Q(association__user=actor, association__user_account__user_profile__user=actor)
        | Q(company_id__in=_appointment_companies(actor))
    )


def _own(association, actor, *, lock=False):
    queryset = MemberAssociation.objects.select_for_update() if lock else MemberAssociation.objects.all()
    result = own_associations(queryset, actor).filter(pk=association).first()
    if result is None:
        raise NotFound(NOT_FOUND)
    return result


def _same(existing, values):
    if any(getattr(existing, key) != value for key, value in values.items()):
        raise RegisterChangeConflict()


def issue_invitation(
    *, actor, operation_id, company, appointment, member, intended_email, acceptance_deadline=None, _code=None
):
    intended_email = normalize_email(intended_email)
    with register_command(actor, company, "member_invitation_issue") as (issuer, current, profile, operator):
        source = register_appointment(issuer, current, profile, operator, appointment, CompanyCapability.ADMIN)
        existing = MemberInvitation.objects.filter(pk=operation_id).first()
        values = {
            "company_id": issuer.pk,
            "member": member,
            "issued_by_id": current.pk,
            "appointment_id": source.pk,
            "intended_email": intended_email,
        }
        if existing is not None:
            _same(existing, values)
            if acceptance_deadline is not None and existing.acceptance_deadline != acceptance_deadline:
                raise RegisterChangeConflict()
            return existing, None, False
        snapshot = _identity(issuer.pk, member)
        if MemberAssociation.objects.filter(company=issuer, member=member, current=True).exists():
            raise ValidationError("Revoke the existing member association before issuing another invitation.")
        now = timezone.now()
        deadline = acceptance_deadline or now + timedelta(days=TEAM_INVITATION_DEFAULT_DAYS)
        if not now < deadline <= now + timedelta(days=TEAM_INVITATION_MAX_DAYS):
            raise ValidationError({"acceptance_deadline": "Choose a future deadline within 30 days."})
        code = _code or secrets.token_urlsafe(32)
        try:
            invitation = MemberInvitation.objects.create(
                uuid=operation_id,
                source_snapshot=snapshot,
                acceptance_deadline=deadline,
                code_sha256=hashlib.sha256(code.encode()).hexdigest(),
                **values,
            )
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return invitation, code, True


def _email_invitation_code(operation_id):
    proof = salted_hmac("tokens.member_email_invitation", str(operation_id), algorithm="sha256").digest()
    return urlsafe_base64_encode(proof)


def _invitation_url(code):
    origin = settings.DASHBOARD_BASE_URL.strip().rstrip("/")
    try:
        URLValidator(schemes=["https", "http"])(origin)
        parsed = urlsplit(origin)
    except (ValueError, DjangoValidationError):
        raise InvitationEmailUnavailable("The configured dashboard URL is invalid.") from None
    local = settings.DEBUG and parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        (parsed.scheme != "https" and not local)
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise InvitationEmailUnavailable(
            "Invitation email is unavailable. Ask the operator to configure the dashboard URL."
        )
    return f"{origin}/member-invitation#{code}"


def send_invitation_email(*, actor, **values):
    code = _email_invitation_code(values["operation_id"])
    invitation_url = _invitation_url(code)
    invitation, _, created = issue_invitation(actor=actor, _code=code, **values)
    with register_command(actor, invitation.company_id, "member_invitation_issue") as (
        company,
        current,
        profile,
        operator,
    ):
        register_appointment(company, current, profile, operator, values["appointment"], CompanyCapability.ADMIN)
        if not constant_time_compare(invitation.code_sha256, hashlib.sha256(code.encode()).hexdigest()):
            raise RegisterChangeConflict()
        if (
            MemberAssociation.objects.filter(company=company, member=invitation.member, current=True).exists()
            or getattr(invitation, "association", None)
            or invitation.acceptance_deadline <= timezone.now()
            or not _query("tokens_member_invitation_current", invitation.pk)
        ):
            raise ValidationError("This invitation is no longer pending. Create a new invitation if access is needed.")
        html = render_to_string(
            "tokens/member_invitation.html",
            {
                "company": company.name,
                "member": invitation.source_snapshot["name"],
                "invitation_url": invitation_url,
                "deadline": invitation.acceptance_deadline,
            },
        )
        try:
            result = sendgrid_client.send_email(
                to_email=invitation.intended_email,
                subject=f"{company.name} invited you to view your shares",
                html_content=html,
                text_content=(
                    f"{company.name} invited you to view {invitation.source_snapshot['name']}'s share records.\n\n"
                    f"View invitation: {invitation_url}\n\n"
                    f"Sign in with {invitation.intended_email} and review the invitation before accepting.\n"
                    f"This invitation expires on {invitation.acceptance_deadline.isoformat()}."
                ),
            )
        except (OSError, SMTPException, BadHeaderError):
            raise InvitationEmailUnavailable() from None
        if result.get("success") is not True:
            raise InvitationEmailUnavailable()
    return invitation, created


def preview_invitation(*, actor, code):
    _require_requester(actor)
    invitation = get_object_or_404(
        MemberInvitation.objects.select_related("company", "association"),
        code_sha256=hashlib.sha256(code.encode()).hexdigest(),
    )
    if normalize_email(actor.email) != invitation.intended_email:
        raise ValidationError("This invitation names a different recipient.")
    association = getattr(invitation, "association", None)
    if association:
        if not association.current or association.user_id != actor.pk:
            raise ValidationError("This association is unavailable. Ask the company for a new invitation.")
        if not _query("tokens_member_association_current", association.pk, actor.pk):
            raise ValidationError("This member association is no longer current.")
        status = "accepted"
    else:
        if invitation.acceptance_deadline <= timezone.now():
            raise ValidationError("This invitation has expired. Ask the company for a new invitation.")
        if not _query("tokens_member_invitation_current", invitation.pk):
            raise ValidationError("The company invitation or its recorded member identity is no longer current.")
        if MemberAssociation.objects.filter(
            company_id=invitation.company_id, member=invitation.member, current=True
        ).exists():
            raise ValidationError("This member is already linked. Ask the company to review their access.")
        status = "pending"
    return {
        "company": {"uuid": invitation.company_id, "name": invitation.company.name},
        "member": {"uuid": invitation.member, "name": invitation.source_snapshot["name"]},
        "intended_email": invitation.intended_email,
        "acceptance_deadline": invitation.acceptance_deadline,
        "status": status,
    }


def accept_invitation(*, actor, code, user_account, confirmation):
    _require_requester(actor)
    if confirmation is not True or re.fullmatch(r"[A-Za-z0-9_-]{43}", code or "") is None:
        raise ValidationError("Confirm the invitation using the code supplied by the company.")
    digest = hashlib.sha256(code.encode()).hexdigest()
    invitation = get_object_or_404(MemberInvitation, code_sha256=digest)
    with register_command(actor, invitation.company_id, "member_invitation_accept") as (company, current, _, _):
        _require_requester(current)
        invitation = MemberInvitation.objects.select_for_update().get(pk=invitation.pk)
        account = get_object_or_404(
            UserAccount.objects.select_for_update(), pk=user_account, user_profile__user=current
        )
        if normalize_email(current.email) != invitation.intended_email:
            raise ValidationError("This invitation names a different recipient.")
        existing = MemberAssociation.objects.filter(invitation=invitation).first()
        if existing is not None:
            _same(existing, {"user_id": current.pk, "user_account_id": account.pk})
            if not existing.current:
                raise ValidationError("This association was revoked. Ask the company for a new invitation.")
            return existing
        if invitation.acceptance_deadline <= timezone.now():
            raise ValidationError("This invitation has expired. Ask the company for a new invitation.")
        if not _query("tokens_member_invitation_current", invitation.pk):
            raise ValidationError("The company invitation or its recorded member identity is no longer current.")
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT set_config('app.member_invitation_code', %s, true)", [code])
        try:
            return MemberAssociation.objects.create(
                invitation=invitation,
                company=company,
                member=invitation.member,
                user=current,
                user_account=account,
                accepted_email=invitation.intended_email,
            )
        except IntegrityError:
            raise RegisterChangeConflict() from None


def revoke_association(*, actor, association_id, appointment, idempotency_key, reason):
    subject = get_object_or_404(company_readable(MemberAssociation.objects.all(), actor, admin=True), pk=association_id)
    with register_command(actor, subject.company_id, "member_association_revoke") as (
        company,
        current,
        profile,
        operator,
    ):
        source = register_appointment(company, current, profile, operator, appointment, CompanyCapability.ADMIN)
        subject = MemberAssociation.objects.select_for_update().get(pk=subject.pk)
        values = {
            "association_id": subject.pk,
            "revoked_by_id": current.pk,
            "appointment_id": source.pk,
            "reason": reason,
        }
        existing = MemberAssociationRevocation.objects.filter(
            revoked_by=current, idempotency_key=idempotency_key
        ).first()
        if existing:
            _same(existing, values)
            return subject
        if not subject.current:
            raise RegisterChangeConflict()
        try:
            MemberAssociationRevocation.objects.create(idempotency_key=idempotency_key, **values)
            subject.current = False
            subject.save(update_fields=["current", "updated_at"])
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return subject


def request_particulars(*, actor, operation_id, association, name, residential_address, confirmation):
    subject = _own(association, actor)
    with register_command(actor, subject.company_id, "member_particulars_request") as (company, current, _, _):
        _require_requester(current)
        subject = _own(subject.pk, current, lock=True)
        values = {
            "association_id": subject.pk,
            "company_id": company.pk,
            "member": subject.member,
            "requested_by_id": current.pk,
            "name": name.strip(),
            "residential_address": residential_address.strip(),
        }
        existing = MemberParticularsRequest.objects.filter(pk=operation_id).first()
        if existing:
            _same(existing, values)
            return existing, False
        if confirmation is not True:
            raise ValidationError("Confirm the proposed company-recorded particulars.")
        if not RegisterMemberParticulars.objects.filter(member_id=subject.member, member__company=company).exists():
            raise ValidationError("The company no longer retains particulars for this member.")
        snapshot = _query("tokens_register_particulars_snapshot", subject.member)
        if snapshot["name"] == values["name"] and snapshot["residential_address"] == values["residential_address"]:
            raise ValidationError("These particulars already match the company record.")
        try:
            return MemberParticularsRequest.objects.create(uuid=operation_id, source_snapshot=snapshot, **values), True
        except IntegrityError:
            raise RegisterChangeConflict() from None


def prepare_requested_particulars(*, actor, request_id, operation_id, appointment, supporting_evidence, as_at, reason):
    from tokens.services.register_particulars import prepare_particulars_change

    request = get_object_or_404(company_readable(MemberParticularsRequest.objects.all(), actor), pk=request_id)
    return prepare_particulars_change(
        actor=actor,
        operation_id=operation_id,
        appointment=appointment,
        member=request.member,
        name=request.name,
        residential_address=request.residential_address,
        supporting_evidence=supporting_evidence,
        as_at=as_at,
        reason=reason,
        member_request=request.pk,
    )


def requested_particulars_change(actor, change):
    return RegisterParticularsChange.objects.register_readable_by(actor).filter(pk=change)


def request_certificate(*, actor, operation_id, association, entry):
    subject = _own(association, actor)
    with register_command(actor, subject.company_id, "member_certificate_request") as (company, current, _, _):
        _require_requester(current)
        subject = _own(subject.pk, current, lock=True)
        effect = get_object_or_404(
            RegisterEntry.objects.select_related("register"), pk=entry, register__company=company
        )
        values = {
            "association_id": subject.pk,
            "company_id": company.pk,
            "member": subject.member,
            "requested_by_id": current.pk,
            "token_id": effect.register.token_id,
            "entry_id": effect.pk,
        }
        existing = MemberCertificateRequest.objects.filter(pk=operation_id).first()
        if existing:
            _same(existing, values)
            return existing, False
        if not _query("tokens_member_certificate_entry", subject.pk, effect.pk):
            raise ValidationError("Select a genuine uncorrected issue or receiving transfer for this member.")
        try:
            return MemberCertificateRequest.objects.create(uuid=operation_id, **values), True
        except IntegrityError:
            raise RegisterChangeConflict() from None


def withdraw_certificate(*, actor, request_id, idempotency_key):
    request = get_object_or_404(MemberCertificateRequest, pk=request_id, association__user=actor)
    with register_command(actor, request.company_id, "member_certificate_withdraw") as (_, current, _, _):
        _require_requester(current)
        request = MemberCertificateRequest.objects.select_for_update().get(pk=request.pk)
        _own(request.association_id, current, lock=True)
        values = {"request_id": request.pk, "withdrawn_by_id": current.pk}
        existing = MemberCertificateWithdrawal.objects.filter(
            withdrawn_by=current, idempotency_key=idempotency_key
        ).first()
        if existing:
            _same(existing, values)
            return request
        if MemberCertificateFulfilment.objects.filter(request=request).exists():
            raise ValidationError("This request already has a retained certificate and cannot be withdrawn.")
        if MemberCertificateWithdrawal.objects.filter(request=request).exists():
            raise RegisterChangeConflict()
        try:
            MemberCertificateWithdrawal.objects.create(idempotency_key=idempotency_key, **values)
        except IntegrityError:
            raise RegisterChangeConflict() from None
        return request


def own_record(association, *, actor):
    with company_operation(actor, association.company_id, "member_record_read"), _snapshot():
        return _own_record(_own(association.pk, actor))


def _own_record(association):
    identity = _identity(association.company_id, association.member)
    classes = []
    for position in RegisterPosition.objects.filter(
        member_id=association.member, register__company=association.company
    ).select_related("register__token", "last_entry"):
        entered_on = position.entered_on
        if position.shares == 0:
            ceased_on = (
                RegisterMemberCessation.objects.filter(member_id=association.member, entry_id=position.last_entry_id)
                .values_list("ceased_on", flat=True)
                .first()
                or position.last_entry.effective_on
            )
            if ceased_on is None or ceased_on < retention_cutoff():
                continue
            paid = None
            entered_on = imported_membership_dates(position.register.token).get(str(association.member), entered_on)
        else:
            ceased_on = None
            register = _stored_register(position.register.token)
            row = next((row for row in register["rows"] if row["member"] == str(association.member)), None)
            paid = row["amount_paid"] if row else None
            entered_on = row["entered_on"] if row else entered_on
        classes.append(
            {
                "uuid": position.register.token_id,
                "name": position.register.token.name,
                "symbol": position.register.token.symbol,
                "shares": position.shares,
                "entered_on": entered_on,
                "ceased_on": ceased_on,
                "amount_paid": paid,
            }
        )
    awards = []
    for award in RegisterAward.objects.filter(company=association.company, member=association.member).prefetch_related(
        "vestings", "ends", "vesting_reversals"
    ):
        awards.append(
            {
                "uuid": award.pk,
                "token": award.token_id,
                "shares": award.shares,
                "terms_on": award.terms_on,
                "terms": award.terms,
                "schedule": award.schedule,
                **award_quantities(award),
                "vestings": [
                    {"uuid": fact.pk, "shares": fact.shares, "vested_on": fact.vested_on}
                    for fact in award.vestings.all()
                ],
                "ends": [
                    {
                        "uuid": fact.pk,
                        "unvested_shares": fact.unvested_shares,
                        "vested_shares": fact.vested_shares,
                        "company_event_on": fact.company_event_on,
                        "reason": fact.reason,
                        "created_at": fact.created_at,
                    }
                    for fact in award.ends.all()
                ],
                "vesting_reversals": [
                    {
                        "uuid": fact.pk,
                        "vesting": fact.vesting_id,
                        "reversed_shares": fact.reversed_shares,
                        "company_event_on": fact.company_event_on,
                        "reason": fact.reason,
                        "created_at": fact.created_at,
                    }
                    for fact in award.vesting_reversals.all()
                ],
            }
        )
    return {
        "uuid": association.pk,
        "member": association.member,
        "company": {"uuid": association.company_id, "name": association.company.name, "acn": association.company.acn},
        **identity,
        "identity_source": "company_recorded",
        "classes": classes,
        "awards": awards,
        "ownership": (
            _ownership_summary(association.company, member_id=association.member)
            if association.company.share_ownership_with_members
            else None
        ),
    }


def own_entries(association, token):
    entries = []
    queryset = RegisterEntry.objects.filter(register__company=association.company, register__token_id=token).order_by(
        "sequence"
    )
    for entry in with_company_event_dates(queryset).select_related("correction"):
        delta = sum(
            (Decimal(change["shares"]) for change in entry.changes if change["member"] == str(association.member)),
            Decimal(0),
        )
        if not any(change["member"] == str(association.member) for change in entry.changes):
            continue
        entries.append(
            {
                "uuid": entry.pk,
                "sequence": entry.sequence,
                "kind": entry.kind,
                "effective_on": entry.effective_on,
                "company_event_on": entry.company_event_on,
                "delta": delta,
                "created_at": entry.created_at,
                "corrects": entry.corrects_id,
                "corrected_by": getattr(getattr(entry, "correction", None), "pk", None),
            }
        )
    return {"entries": entries}
