import json
from contextlib import contextmanager
from datetime import datetime
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from companies.models import Company
from companies.services.authority_requests import _requester_principal
from integrations.base_chain import get_base_chain_client
from shared.db import APP_ALIAS, atomic, current_alias, principal_of, use_operator
from users.models import CompanyEligibilityDecision, InvestorCategory
from users.services.company_eligibility import _configuration, _evidence_hash
from users.services.investor_classification import require_evidence_retention_policy
from whitelist.exceptions import WhitelistChangeConflict
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistEligibilityInvalidation,
    WhitelistEntry,
    WhitelistInvalidationCause,
)
from whitelist.services import changes
from whitelist.services.whitelist import open_approval, registry_for

SETTING = "app.whitelist_invalidation"
GENERAL = (InvestorCategory.ACCOUNTANT_CERTIFICATE, InvestorCategory.PROFESSIONAL_INVESTOR)
RETAINED = (
    WhitelistInvalidationCause.STANDING_LOSS,
    WhitelistInvalidationCause.IDENTITY_LOSS,
    WhitelistInvalidationCause.WALLET_REMOVAL,
)


@contextmanager
def _invalidation_operator_context(principal):
    operator_role = settings.RLS_ROLES["operator"]
    if operator_role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["migrate"]):
        raise ImproperlyConfigured("Eligibility invalidation requires a distinct configured operator role.")
    original_connection = connections[current_alias()]
    with use_operator():
        selected_db = connections[current_alias()]
        if original_connection.in_atomic_block and original_connection is not selected_db:
            raise WhitelistChangeConflict("The original invalidation write must use one operator transaction.")
        with selected_db.cursor() as cursor:
            cursor.execute("SELECT rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = %s", [operator_role])
            if cursor.fetchone() != (False, True):
                raise ImproperlyConfigured("Eligibility invalidation requires the configured pure operator role.")
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
            yield selected_db
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


@contextmanager
def invalidation_writer_context(actor=None):
    principal = principal_of() or ""
    if actor is None:
        if principal:
            raise PermissionDenied("An authenticated human cannot be relabelled as automation.")
    elif not actor.is_authenticated or principal != str(actor.pk):
        raise PermissionDenied("Record invalidation as its actual human principal.")
    with _invalidation_operator_context(principal), atomic():
        yield


@contextmanager
def invalidation_worker_context():
    if principal_of():
        raise PermissionDenied("An authenticated human cannot be relabelled as automation.")
    original_connection = connections[current_alias()]
    if original_connection.in_atomic_block or not original_connection.get_autocommit():
        raise WhitelistChangeConflict("Run invalidation work outside the original write transaction.")
    with _invalidation_operator_context("") as selected_db:
        if selected_db.in_atomic_block or not selected_db.get_autocommit():
            raise WhitelistChangeConflict("Run invalidation work outside the original write transaction.")
        yield


def record_invalidation(account_id, cause, *, actor=None, wallet_id=None, address="", cause_fields=()):
    selected_db = connections[current_alias()]
    if current_alias() == APP_ALIAS or not selected_db.in_atomic_block:
        raise WhitelistChangeConflict("Record invalidation in the original bounded operator transaction.")
    if cause not in RETAINED:
        raise WhitelistChangeConflict("This cause already has its own retained eligibility record.")
    if (principal_of() or "") != (str(actor.pk) if actor is not None else ""):
        raise PermissionDenied("Retain the actual human principal or explicit automation.")
    with selected_db.cursor() as cursor:
        cursor.execute(
            "SELECT whitelist_eligibility_invalidation_facts(%s, %s, %s)",
            [account_id, wallet_id, settings.BLOCKCHAIN_CHAIN_ID],
        )
        facts = cursor.fetchone()[0]
    facts = json.loads(facts) if isinstance(facts, str) else facts
    if facts is None:
        raise WhitelistChangeConflict("The invalidated account or configuration is unavailable.")
    record = WhitelistEligibilityInvalidation.objects.create(
        user_account_id=account_id,
        cause=cause,
        chain_id=settings.BLOCKCHAIN_CHAIN_ID,
        initiated_by=actor,
        wallet_id=wallet_id,
        address=address.lower(),
        facts=facts,
        cause_fields=sorted(cause_fields),
        invalidated_at=timezone.now(),
    )
    record.refresh_from_db()
    return record


