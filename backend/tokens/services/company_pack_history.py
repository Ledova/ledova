from collections import defaultdict

from django.db.models import Q

from offerings.models import Subscription, SubscriptionStatus
from tokens.constants import FORMER_MEMBER_RETENTION_MONTHS
from tokens.models import (
    CapitalIncreaseRequest,
    PauseChange,
    RegisterAcknowledgement,
    RegisterCorrection,
    RegisterCorrectionAuthority,
    RegisterImport,
    RegisterInstruction,
    RegisterOpening,
    RegisterReconciliation,
    RegisterWalletLink,
    ShareIssuanceRequest,
)
from tokens.services.register import former_identity_label, months_after
from tokens.services.register_inclusions import waiting_list
from whitelist.models import WhitelistApproval, WhitelistChange

RECORDED = "recorded"
REVIEWED = "reviewed_by__userprofile"


def _whole(value):
    return None if value is None else str(int(value))


def _name(user):
    if user is None:
        return None
    profile = getattr(user, "userprofile", None)
    return (profile.full_name if profile is not None else "") or ""


def _ordered(records):
    return records.select_related(REVIEWED).order_by("created_at", "uuid")


def _evidence(record):
    snapshot = record.evidence_snapshot
    return {
        "document": record.source_document,
        "document_type": snapshot.get("document_type"),
        "name": snapshot.get("name"),
        "mime_type": snapshot.get("mime_type"),
        "size": snapshot.get("file_size"),
        "sha256": snapshot.get("sha256"),
    }


def _decided(record, authority, **terms):
    return {
        "uuid": record.pk,
        "submitted_at": record.created_at,
        "authority": authority,
        "approving_director": record.approving_director,
        "authority_reference": record.authority_reference,
        "reason": record.reason,
        **terms,
        "evidence": _evidence(record),
        "status": record.status,
        "reviewer": _name(record.reviewed_by),
        "reviewed_at": record.reviewed_at,
        "rejection_reason": record.rejection_reason,
    }


def authority(company, token) -> dict:
    return {
        "openings": [
            _decided(opening, opening.authority, mapping=opening.mapping, entry=opening.applied_entry_id)
            for opening in _ordered(RegisterOpening.objects.filter(company=company, token=token))
        ],
        "imports": [
            _decided(
                record,
                record.authority,
                as_at=record.as_at,
                members=record.members,
                former_members=record.former_members,
                asic={
                    "document": record.asic_document,
                    "issued_total": _whole(record.asic_issued_total),
                    "member_count": record.asic_member_count,
                },
                register_sequence=record.register_sequence,
            )
            for record in _ordered(RegisterImport.objects.filter(company=company, token=token))
        ],
        "corrections": [
            _decided(
                correction,
                correction.authority,
                corrects=correction.corrects_id,
                effective_on=correction.effective_on,
                changes=correction.changes,
                base_sequence=correction.base_sequence,
                base_hash=correction.base_hash,
                entry=correction.applied_entry_id,
            )
            for correction in _ordered(RegisterCorrection.objects.filter(company=company, register__token=token))
        ],
        "instructions": [
            _decided(
                instruction,
                RegisterCorrectionAuthority.DIRECTOR_RESOLUTION,
                kind=instruction.kind,
                items=instruction.items,
            )
            for instruction in _ordered(RegisterInstruction.objects.filter(company=company, token=token))
        ],
    }


def wallet_links(company) -> list:
    return [
        _decided(link, link.authority, mapping=link.mapping)
        for link in _ordered(RegisterWalletLink.objects.filter(company=company))
    ]


def _payment(subscription):
    return {
        "basis": RECORDED,
        "amount_received": subscription.amount_received,
        "received_on": subscription.payment_received_on,
        "reference_seen": subscription.payment_reference_seen,
        "transaction": subscription.payment_tx_hash or None,
        "recorded_at": subscription.payment_confirmed_at,
        "refund_amount": subscription.refund_amount,
        "refunded_at": subscription.refunded_at,
        "refund_reference": subscription.refund_reference,
    }


def _subscription(subscription):
    if subscription is None:
        return None
    return {
        "uuid": subscription.pk,
        "offering": subscription.offering_id,
        "status": subscription.status,
        "subscribed_at": subscription.created_at,
        "shares_requested": str(subscription.quantity),
        "allotment": str(subscription.allotment_quantity),
        "currency": subscription.offering.price_currency,
        "price_per_share": subscription.price_per_share,
        "amount_due": subscription.amount_due,
        "payment_due_at": subscription.payment_due_at,
        "reference": subscription.reference,
        "rail": subscription.settlement_rail,
        "payment": _payment(subscription),
    }


def _awaiting(subscription):
    return {
        **_subscription(subscription),
        "subscriber": (subscription.user_account.user_profile.full_name or "").strip(),
        "wallet": subscription.wallet.address,
    }


def _issuance(issuance):
    if issuance is None:
        return None
    return {
        "uuid": issuance.pk,
        "status": issuance.status,
        "shares": issuance.amount,
        "completed_at": issuance.completed_at,
    }


