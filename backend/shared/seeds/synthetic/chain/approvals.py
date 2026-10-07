from uuid import uuid4

from django.utils import timezone

from companies.models import CompanyAppointment, CompanyCapability
from companies.services.authority_requests import _requester_principal
from operators.models import Operator
from shared.db import use_operator
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.story import (
    ACCEPTED,
    DRAFT,
    REJECTED,
    SUBMITTED,
    WITHDRAWN,
)
from shared.seeds.synthetic.market.keyring import KeyRing
from users.services.company_eligibility_consumption import company_eligibility
from wallets.services.verification import (
    complete_wallet_verification,
    start_wallet_verification,
)
from whitelist.models import WhitelistChangeStatus
from whitelist.services import changes
from whitelist.services.company_wallet_instructions import (
    decide_wallet_instruction,
    prepare_wallet_instruction,
    preview_wallet_instruction_decision,
)
from whitelist.services.wallet_nominations import (
    nominate_wallet,
    preview_wallet_nomination,
)

UNAPPROVED_STATUSES = (DRAFT, SUBMITTED, WITHDRAWN, ACCEPTED)
NOT_CONFIRMED = "The approval of {address} for {company} ended {status}."
TREASURY_UNSUPPORTED = (
    "The issuance plan includes an employee share trust address with no held signing key. "
    "Fresh treasury approval is unsupported; no chain layer records or transactions were added."
)


def approved_addresses(plan, company):
    addresses = {}
    for share_class in plan.classes_of(company):
        for position in share_class.positions:
            addresses.setdefault(position.address.lower(), position)
    for item in plan.rounds:
        if plan.share_class(item.share_class).company != company:
            continue
        for application in item.applications:
            lapsed_early = application.status == REJECTED and application.instructed_at is None
            if application.status in UNAPPROVED_STATUSES or lapsed_early:
                continue
            addresses.setdefault(application.address.lower(), application)
    for request in plan.requests:
        if plan.share_class(request.share_class).company == company:
            addresses.setdefault(request.address.lower(), request)
    return sorted(addresses)


def approve_participant_wallet(company, wallet, keyring):
    key = keyring.key(wallet.address)
    participant = wallet.user_account.user_profile.user
    with use_operator(), _requester_principal(participant.pk):
        eligibility = company_eligibility(wallet.user_account, company, purpose="secondary")
    if not eligibility.is_eligible or eligibility.decision.expires_at is None:
        raise ChainStepFailed("A current finite GENERAL company eligibility decision is required for wallet approval.")
    with use_operator(), _requester_principal(company.owner_id):
        appointment = (
            CompanyAppointment.objects.current_for(
                company.owner,
                company.pk,
                at=timezone.now(),
                identity_required=Operator.get().issuer_kyc_required,
            )
            .filter(capabilities__contains=[CompanyCapability.ADMIN])
            .order_by("pk")
            .first()
        )
    if appointment is None:
        raise ChainStepFailed("The company owner needs an existing current personal ADMIN appointment.")
    with use_operator(), _requester_principal(participant.pk):
        challenge = start_wallet_verification(participant, wallet.pk).verification_challenge
    complete_wallet_verification(participant, wallet.pk, keys.sign("base", key, challenge))
    preview = preview_wallet_nomination(actor=participant, request=eligibility.decision.request_id, wallet=wallet.pk)
    nomination, _ = nominate_wallet(
        actor=participant,
        operation_id=uuid4(),
        request=eligibility.decision.request_id,
        wallet=wallet.pk,
        preview_digest=preview["preview_digest"],
        sharing_accepted=True,
    )
    proposal = prepare_wallet_instruction(
        actor=company.owner,
        operation_id=uuid4(),
        appointment=appointment.pk,
        company=company.pk,
        action="add",
        nomination=nomination.pk,
        expires_at=eligibility.decision.expires_at.replace(microsecond=0),
    )
    for kind in ("approve", "apply"):
        _, preview = preview_wallet_instruction_decision(
            actor=company.owner, instruction_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=""
        )
        proposal = decide_wallet_instruction(
            actor=company.owner,
            instruction_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            reason="",
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
    with use_operator():
        change = changes.recover(proposal.change_id)
    if change.status not in (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED):
        raise ChainStepFailed(NOT_CONFIRMED.format(address=wallet.address, company=company.name, status=change.status))
    return change


def approve_company(plan, company_key, records):
    if plan.treasuries:
        raise ChainStepFailed(TREASURY_UNSUPPORTED)
    company = records.companies[company_key]
    keyring = KeyRing()
    approved = 0
    for address in approved_addresses(plan, company_key):
        holder = records.holders[(company_key, address)]
        approve_participant_wallet(company, records.wallet(holder, address), keyring)
        approved += 1
    return approved
