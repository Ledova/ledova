import json
import logging
from uuid import NAMESPACE_URL, uuid5

from django.conf import settings
from django.db import connections
from django.utils import timezone
from web3 import Web3

from shared.db import current_alias, on_commit
from users.models import CompanyEligibilityDecision, InvestorClassification
from whitelist.constants import WHITELIST_NO_EXPIRY, WHITELIST_REFRESH_LIMIT
from whitelist.exceptions import WhitelistRemovalPending
from whitelist.models import (
    WhitelistApproval,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistInvalidationCause,
)
from whitelist.services import changes
from whitelist.services.eligibility_invalidation import (
    command_for,
    invalidation_worker_context,
    record_invalidation,
)
from whitelist.services.whitelist import registry_contract

logger = logging.getLogger(__name__)


def observed_expiry(registry_address, address, client=None):
    contract = registry_contract(registry_address, client)
    expiry = contract.functions.expiresAt(Web3.to_checksum_address(address)).call()
    if type(expiry) is not int or not 0 <= expiry <= WHITELIST_NO_EXPIRY:
        raise ValueError("The registry did not answer with a uint64 expiry.")
    return expiry


def _approvals(**filters):
    return WhitelistApproval.objects.filter(**filters).select_related("entry__wallet", "company")


def targets_for(approvals):
    return [
        {
            "address": approval.entry.wallet_address.lower(),
            "company": str(approval.company_id),
            "registry": approval.registry_address,
            "chain_id": settings.BLOCKCHAIN_CHAIN_ID,
            "wallet": str(approval.entry.wallet_id) if approval.entry.wallet_id else None,
            "account": str(approval.entry.wallet.user_account_id) if approval.entry.wallet_id else None,
        }
        for approval in approvals
    ]


def targets_for_account(account_id):
    return targets_for(_approvals(entry__wallet__user_account_id=account_id))


def targets_for_wallet(wallet_id):
    return targets_for(_approvals(entry__wallet_id=wallet_id))


def _target_with_account(target):
    if "account" in target and "wallet" in target:
        return target
    approval = (
        _approvals(company_id=target["company"], registry_address=target["registry"])
        .filter(entry__wallet__address__iexact=target["address"])
        .first()
    )
    return targets_for([approval])[0] if approval is not None else target


def _recover_target(target):
    unresolved = WhitelistChange.objects.for_target(
        target.get("chain_id", settings.BLOCKCHAIN_CHAIN_ID), target["registry"], target["address"]
    ).unresolved()
    for change in unresolved.order_by("created_at", "uuid"):
        recovered = changes.recover(change.pk)
        if recovered.status not in changes.TERMINAL:
            raise WhitelistRemovalPending("The original whitelist change still requires recovery.")


def _submission_id(command):
    previous_failed = (
        WhitelistChange.objects.for_target(command["chain_id"], command["registry"], command["address"])
        .filter(status=WhitelistChangeStatus.FAILED)
        .order_by("-created_at", "uuid")
        .values_list("uuid", flat=True)
        .first()
    )
    identity = json.dumps(command, sort_keys=True, separators=(",", ":"))
    return uuid5(NAMESPACE_URL, f"ledova:eligibility-invalidation:{identity}:{previous_failed or ''}")


def _refresh_target(target, *, cause=None, decision_id=None, invalidation_id=None, client=None):
    target = _target_with_account(target)
    _recover_target(target)
    expiry = observed_expiry(target["registry"], target["address"], client)
    if expiry <= int(timezone.now().timestamp()):
        return None, False
    command = command_for(target, cause=cause, decision_id=decision_id, invalidation_id=invalidation_id)
    if command is None:
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM users_companyeligibilitydecision decision "
                "JOIN users_companyeligibilityrequest proposal ON proposal.uuid = decision.request_id "
                "WHERE proposal.user_account_id = %s AND proposal.company_id = %s "
                "AND users_company_eligibility_decision_facts_current("
                "decision.uuid, proposal.user_account_id, proposal.company_id, "
                "'secondary', NULL, NULL, clock_timestamp()))",
                [target.get("account"), target["company"]],
            )
            if cursor.fetchone()[0] is True:
                return None, False
        logger.error(
            "Whitelist removal lacks retained cause: company=%s registry=%s", target["company"], target["registry"]
        )
        return None, True
    change = changes.submit_invalidation(_submission_id(command), command)
    if change is not None and change.status not in (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED):
        raise WhitelistRemovalPending("The admitted whitelist removal still requires recovery.")
    return change, False


