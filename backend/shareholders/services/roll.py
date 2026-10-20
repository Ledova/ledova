import hashlib
import json
from collections import defaultdict
from uuid import UUID

from django.db.models import BooleanField, Exists, F, Func, OuterRef

from tokens.models import MemberAssociation, RegisterEntry, RegisterMemberWallet
from tokens.services.register import member_identities
from whitelist.models import HolderType


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
    wallets = RegisterMemberWallet.objects.filter(company_id=token.company_id, member_id=OuterRef("member"))
    accounts = dict(
        MemberAssociation.objects.filter(company_id=token.company_id, member__in=held, current=True)
        .alias(
            has_wallet=Exists(wallets),
            access_current=Func(
                F("uuid"), F("user_id"), function="tokens_member_association_current", output_field=BooleanField()
            ),
        )
        .filter(has_wallet=False, access_current=True)
        .values_list("member", "user_id")
    )
    rows = [
        {
            "member_id": member,
            "user_id": identities[member].user_id
            or (accounts.get(member) if identities[member].holder_type == HolderType.MEMBER else None),
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