def retained_cause(decision_id, cause, invalidation_id=None):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT whitelist_eligibility_invalidation_cause(%s, %s, %s)", [decision_id, cause, invalidation_id]
        )
        value = cursor.fetchone()[0]
    return json.loads(value) if isinstance(value, str) else value


def candidates(account_id, company_id):
    return CompanyEligibilityDecision.objects.filter(
        request__user_account_id=account_id,
        request__company_id=company_id,
        request__category__in=GENERAL,
        outcome="accepted",
    ).select_related("request__source")


def has_live_general_decision(account_id, company_id, *, decision_id=None):
    _configuration()
    require_evidence_retention_policy()
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT users_company_eligibility_certificate_time_zone()")
        if cursor.fetchone()[0] != settings.TIME_ZONE:
            raise WhitelistChangeConflict("Certificate configuration changed; install its guard migration.")
    selected = candidates(account_id, company_id)
    if decision_id is not None:
        selected = selected.filter(pk=decision_id)
    for decision in selected.order_by("request__source_id", "request_id", "uuid"):
        try:
            evidence_hash = _evidence_hash(decision.request.source)
        except ValidationError:
            evidence_hash = None
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT users_company_eligibility_decision_facts_current("
                "%s, %s, %s, 'secondary', NULL, NULL, clock_timestamp())",
                [decision.pk, account_id, company_id],
            )
            metadata_live = cursor.fetchone()[0] is True
        if metadata_live:
            if evidence_hash != decision.request.evidence_hash:
                raise WhitelistChangeConflict("A current decision's retained evidence needs reconciliation.")
            return True
    return False


def command_for(target, *, cause=None, decision_id=None, invalidation_id=None):
    account_id = target.get("account")
    if account_id is None:
        return None
    event = None
    if invalidation_id is not None:
        event = WhitelistEligibilityInvalidation.objects.filter(pk=invalidation_id, user_account_id=account_id).first()
    elif cause in RETAINED or cause is None:
        events = WhitelistEligibilityInvalidation.objects.filter(user_account_id=account_id)
        if cause is not None:
            events = events.filter(cause=cause)
        for candidate in events.order_by("-invalidated_at", "uuid"):
            if any(
                recorded["company"] == target["company"]
                and recorded["registry"] == target["registry"].lower()
                and recorded["wallet"] == target.get("wallet")
                and recorded["address"] == target["address"].lower()
                for recorded in candidate.facts["targets"]
            ):
                event = candidate
                break
    if event is not None:
        if event.chain_id != target.get("chain_id", settings.BLOCKCHAIN_CHAIN_ID):
            return None
        if event.cause == WhitelistInvalidationCause.WALLET_REMOVAL and (
            str(event.wallet_id) != target.get("wallet") or event.address != target["address"].lower()
        ):
            return None
        cause = event.cause
        invalidation_id = event.pk
        if decision_id is None:
            decision_id = (
                candidates(account_id, target["company"])
                .order_by("-decided_at", "uuid")
                .values_list("uuid", flat=True)
                .first()
            )
    else:
        invalidation_id = None
        options = (
            (cause,)
            if cause is not None
            else (
                WhitelistInvalidationCause.COMPANY_REVOCATION,
                WhitelistInvalidationCause.REQUEST_WITHDRAWAL,
                WhitelistInvalidationCause.SOURCE_WITHDRAWAL,
                WhitelistInvalidationCause.EXPIRY,
                WhitelistInvalidationCause.EVIDENCE_PURGE,
            )
        )
        decisions = candidates(account_id, target["company"])
        if decision_id is not None:
            decisions = decisions.filter(pk=decision_id)
        matched = None
        for decision in decisions.order_by("-decided_at", "uuid"):
            for option in options:
                if retained_cause(decision.pk, option) is not None:
                    matched = decision.pk, option
                    break
            if matched is not None:
                break
        if matched is None:
            return None
        decision_id, cause = matched
    history = retained_cause(decision_id, cause, invalidation_id)
    if history is None:
        return None
    return {
        "version": 1,
        "chain_id": target.get("chain_id", settings.BLOCKCHAIN_CHAIN_ID),
        "operation": "remove",
        "company": str(UUID(target["company"])),
        "account": str(UUID(account_id)),
        "wallet": str(UUID(target["wallet"])) if target.get("wallet") is not None else None,
        "address": target["address"].lower(),
        "registry": target["registry"].lower(),
        "decision": str(decision_id) if decision_id is not None else None,
        "invalidation": str(invalidation_id) if invalidation_id is not None else None,
        "cause": cause,
        "actor": history["actor"],
    }


