import json
from contextlib import contextmanager
from datetime import timezone as datetime_timezone
from uuid import UUID

from django.db import IntegrityError, OperationalError, connections
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from companies.models import Company
from companies.services.authority_requests import _requester_principal
from shared.db import atomic, current_alias, use_operator
from users.services.participants import (
    participant_requirements,
    requirements_shown_to_the_company,
)
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.services.possession_proof import current_possession_proof
from whitelist.exceptions import WhitelistChangeConflict, WhitelistSigningHold
from whitelist.models import CompanyWalletNomination

SNAPSHOT_KEYS = frozenset(
    {
        "company",
        "wallet",
        "address",
        "chain",
        "proof",
        "proof_completed_at",
        "account",
        "profile",
        "participant",
        "proof_digest",
    }
)


def _stamp(value):
    return value.astimezone(datetime_timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _digest(value):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(value)])
        return cursor.fetchone()[0]


@contextmanager
def _nomination_operation():
    active_connection = connections[current_alias()]
    with active_connection.cursor() as cursor:
        cursor.execute("SELECT current_setting('app.wallet_nomination_operation', true)")
        previous = cursor.fetchone()[0] or ""
        cursor.execute("SELECT set_config('app.wallet_nomination_operation', 'submit', false)")
    try:
        yield
    finally:
        with active_connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.wallet_nomination_operation', %s, false)", [previous])


def _source(actor, company_id, wallet_id):
    company = get_object_or_404(Company.objects.active(), pk=company_id)
    wallets = Wallet.objects.owned_by(actor).select_related("user_account__user_profile__user")
    wallet = get_object_or_404(wallets, pk=wallet_id)
    unmet = participant_requirements(wallet.user_account, company)
    if wallet.chain != "base":
        unmet.append("base_wallet_required")
    proof = current_possession_proof(wallet)
    if proof is None or wallet.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED:
        unmet.append("wallet_proof_required")
    snapshot = {
        "company": str(company.pk),
        "wallet": str(wallet.pk),
        "address": wallet.address.lower(),
        "chain": wallet.chain,
        "proof": str(proof.pk) if proof else None,
        "proof_completed_at": _stamp(proof.completed_at) if proof else None,
        "account": str(wallet.user_account_id),
        "profile": str(wallet.user_account.user_profile_id),
        "participant": actor.pk,
        "proof_digest": proof.digest if proof else None,
    }
    return company, wallet, proof, snapshot, sorted(set(unmet))


def preview_wallet_nomination(*, actor, company, wallet):
    with use_operator(), _requester_principal(actor.pk):
        _, _, _, snapshot, unmet = _source(actor, company, wallet)
        return {**snapshot, "preview_digest": _digest(snapshot), "can_submit": not unmet, "unmet_requirements": unmet}


def nominate_wallet(*, actor, operation_id, company, wallet, preview_digest, sharing_accepted):
    if sharing_accepted is not True:
        raise ValidationError("Confirm sharing this exact wallet address with this company.")
    try:
        with use_operator(), _requester_principal(actor.pk), atomic(durable=True):
            prior = CompanyWalletNomination.objects.filter(pk=operation_id).first()
            if prior is not None:
                if (
                    prior.submitted_by_id,
                    prior.company_id,
                    prior.wallet_id,
                    prior.preview_digest,
                    prior.sharing_accepted,
                ) != (actor.pk, UUID(str(company)), UUID(str(wallet)), preview_digest, sharing_accepted):
                    raise WhitelistChangeConflict()
                return prior, False
            company_row, wallet_row, proof, snapshot, unmet = _source(actor, company, wallet)
            if _digest(snapshot) != preview_digest:
                raise WhitelistChangeConflict()
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            from whitelist.services.company_wallet_instructions import _lock_context

            company_row = Company.objects.select_for_update().get(pk=company_row.pk)
            try:
                _lock_context(company_row, {actor.pk}, snapshot, [])
            except WhitelistSigningHold as error:
                raise ValidationError({"unmet_requirements": error.unmet_requirements}) from None
            company_row, wallet_row, proof, snapshot, unmet = _source(actor, company, wallet)
            if _digest(snapshot) != preview_digest or unmet:
                raise WhitelistChangeConflict()
            with _nomination_operation():
                nomination = CompanyWalletNomination.objects.create(
                    uuid=operation_id,
                    company=company_row,
                    proof=proof,
                    wallet_id=wallet_row.pk,
                    submitted_by=actor,
                    snapshot=snapshot,
                    preview_digest=preview_digest,
                    digest=preview_digest,
                    sharing_accepted=True,
                    submitted_at=timezone.now(),
                )
            nomination.refresh_from_db(fields=["submitted_at"])
            return nomination, True
    except (IntegrityError, OperationalError):
        raise WhitelistChangeConflict() from None


def nomination_requirements(nomination):
    snapshot = nomination.snapshot
    wallet = Wallet.objects.select_related("user_account__user_profile__user").filter(pk=nomination.wallet_id).first()
    unmet = []
    if (
        set(snapshot) != SNAPSHOT_KEYS
        or wallet is None
        or str(wallet.user_account_id) != snapshot.get("account")
        or str(wallet.user_account.user_profile_id) != snapshot.get("profile")
        or wallet.user_account.user_profile.user_id != snapshot.get("participant")
        or wallet.address.lower() != snapshot.get("address")
        or wallet.chain != "base"
    ):
        unmet.append("wallet_source_changed")
    else:
        if (
            wallet.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED
            or (proof := current_possession_proof(wallet)) is None
            or proof.pk != nomination.proof_id
        ):
            unmet.append("wallet_proof_required")
        participant = participant_requirements(wallet.user_account, nomination.company)
        unmet.extend(requirements_shown_to_the_company(participant))
    return sorted(set(unmet))
