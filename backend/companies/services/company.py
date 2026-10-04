import logging

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from companies.exceptions import (
    OfficeholderAttestationRequiredException,
    RegistryVerificationRequiredException,
)
from companies.identity import officeholder_declaration
from companies.models import (
    Company,
    CompanyStatus,
    RegistryCheckPurpose,
)
from companies.services.administration import company_operation, lock_company_actor
from companies.services.editing import EDITABLE_FIELDS
from companies.services.registry import begin_registry_check, perform_registry_check
from companies.validators import (
    ABN_DOES_NOT_CARRY_ACN,
    abn_carries_acn,
    checked_abn,
    checked_acn,
)
from shared.constants import normalize_chain
from shared.db import atomic
from users.models import UserProfile
from wallets.models import Wallet
from wallets.models.wallet import Blockchain

logger = logging.getLogger(__name__)


def primary_wallet_for(company: Company, chain: str | None = None):
    chain = normalize_chain(chain or Blockchain.BASE.value)
    if company.operator_wallet:
        return company.operator_wallet if company.operator_wallet.chain == chain else None

    return Wallet.objects.owned_by(company.owner).verified_for_chain(chain)


def register_company(owner, name: str, acn: str, primary_contact_data: dict, **kwargs) -> Company:
    if kwargs.keys() - (EDITABLE_FIELDS - {"operator_wallet", "declarant_name", "board_resolution_reference"}):
        raise PermissionDenied("Registration records an owner draft without review or provider results.")
    acn = checked_acn(acn)
    abn = checked_abn(kwargs.get("abn", ""))
    if abn and not abn_carries_acn(abn, acn):
        raise ValidationError({"abn": ABN_DOES_NOT_CARRY_ACN})
    company = Company(owner=owner, name=name, acn=acn, **{**kwargs, "abn": abn})
    with company_operation(owner, company.pk, "register"), atomic():
        owner = get_user_model().objects.select_for_update().get(pk=owner.pk)
        if not owner.is_active or not owner.is_email_verified:
            raise PermissionDenied("Registration requires your current active, email-verified account.")
        UserProfile.objects.select_for_update().filter(user=owner).first()
        company.owner = owner
        company.save(force_insert=True)
        full_name = f"{primary_contact_data['first_name']} {primary_contact_data['last_name']}".strip()
        UserProfile.objects.update_or_create(user=owner, defaults={"full_name": full_name})
    logger.info(f"Registered new company: {company.name} (ACN: {acn})")
    return company


def _attest_officeholder(company, actor, declaration):
    if (
        declaration.get("attest_officeholder") is not True
        or not declaration.get("declarant_name", "").strip()
        or not declaration.get("board_resolution_reference", "").strip()
    ):
        raise OfficeholderAttestationRequiredException()
    company.declarant_name = declaration["declarant_name"].strip()
    company.board_resolution_reference = declaration["board_resolution_reference"].strip()
    if len(company.declarant_name) > 255 or len(company.board_resolution_reference) > 255:
        raise OfficeholderAttestationRequiredException()
    company.officeholder_attested_by = actor
    company.officeholder_attested_at = timezone.now()
    company.officeholder_attestation = officeholder_declaration(company)
    company.lifecycle_revision += 1
    company.save(
        update_fields=[
            "declarant_name",
            "board_resolution_reference",
            "officeholder_attested_by",
            "officeholder_attested_at",
            "officeholder_attestation",
            "lifecycle_revision",
            "updated_at",
        ]
    )


ACTIVE_METHODS = {
    CompanyStatus.WARNING: "resolve_warning",
    CompanyStatus.SUSPENDED: "reinstate",
}


def _registry_transition(company, method, actor, declaration, admin_review):
    operation = "admin_workflow" if admin_review else "workflow"
    with company_operation(actor, company.pk, operation), atomic(durable=True):
        current, actor, _profile, _operator = lock_company_actor(actor, company.pk)
        _require_workflow_actor(current, actor, method, admin_review)
        if method == "retry_registry":
            current._require_status(
                [CompanyStatus.ACTIVE, CompanyStatus.WARNING, CompanyStatus.SUSPENDED],
                CompanyStatus.ACTIVE,
            )
            purpose = RegistryCheckPurpose.RETRY
        else:
            allowed = [state for state, transition in ACTIVE_METHODS.items() if method in (transition, "set_active")]
            current._require_status(allowed, CompanyStatus.ACTIVE)
            method = ACTIVE_METHODS[current.status]
            if declaration:
                _attest_officeholder(current, actor, declaration)
            if not current.has_initial_activation_provenance:
                current._require_attestation()
            purpose = RegistryCheckPurpose.ACTIVATION
        check = begin_registry_check(current, purpose, actor)
    check = perform_registry_check(check)
    if purpose != RegistryCheckPurpose.ACTIVATION:
        return Company.objects.get(pk=company.pk)
    with company_operation(actor, company.pk, operation), atomic(durable=True):
        current, actor, _profile, _operator = lock_company_actor(actor, company.pk)
        _require_workflow_actor(current, actor, method, admin_review)
        if current.registry_check_id != check.pk:
            raise RegistryVerificationRequiredException()
        getattr(current, method)()
    return current


def _require_workflow_actor(company, actor, method, admin_review=False):
    if not actor.is_active or not actor.is_staff:
        raise PermissionDenied("A current active staff account is required for technical company recovery.")
    if admin_review and not actor.has_perm("companies.change_company"):
        raise PermissionDenied("Company recovery requires the current model change permission.")


def transition_company(
    company: Company, method: str, *, actor=None, declaration=None, admin_review=False, **kwargs
) -> Company:
    if actor is None:
        raise PermissionDenied("An authenticated company actor is required.")
    registry_methods = {"retry_registry", "set_active", *ACTIVE_METHODS.values()}
    if method not in registry_methods | {"issue_warning", "suspend", "delist"}:
        raise PermissionDenied("Company activation is instructed by a current personal company administrator.")
    if method in registry_methods:
        return _registry_transition(company, method, actor, declaration, admin_review)
    with company_operation(actor, company.pk, "admin_workflow" if admin_review else "workflow"), atomic():
        current, actor, _profile, _operator = lock_company_actor(actor, company.pk)
        _require_workflow_actor(current, actor, method, admin_review)
        getattr(current, method)(**kwargs)
    return current
