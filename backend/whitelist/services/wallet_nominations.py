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
from users.models import CompanyEligibilityDecision, CompanyEligibilityRequest
from users.services.company_eligibility import _digest
from users.services.company_eligibility_consumption import company_eligibility
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.services.possession_proof import current_possession_proof
from whitelist.exceptions import WhitelistChangeConflict, WhitelistSigningHold
from whitelist.models import CompanyWalletNomination


def _stamp(value):
    return value.astimezone(datetime_timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


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


def _own_request(actor, request_id):
    return get_object_or_404(
        CompanyEligibilityRequest.objects.filter(user_account__user_profile__user=actor).select_related(
            "company", "user_account__user_profile"
        ),
        pk=request_id,
    )


def _source(actor, request_id, wallet_id):
    request = _own_request(actor, request_id)
    wallets = Wallet.objects.owned_by(actor).select_related("user_account__user_profile")
    wallet = get_object_or_404(wallets, pk=wallet_id)
    unmet = []
    if wallet.user_account_id != request.user_account_id:
        unmet.append("wallet_source_changed")
    if wallet.chain != "base":
        unmet.append("base_wallet_required")
    proof = current_possession_proof(wallet)
    if proof is None or wallet.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED:
        unmet.append("wallet_proof_required")
    decision = CompanyEligibilityDecision.objects.filter(request=request, outcome="accepted").first()
    eligible = company_eligibility(
        request.user_account, request.company, purpose="secondary", decision_id=decision.pk if decision else UUID(int=0)
    )
    if not eligible.is_eligible:
        unmet.append("eligibility_source_lapsed")
    snapshot = {
        "company": str(request.company_id),
        "request": str(request.pk),
        "decision": str(decision.pk) if decision else None,
        "wallet": str(wallet.pk),
        "address": wallet.address.lower(),
        "chain": wallet.chain,
        "proof": str(proof.pk) if proof else None,
        "proof_completed_at": _stamp(proof.completed_at) if proof else None,
        "eligibility_expires_at": _stamp(decision.expires_at) if decision and decision.expires_at else None,
        "account": str(request.user_account_id),
        "profile": str(request.user_account.user_profile_id),
        "participant": actor.pk,
        "proof_digest": proof.digest if proof else None,
        "request_digest": request.digest,
        "decision_digest": decision.digest if decision else None,
    }
    return request, wallet, proof, decision, snapshot, sorted(set(unmet))


def preview_wallet_nomination(*, actor, request, wallet):
    with use_operator(), _requester_principal(actor.pk):
        _, _, _, _, snapshot, unmet = _source(actor, request, wallet)
        return {**snapshot, "preview_digest": _digest(snapshot), "can_submit": not unmet, "unmet_requirements": unmet}


def nominate_wallet(*, actor, operation_id, request, wallet, preview_digest, sharing_accepted):
    if sharing_accepted is not True:
        raise ValidationError("Confirm sharing this exact wallet address with this company.")
    try:
        with use_operator(), _requester_principal(actor.pk), atomic(durable=True):
            _own_request(actor, request)
            prior = CompanyWalletNomination.objects.filter(pk=operation_id).first()
            if prior is not None:
                if (
                    prior.submitted_by_id,
                    prior.request_id,
                    prior.wallet_id,
                    prior.preview_digest,
                    prior.sharing_accepted,
                ) != (actor.pk, UUID(str(request)), UUID(str(wallet)), preview_digest, sharing_accepted):
                    raise WhitelistChangeConflict()
                return prior, False
            request_row, wallet_row, proof, decision, snapshot, unmet = _source(actor, request, wallet)
            if _digest(snapshot) != preview_digest:
                raise WhitelistChangeConflict()
            if unmet:
                raise ValidationError({"unmet_requirements": unmet})
            from whitelist.services.company_wallet_instructions import _lock_context

            company = Company.objects.select_for_update().get(pk=request_row.company_id)
            try:
                _lock_context(company, {actor.pk}, snapshot, [])
            except WhitelistSigningHold as error:
                raise ValidationError({"unmet_requirements": error.unmet_requirements}) from None
            request_row, wallet_row, proof, decision, snapshot, unmet = _source(actor, request, wallet)
            if _digest(snapshot) != preview_digest or unmet:
                raise WhitelistChangeConflict()
            with _nomination_operation():
                nomination = CompanyWalletNomination.objects.create(
                    uuid=operation_id,
                    company=company,
                    request=request_row,
                    decision=decision,
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
    from whitelist.services.eligibility_invalidation import has_live_general_decision

    snapshot = nomination.snapshot
    wallet = Wallet.objects.select_related("user_account__user_profile").filter(pk=nomination.wallet_id).first()
    unmet = []
    if (
        wallet is None
        or str(wallet.user_account_id) != snapshot["account"]
        or str(wallet.user_account.user_profile_id) != snapshot["profile"]
        or wallet.user_account.user_profile.user_id != snapshot["participant"]
        or wallet.address.lower() != snapshot["address"]
        or wallet.chain != "base"
    ):
        unmet.append("wallet_source_changed")
    elif (
        wallet.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED
        or (proof := current_possession_proof(wallet)) is None
        or proof.pk != nomination.proof_id
    ):
        unmet.append("wallet_proof_required")
    if not has_live_general_decision(
        nomination.request.user_account_id, nomination.company_id, decision_id=nomination.decision_id
    ):
        unmet.append("eligibility_source_lapsed")
    return sorted(set(unmet))
