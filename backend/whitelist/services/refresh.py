import logging
from datetime import datetime
from datetime import timezone as dt_timezone
from uuid import uuid4

from django.conf import settings
from django.utils import timezone
from web3 import Web3

from companies.models import Company
from users.models import (
    InvestorClassification,
    InvestorClassificationStatus,
    UserAccount,
)
from users.services.eligibility import NO_LIVE_CLASSIFICATION, account_eligibility
from whitelist.constants import WHITELIST_NO_EXPIRY, WHITELIST_REFRESH_LIMIT
from whitelist.models import (
    WhitelistAction,
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistStatus,
)
from whitelist.services import changes
from whitelist.services.whitelist import registry_contract

logger = logging.getLogger(__name__)
STAFF_ENTERED = "staff_entered"
REVIEWED = [InvestorClassificationStatus.VERIFIED, InvestorClassificationStatus.REVOKED]


def _investor_account(entry):
    if not entry.wallet_id:
        return None
    return UserAccount.objects.investing().filter(pk=entry.wallet.user_account_id).first()


def _live_classifications(account, company):
    return InvestorClassification.objects.filter(user_account=account).live().for_company(company)


def wanted_expiry(approval):
    account = _investor_account(approval.entry)
    if account is None:
        return STAFF_ENTERED
    if not account_eligibility(account, approval.company).is_eligible:
        return 0
    expiries = [claim.expires_at for claim in _live_classifications(account, approval.company)]
    if not expiries:
        return 0
    if any(expiry is None for expiry in expiries):
        return WHITELIST_NO_EXPIRY
    return int(max(expiries).replace(microsecond=0).timestamp())


def observed_expiry(registry_address, address, client=None):
    contract = registry_contract(registry_address, client)
    expiry = contract.functions.expiresAt(Web3.to_checksum_address(address)).call()
    if type(expiry) is not int or not 0 <= expiry <= WHITELIST_NO_EXPIRY:
        raise ValueError("The registry did not answer with a uint64 expiry.")
    return expiry


def recorded_expiry(approval, client=None):
    if approval.status == WhitelistStatus.REMOVED:
        return 0
    if approval.status == WhitelistStatus.ACTIVE:
        return changes.on_chain_expiry(WhitelistAction.ADD, approval.expires_at)
    return observed_expiry(approval.registry_address, approval.entry.wallet_address, client)


def _effective(expiry, moment):
    return 0 if expiry <= moment else expiry


def _unresolved(registry_address, address):
    return (
        WhitelistChange.objects.for_target(settings.BLOCKCHAIN_CHAIN_ID, registry_address, address)
        .unresolved()
        .exists()
    )


def needed_expiry(approval, client=None):
    wanted = wanted_expiry(approval)
    if wanted is STAFF_ENTERED:
        return None
    if _unresolved(approval.registry_address, approval.entry.wallet_address):
        return None
    moment = int(timezone.now().timestamp())
    if _effective(wanted, moment) == _effective(recorded_expiry(approval, client), moment):
        return None
    return wanted


def _submit(address, company, wallet_id, wanted, actor):
    action = WhitelistAction.REMOVE if wanted == 0 else WhitelistAction.ADD
    expires_at = None if wanted == WHITELIST_NO_EXPIRY else datetime.fromtimestamp(wanted, tz=dt_timezone.utc)
    change = changes.submit(
        uuid4(),
        action,
        address,
        actor,
        company=company,
        expires_at=None if action == WhitelistAction.REMOVE else expires_at,
        authority=WhitelistAuthority.CLASSIFICATION_REFRESH,
        wallet_uuid=wallet_id if action == WhitelistAction.ADD else None,
    )
    if change.status == WhitelistChangeStatus.FAILED:
        logger.error(
            "A whitelist refresh failed and leaves the approval unconfirmed: submission=%s action=%s",
            change.pk,
            change.action,
        )
    return change


