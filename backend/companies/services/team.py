import hashlib
import re
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connections
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import get_object_or_404

from companies.constants import TEAM_INVITATION_DEFAULT_DAYS, TEAM_INVITATION_MAX_DAYS
from companies.exceptions import (
    IssuerIdentityVerificationRequiredException,
    TeamInvitationConflictException,
)
from companies.models import (
    Company,
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyCapability,
    CompanyTeamInvitation,
)
from companies.services.authority import (
    DECLARATION_TEXT,
    DECLARATION_VERSION,
    _require_declaration,
)
from companies.services.authority_requests import (
    _capabilities,
    _requester_principal,
    _require_requester,
)
from operators.models import Operator
from shared.db import atomic, current_alias, use_app, use_operator
from users.models import UserProfile


def _locked_actor(requester):
    actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=requester.pk)
    _require_requester(actor)
    profile = get_object_or_404(UserProfile.objects.select_for_update(), user=actor)
    return actor, profile


def _current(actor, company_id):
    return CompanyAppointment.objects.current_for(
        actor, company_id, at=timezone.now(), identity_required=Operator.get().issuer_kyc_required
    )


def _require_admin(actor, company_id):
    if not _current(actor, company_id).filter(capabilities__contains=[CompanyCapability.ADMIN]).exists():
        raise NotFound("No CompanyAppointment matches the given query.")


def _require_delegation(invitation):
    source = invitation.inviter_appointment
    if not _current(invitation.inviter, invitation.company_id).filter(pk=source.pk).exists():
        raise ValidationError({"invitation": "The inviter's appointment is no longer current."})
    offered = set(invitation.capabilities) | set(invitation.delegatable_capabilities)
    if not offered.issubset(source.delegatable_capabilities):
        raise ValidationError({"capabilities": "Use only capabilities this appointment may delegate."})
    if CompanyCapability.ADMIN in offered:
        _require_admin(invitation.inviter, invitation.company_id)


def issue_team_invitation(
    *,
    requester,
    company_id,
    inviter_appointment_id,
    idempotency_key,
    capabilities,
    delegatable_capabilities=None,
    acceptance_deadline=None,
    appointment_expires_at=None
):
    _require_requester(requester)
    personal = _capabilities(capabilities, "capabilities")
    delegatable = _capabilities(
        [] if delegatable_capabilities is None else delegatable_capabilities, "delegatable_capabilities"
    )
    if not personal and not delegatable:
        raise ValidationError({"capabilities": "Choose at least one personal or delegatable capability."})
    with use_app(), _requester_principal(requester.pk):
        get_object_or_404(CompanyAppointment, pk=inviter_appointment_id, appointee=requester, company_id=company_id)
    with use_operator(), _requester_principal(requester.pk), atomic():
        company = get_object_or_404(Company.objects.select_for_update(), pk=company_id)
        actor, _profile = _locked_actor(requester)
        existing = (
            CompanyTeamInvitation.objects.select_related("appointment")
            .filter(inviter=actor, idempotency_key=idempotency_key)
            .first()
        )
        if existing:
            if (
                existing.company_id != company.pk
                or str(existing.inviter_appointment_id) != str(inviter_appointment_id)
                or existing.capabilities != personal
                or existing.delegatable_capabilities != delegatable
                or (acceptance_deadline is not None and existing.acceptance_deadline != acceptance_deadline)
                or existing.appointment_expires_at != appointment_expires_at
            ):
                raise TeamInvitationConflictException()
            return existing, None, False
        now = timezone.now()
        deadline = acceptance_deadline or now + timedelta(days=TEAM_INVITATION_DEFAULT_DAYS)
        if not now < deadline <= now + timedelta(days=TEAM_INVITATION_MAX_DAYS):
            raise ValidationError({"acceptance_deadline": "Choose a future deadline within 30 days."})
        if appointment_expires_at is not None and appointment_expires_at <= now:
            raise ValidationError({"appointment_expires_at": "Choose a future appointment expiry."})
        source = get_object_or_404(
            CompanyAppointment.objects.select_for_update(), pk=inviter_appointment_id, appointee=actor, company=company
        )
        code = secrets.token_urlsafe(32)
        invitation = CompanyTeamInvitation(
            company=company,
            company_name=company.name,
            inviter=actor,
            inviter_appointment=source,
            idempotency_key=idempotency_key,
            capabilities=personal,
            delegatable_capabilities=delegatable,
            acceptance_deadline=deadline,
            appointment_expires_at=appointment_expires_at,
            code_sha256=hashlib.sha256(code.encode()).hexdigest(),
        )
        _require_delegation(invitation)
        invitation.save(force_insert=True)
        return invitation, code, True


