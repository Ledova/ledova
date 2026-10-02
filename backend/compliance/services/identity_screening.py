import hashlib
import json
import logging

from compliance.constants import (
    ALERT_SEVERITY_CRITICAL,
    ALERT_SEVERITY_HIGH,
    ALERT_STATUS_NEW,
    ALERT_TYPE_PEP_MATCH,
    ALERT_TYPE_SANCTIONS_MATCH,
    ALERT_TYPE_WATCHLIST_MATCH,
    IDENTITY_SCREENING_RULE,
)
from compliance.models import ComplianceAlert
from shared.db import atomic
from users.models import UserAccount

logger = logging.getLogger(__name__)

ALERT_BY_LIST_TYPE = (
    ("SANCTIONS", ALERT_TYPE_SANCTIONS_MATCH, ALERT_SEVERITY_CRITICAL),
    ("WANTED", ALERT_TYPE_WATCHLIST_MATCH, ALERT_SEVERITY_CRITICAL),
    ("PEP", ALERT_TYPE_PEP_MATCH, ALERT_SEVERITY_HIGH),
)
ALERT_FOR_ANY_OTHER_LIST = (ALERT_TYPE_WATCHLIST_MATCH, ALERT_SEVERITY_HIGH)
MATCH_IDENTITY = ("provider", "applicant_id", "verification_id", "document_id")


def alert_for(list_types) -> tuple:
    for list_type, alert_type, severity in ALERT_BY_LIST_TYPE:
        if list_type in list_types:
            return alert_type, severity
    return ALERT_FOR_ANY_OTHER_LIST


def match_key(match: dict) -> str:
    identity = {field: match.get(field) for field in MATCH_IDENTITY}
    identity["list_types"] = sorted(match.get("list_types") or [])
    identity["databases"] = sorted(match.get("databases") or [])
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def description_of(match: dict) -> str:
    lists = ", ".join(match.get("list_types") or []) or "unnamed"
    databases = ", ".join(match.get("databases") or []) or "no database named"
    return f"{str(match.get('provider', '')).upper()} screening matched this customer on {lists} lists ({databases})"


def raise_screening_alert(user_account, match: dict):
    key = match_key(match)
    alert_type, severity = alert_for(match.get("list_types") or [])
    with atomic():
        UserAccount.objects.select_for_update().get(pk=user_account.pk)
        if ComplianceAlert.objects.filter(
            user_account=user_account, triggered_rule=IDENTITY_SCREENING_RULE, alert_data__match_key=key
        ).exists():
            logger.info("A repeated identity screening match raised no further alert")
            return None
        alert = ComplianceAlert.objects.create(
            user_account=user_account,
            alert_type=alert_type,
            severity=severity,
            triggered_rule=IDENTITY_SCREENING_RULE,
            description=description_of(match),
            alert_data={**match, "match_key": key},
            status=ALERT_STATUS_NEW,
        )
    logger.info("Raised a %s alert for an identity screening match", alert_type)
    return alert
