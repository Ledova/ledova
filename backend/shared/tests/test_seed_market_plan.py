from collections import Counter, defaultdict
from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from assets.models import Asset, AssetChainDeployment
from operators.models import Operator
from operators.settlement import single_settlement_asset
from shared.constants import BLOCKCHAIN_BASE, BLOCKCHAIN_ETHEREUM
from shared.seeds.demo import DEMO_INVESTOR_EMAIL
from shared.seeds.synthetic.chain import population as chain_population
from shared.seeds.synthetic.chain.approvals import approved_addresses
from shared.seeds.synthetic.chain.deferred import UnexpectedJob, captured
from shared.seeds.synthetic.chain.story import TESTER_WALLETS, build_issuance
from shared.seeds.synthetic.clock import AEST, Calendar
from shared.seeds.synthetic.market import layer
from shared.seeds.synthetic.market.context import Market
from shared.seeds.synthetic.market.deposits import mint_id
from shared.seeds.synthetic.market.plan import Holder, Listing, Trader, TraderWallet
from shared.seeds.synthetic.market.story import (
    BUY,
    CANCELLED,
    FILLED,
    MARKETS,
    OPEN,
    PARTIAL,
    SELL,
    build_market,
)
from shared.seeds.synthetic.plan import DEFAULT_INVESTORS, MINIMUM_INVESTORS
from shared.seeds.synthetic.staff import PERMISSIONS
from shareholders.services.distributions import entitlement
from tokens.models import MintRequest, ShareToken
from users.models import Notification, UserProfile
from users.tasks.notifications import send_push_notification
from wallets.tasks import sync_wallet

PASSWORD = "pw-12345678"
User = get_user_model()
NODE = "web3.providers.rpc.HTTPProvider.make_request"
RECORD = "shared.seeds.synthetic.market.deposits.record"
TESTER = DEMO_INVESTOR_EMAIL
NOW = "now"


def seed(**options):
    output = StringIO()
    call_command("seed_demo", stdout=output, password=PASSWORD, **options)
    return output.getvalue()


def market_inputs(issuance, candidates):
    roles = {candidate.key: candidate.role for candidate in candidates}
    approved = {company: set(approved_addresses(issuance, company)) for company in issuance.directors}
    listings = []
    for share_class in issuance.classes:
        if share_class.target != "deployed":
            continue
        held = defaultdict(int)
        for position in share_class.positions:
            held[(position.holder, position.address)] += position.shares
        for item in issuance.rounds_of(share_class.key):
            for application in item.applications:
                if application.status == "allotted" and application.allotted:
                    held[(application.investor, application.address)] += application.allotted
        for request in issuance.requests:
            if request.share_class == share_class.key and request.status == "executed":
                held[(request.holder, request.address)] += request.shares
        holders = sorted(
            (
                Holder(investor, address, shares, roles[investor])
                for (investor, address), shares in held.items()
                if investor in roles
            ),
            key=lambda holder: (holder.investor, holder.address.lower()),
        )
        listings.append(
            Listing(
                key=share_class.key,
                company=share_class.company,
                symbol=share_class.symbol,
                name=share_class.name,
                holders=tuple(holders),
            )
        )
    traders = [
        Trader(
            key=candidate.key,
            name=candidate.name,
            ready_at=candidate.ready_at,
            companies=candidate.companies,
            associated=candidate.associated,
            wallets=tuple(
                TraderWallet(
                    address=wallet.address,
                    verified_at=wallet.verified_at,
                    approved=frozenset(
                        company for company, addresses in approved.items() if wallet.address.lower() in addresses
                    ),
                )
                for wallet in candidate.wallets
            ),
        )
        for candidate in candidates
        if candidate.role == "investor" and candidate.ready_at is not None and not candidate.large_only
    ]
    return listings, traders


def build(found, now, seed_value=None):
    candidates = chain_population.candidates(found)
    issuance = build_issuance(now, chain_population.firms(found), candidates)
    listings, traders = market_inputs(issuance, candidates)
    options = {} if seed_value is None else {"seed": seed_value}
    return build_market(now, listings, traders, **options), listings, traders