def refresh_approval(approval, actor, client=None):
    wanted = needed_expiry(approval, client)
    if wanted is None:
        return None
    return _submit(approval.entry.wallet_address, approval.company, approval.entry.wallet_id, wanted, actor)


def _deciding_actor(approval, wanted):
    account = _investor_account(approval.entry)
    if account is None:
        return None
    if wanted == 0 and account_eligibility(account, approval.company).reasons != (NO_LIVE_CLASSIFICATION,):
        return None
    reviewed = (
        InvestorClassification.objects.filter(user_account=account, status__in=REVIEWED, reviewed_by__isnull=False)
        .for_company(approval.company)
        .select_related("reviewed_by")
        .order_by("-reviewed_at")
        .first()
    )
    actor = reviewed.reviewed_by if reviewed else None
    if actor is None or not actor.is_active or not actor.is_staff:
        return None
    return actor


def _approvals(**filters):
    return WhitelistApproval.objects.filter(**filters).select_related("entry__wallet", "company")


def targets_for(approvals):
    return [
        {
            "address": approval.entry.wallet_address,
            "company": str(approval.company_id),
            "registry": approval.registry_address,
        }
        for approval in approvals
    ]


def targets_for_account(account_id):
    return targets_for(_approvals(entry__wallet__user_account_id=account_id))


def targets_for_wallet(wallet_id):
    return targets_for(_approvals(entry__wallet_id=wallet_id))


def _target_approval(target):
    return (
        _approvals(company_id=target["company"], registry_address=target["registry"])
        .filter(entry__wallet__address__iexact=target["address"])
        .first()
    )


def _remove_target(target, actor):
    if _unresolved(target["registry"], target["address"]):
        return None
    moment = int(timezone.now().timestamp())
    if _effective(observed_expiry(target["registry"], target["address"]), moment) == 0:
        return None
    return _submit(target["address"], Company.objects.get(pk=target["company"]), None, 0, actor)


def refresh_targets(targets, actor):
    result = {"checked": 0, "submitted": 0, "errors": 0}
    for target in targets:
        result["checked"] += 1
        try:
            approval = _target_approval(target)
            change = refresh_approval(approval, actor) if approval else _remove_target(target, actor)
            result["submitted"] += 1 if change else 0
        except Exception:
            result["errors"] += 1
            logger.error("Whitelist refresh failed: company=%s registry=%s", target["company"], target["registry"])
    return result


def _enqueue(targets, actor, delay):
    from whitelist.tasks import refresh_whitelist_targets

    if not targets or actor is None:
        return targets
    task = refresh_whitelist_targets.configure(schedule_in={"seconds": delay}) if delay else refresh_whitelist_targets
    task.defer(targets=targets, actor_id=str(actor.pk))
    return targets


def enqueue_for_account(account_id, actor, delay=0):
    return _enqueue(targets_for_account(account_id), actor, delay)


def enqueue_for_wallet(wallet_id, actor, delay=0):
    return _enqueue(targets_for_wallet(wallet_id), actor, delay)


def sweep():
    result = {"checked": 0, "submitted": 0, "unattributed": 0, "errors": 0}
    approvals = _approvals().select_related("entry__wallet__user_account").order_by("updated_at", "uuid")
    for approval in approvals.iterator():
        if result["submitted"] >= WHITELIST_REFRESH_LIMIT:
            break
        result["checked"] += 1
        try:
            wanted = needed_expiry(approval)
            if wanted is None:
                continue
            actor = _deciding_actor(approval, wanted)
            if actor is None:
                result["unattributed"] += 1
                logger.error(
                    "A whitelist approval needs a change that no actor can be attributed to: approval=%s",
                    approval.pk,
                )
                continue
            _submit(approval.entry.wallet_address, approval.company, approval.entry.wallet_id, wanted, actor)
            result["submitted"] += 1
        except Exception:
            result["errors"] += 1
            logger.error("Whitelist refresh failed: approval=%s", approval.pk)
    return result