def refresh_approval(approval, actor=None, client=None, *, cause=None, decision_id=None, invalidation_id=None):
    change, _ = _refresh_target(
        targets_for([approval])[0],
        cause=cause,
        decision_id=decision_id,
        invalidation_id=invalidation_id,
        client=client,
    )
    return change


def refresh_targets(targets, actor=None, remove_only=False, *, cause=None, decision_id=None, invalidation_id=None):
    with invalidation_worker_context():
        result = {"checked": 0, "submitted": 0, "unattributed": 0, "errors": 0}
        for target in targets:
            result["checked"] += 1
            try:
                change, unattributed = _refresh_target(
                    target, cause=cause, decision_id=decision_id, invalidation_id=invalidation_id
                )
                result["submitted"] += int(change is not None)
                result["unattributed"] += int(unattributed)
            except Exception:
                result["errors"] += 1
                logger.exception(
                    "Whitelist invalidation failed: company=%s registry=%s", target["company"], target["registry"]
                )
        if result["errors"]:
            raise WhitelistRemovalPending("One or more retained removals still require recovery.")
        return result


def _defer(targets, *, delay=0, cause=None, decision_id=None, invalidation_id=None):
    from whitelist.tasks import refresh_whitelist_targets

    if not targets:
        return
    task = refresh_whitelist_targets.configure(schedule_in={"seconds": delay}) if delay else refresh_whitelist_targets
    task.defer(
        targets=targets,
        cause=cause,
        decision_id=str(decision_id) if decision_id is not None else None,
        invalidation_id=str(invalidation_id) if invalidation_id is not None else None,
    )


def enqueue_for_decision(decision_id, cause, delay=0):
    def enqueue():
        decision = CompanyEligibilityDecision.objects.select_related("request").get(pk=decision_id)
        targets = targets_for(
            _approvals(
                entry__wallet__user_account_id=decision.request.user_account_id, company_id=decision.request.company_id
            )
        )
        _defer(targets, delay=delay, cause=cause, decision_id=decision.pk)

    on_commit(enqueue)


def enqueue_for_source(source_id, cause, delay=0):
    def enqueue():
        source = InvestorClassification.objects.get(pk=source_id)
        decisions = CompanyEligibilityDecision.objects.filter(request__source=source, outcome="accepted")
        for decision in decisions:
            enqueue_for_decision(decision.pk, cause, delay)

    on_commit(enqueue)


def enqueue_for_account(
    account_id, actor=None, delay=0, *, cause=WhitelistInvalidationCause.STANDING_LOSS, cause_fields
):
    record = record_invalidation(account_id, cause, actor=actor, cause_fields=cause_fields)
    on_commit(lambda: _defer(targets_for_account(account_id), delay=delay, cause=cause, invalidation_id=record.pk))
    return record


def enqueue_for_wallet(wallet_id, actor, delay=0, remove_only=False):
    from wallets.models import Wallet

    wallet = Wallet.objects.get(pk=wallet_id)
    targets = targets_for_wallet(wallet_id)
    record = record_invalidation(
        wallet.user_account_id,
        WhitelistInvalidationCause.WALLET_REMOVAL,
        actor=actor,
        wallet_id=wallet.pk,
        address=wallet.address,
    )
    on_commit(
        lambda: _defer(targets, delay=delay, cause=WhitelistInvalidationCause.WALLET_REMOVAL, invalidation_id=record.pk)
    )
    return record


def sweep():
    with invalidation_worker_context():
        result = {"checked": 0, "submitted": 0, "unattributed": 0, "errors": 0}
        approvals = _approvals().order_by("updated_at", "uuid")
        for approval in approvals.iterator():
            if result["submitted"] >= WHITELIST_REFRESH_LIMIT:
                break
            result["checked"] += 1
            try:
                change, unattributed = _refresh_target(targets_for([approval])[0])
                result["submitted"] += int(change is not None)
                result["unattributed"] += int(unattributed)
            except Exception:
                result["errors"] += 1
                logger.exception("Whitelist invalidation failed: approval=%s", approval.pk)
        return result
