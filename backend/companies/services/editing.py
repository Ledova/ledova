from rest_framework.exceptions import ValidationError

from companies.models import CompanyStatus, RegistryCheckStatus
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
        current, current_actor, profile, operator = lock_company_actor(actor, company.pk)
        require_company_administration(current, current_actor, profile, operator)
        return _update_company(current, changes, current_actor)


def _update_company(current, changes, actor):
    forbidden = changes.keys() - EDITABLE_FIELDS
    if forbidden:
        raise ValidationError({field: "Use the explicit company review action." for field in sorted(forbidden)})
    changes = {field: value for field, value in changes.items() if getattr(current, field) != value}
    if changes.get("operator_wallet") is not None:
        wallet = Wallet.objects.select_for_update().filter(pk=changes["operator_wallet"].pk).first()
        if wallet is None or not Wallet.objects.owned_by(actor).verified_evm().filter(pk=wallet.pk).exists():
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
