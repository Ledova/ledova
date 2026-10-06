import json
from contextlib import contextmanager
from dataclasses import dataclass

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from rest_framework.exceptions import NotFound

from shared.db import current_alias, principal_of, use_operator
from users.exceptions import InvestorNotEligibleException
from users.models import UserAccount, UserProfile
from users.services.company_eligibility_consumption import company_eligibility
from wallets.models import Wallet

SETTING = "app.trading_admission"


@dataclass(frozen=True)
class TradingAdmission:
    decision: object | None
    command: dict | None
    reasons: tuple[str, ...]

    def require_current(self):
        if self.decision is None:
            raise InvestorNotEligibleException(self.reasons)


@contextmanager
def participant_context(actor):
    principal = principal_of() or ""
    if actor is None or not actor.is_authenticated or principal != str(actor.pk):
        raise NotFound("Trading participant not found.")
    operator_role = settings.RLS_ROLES["operator"]
    if operator_role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["migrate"]):
        raise ImproperlyConfigured("Trading admission requires a distinct configured operator role.")
    with use_operator():
        selected_db = connections[current_alias()]
        with selected_db.cursor() as cursor:
            cursor.execute("SELECT rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = %s", [operator_role])
            if cursor.fetchone() != (False, True):
                raise ImproperlyConfigured("Trading admission requires the configured pure operator role.")
            cursor.execute(
                "SELECT current_setting('role'), current_setting('app.user_id', true), current_setting(%s, true)",
                [SETTING],
            )
            previous_role, previous_principal, previous_command = cursor.fetchone()
        try:
            with selected_db.cursor() as cursor:
                cursor.execute(f"SET ROLE {selected_db.ops.quote_name(operator_role)}")
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, false), set_config(%s, '', false)", [principal, SETTING]
                )
            yield
        finally:
            with selected_db.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, false), set_config(%s, %s, false)",
                    [previous_principal or "", SETTING, previous_command or ""],
                )
                if previous_role == "none":
                    cursor.execute("RESET ROLE")
                else:
                    cursor.execute(f"SET ROLE {selected_db.ops.quote_name(previous_role)}")


def clear_admission():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT set_config(%s, '', true)", [SETTING])


def lock_participant(actor, account_id, wallet_id):
    if actor is None or not actor.is_authenticated or principal_of() != str(actor.pk):
        raise NotFound("Trading participant not found.")
    wallet = Wallet.objects.select_for_update(of=("self",), no_key=True).filter(pk=wallet_id).first()
    account = UserAccount.objects.select_for_update(of=("self",), no_key=True).filter(pk=account_id).first()
    if wallet is None or account is None or wallet.user_account_id != account.pk:
        raise NotFound("Trading participant not found.")
    profile_id = account.user_profile_id
    holder = get_user_model().objects.select_for_update(of=("self",), no_key=True).filter(pk=actor.pk).first()
    profile = UserProfile.objects.select_for_update(of=("self",), no_key=True).filter(pk=profile_id).first()
    if holder is None or profile is None or profile.user_id != holder.pk:
        raise NotFound("Trading participant not found.")
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT id FROM public.operators_operator WHERE id = 1 FOR SHARE")
        if cursor.fetchone() is None:
            raise NotFound("Trading configuration not found.")
    account.user_profile = profile
    wallet.user_account = account
    return account, wallet


def prepare_admission(
    actor,
    token,
    account,
    wallet,
    *,
    operation,
    target_id,
    challenge=None,
    submission=None,
    action=None,
    participant=None,
    signature=None,
    settlement_digest=None,
):
    account, wallet = lock_participant(actor, account.pk, wallet.pk)
    outcome = company_eligibility(account, token.company, purpose="secondary")
    if not outcome.is_eligible:
        return TradingAdmission(None, None, outcome.reasons)
    decision = outcome.decision
    request = decision.request
    command = {
        "version": 1,
        "operation": operation,
        "actor_id": str(actor.pk),
        "company_uuid": str(token.company_id),
        "token_uuid": str(token.pk),
        "owner_account_uuid": str(account.pk),
        "wallet_uuid": str(wallet.pk),
        "profile_uuid": str(account.user_profile_id),
        "source_uuid": str(request.source_id),
        "request_uuid": str(request.pk),
        "decision_uuid": str(decision.pk),
        "request_digest": request.digest,
        "decision_digest": decision.digest,
        "target_uuid": str(target_id),
    }
    if operation in ("create_order", "modify_order"):
        local = submission if operation == "create_order" else action
        name = "submission" if operation == "create_order" else "action"
        command.update(
            {
                name + "_uuid": str(local.pk),
                name + "_id": str(getattr(local, name + "_id")),
                "challenge_uuid": str(challenge.pk),
                "payment_asset_uuid": (
                    str(local.order.payment_asset_id) if action and local.order.payment_asset_id else None
                ),
            }
        )
        if submission is not None:
            from tokens.services.trading_order_create import _settlement_asset

            command["payment_asset_uuid"] = str(_settlement_asset().pk)
    else:
        command.update(participant=participant, signature=signature, settlement_digest=settlement_digest)
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT set_config(%s, %s, true)", [SETTING, json.dumps(command)])
        cursor.execute("SELECT public.tokens_lock_trading_admission(%s::jsonb)", [json.dumps(command)])
    outcome = company_eligibility(account, token.company, purpose="secondary", decision_id=decision.pk)
    return TradingAdmission(decision if outcome.is_eligible else None, command, outcome.reasons)


def eligibility_guard_refusal(exc):
    cause = exc.__cause__
    return (
        getattr(cause, "sqlstate", None) == "23514"
        and getattr(getattr(cause, "diag", None), "constraint_name", None) == "tokens_trading_eligibility_current"
    )