def issues(company, token) -> dict:
    requests = list(
        _ordered(ShareIssuanceRequest.objects.filter(company=company, token=token)).select_related("executed_issuance")
    )
    subscriptions = {
        subscription.issuance_request_id: subscription
        for subscription in Subscription.objects.filter(company=company, issuance_request__in=requests).select_related(
            "offering"
        )
    }
    awaiting = (
        Subscription.objects.filter(company=company, offering__token=token, issuance_request__isnull=True)
        .filter(
            Q(status=SubscriptionStatus.PAID)
            | Q(status=SubscriptionStatus.AWAITING_PAYMENT, amount_received__isnull=False)
        )
        .select_related("offering", "wallet", "user_account__user_profile")
        .order_by("created_at", "uuid")
    )
    return {
        "issues": [_issue(request, subscriptions.get(request.pk)) for request in requests],
        "awaiting_allotment": [_awaiting(subscription) for subscription in awaiting],
    }


def _issue(request, subscription):
    return {
        "request": request.pk,
        "type": request.issuance_type,
        "recipient_address": request.recipient_address,
        "recipient_name": request.recipient_name,
        "shares": str(request.amount),
        "reason": request.reason,
        "status": request.status,
        "submitted_at": request.submitted_at,
        "reviewer": _name(request.reviewed_by),
        "reviewed_at": request.reviewed_at,
        "rejection_reason": request.rejection_reason,
        "executed_at": request.executed_at,
        "issuance": _issuance(request.executed_issuance),
        "subscription": _subscription(subscription),
    }


def cap_increases(company, token) -> list:
    return [
        {
            "uuid": request.pk,
            "status": request.status,
            "additional_shares": str(request.additional_shares),
            "new_authorised_total": str(request.new_authorized_total),
            "purpose": request.purpose,
            "board_resolution_reference": request.board_resolution_reference,
            "shareholder_approval_reference": request.shareholder_approval_reference,
            "submitted_at": request.submitted_at,
            "reviewer": _name(request.reviewed_by),
            "reviewed_at": request.reviewed_at,
            "rejection_reason": request.rejection_reason,
            "executed_at": request.executed_at,
        }
        for request in _ordered(CapitalIncreaseRequest.objects.filter(company=company, token=token))
    ]


def pauses(company, token) -> list:
    return [
        {
            "uuid": change.pk,
            "paused": change.paused,
            "authority": change.authority,
            "status": change.status,
            "requested_at": change.created_at,
            "completed_at": change.completed_at,
        }
        for change in PauseChange.objects.filter(company_id=company.pk, token_id=token.pk).order_by(
            "created_at", "uuid"
        )
    ]


def former_members(stored) -> list:
    return [
        {
            "name": row.name,
            "residential_address": row.residential_address,
            "wallet": row.wallet_address,
            "shares_at_cessation": _whole(row.shares_at_cessation),
            "ceased_on": row.ceased_on,
            "retain_until": months_after(row.ceased_on, FORMER_MEMBER_RETENTION_MONTHS),
            "identity_source": former_identity_label(row.identity_source),
            "recorded_at": row.created_at,
        }
        for row in ([] if stored is None else stored["former_members"])
    ]


def reconciliations(token) -> list:
    acknowledged = defaultdict(list)
    for acknowledgement in RegisterAcknowledgement.objects.filter(token_id=token.pk).order_by("created_at", "uuid"):
        acknowledged[acknowledgement.reconciliation_id].append(
            {
                "discrepancy": acknowledgement.discrepancy,
                "reason": acknowledgement.reason,
                "acknowledged_at": acknowledgement.created_at,
            }
        )
    return [
        {
            "uuid": record.pk,
            "reconciled_at": record.created_at,
            "status": record.status,
            "block_number": record.block_number,
            "block_hash": record.block_hash,
            "register_sequence": record.register_sequence,
            "discrepancies": record.discrepancies,
            "failure": record.failure,
            "acknowledgements": acknowledged[record.pk],
        }
        for record in RegisterReconciliation.objects.filter(token=token).order_by("created_at", "uuid")
    ]


def waiting(token) -> dict:
    return {"effects": waiting_list(token.pk)}


def due(items, token) -> list:
    return [
        {
            "sequence": item["sequence"],
            "kind": item["kind"],
            "effective_on": item["effective_on"],
            "output": item["output"],
            "due_on": item["due_on"],
            "overdue": item["overdue"],
        }
        for item in items
        if item["token"].pk == token.pk
    ]


def approvals(company, as_at) -> dict:
    granted = list(
        WhitelistApproval.objects.filter(company=company).select_related("entry__wallet").order_by("created_at", "uuid")
    )
    changes = list(
        WhitelistChange.objects.filter(company_id=company.pk)
        .select_related("transaction")
        .order_by("created_at", "uuid")
    )
    return {
        "registries": sorted({row.registry_address for row in (*granted, *changes)}),
        "approvals": [
            {
                "wallet": approval.entry.wallet_address,
                "registry": approval.registry_address,
                "status": approval.status,
                "expires_at": approval.expires_at,
                "listed": approval.is_listed(as_at),
            }
            for approval in granted
        ],
        "changes": [
            {
                "uuid": change.pk,
                "action": change.action,
                "wallet": change.address,
                "registry": change.registry_address,
                "expires_at": change.expires_at,
                "authority": change.authority,
                "status": change.status,
                "requested_at": change.created_at,
                "completed_at": change.completed_at,
                "transaction": None if change.transaction is None else change.transaction.tx_hash,
            }
            for change in changes
        ],
    }
