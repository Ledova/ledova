from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError

from companies.models import Company, CompanyStatus, RegistryCheckStatus
from companies.services.administration import (
    company_operation,
    lock_company_actor,
    require_company_administration,
)
from companies.validators import (
    ABN_DOES_NOT_CARRY_ACN,
    abn_carries_acn,
    checked_abn,
    checked_acn,
)
from shared.db import atomic
from users.models import UserAccount, UserProfile
from wallets.models import Wallet

IDENTIFIERS = frozenset({"acn", "abn", "company_type"})
DECLARATION_FIELDS = frozenset({"declarant_name", "board_resolution_reference"})
REVIEWED_FIELDS = IDENTIFIERS | DECLARATION_FIELDS | {"name"}
EDITABLE_FIELDS = REVIEWED_FIELDS | {
    "trading_name",
    "phone",
    "address_line_1",
    "address_line_2",
    "city",
    "state",
    "postcode",
    "country",
    "description",
    "industry",
    "founded_year",
    "operator_wallet",
    "is_open_to_investors",
}


def update_company(company, changes, *, actor):
    with company_operation(actor, company.pk, "edit"), atomic():
        company = get_object_or_404(Company.objects.select_for_update(), pk=company.pk)
        selected_wallet = changes.get("operator_wallet")
        if selected_wallet is not None and selected_wallet.pk != company.operator_wallet_id:
            wallet = (
                Wallet.objects.owned_by(actor)
                .verified_evm()
                .select_for_update(of=("self",), no_key=True)
                .filter(pk=selected_wallet.pk)
                .first()
            )
            account = (
                UserAccount.objects.select_for_update(no_key=True).filter(pk=wallet.user_account_id).first()
                if wallet
                else None
            )
            profile_id = account.user_profile_id if account else None
            if profile_id is None or not UserProfile.objects.filter(pk=profile_id, user_id=actor.pk).exists():
                raise ValidationError({"operator_wallet": "Select one of your current verified EVM wallets."})
            current_actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=actor.pk)
            wallet_profile = UserProfile.objects.select_for_update().filter(pk=profile_id).first()
            if wallet_profile is None or wallet_profile.user_id != current_actor.pk:
                raise ValidationError({"operator_wallet": "Select one of your current verified EVM wallets."})
            changes = {**changes, "operator_wallet": wallet}
        current, current_actor, profile, operator = lock_company_actor(actor, company.pk)
        require_company_administration(current, current_actor, profile, operator)
        return _update_company(current, changes, current_actor)


def _update_company(current, changes, actor):
    forbidden = changes.keys() - EDITABLE_FIELDS
    if forbidden:
        raise ValidationError({field: "Use the explicit company review action." for field in sorted(forbidden)})
    changes = {field: value for field, value in changes.items() if getattr(current, field) != value}
    if changes.get("operator_wallet") is not None:
        wallet = changes["operator_wallet"]
        if not Wallet.objects.owned_by(actor).verified_evm().filter(pk=wallet.pk).exists():
            raise ValidationError({"operator_wallet": "Select one of your current verified EVM wallets."})
        changes["operator_wallet"] = wallet
    if current.status != CompanyStatus.DRAFT and changes.keys() & IDENTIFIERS:
        raise ValidationError(
            {field: "Cannot be changed after registration is submitted." for field in changes.keys() & IDENTIFIERS}
        )
    if current.status not in (CompanyStatus.DRAFT, CompanyStatus.INFO_REQUIRED) and changes.keys() & (
        DECLARATION_FIELDS | {"name"}
    ):
        raise ValidationError(
            {
                field: "Request information before correcting the registered identity or declaration."
                for field in changes.keys() & (DECLARATION_FIELDS | {"name"})
            }
        )
    if "acn" in changes:
        changes["acn"] = checked_acn(changes["acn"])
    if "abn" in changes:
        changes["abn"] = checked_abn(changes["abn"])
    for field, value in changes.items():
        setattr(current, field, value)
    if current.abn and not abn_carries_acn(current.abn, current.acn):
        raise ValidationError({"abn": ABN_DOES_NOT_CARRY_ACN})
    fields = [*changes, "updated_at"]
    if changes.keys() & REVIEWED_FIELDS:
        current.lifecycle_revision += 1
        current.registry_status = RegistryCheckStatus.PENDING
        current.registry_reason = "identity_changed"
        fields.extend(["lifecycle_revision", "registry_status", "registry_reason"])
    if changes:
        current.save(update_fields=fields)
    return current