def history(plan):
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


class Replay:
    def __init__(self, plan):
        self.plan = plan
        self.book = defaultdict(dict)
        self.remaining = {}
        self.placed = {}
        self.crossed = []
        self.cancelled = set()
        self.open_lapses = set()

    def best(self, order):
        others = [
            resting
            for resting in self.book[order.listing].values()
            if resting.side != order.side
            and resting.address.lower() != order.address.lower()
            and self.remaining[resting.key] > 0
            and (resting.price <= order.price if order.side == BUY else resting.price >= order.price)
        ]
        if not others:
            return None
        if order.side == BUY:
            return min(others, key=lambda resting: (resting.price, self.placed[resting.key], resting.key))
        return min(others, key=lambda resting: (-resting.price, self.placed[resting.key], resting.key))

    def rest(self, order, moment):
        self.book[order.listing][order.key] = order
        self.remaining.setdefault(order.key, order.quantity)
        self.placed[order.key] = moment

    def check_spread(self, listing):
        if self.open_lapses:
            return
        resting = [order for order in self.book[listing].values() if self.remaining[order.key] > 0]
        bids = [order.price for order in resting if order.side == BUY]
        asks = [order.price for order in resting if order.side == SELL]
        if bids and asks and max(bids) >= min(asks):
            self.crossed.append((listing, max(bids), min(asks)))

    def run(self):
        for moment, kind, key, item in history(self.plan):
            if kind == 0:
                assert self.best(item) is None, f"{key} would match on placement"
                self.rest(item, moment)
                self.check_spread(item.listing)
            elif kind == 1:
                taker = self.plan.order(item.taker)
                maker = self.best(taker)
                assert maker is not None and maker.key == item.maker, f"{key} would not match {item.maker}"
                self.rest(taker, moment)
                self.open_lapses.add(key)
            else:
                assert key in self.book[item.listing], f"{key} is cancelled without resting"
                del self.book[item.listing][key]
                self.cancelled.add(key)
                self.open_lapses.discard(key)
                self.check_spread(item.listing)
        later = max(self.placed.values()) + timedelta(days=1)
        for number, fill in enumerate(self.plan.today()):
            taker = self.plan.order(fill.taker)
            maker = self.best(taker)
            assert maker is not None and maker.key == fill.maker, f"{fill.taker} would not match {fill.maker}"
            quantity = min(taker.quantity, self.remaining[maker.key])
            assert quantity == fill.quantity, f"{fill.taker} would fill {quantity}, not {fill.quantity}"
            self.remaining[maker.key] -= quantity
            self.remaining[taker.key] = taker.quantity - quantity
            if self.remaining[taker.key]:
                self.rest(taker, later + timedelta(seconds=number))
            self.check_spread(taker.listing)
        return self

    def fate(self, order):
        if order.key in self.cancelled:
            return CANCELLED
        filled = order.quantity - self.remaining.get(order.key, order.quantity)
        return FILLED if filled == order.quantity else PARTIAL if filled else OPEN


