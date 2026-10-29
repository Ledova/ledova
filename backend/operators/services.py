from typing import NamedTuple

from django.conf import settings
from django.urls import reverse
from django.utils import timezone

from companies.models import Company
from operators.models import Operator
from operators.settlement import deployment_on_chain
from tokens.models import (
    CapitalIncreaseRequest,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.tasks.deployment import PENDING_DEPLOYMENT_AGE
from users.models import InvestorClassification
from whitelist.models import WhitelistApproval, WhitelistEntry
from whitelist.services.identity import unnameable_addresses

SEVERITY_WARNING = "warning"
SEVERITY_DANGER = "danger"

OPERATOR_IDENTITY_FIELDS = ("name", "legal_name", "abn", "contact_email")

OPERATOR_INCOMPLETE = "Fill in {fields} on the operator row."
OPERATOR_COMPLETE = "Identity and contact details are recorded."
SETTING_MISSING = "{name} is not set, so the contract cannot be reached."
SETTING_PRESENT = "{name} is set."
NO_SETTLEMENT_ASSETS = "No settlement asset is supported. A fresh install starts this way; add one on the operator row."
SETTLEMENT_NOT_DEPLOYED = "{symbols} has no active deployment on {chain}."
SETTLEMENT_OK = "{count} settlement asset(s) deployed on {chain}."

REGISTRANT_NOTE = (
    "This records who keeps the register on this deployment. It does not decide who carries the section 168 "
    "obligation."
)


class WorklistRow(NamedTuple):

    label: str
    count: int
    url: str
    severity: str


class HealthCheck(NamedTuple):

    label: str
    ok: bool
    detail: str


class Registrant(NamedTuple):

    company: str
    acn: str
    registrant: str


def _changelist(app_label: str, model_name: str, query: str = "") -> str:
    return reverse(f"admin:{app_label}_{model_name}_changelist") + query


def worklist() -> list[WorklistRow]:
    cutoff = timezone.now() - PENDING_DEPLOYMENT_AGE
    unnameable = unnameable_addresses(ShareIssuance.objects.distinct_recipient_addresses())
    return [
        WorklistRow(
            "Company applications waiting",
            Company.objects.awaiting_review().count(),
            _changelist("companies", "company", "?status__in=submitted,review,info_required"),
            SEVERITY_WARNING,
        ),
        WorklistRow(
            "Investor classifications awaiting verification",
            InvestorClassification.objects.submitted().count(),
            _changelist("users", "investorclassification", "?status__exact=submitted"),
            SEVERITY_WARNING,
        ),
        WorklistRow(
            "Whitelist approvals pending",
            WhitelistApproval.objects.pending().count(),
            _changelist("whitelist", "whitelistentry", "?approvals__status__exact=pending"),
            SEVERITY_WARNING,
        ),
        WorklistRow(
            "Whitelist entries needing holder standing review",
            WhitelistEntry.objects.needing_standing_review().count(),
            _changelist("whitelist", "whitelistentry", "?holder_standing_review=yes"),
            SEVERITY_DANGER,
        ),
        WorklistRow(
            "Share issuance requests needing attention",
            ShareIssuanceRequest.objects.needing_attention().count(),
            _changelist("tokens", "shareissuancerequest", "?status__in=submitted,under_review,approved,failed"),
            SEVERITY_WARNING,
        ),
        WorklistRow(
            "Capital increase requests needing attention",
            CapitalIncreaseRequest.objects.needing_attention().count(),
            _changelist("tokens", "capitalincreaserequest", "?status__in=submitted,under_review,approved,failed"),
            SEVERITY_WARNING,
        ),
        WorklistRow(
            "Share tokens stuck deploying",
            ShareToken.objects.stuck_deploying(cutoff).count(),
            _changelist("tokens", "sharetoken", "?status__exact=deploying"),
            SEVERITY_DANGER,
        ),
        WorklistRow(
            "Allotment addresses with two wallets, so no member can be named",
            unnameable.ambiguous,
            _changelist("whitelist", "whitelistentry"),
            SEVERITY_DANGER,
        ),
        WorklistRow(
            "Allotment addresses with no named member behind them",
            unnameable.unidentified,
            _changelist("whitelist", "whitelistentry"),
            SEVERITY_DANGER,
        ),
    ]


def _identity_check(operator: Operator) -> HealthCheck:
    missing = [field for field in OPERATOR_IDENTITY_FIELDS if not getattr(operator, field)]
    if missing:
        return HealthCheck("Operator row", False, OPERATOR_INCOMPLETE.format(fields=", ".join(missing)))
    return HealthCheck("Operator row", True, OPERATOR_COMPLETE)


def _setting_check(name: str) -> HealthCheck:
    if getattr(settings, name, ""):
        return HealthCheck(name, True, SETTING_PRESENT.format(name=name))
    return HealthCheck(name, False, SETTING_MISSING.format(name=name))


def _settlement_check(operator: Operator) -> HealthCheck:
    assets = list(operator.supported_settlement_assets.all())
    if not assets:
        return HealthCheck("Settlement assets", False, NO_SETTLEMENT_ASSETS)
    chain = operator.receiving_wallet_chain
    undeployed = [asset.symbol for asset in assets if deployment_on_chain(asset, chain) is None]
    if undeployed:
        return HealthCheck(
            "Settlement assets", False, SETTLEMENT_NOT_DEPLOYED.format(symbols=", ".join(undeployed), chain=chain)
        )
    return HealthCheck("Settlement assets", True, SETTLEMENT_OK.format(count=len(assets), chain=chain))


def configuration_health() -> list[HealthCheck]:
    operator = Operator.get()
    return [
        _identity_check(operator),
        _setting_check("SHARE_TOKEN_FACTORY_ADDRESS"),
        _settlement_check(operator),
    ]


def registrants() -> list[Registrant]:
    keeper = Operator.get()
    name = keeper.legal_name or keeper.name
    return [
        Registrant(company.display_name, company.acn, name) for company in Company.objects.active().order_by("name")
    ]
