from contextlib import contextmanager

from django.contrib.auth import get_user_model
from django.db import connections
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyLegacyOwnerSource,
    CompanyStatus,
)
from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import atomic, current_alias, use_operator
from users.models import UserProfile


@contextmanager
def company_operation(actor, company_id, operation):
    if actor is None or not actor.is_authenticated:
        raise PermissionDenied("An authenticated company actor is required.")
    with use_operator(), _requester_principal(actor.pk):
        command_connection = connections[current_alias()]
        with command_connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_setting('app.company_operation', true), current_setting('app.company_id', true)"
            )
            previous_operation, previous_company = cursor.fetchone()
            cursor.execute(
                "SELECT set_config('app.company_operation', %s, false), set_config('app.company_id', %s, false)",
                [operation, str(company_id)],
            )
        try:
            yield
        finally:
            with command_connection.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.company_operation', %s, false), set_config('app.company_id', %s, false)",
                    [previous_operation or "", previous_company or ""],
                )


def has_authority_root(company):
    return (
        CompanyLegacyOwnerSource.objects.filter(company=company).exists()
        or CompanyAppointment.objects.filter(company=company, request__isnull=False).exists()
    )


def lock_company_actor(actor, company_id):
    company = get_object_or_404(Company.objects.select_for_update(), pk=company_id)
    current_actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=actor.pk)
    profile = UserProfile.objects.select_for_update().filter(user=current_actor).first()
    Operator.get()
    operator = Operator.objects.select_for_update().get(pk=1)
    list(
        CompanyAppointment.objects.select_for_update()
        .filter(company=company, appointee=current_actor)
        .order_by("uuid")
        .values_list("uuid", flat=True)
    )
    return company, current_actor, profile, operator


@contextmanager
def company_owner_operation(actor, company_id):
    if actor is None or not actor.is_authenticated:
        raise NotFound("Company not found or permission denied")
    with use_operator(), _requester_principal(actor.pk), atomic():
        company, current_actor, _profile, _operator = lock_company_actor(actor, company_id)
        if not current_actor.is_active or company.owner_id != current_actor.pk:
            raise NotFound("Company not found or permission denied")
        yield company


def require_company_documents(company, actor, documents):
    if documents and (
        not Company.objects.administrable_by(actor).filter(pk=company.pk).exists()
        or any(document.company_id != company.pk for document in documents)
    ):
        raise NotFound("Company authority document not found.")


def require_company_administration(company, actor, profile, operator):
    if not actor.is_active or not actor.is_email_verified:
        raise NotFound("Company not found or permission denied")
    if company.owner_id == actor.pk and company.status == CompanyStatus.DRAFT and not has_authority_root(company):
        return
    if profile and (
        CompanyAppointment.objects.current_for(
            actor, company.pk, at=timezone.now(), identity_required=operator.issuer_kyc_required
        )
        .filter(capabilities__contains=[CompanyCapability.ADMIN])
        .exists()
    ):
        return
    raise NotFound("Company not found or permission denied")


def company_administrative_access(company, actor):
    if actor is None or not actor.is_authenticated:
        return {"capabilities": [], "draft_setup": False}
    with use_operator(), _requester_principal(actor.pk):
        current_actor = get_user_model().objects.filter(pk=actor.pk, is_active=True, is_email_verified=True).first()
        if current_actor is None:
            return {"capabilities": [], "draft_setup": False}
        Operator.get()
        identity_required = Operator.objects.values_list("issuer_kyc_required", flat=True).get(pk=1)
        personal = CompanyAppointment.objects.current_for(
            current_actor, company.pk, at=timezone.now(), identity_required=identity_required
        ).values_list("capabilities", flat=True)
        capabilities = sorted({capability for scope in personal for capability in scope})
        draft_setup = (
            company.owner_id == current_actor.pk
            and company.status == CompanyStatus.DRAFT
            and not has_authority_root(company)
        )
        return {"capabilities": capabilities, "draft_setup": draft_setup}


def company_contact(company, actor, *, review=False):
    with use_operator(), _requester_principal(actor.pk):
        companies = Company.objects.administrable_by(actor)
        if review:
            if not get_user_model().objects.filter(pk=actor.pk, is_active=True, is_staff=True).exists():
                return None
            companies = Company.objects.all()
        contact = (
            companies.filter(pk=company.pk)
            .values("owner__email", "owner__userprofile__uuid", "owner__userprofile__full_name")
            .first()
        )
        if contact is None:
            return None
        return {
            "email": contact["owner__email"],
            "primary_contact": (
                {"full_name": contact["owner__userprofile__full_name"]}
                if contact["owner__userprofile__uuid"] is not None
                else None
            ),
        }
