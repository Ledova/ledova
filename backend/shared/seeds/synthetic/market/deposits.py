from decimal import Decimal

from web3 import Web3

from operators.settlement import require_deployment
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.market.context import seeded_id
from tokens.models import MintRequest, MintRequestStatus
from tokens.services import mint_service
from users.models import UserProfile

EXECUTED = "executed"
REJECTED = "rejected"
PERMISSION = "assets.change_asset"
NOT_MINTED = "The AUDY deposit {reference} for {address} ended {status}."
NOTES = {
    EXECUTED: "Bank deposit matched to the investor's verified wallet and minted as AUDY.",
    REJECTED: "Recorded from the bank statement, then rejected.",
    "pending": "Recorded from the bank statement; awaiting a second check before minting.",
}


def mint_id(key):
    return seeded_id("mint", key)


def units(market, amount):
    decimals = require_deployment(market.audy).decimals
    return int((Decimal(amount) * Decimal(10) ** decimals).to_integral_value())


def _request(deposit, market):
    profile = UserProfile.objects.get(user__email=deposit.investor)
    return mint_service.create_request(
        mint_id(deposit.key),
        market.operations,
        settlement_asset=market.audy,
        recipient_address=Web3.to_checksum_address(deposit.address),
        recipient_name=profile.full_name,
        amount=units(market, deposit.amount),
        deposit_reference=deposit.reference,
        deposit_date=deposit.received_on,
        notes=deposit.reason if deposit.state == "pending" else NOTES[deposit.state],
    )


def mint(deposit, market):
    request = _request(deposit, market)
    mint_service.execute(request, market.operations, permission=PERMISSION)
    request.refresh_from_db()
    if request.status != MintRequestStatus.EXECUTED:
        raise ChainStepFailed(
            NOT_MINTED.format(reference=deposit.reference, address=deposit.address, status=request.status)
        )
    return request


def record(deposit, market):
    with frozen(deposit.recorded_at):
        request = _request(deposit, market)
    if deposit.state == REJECTED:
        with frozen(deposit.decided_at):
            mint_service.reject(request, market.operations, deposit.reason)
    return MintRequest.objects.get(pk=request.pk)