def accept_team_invitation(*, requester, code, declaration_version, accept_declaration):
    _require_requester(requester)
    _require_declaration(declaration_version, accept_declaration)
    if not isinstance(code, str) or re.fullmatch(r"[A-Za-z0-9_-]{43}", code) is None:
        raise ValidationError({"code": "Enter the invitation code supplied by the company."})
    digest = hashlib.sha256(code.encode()).hexdigest()
    with use_operator(), _requester_principal(requester.pk), atomic():
        invitation = get_object_or_404(CompanyTeamInvitation, code_sha256=digest)
        company = get_object_or_404(Company.objects.select_for_update(), pk=invitation.company_id)
        list(
            get_user_model()
            .objects.filter(pk__in=[requester.pk, invitation.inviter_id])
            .order_by("pk")
            .select_for_update()
        )
        actor, profile = _locked_actor(requester)
        invitation = (
            CompanyTeamInvitation.objects.select_for_update()
            .select_related("inviter", "inviter_appointment")
            .get(pk=invitation.pk)
        )
        existing = (
            CompanyAppointment.objects.select_related("company", "appointee", "revocation")
            .filter(invitation=invitation)
            .first()
        )
        if existing:
            if existing.appointee_id != actor.pk:
                raise ValidationError({"code": "This invitation has already been accepted."})
            return existing
        now = timezone.now()
        if invitation.acceptance_deadline <= now or (
            invitation.appointment_expires_at is not None and invitation.appointment_expires_at <= now
        ):
            raise ValidationError({"code": "This invitation has expired. Request a new invitation."})
        if invitation.inviter_id == actor.pk:
            raise ValidationError({"code": "Another company appointee must invite you."})
        if (
            CompanyAppointment.objects.filter(company=company, appointee=actor, revocation__isnull=True)
            .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
            .exists()
        ):
            raise ValidationError({"code": "You already have an unrevoked, unexpired appointment for this company."})
        if Operator.get().issuer_kyc_required and not profile.is_id_verified:
            raise IssuerIdentityVerificationRequiredException(
                "Your identity must be verified before accepting a company appointment."
            )
        _require_delegation(invitation)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT current_setting('app.team_invitation_code', true)")
            previous_code = cursor.fetchone()[0] or ""
            cursor.execute("SELECT set_config('app.team_invitation_code', %s, true)", [code])
        appointment = CompanyAppointment.objects.create(
            company=company,
            appointee=actor,
            appointee_profile=profile,
            invitation=invitation,
            capabilities=invitation.capabilities,
            delegatable_capabilities=invitation.delegatable_capabilities,
            expires_at=invitation.appointment_expires_at,
            declaration_version=DECLARATION_VERSION,
            declaration_text=DECLARATION_TEXT,
        )
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT set_config('app.team_invitation_code', %s, true)", [previous_code])
        return appointment


def company_team(*, requester, company_id):
    _require_requester(requester)
    with use_operator(), _requester_principal(requester.pk), atomic():
        if not Company.objects.filter(pk=company_id).exists():
            raise NotFound("No CompanyAppointment matches the given query.")
        Company.objects.select_for_update().get(pk=company_id)
        actor, _profile = _locked_actor(requester)
        Operator.objects.select_for_update().get(pk=Operator.get().pk)
        _require_admin(actor, company_id)
        return list(
            CompanyAppointment.objects.filter(company_id=company_id)
            .select_related("appointee", "appointee_profile", "company", "revocation")
            .order_by("created_at", "uuid")
        )


def revoke_company_appointment(*, requester, appointment_id):
    _require_requester(requester)
    with use_operator(), _requester_principal(requester.pk), atomic():
        target = get_object_or_404(CompanyAppointment, pk=appointment_id)
        get_object_or_404(Company.objects.select_for_update(), pk=target.company_id)
        actor, _profile = _locked_actor(requester)
        if target.appointee_id != actor.pk:
            _require_admin(actor, target.company_id)
        target = CompanyAppointment.objects.select_for_update().get(pk=target.pk)
        CompanyAppointmentRevocation.objects.get_or_create(appointment=target, defaults={"revoked_by": actor})
        return CompanyAppointment.objects.select_related("appointee", "company", "revocation").get(pk=target.pk)
