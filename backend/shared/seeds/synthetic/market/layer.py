from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from uuid import uuid4

from django.conf import settings
from django.utils import timezone
from web3 import HTTPProvider, Web3

from blockchain.models import SignedAttempt
from integrations.base_chain import get_base_chain_client
from operators.models import Operator
from operators.settlement import single_settlement_asset
from shared.constants import BLOCKCHAIN_BASE
from shared.seeds.synthetic.chain import layer as chain_layer
from shared.seeds.synthetic.chain import population as chain_population
from shared.seeds.synthetic.chain.approvals import (
    ENTRY_NOTE,
    NOT_CONFIRMED,
    NOT_ELIGIBLE,
    expiry_for,
)
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.deferred import captured
from shared.seeds.synthetic.chain.guard import (
    GET_THE_CHAIN,
    PROBE_TIMEOUT,
    chain_refusal,
)
from shared.seeds.synthetic.chain.settlement import AUDY, WEI
from shared.seeds.synthetic.clock import AEST
from shared.seeds.synthetic.market import deposits, population, register, trading
from shared.seeds.synthetic.market.context import Market
from shared.seeds.synthetic.market.deposits import EXECUTED
from shared.seeds.synthetic.market.notices import CLOSED, Notices
from shared.seeds.synthetic.market.story import build_market
from shared.seeds.synthetic.staff import PERMISSIONS, permissions
from shareholders.models import Publication, PublicationEvent, PublicationEventKind
from tokens.models import (
    MintRequest,
    ShareToken,
    SwapApprovalSubmission,
    SwapOrder,
    TransferOrder,
    TransferOrderStatus,
)
from tokens.services.market_data_service import market_summaries
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistChangeStatus,
    WhitelistEntry,
)
from whitelist.services import changes

ABSENT = "absent"
PRESENT = "present"
PARTIAL = "partial"
SKIPPED = "skipped"
FIRST_DEPOSIT = "deposit-001"
SEALING_DEPOSIT = "pending-2"
GAS = Decimal("0.05")
NO_CHAIN_LAYER = "The chain layer is not on this database, so there are no deployed classes to trade."
NOT_AUDY = (
    "The operator does not settle in AUDY on Base alone, so orders could not be placed. Set its receiving wallet "
    "on Base and AUDY as its only settlement asset in the admin, then run make dev-seed again."
)
NO_CLASS_CODE = (
    "{symbol} of {company} has no contract code on the node, so the database's share classes are not on this "
    "chain. Start over with make dev-clean, make dev-up and make dev-seed."
)
NOTHING_TO_TRADE = "No deployed class has holders and buyers to trade."


@dataclass(frozen=True)
class Outcome:
    state: str
    plan: object = None
    reason: str = ""
    counts: dict = field(default_factory=dict)


def market_state():
    if MintRequest.objects.filter(pk=deposits.mint_id(SEALING_DEPOSIT)).exists():
        return PRESENT
    return PARTIAL if MintRequest.objects.filter(pk=deposits.mint_id(FIRST_DEPOSIT)).exists() else ABSENT


def _settlement_refusal():
    asset = single_settlement_asset()
    if Operator.get().receiving_wallet_chain != BLOCKCHAIN_BASE or asset is None or asset.symbol != AUDY:
        return NOT_AUDY
    return None


def _class_refusal(found):
    node = Web3(HTTPProvider(settings.BLOCKCHAIN_RPC_URL, request_kwargs={"timeout": PROBE_TIMEOUT}))
    for token in population.deployed(found):
        if not node.eth.get_code(Web3.to_checksum_address(token.contract_address)):
            return NO_CLASS_CODE.format(symbol=token.symbol, company=token.company.name)
    return None


def seed_market(now):
    state = market_state()
    if state != ABSENT:
        return Outcome(state)
    found = chain_population.companies()
    if chain_layer.issuance_state(found) != chain_layer.PRESENT:
        return Outcome(SKIPPED, reason=NO_CHAIN_LAYER)
    refusal = chain_refusal()
    if refusal:
        return Outcome(SKIPPED, reason=f"{refusal} {GET_THE_CHAIN}")
    refusal = _settlement_refusal() or _class_refusal(found)
    if refusal:
        return Outcome(SKIPPED, reason=refusal)
    plan = build_market(now, population.listings(found), population.traders(found))
    if not plan.today():
        return Outcome(SKIPPED, reason=NOTHING_TO_TRADE)
    signed = SignedAttempt.objects.count()
    with captured() as deferrals:
        market = Market(plan, found, deferrals)
        _apply(plan, market)
    return Outcome(PRESENT, plan, counts=summary(plan, market, SignedAttempt.objects.count() - signed))


def _grant(market):
    market.operations.user_permissions.add(*permissions(PERMISSIONS["operations"]))
    market.staff["operations"] = type(market.operations).objects.get(pk=market.operations.pk)


