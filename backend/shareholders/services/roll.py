import hashlib
import json
from collections import defaultdict
from uuid import UUID

from tokens.models import RegisterEntry
from tokens.services.register import member_identities


def holdings_at(register, record_date) -> dict:
    held = defaultdict(int)
    changes_by_entry = (
        RegisterEntry.objects.filter(register=register, effective_on__lte=record_date)
        .order_by("sequence")
        .values_list("changes", flat=True)
    )
    for changes in changes_by_entry:
        for change in changes:
            held[UUID(change["member"])] += int(change["shares"])
    return {member: shares for member, shares in held.items() if shares > 0}


def frozen_rows(token, register, record_date) -> list[dict]:
    held = holdings_at(register, record_date)
    identities = member_identities(token, sorted(held))
    rows = [
        {
            "member_id": member,
            "user_id": identities[member].user_id,
            "name": identities[member].name,
            "holder_type": identities[member].holder_type,
            "identity_source": identities[member].source,
            "shares": shares,
        }
        for member, shares in held.items()
    ]
    rows.sort(key=lambda row: (-row["shares"], str(row["member_id"])))
    return rows


def roll_digest(rows) -> str:
    payload = [
        {
            "member": str(row["member_id"]),
            "user": row["user_id"],
            "name": row["name"],
            "holder_type": row["holder_type"],
            "identity_source": row["identity_source"],
            "shares": str(row["shares"]),
        }
        for row in sorted(rows, key=lambda row: str(row["member_id"]))
    ]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