@contextmanager
def invalidation_command(command):
    selected_db = connections[current_alias()]
    with _requester_principal(""):
        with selected_db.cursor() as cursor:
            cursor.execute("SELECT current_setting(%s, true)", [SETTING])
            previous = cursor.fetchone()[0]
            cursor.execute("SELECT set_config(%s, %s, true)", [SETTING, json.dumps(command)])
        try:
            with atomic():
                yield
        finally:
            with selected_db.cursor() as cursor:
                cursor.execute("SELECT set_config(%s, %s, true)", [SETTING, previous or ""])


def _same_change(change, command, intent, history):
    expected = {
        "action": WhitelistAction.REMOVE,
        "address": command["address"],
        "chain_id": intent["chain_id"],
        "registry_address": intent["to"],
        "company_id": UUID(command["company"]),
        "expires_at": None,
        "intent": intent,
        "initiated_by_id": int(command["actor"]) if command["actor"] is not None else None,
        "authority": WhitelistAuthority.CLASSIFICATION_REFRESH,
        "requested_wallet_id": None,
        "eligibility_decision_id": UUID(command["decision"]) if command["decision"] is not None else None,
        "eligibility_invalidation_id": UUID(command["invalidation"]) if command["invalidation"] is not None else None,
        "invalidation_cause": command["cause"],
        "invalidated_at": datetime.fromisoformat(history["at"]),
    }
    if any(getattr(change, field) != value for field, value in expected.items()):
        raise WhitelistChangeConflict("This submission already records a different invalidation or target.")
    return expected


def admit_invalidation(submission_id, command):
    company = Company.objects.get(pk=command["company"])
    registry = registry_for(company, get_base_chain_client())
    if registry != command["registry"]:
        raise WhitelistChangeConflict("The captured company registry changed.")
    intent = changes._intent(WhitelistAction.REMOVE, command["address"], registry, None)
    if intent["chain_id"] != command["chain_id"]:
        raise WhitelistChangeConflict("The captured chain configuration changed.")
    with changes.target_transaction(intent["chain_id"], registry, command["address"]), invalidation_command(command):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT whitelist_lock_eligibility_invalidation(%s::jsonb)", [json.dumps(command)])
        history = retained_cause(command["decision"], command["cause"], command["invalidation"])
        previous = WhitelistChange.objects.filter(pk=submission_id).first()
        if previous is not None:
            _same_change(previous, command, intent, history)
            return previous
        if WhitelistChange.objects.for_target(intent["chain_id"], registry, command["address"]).unresolved().exists():
            raise WhitelistChangeConflict("Recover the original unresolved whitelist change first.")
        if command["cause"] != WhitelistInvalidationCause.WALLET_REMOVAL and has_live_general_decision(
            command["account"], command["company"]
        ):
            return None
        entry = WhitelistEntry.objects.filter(wallet_id=command["wallet"]).first() if command["wallet"] else None
        change = WhitelistChange(
            pk=submission_id,
            action=WhitelistAction.REMOVE,
            address=command["address"],
            chain_id=intent["chain_id"],
            registry_address=registry,
            company_id=company.pk,
            intent=intent,
            initiated_by_id=int(command["actor"]) if command["actor"] is not None else None,
            authority=WhitelistAuthority.CLASSIFICATION_REFRESH,
            entry_id=entry.pk if entry else None,
            eligibility_decision_id=command["decision"],
            eligibility_invalidation_id=command["invalidation"],
            invalidation_cause=command["cause"],
            invalidated_at=datetime.fromisoformat(history["at"]),
        )
        change.save(force_insert=True)
        if entry is not None:
            open_approval(entry, company, registry)
        return change