def _approve(approval, market):
    company = market.companies[approval.company]
    wallet = market.wallet(approval.investor, approval.address)
    entry, _ = WhitelistEntry.objects.get_or_create(wallet=wallet, defaults={"notes": ENTRY_NOTE})
    expires_at = expiry_for(entry, company)
    if expires_at == 0:
        raise ChainStepFailed(NOT_ELIGIBLE.format(address=approval.address, company=company.name))
    change = changes.submit(
        uuid4(),
        WhitelistAction.ADD,
        entry.wallet_address,
        market.operations,
        company=company,
        expires_at=expires_at,
        authority=WhitelistAuthority.WHITELIST_ADMIN,
        wallet_uuid=wallet.pk,
    )
    if change.status != WhitelistChangeStatus.CONFIRMED:
        raise ChainStepFailed(
            NOT_CONFIRMED.format(address=approval.address, company=company.name, status=change.status)
        )
    return change


def _history(plan):
    lapsed = {fill.taker: fill for fill in plan.lapses()}
    events = []
    for order in plan.orders:
        if order.key in lapsed:
            events.append((order.placed_at, 1, order.key, lapsed[order.key]))
        elif order.placed_at is not None:
            events.append((order.placed_at, 0, order.key, order))
        if order.cancelled_at is not None:
            events.append((order.cancelled_at, 2, order.key, order))
    return sorted(events, key=lambda event: event[:3])


def _parties(plan):
    addresses = set()
    for fill in plan.today():
        for key in (fill.taker, fill.maker):
            addresses.add(plan.order(key).address.lower())
    return addresses


def _replay(plan, market):
    for _, kind, _, item in _history(plan):
        if kind == 0:
            trading.place(item, market, at=item.placed_at)
        elif kind == 1:
            trading.lapse(item, market)
        else:
            trading.cancel(item, market)


def _trade(plan, market):
    funded = _parties(plan)
    provider = get_base_chain_client().w3.provider
    trading.fund(funded, lambda address: int((register.seeded_ether(address) + GAS) * WEI), provider)
    market.funded.update(funded)
    for fill in plan.today():
        trading.trade(fill, market)
    return register.completed(market)


def _settle(market, swaps):
    register.link_buyers(market, swaps)
    register.instruct_transfers(market, swaps)
    register.reconcile(market)
    register.restore_ether(market)


def _apply(plan, market):
    _grant(market)
    market.tokens = {
        listing.key: ShareToken.objects.select_related("company").get(
            company=market.companies[listing.company], symbol=listing.symbol
        )
        for listing in plan.listings
    }
    for deposit in plan.deposits:
        if deposit.state == EXECUTED:
            deposits.mint(deposit, market)
    for approval in plan.approvals:
        _approve(approval, market)
    notices = Notices(market, plan.now.astimezone(AEST).date())
    for notice in plan.notices:
        if notice.window == CLOSED:
            notices.publish(notice)
    _replay(plan, market)
    _settle(market, _trade(plan, market))
    for notice in plan.notices:
        if notice.window != CLOSED:
            notices.publish(notice)
    notices.close()
    for deposit in plan.deposits:
        if deposit.state != EXECUTED and deposit.key != SEALING_DEPOSIT:
            deposits.record(deposit, market)
    _seal(plan, market)


def _seal(plan, market):
    market.run()
    market.deferrals.require_empty()
    deposits.record(plan.deposit(SEALING_DEPOSIT), market)


def _resolution_state(publication, closes, now):
    if publication.pk in closes:
        return "carried" if closes[publication.pk] else "not carried"
    return "upcoming" if publication.opens_at > now else "open"


def _label(token):
    return f"{token.company.name.split()[0]} {token.symbol}"


def summary(plan, market, signed):
    tokens = list(market.tokens.values())
    swaps = SwapOrder.objects.filter(share_token__in=tokens)
    publications = Publication.objects.filter(token__in=tokens)
    events = PublicationEvent.objects.filter(publication__in=publications)
    closes = {
        event.publication_id: event.payload["carried"] for event in events.filter(kind=PublicationEventKind.CLOSE)
    }
    now = timezone.now()
    resolutions = publications.filter(kind="resolution")
    prices = market_summaries(tokens)
    minted = MintRequest.objects.filter(pk__in=[deposits.mint_id(deposit.key) for deposit in plan.deposits])
    held = TransferOrder.objects.filter(token__in=tokens, status=TransferOrderStatus.HELD).select_related(
        "token__company", "owner_account__user_profile__user"
    )
    return {
        "deposits": dict(Counter(minted.values_list("status", flat=True))),
        "orders": dict(Counter(TransferOrder.objects.filter(token__in=tokens).values_list("status", flat=True))),
        "swaps": dict(Counter(swaps.values_list("status", flat=True))),
        "held": [
            (
                order.owner_account.user_profile.user.email,
                order.get_order_type_display().lower(),
                order.remaining_quantity,
                _label(order.token),
                order.price_per_share,
            )
            for order in held.order_by("created_at", "pk")
        ],
        "trades": {_label(token): swaps.filter(share_token=token, status="completed").count() for token in tokens},
        "prices": {_label(token): prices.get(token.pk, {}).get("last_price") for token in tokens},
        "notices": dict(Counter(publications.values_list("kind", flat=True))),
        "resolutions": dict(Counter(_resolution_state(item, closes, now) for item in resolutions)),
        "ballots": events.filter(kind=PublicationEventKind.BALLOT).count(),
        "payments": events.filter(kind=PublicationEventKind.PAYMENT).count(),
        "approvals": len(plan.approvals),
        "transactions": signed,
        "approvals_signed": SwapApprovalSubmission.objects.filter(swap__share_token__in=tokens).count(),
    }