@override_settings(DEBUG=True)
class MarketPlanTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command("sync_monitoring_rules", stdout=StringIO())
        with patch(NODE):
            seed(investors=DEFAULT_INVESTORS)
        cls.found = chain_population.companies()
        cls.now = timezone.now()
        cls.plan, cls.listings, cls.traders = build(cls.found, cls.now)
        cls.anchor = Calendar(cls.now).anchor
        cls.traders_by_key = {trader.key: trader for trader in cls.traders}

    def test_the_plan_is_the_same_on_every_build_and_changes_with_the_seed(self):
        again, _, _ = build(self.found, self.now)
        other, _, _ = build(self.found, self.now, seed_value=1)

        self.assertEqual(again, self.plan)
        self.assertNotEqual(other.orders, self.plan.orders)

    def test_the_plan_depends_on_the_day_of_the_run_and_not_its_time(self):
        early, _, _ = build(self.found, self.anchor + timedelta(hours=1))
        late, _, _ = build(self.found, self.anchor + timedelta(hours=22))

        self.assertEqual(early, late)

    def test_the_orders_replay_to_their_planned_fates_under_the_matching_rules(self):
        replay = Replay(self.plan).run()

        self.assertEqual(replay.crossed, [])
        for order in self.plan.orders:
            self.assertEqual(replay.fate(order), order.fate, order.key)
            if order.fate != CANCELLED:
                self.assertEqual(order.quantity - replay.remaining[order.key], order.filled, order.key)

    def test_every_traded_class_settles_trades_and_leaves_a_book_on_both_sides(self):
        trades = Counter(fill.listing for fill in self.plan.today())
        self.assertGreaterEqual(sum(trades.values()), 15)
        self.assertEqual(set(trades), {spec.listing for spec in MARKETS})
        resting = defaultdict(set)
        for order in self.plan.orders:
            if order.fate in (OPEN, PARTIAL):
                resting[(order.listing, order.side)].add(order.price)
        for spec in MARKETS:
            self.assertGreaterEqual(len(resting[(spec.listing, SELL)]), 2, spec.listing)
            self.assertGreaterEqual(len(resting[(spec.listing, BUY)]), 2, spec.listing)
            prices = [fill.price for fill in self.plan.today() if fill.listing == spec.listing]
            reference = Decimal(spec.reference)
            self.assertTrue(all(abs(price - reference) <= reference / 20 for price in prices), spec.listing)

    def test_each_class_settles_at_least_every_take_its_spec_plans(self):
        trades = Counter(fill.listing for fill in self.plan.today())
        for spec in MARKETS:
            planned = sum(len(takes) for takes in (*spec.asks, *spec.bids))
            self.assertGreaterEqual(trades[spec.listing], planned, spec.listing)

    def test_orders_cover_every_status_a_market_shows_and_two_matches_lapse(self):
        self.assertEqual({order.fate for order in self.plan.orders}, {OPEN, PARTIAL, FILLED, CANCELLED})
        self.assertEqual(len(self.plan.lapses()), 2)
        for fill in self.plan.lapses():
            taker = self.plan.order(fill.taker)
            self.assertEqual(taker.fate, CANCELLED)
            self.assertLess(taker.cancelled_at - taker.placed_at, timedelta(hours=1))

    def test_the_investor_tester_has_orders_in_four_statuses_and_buys_a_class_into_a_new_wallet(self):
        mine = [order for order in self.plan.orders if order.investor == TESTER]
        self.assertEqual({order.fate for order in mine}, {OPEN, PARTIAL, FILLED, CANCELLED})
        bought = [order for order in mine if order.side == BUY and order.fate == FILLED]
        self.assertEqual(len(bought), 1)
        listing = next(item for item in self.listings if item.key == bought[0].listing)
        self.assertNotIn(bought[0].address.lower(), {holder.address.lower() for holder in listing.holders})
        self.assertEqual(bought[0].address, TESTER_WALLETS[4])

    def test_everyone_trades_one_side_of_a_class_within_half_their_holding(self):
        sides = defaultdict(set)
        offered = defaultdict(int)
        for order in self.plan.orders:
            sides[(order.listing, order.investor)].add(order.side)
            if order.side == SELL:
                offered[(order.listing, order.address.lower())] += order.quantity
        self.assertTrue(all(len(found) == 1 for found in sides.values()), sides)
        holdings = {
            (listing.key, holder.address.lower()): holder.shares
            for listing in self.listings
            for holder in listing.holders
        }
        for key, quantity in offered.items():
            self.assertLessEqual(quantity, holdings[key], key)

    def test_history_is_dated_before_the_day_of_the_run_after_each_trader_could_trade(self):
        start = self.anchor - timedelta(days=19)
        for order in self.plan.orders:
            if order.placed_at is None:
                self.assertEqual(order.fate, FILLED, order.key)
                continue
            self.assertTrue(start <= order.placed_at < self.anchor, order.key)
            self.assertGreater(order.placed_at, self.traders_by_key[order.investor].ready_at, order.key)
            self.assertTrue(7 <= order.placed_at.astimezone(AEST).hour < 22, order.key)
            if order.cancelled_at is not None:
                self.assertTrue(order.placed_at < order.cancelled_at < self.anchor, order.key)

    def test_each_buyer_is_approved_for_the_company_or_planned_an_approval(self):
        approvals = {(item.investor, item.address.lower(), item.company) for item in self.plan.approvals}
        self.assertEqual(len(approvals), 1)
        companies = {listing.key: listing.company for listing in self.listings}
        for order in self.plan.orders:
            if order.side != BUY:
                continue
            company = companies[order.listing]
            wallet = self.traders_by_key[order.investor].wallet(order.address)
            planned = (order.investor, order.address.lower(), company) in approvals
            self.assertTrue(company in wallet.approved or planned, order.key)

    def test_deposits_cover_every_bid_before_it_and_unminted_ones_are_pending_or_rejected(self):
        needed = defaultdict(Decimal)
        first = {}
        for order in self.plan.orders:
            if order.side == BUY:
                key = (order.investor, order.address)
                needed[key] += order.quantity * order.price
                first[key] = min(first.get(key, self.anchor), order.placed_at or self.anchor)
        minted = {
            (deposit.investor, deposit.address): deposit
            for deposit in self.plan.deposits
            if deposit.state == "executed"
        }
        self.assertEqual(set(minted), set(needed))
        for key, deposit in minted.items():
            self.assertGreaterEqual(deposit.amount, needed[key], key)
            self.assertLess(deposit.received_on, first[key].astimezone(AEST).date(), key)
        states = Counter(deposit.state for deposit in self.plan.deposits)
        self.assertEqual((states["pending"], states["rejected"]), (2, 2))
        self.assertEqual(len({deposit.reference for deposit in self.plan.deposits}), len(self.plan.deposits))
        self.assertEqual(self.plan.deposits[0].key, layer.FIRST_DEPOSIT)
        self.assertEqual(self.plan.deposits[-1].key, layer.SEALING_DEPOSIT)

    def test_the_tester_gets_more_than_a_page_of_notices_of_every_kind(self):
        held = {key for (key, investor) in self.plan.holdings if investor == TESTER}
        mine = [notice for notice in self.plan.notices if notice.listing in held]
        self.assertGreater(len(mine), 25)
        self.assertEqual(
            {notice.kind for notice in mine}, {"holding_statement", "meeting_notice", "resolution", "distribution"}
        )
        windows = Counter(notice.window for notice in mine if notice.kind == "resolution")
        self.assertTrue(windows["open"] and windows["upcoming"] and windows["closed"])
        voted = {notice.key for notice in mine for ballot in notice.ballots if ballot.voter == TESTER}
        unvoted = [notice for notice in mine if notice.window == "open" and notice.key not in voted]
        self.assertTrue(voted and unvoted)

    def test_closed_resolutions_reach_their_outcome_from_the_morning_roll(self):
        morning = defaultdict(int)
        for listing in self.listings:
            for holder in listing.holders:
                morning[(listing.key, holder.investor)] += holder.shares
        outcomes = []
        for notice in self.plan.notices:
            if notice.window != "closed":
                continue
            shares = defaultdict(int)
            for ballot in notice.ballots:
                self.assertIn((notice.listing, ballot.voter), morning, notice.key)
                shares[ballot.choice] += morning[(notice.listing, ballot.voter)]
            cast = shares["for"] + shares["against"]
            if notice.resolution_kind == "special":
                carried = cast > 0 and shares["for"] * 4 >= cast * 3
            else:
                carried = shares["for"] > shares["against"]
            self.assertEqual(carried, notice.carried, notice.key)
            outcomes.append(carried)
        self.assertEqual(Counter(outcomes), Counter({True: 2, False: 3}))

    def test_dividends_are_recorded_for_all_some_and_none_and_an_odd_lot_gets_nothing(self):
        dividends = {notice.key: notice for notice in self.plan.notices if notice.kind == "distribution"}
        self.assertEqual({len(notice.paid) > 1 for notice in dividends.values() if notice.paid}, {False, True})
        self.assertIn((), [notice.paid for notice in dividends.values()])
        special = dividends["wattlefield-special-dividend"]
        members = {investor: shares for (key, investor), shares in self.plan.holdings.items() if key == special.listing}
        nothing = [investor for investor, shares in members.items() if entitlement(shares, special.rate) == 0]
        self.assertEqual(len(nothing), 1)
        self.assertLess(members[nothing[0]], 10)
        self.assertNotIn(nothing[0], {holder.investor for holder in self.plan.listing(special.listing).holders})


@override_settings(DEBUG=True)
class SmallMarketPlanTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command("sync_monitoring_rules", stdout=StringIO())
        with patch(NODE):
            seed(investors=MINIMUM_INVESTORS)
        cls.found = chain_population.companies()

    def test_a_minimum_population_plans_a_coherent_market(self):
        plan, _, _ = build(self.found, timezone.now())
        replay = Replay(plan).run()

        self.assertTrue(plan.today())
        self.assertEqual(replay.crossed, [])
        for order in plan.orders:
            self.assertEqual(replay.fate(order), order.fate, order.key)

    def test_the_layer_is_skipped_without_the_chain_layer_and_reads_no_chain(self):
        with patch(NODE) as rpc:
            outcome = layer.seed_market(timezone.now())

        self.assertEqual((outcome.state, outcome.reason), (layer.SKIPPED, layer.NO_CHAIN_LAYER))
        self.assertFalse(rpc.called)

    def deposit(self, key):
        audy = Asset.objects.get(symbol="AUDY")
        profile = UserProfile.objects.filter(user__email=TESTER).first()
        return MintRequest.objects.create(
            pk=mint_id(key),
            settlement_asset=audy,
            recipient_address=TESTER_WALLETS[4],
            recipient_name=profile.full_name,
            amount=100,
            deposit_reference=f"AUDY-TEST-{key}",
            deposit_date=timezone.localdate(),
            requested_by=profile.user,
        )

    def test_a_layer_that_started_or_finished_is_reported_and_left_alone_without_reading_the_chain(self):
        self.assertEqual(layer.market_state(), layer.ABSENT)
        self.deposit(layer.FIRST_DEPOSIT)
        with patch(NODE) as rpc:
            started = layer.seed_market(timezone.now())
        self.deposit(layer.SEALING_DEPOSIT)
        with patch(NODE):
            finished = layer.seed_market(timezone.now())

        self.assertEqual((started.state, finished.state, finished.plan), (layer.PARTIAL, layer.PRESENT, None))
        self.assertFalse(rpc.called)

    def test_an_operator_settling_in_anything_but_audy_is_skipped_before_any_write(self):
        usdc = Asset.objects.get(symbol="USDC")
        AssetChainDeployment.objects.update_or_create(
            asset=usdc,
            chain=BLOCKCHAIN_BASE,
            defaults={"contract_address": "0x" + "c3" * 20, "decimals": 6, "is_active": True},
        )
        Operator.get().supported_settlement_assets.set([usdc])
        present = "shared.seeds.synthetic.market.layer.chain_layer.issuance_state"
        with patch(present, return_value=layer.chain_layer.PRESENT), patch(
            "shared.seeds.synthetic.market.layer.chain_refusal", return_value=None
        ), patch(NODE) as rpc:
            outcome = layer.seed_market(timezone.now())

        self.assertEqual(single_settlement_asset(), usdc)
        self.assertEqual((outcome.state, outcome.reason), (layer.SKIPPED, layer.NOT_AUDY))
        self.assertFalse(rpc.called)
        self.assertEqual(layer.market_state(), layer.ABSENT)

    def test_an_operator_receiving_on_another_chain_is_skipped_before_any_write(self):
        audy = Asset.objects.get(symbol="AUDY")
        AssetChainDeployment.objects.update_or_create(
            asset=audy,
            chain=BLOCKCHAIN_ETHEREUM,
            defaults={"contract_address": "0x" + "a1" * 20, "decimals": 2, "is_active": True},
        )
        operator = Operator.get()
        operator.supported_settlement_assets.set([audy])
        Operator.objects.filter(pk=operator.pk).update(
            receiving_wallet_address="0x" + "b2" * 20, receiving_wallet_chain=BLOCKCHAIN_ETHEREUM
        )
        present = "shared.seeds.synthetic.market.layer.chain_layer.issuance_state"
        with patch(present, return_value=layer.chain_layer.PRESENT), patch(
            "shared.seeds.synthetic.market.layer.chain_refusal", return_value=None
        ), patch(NODE) as rpc:
            outcome = layer.seed_market(timezone.now())

        self.assertEqual(single_settlement_asset(), audy)
        self.assertEqual((outcome.state, outcome.reason), (layer.SKIPPED, layer.NOT_AUDY))
        self.assertFalse(rpc.called)
        self.assertEqual(layer.market_state(), layer.ABSENT)

    def test_a_deployed_class_without_code_on_the_node_is_skipped_with_the_class_named(self):
        audy = Asset.objects.get(symbol="AUDY")
        Operator.get().supported_settlement_assets.set([audy])
        ShareToken.objects.create(
            company=self.found["wattlefield"],
            symbol="ORD",
            name="Ordinary Shares",
            total_supply="1000",
            status="deployed",
            contract_address="0x" + "e5" * 20,
        )
        present = "shared.seeds.synthetic.market.layer.chain_layer.issuance_state"
        answer = {"jsonrpc": "2.0", "id": 1, "result": "0x"}
        with patch(present, return_value=layer.chain_layer.PRESENT), patch(
            "shared.seeds.synthetic.market.layer.chain_refusal", return_value=None
        ), patch("shared.seeds.synthetic.market.layer._settlement_refusal", return_value=None), patch(
            NODE, return_value=answer
        ):
            outcome = layer.seed_market(timezone.now())

        self.assertEqual(outcome.state, layer.SKIPPED)
        self.assertIn("ORD of Wattlefield", outcome.reason)

    def recorded(self, deposit, market):
        return self.deposit(deposit.key)

    def test_a_job_queued_by_the_last_step_runs_before_the_market_seals_itself(self):
        plan, _, _ = build(self.found, timezone.now())
        investor = User.objects.get(email=TESTER)

        with patch(RECORD, side_effect=self.recorded), captured() as deferrals:
            send_push_notification.defer(user_id=investor.pk, title="Notices closed", body="Every vote is in.")
            layer._seal(plan, Market(plan, self.found, deferrals))

        self.assertEqual(layer.market_state(), layer.PRESENT)
        self.assertTrue(Notification.objects.filter(user=investor, title="Notices closed").exists())

    def test_a_job_the_market_cannot_run_stops_it_before_it_seals_itself(self):
        plan, _, _ = build(self.found, timezone.now())

        with self.assertRaisesMessage(UnexpectedJob, sync_wallet.name):
            with patch(RECORD, side_effect=self.recorded), captured() as deferrals:
                sync_wallet.defer(wallet_uuid=str(uuid4()), principal_id=None)
                layer._seal(plan, Market(plan, self.found, deferrals))

        self.assertEqual(layer.market_state(), layer.ABSENT)

    def test_the_operations_officer_can_mint_audy_and_publish_to_members(self):
        self.assertTrue(
            {
                "assets.change_asset",
                "tokens.change_mintrequest",
                "shareholders.change_publication",
                "shareholders.view_publicationevent",
            }
            <= set(PERMISSIONS["operations"])
        )
