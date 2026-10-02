from collections import defaultdict
from dataclasses import replace
from datetime import datetime, time, timedelta
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import NamedTuple

from shared.seeds.demo import DEMO_INVESTOR_EMAIL
from shared.seeds.synthetic.chain.story import (
    CORALGUM,
    DEMO,
    TESTER_WALLETS,
    WATTLEFIELD,
)
from shared.seeds.synthetic.clock import AEST, Calendar, utc
from shared.seeds.synthetic.market.plan import (
    Approval,
    Ballot,
    Deposit,
    Fill,
    MarketPlan,
    Notice,
    Order,
)
from shared.seeds.synthetic.market.texts import NOTICE_SPECS
from shared.seeds.synthetic.plan import SEED, stream

MARKET_STREAM = "market"
HELD_STREAM = "market-held"
CENT = Decimal("0.01")
LOT = 100
BUY = "buy"
SELL = "sell"
OPEN = "open"
PARTIAL = "partially_filled"
FILLED = "completed"
CANCELLED = "cancelled"
HELD = "held"
REST = "rest"
FOR = "for"
AGAINST = "against"
ABSTAIN = "abstain"
TESTER = DEMO_INVESTOR_EMAIL
HISTORY_DAYS = 18
SELL_SHARE = Decimal("0.5")
DEPOSIT_STEP = Decimal("500")
REFERENCES = "AUDY-{day:%y%m%d}-{number:03d}"
PENDING_DEPOSITS = (
    ("Deposit received after the daily cut-off; minted on the next business day.", 0),
    ("Second deposit from the same payer, held while the first one is matched.", 1),
)
REJECTED_DEPOSITS = (
    "The deposit came from an account in another name, so it was returned to the payer.",
    "A duplicate of a deposit already minted; the bank recalled the second transfer.",
)


class MarketSpec(NamedTuple):
    listing: str
    reference: str
    lot: tuple
    asks: tuple
    bids: tuple
    open_asks: tuple
    open_bids: tuple
    cancels: tuple = ()
    lapse: str = ""
    held: str = ""


class TesterSlot(NamedTuple):
    listing: str
    role: str
    index: int
    wallet: int
    quantity: int
    days: int = 0
    cancelled: int = 0


MARKETS = (
    MarketSpec(
        f"{DEMO}/ORD",
        "2.40",
        (1_000, 4_000),
        asks=((REST,), (0.5, REST), (0.4,)),
        bids=((REST,), (REST,)),
        open_asks=(0.04, 0.04, 0.08, 0.125),
        open_bids=(-0.04, -0.0625, -0.10),
        cancels=((SELL, 0.15, 16, 11),),
    ),
    MarketSpec(
        f"{WATTLEFIELD}/ORD",
        "0.98",
        (2_000, 8_000),
        asks=((8, REST), (REST,)),
        bids=((REST,), (0.5, REST)),
        open_asks=(0.04, 0.06, 0.10),
        open_bids=(-0.04, -0.06, -0.06, -0.10),
        cancels=((SELL, 0.08, 12, 7),),
        lapse=BUY,
    ),
    MarketSpec(
        f"{CORALGUM}/ORD",
        "2.80",
        (1_000, 5_000),
        asks=((REST,), (0.5, REST)),
        bids=((REST,), (0.6,)),
        open_asks=(0.035, 0.07, 0.09),
        open_bids=(-0.04, -0.06, -0.09),
        cancels=((BUY, -0.12, 14, 9),),
        lapse=SELL,
    ),
    MarketSpec(
        f"{DEMO}/PRF",
        "1.60",
        (1_500, 3_000),
        asks=((REST,), (0.5,)),
        bids=(),
        open_asks=(0.05, 0.09),
        open_bids=(-0.03, -0.06),
        held=SELL,
    ),
)
TESTER_SLOTS = (
    TesterSlot(f"{DEMO}/ORD", "ask", 2, 1, 2_500, days=9),
    TesterSlot(f"{WATTLEFIELD}/ORD", "ask", 1, 2, 4_000, days=6),
    TesterSlot(f"{WATTLEFIELD}/ORD", "cancel", 0, 2, 5_000, days=12, cancelled=7),
    TesterSlot(f"{CORALGUM}/ORD", "open_bid", 0, 4, 1_500, days=4),
    TesterSlot(f"{DEMO}/PRF", "take", 1, 4, 1_000),
)
ODD_LOT = (f"{WATTLEFIELD}/ORD", 0, 0)
NEW_APPROVAL = (f"{CORALGUM}/ORD", 0, 0)


def build_market(now, listings, traders, seed=SEED):
    return MarketStory(now, listings, traders, seed).build()


def money(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def lots(value):
    return max(LOT, int(value) // LOT * LOT)


class Book:
    def __init__(self):
        self.orders = []
        self.fills = []
        self.sides = defaultdict(set)

    def add(self, order):
        self.orders.append(order)
        self.sides[(order.listing, order.investor)].add(order.side)
        return order

    def side_free(self, listing, investor, side):
        return self.sides[(listing, investor)] <= {side}

    def active(self, listing):
        return {order.investor for order in self.orders if order.listing == listing}


class MarketStory:
    def __init__(self, now, listings, traders, seed):
        self.rng = stream(MARKET_STREAM, seed)
        self.held_rng = stream(HELD_STREAM, seed)
        self.calendar = Calendar(now)
        self.now = self.calendar.anchor
        self.start = self.now - timedelta(days=HISTORY_DAYS)
        self.listings = {listing.key: listing for listing in sorted(listings, key=lambda item: item.key)}
        self.traders = {trader.key: trader for trader in sorted(traders, key=lambda item: item.key)}
        self.book = Book()
        self.approvals = {}
        self.committed = defaultdict(int)
        self.numbers = defaultdict(int)
        self.used_times = defaultdict(set)
        self.reserved = defaultdict(set)

    def build(self):
        for spec in MARKETS:
            listing = self.listings.get(spec.listing)
            if listing is not None:
                self._market(spec, listing)
        orders = tuple(sorted(self.book.orders, key=lambda order: order.key))
        fills = tuple(self.book.fills)
        holdings = self._holdings(fills, orders)
        notices = self._notices(self._holdings((), orders), holdings)
        return MarketPlan(
            now=self.now,
            listings=tuple(self.listings.values()),
            approvals=tuple(sorted(self.approvals.values(), key=lambda item: (item.company, item.investor))),
            deposits=self._deposits(orders),
            orders=orders,
            fills=fills,
            notices=notices,
            holdings=holdings,
        )

    def at(self, days, hour=10, minute=0):
        local = datetime.combine(self.calendar.today - timedelta(days=days), time(hour, minute), AEST)
        return utc(local)

    def moment(self, earliest, latest, rng=None):
        rng = rng or self.rng
        earliest = max(earliest, self.start)
        if latest <= earliest:
            return None
        for _ in range(40):
            seconds = rng.randint(0, int((latest - earliest).total_seconds()))
            moment = (earliest + timedelta(seconds=seconds)).replace(microsecond=0)
            local = moment.astimezone(AEST)
            if 7 <= local.hour < 22:
                return moment
        return (earliest + (latest - earliest) / 2).replace(microsecond=0)

    def _key(self, listing, kind):
        self.numbers[listing] += 1
        return f"{listing}/{self.numbers[listing]:02d}-{kind}"

    def _sellers(self, listing):
        company = listing.company
        found = []
        for holder in listing.holders:
            trader = self.traders.get(holder.investor)
            if (
                holder.role != "investor"
                or holder.investor == TESTER
                or trader is None
                or company not in trader.companies
                or company in trader.associated
            ):
                continue
            found.append(holder)
        return found

    def _buyers(self, listing):
        company = listing.company
        held = {holder.investor for holder in listing.holders}
        approved, fresh = [], []
        for trader in self.traders.values():
            if trader.key == TESTER or company not in trader.companies or company in trader.associated:
                continue
            wallets = [wallet for wallet in trader.wallets if company in wallet.approved]
            (approved if wallets else fresh).append((trader.key in held, trader))
        approved.sort(key=lambda item: (item[0], item[1].key))
        return [trader for _, trader in approved], [trader for _, trader in fresh]

    def _tester_can(self, listing, slot):
        tester = self.traders.get(TESTER)
        address = TESTER_WALLETS[slot.wallet].lower()
        wallets = [wallet for wallet in tester.wallets if wallet.address.lower() == address] if tester else []
        if not wallets or listing.company not in wallets[0].approved:
            return False
        if slot.role in ("ask", "cancel"):
            held = sum(holder.shares for holder in listing.holders if holder.address.lower() == address)
            return held >= 2 * slot.quantity
        return True

    def _price(self, reference, offset):
        return money(reference * (1 + Decimal(str(offset))))

    def _ladder(self, reference, count, start, step, rising):
        prices = []
        for index in range(count):
            price = money(reference * (start + (step if rising else -step) * index))
            if prices and (price <= prices[-1] if rising else price >= prices[-1]):
                price = prices[-1] + (CENT if rising else -CENT)
            prices.append(price)
        return prices

    def _available(self, holder):
        cap = lots(Decimal(holder.shares) * SELL_SHARE) if holder.shares >= 2 * LOT else 0
        return cap - self.committed[(holder.investor, holder.address)]

    def _seller(self, pool, quantity, cursor, listing, avoid=frozenset()):
        for step in range(len(pool)):
            holder = pool[(cursor + step) % len(pool)]
            if holder.investor in avoid or not self.book.side_free(listing, holder.investor, SELL):
                continue
            if self._available(holder) >= LOT:
                return holder, min(quantity, self._available(holder)), cursor + step + 1
        return None, 0, cursor

    def _buyer_wallet(self, trader, company, listing):
        approved = [wallet for wallet in trader.wallets if company in wallet.approved]
        if not approved:
            return None
        held = {holder.address.lower() for holder in listing.holders}
        approved.sort(key=lambda wallet: (wallet.address.lower() in held, wallet.address.lower()))
        return approved[0].address

    def _place(self, listing, trader_key):
        trader = self.traders[trader_key]
        earliest = trader.ready_at + timedelta(hours=1)
        for _ in range(12):
            moment = self.moment(earliest, self.now - timedelta(hours=2))
            if moment is None:
                return None
            if self._free(listing, moment):
                self.used_times[listing].add(self._hour(moment))
                return moment
        return None

    @staticmethod
    def _hour(moment):
        return moment.replace(minute=0, second=0, microsecond=0)

    def _free(self, listing, moment, hours=1):
        start = self._hour(moment)
        return all(start + timedelta(hours=step) not in self.used_times[listing] for step in range(-1, hours + 1))

    def _market(self, spec, listing):
        reference = Decimal(spec.reference)
        sellers = self._sellers(listing)
        approved, fresh = self._buyers(listing)
        self.rng.shuffle(sellers)
        self.rng.shuffle(approved)
        if not sellers or not approved:
            return
        slots = {
            (slot.role, slot.index): slot
            for slot in TESTER_SLOTS
            if slot.listing == listing.key and self._tester_can(listing, slot)
        }
        state = {"seller": 0, "buyer": 0}
        ask_prices = self._ladder(reference, len(spec.asks), Decimal("1"), Decimal("0.004"), True)
        bid_prices = self._ladder(reference, len(spec.bids), Decimal("0.985"), Decimal("0.005"), False)
        makers = []
        for index, (takes, price) in enumerate(zip(spec.asks, ask_prices)):
            slot = slots.get(("ask", index))
            order = self._resting_ask(listing, sellers, state, price, spec.lot, slot)
            if order is not None:
                makers.append((order, takes, index))
        bid_makers = []
        for index, (takes, price) in enumerate(zip(spec.bids, bid_prices)):
            order = self._resting_bid(listing, approved, state, price, spec.lot)
            if order is not None:
                bid_makers.append((order, takes, index))
        for offset in spec.open_asks:
            self._resting_ask(listing, sellers, state, self._price(reference, offset), spec.lot, None)
        open_bids = []
        for index, offset in enumerate(spec.open_bids):
            slot = slots.get(("open_bid", index))
            if slot is not None:
                self._tester_order(listing, slot, BUY, self._price(reference, offset))
            else:
                open_bids.append(self._resting_bid(listing, approved, state, self._price(reference, offset), spec.lot))
        for index, (side, offset, placed, cancelled) in enumerate(spec.cancels):
            slot = slots.get(("cancel", index))
            self._cancelled(listing, side, sellers, approved, state, reference, offset, placed, cancelled, slot)
        if spec.lapse:
            targets = [order for order, _, _ in (makers if spec.lapse == BUY else bid_makers)]
            self._lapse(listing, spec.lapse, targets, sellers, approved, state, self.rng)
        buys = self._takes(listing, makers, BUY, approved, fresh, state, slots)
        sells = self._takes(listing, bid_makers, SELL, sellers, (), state, {})
        merged = []
        while buys or sells:
            if buys:
                merged.append(buys.pop(0))
            if sells:
                merged.append(sells.pop(0))
        self.book.fills.extend(merged)
        if spec.held == SELL:
            bids = sorted(filter(None, open_bids), key=lambda order: (-order.price, order.placed_at))
            self._lapse(listing, SELL, bids, sellers, approved, state, self.held_rng, held=True)

    def _resting_ask(self, listing, sellers, state, price, lot, slot, placed_at=None):
        if slot is not None:
            return self._tester_order(listing, slot, SELL, price)
        quantity = lots(self.rng.randint(*lot))
        tried = set()
        while len(tried) < len(sellers):
            holder, offered, state["seller"] = self._seller(sellers, quantity, state["seller"], listing.key)
            if holder is None or (holder.investor, holder.address) in tried:
                return None
            tried.add((holder.investor, holder.address))
            placed = self._when(listing.key, holder.investor, placed_at)
            if placed is None:
                continue
            self.committed[(holder.investor, holder.address)] += offered
            return self.book.add(
                Order(
                    key=self._key(listing.key, "ask"),
                    listing=listing.key,
                    investor=holder.investor,
                    address=holder.address,
                    side=SELL,
                    quantity=offered,
                    price=price,
                    placed_at=placed,
                )
            )
        return None

    def _when(self, listing, trader_key, moment):
        if moment is None:
            return self._place(listing, trader_key)
        return self._fixed(listing, trader_key, moment)

    def _fixed(self, listing, trader_key, moment):
        if moment is None or self.traders[trader_key].ready_at + timedelta(hours=1) > moment:
            return None
        self.used_times[listing].add(self._hour(moment))
        return moment

    def _next_buyer(self, pool, state, listing, avoid=frozenset()):
        for _ in range(len(pool)):
            trader = pool[state["buyer"] % len(pool)]
            state["buyer"] += 1
            if trader.key in avoid or trader.key in self.reserved[listing]:
                continue
            if self.book.side_free(listing, trader.key, BUY):
                return trader
        return None

    def _resting_bid(self, listing, buyers, state, price, lot, placed_at=None):
        for _ in range(len(buyers)):
            trader = self._next_buyer(buyers, state, listing.key)
            if trader is None:
                return None
            address = self._buyer_wallet(trader, listing.company, listing)
            if address is None:
                continue
            placed = self._when(listing.key, trader.key, placed_at)
            if placed is None:
                continue
            quantity = lots(self.rng.randint(*lot))
            return self.book.add(
                Order(
                    key=self._key(listing.key, "bid"),
                    listing=listing.key,
                    investor=trader.key,
                    address=address,
                    side=BUY,
                    quantity=quantity,
                    price=price,
                    placed_at=placed,
                )
            )
        return None

    def _tester_order(self, listing, slot, side, price, placed=True):
        address = TESTER_WALLETS[slot.wallet]
        if side == SELL:
            self.committed[(TESTER, address)] += slot.quantity
        moment = self.at(slot.days, 20, 30 + slot.wallet) if placed else None
        if moment is not None:
            self.used_times[listing.key].add(self._hour(moment))
        return self.book.add(
            Order(
                key=self._key(listing.key, "tester-" + ("ask" if side == SELL else "bid")),
                listing=listing.key,
                investor=TESTER,
                address=address,
                side=side,
                quantity=slot.quantity,
                price=price,
                placed_at=moment,
            )
        )

    def _cancelled(self, listing, side, sellers, buyers, state, reference, offset, placed, cancelled, slot):
        price = self._price(reference, offset)
        lot = (LOT * 10, LOT * 30)
        moment = self.at(placed, 11, self.rng.randint(0, 50))
        if slot is not None:
            order = self._tester_order(listing, slot, side, price)
            order = replace(order, cancelled_at=self.at(slot.cancelled, 19, 5))
        elif side == SELL:
            order = self._resting_ask(listing, sellers, state, price, lot, None, placed_at=moment)
            if order is not None:
                order = replace(order, cancelled_at=self.at(cancelled, 15, self.rng.randint(0, 50)))
        else:
            order = self._resting_bid(listing, buyers, state, price, lot, placed_at=moment)
            if order is not None:
                order = replace(order, cancelled_at=self.at(cancelled, 15, self.rng.randint(0, 50)))
        if order is None:
            return
        if order.cancelled_at <= order.placed_at:
            order = replace(order, cancelled_at=order.placed_at + timedelta(hours=26))
        self.book.orders[-1] = replace(order, fate=CANCELLED)

    def _lapse(self, listing, side, targets, sellers, buyers, state, rng, held=False):
        if not targets:
            return
        maker = targets[0]
        trader = None
        if side == BUY:
            busy = self.book.active(listing.key)
            for _ in range(len(buyers)):
                candidate = self._next_buyer(buyers, state, listing.key, busy)
                if candidate is None:
                    break
                if self._buyer_wallet(candidate, listing.company, listing):
                    trader = candidate
                    break
            if trader is None:
                return
            address = self._buyer_wallet(trader, listing.company, listing)
        else:
            holder, _, state["seller"] = self._seller(
                sellers, LOT, state["seller"], listing.key, self.book.active(listing.key)
            )
            if holder is None:
                return
            trader, address = self.traders[holder.investor], holder.address
        earliest = max(maker.placed_at, trader.ready_at) + timedelta(hours=3)
        moment = None
        for _ in range(24):
            found = self.moment(earliest, self.now - timedelta(hours=30), rng)
            if found is None:
                return
            found = self._hour(found) + timedelta(minutes=rng.randint(0, 4), seconds=rng.randint(0, 59))
            if found > earliest and self._free(listing.key, found):
                moment = found
                break
        if moment is None:
            return
        self.used_times[listing.key].add(self._hour(moment))
        quantity = min(maker.quantity, lots(maker.quantity * Decimal("0.4")))
        if side == SELL:
            quantity = min(quantity, self._available(holder))
            if quantity < LOT:
                return
            if held:
                self.committed[(holder.investor, holder.address)] += quantity
        order = self.book.add(
            Order(
                key=self._key(listing.key, ("held-" if held else "lapsed-") + ("bid" if side == BUY else "ask")),
                listing=listing.key,
                investor=trader.key,
                address=address,
                side=side,
                quantity=quantity,
                price=maker.price,
                placed_at=moment,
                cancelled_at=None if held else moment + timedelta(minutes=rng.randint(25, 55)),
                fate=HELD if held else CANCELLED,
            )
        )
        self.book.fills.append(Fill(listing.key, order.key, maker.key, quantity, maker.price, lapsed=True))

    def _takes(self, listing, makers, side, pool, fresh, state, slots):
        fills = []
        for position, (maker, takes, index) in enumerate(makers):
            last = position == len(makers) - 1
            remaining = maker.quantity
            planned = list(takes)
            number = 0
            while number < len(planned) and remaining > 0:
                take = planned[number]
                slot = slots.get(("take", index)) if number == 0 else None
                if take == REST:
                    quantity = remaining
                elif isinstance(take, int):
                    quantity = take
                else:
                    quantity = min(remaining, lots(Decimal(maker.quantity) * Decimal(str(take))))
                if slot is not None:
                    quantity = min(remaining, slot.quantity)
                taker = None
                if 0 < quantity <= remaining:
                    taker = self._taker(listing, maker, side, quantity, pool, fresh, state, slot, (index, number))
                if taker is not None:
                    remaining -= taker.quantity
                    fills.append(Fill(listing.key, taker.key, maker.key, taker.quantity, maker.price))
                    if take == REST and remaining > 0 and not last:
                        planned.append(REST)
                elif take == REST and not last:
                    break
                number += 1
            self._settled(maker, maker.quantity - remaining)
            if remaining > 0 and not last:
                for later, _, _ in makers[position + 1 :]:
                    self._settled(later, 0)
                break
        return fills

    def _settled(self, maker, filled):
        fate = FILLED if filled == maker.quantity else PARTIAL if filled else OPEN
        position = next(index for index, order in enumerate(self.book.orders) if order.key == maker.key)
        self.book.orders[position] = replace(maker, fate=fate, filled=filled)

    def _taker(self, listing, maker, side, quantity, pool, fresh, state, slot, where):
        if slot is not None:
            order = self._tester_order(listing, slot, side, maker.price, placed=False)
            position = len(self.book.orders) - 1
            self.book.orders[position] = replace(order, quantity=quantity, fate=FILLED, filled=quantity)
            return self.book.orders[position]
        if side == SELL:
            busy = self.book.active(listing.key)
            holder, offered, state["seller"] = self._seller(pool, quantity, state["seller"], listing.key, busy)
            if holder is None:
                busy = {maker.investor}
                holder, offered, state["seller"] = self._seller(pool, quantity, state["seller"], listing.key, busy)
            if holder is None:
                return None
            quantity = offered
            self.committed[(holder.investor, holder.address)] += quantity
            investor, address = holder.investor, holder.address
        else:
            trader, address = self._taking_buyer(listing, maker, pool, fresh, state, where)
            if trader is None:
                return None
            investor = trader.key
        return self.book.add(
            Order(
                key=self._key(listing.key, "taker-" + side),
                listing=listing.key,
                investor=investor,
                address=address,
                side=side,
                quantity=quantity,
                price=maker.price,
                fate=FILLED,
                filled=quantity,
            )
        )

    def _taking_buyer(self, listing, maker, pool, fresh, state, where):
        company = listing.company
        if (listing.key, *where) == NEW_APPROVAL and fresh:
            trader = fresh[0]
            address = trader.wallets[0].address
            self.approvals[(trader.key, company)] = Approval(trader.key, address, company)
            return trader, address
        if (listing.key, *where) == ODD_LOT:
            busy = self.book.active(listing.key)
            first_timers = [trader for trader in pool if not listing.held(trader.key) and trader.key not in busy]
            if first_timers:
                trader = first_timers[self.rng.randrange(len(first_timers))]
                self.reserved[listing.key].add(trader.key)
                return trader, self._buyer_wallet(trader, company, listing)
        for avoid in (self.book.active(listing.key), {maker.investor}):
            for _ in range(len(pool)):
                trader = self._next_buyer(pool, state, listing.key, avoid)
                if trader is None:
                    break
                address = self._buyer_wallet(trader, company, listing)
                if address and address.lower() != maker.address.lower():
                    return trader, address
        return None, None

    def _holdings(self, fills, orders):
        orders = {order.key: order for order in orders}
        held = defaultdict(int)
        for listing in self.listings.values():
            for holder in listing.holders:
                held[(listing.key, holder.investor)] += holder.shares
        for fill in fills:
            if fill.lapsed:
                continue
            taker, maker = orders[fill.taker], orders[fill.maker]
            buyer, seller = (taker, maker) if taker.side == BUY else (maker, taker)
            held[(fill.listing, buyer.investor)] += fill.quantity
            held[(fill.listing, seller.investor)] -= fill.quantity
        return {key: shares for key, shares in sorted(held.items()) if shares > 0}

    def _deposits(self, orders):
        needed = defaultdict(Decimal)
        first = {}
        for order in orders:
            if order.side != BUY:
                continue
            key = (order.investor, order.address)
            needed[key] += Decimal(order.quantity) * order.price
            moment = order.placed_at or self.now
            first[key] = min(first.get(key, moment), moment)
        deposits = []
        for number, (key, total) in enumerate(sorted(needed.items()), start=1):
            investor, address = key
            amount = (total / DEPOSIT_STEP).to_integral_value(rounding=ROUND_CEILING) * DEPOSIT_STEP
            amount += DEPOSIT_STEP * self.rng.choice((0, 1, 1, 2, 4))
            received = (first[key] - timedelta(days=self.rng.randint(1, 3))).astimezone(AEST).date()
            deposits.append(
                Deposit(
                    key=f"deposit-{number:03d}",
                    investor=investor,
                    address=address,
                    amount=amount.quantize(CENT),
                    received_on=max(received, (self.start - timedelta(days=3)).astimezone(AEST).date()),
                    reference=REFERENCES.format(day=received, number=number),
                    state="executed",
                )
            )
        deposits += self._unminted(deposits, len(deposits))
        return tuple(deposits)

    def _unminted(self, minted, count):
        if not minted:
            return []
        extra = []
        payers = sorted({(deposit.investor, deposit.address) for deposit in minted})
        for offset, reason in enumerate(REJECTED_DEPOSITS):
            investor, address = payers[(offset * 3 + 1) % len(payers)]
            recorded = self.at(self.rng.randint(5, 12), self.rng.randint(9, 16), self.rng.randint(0, 59))
            count += 1
            extra.append(
                Deposit(
                    key=f"rejected-{offset + 1}",
                    investor=investor,
                    address=address,
                    amount=Decimal(self.rng.choice((1500, 4000, 7500, 12000))).quantize(CENT),
                    received_on=recorded.astimezone(AEST).date(),
                    reference=REFERENCES.format(day=recorded.astimezone(AEST).date(), number=count),
                    state="rejected",
                    recorded_at=recorded,
                    decided_at=recorded + timedelta(hours=self.rng.randint(2, 20)),
                    reason=reason,
                )
            )
        for offset, (reason, days) in enumerate(PENDING_DEPOSITS):
            investor, address = payers[(offset * 5 + 2) % len(payers)]
            recorded = self.at(days + 1, 17, self.rng.randint(10, 50)) if days else self.at(1, 16, 45)
            count += 1
            extra.append(
                Deposit(
                    key=f"pending-{offset + 1}",
                    investor=investor,
                    address=address,
                    amount=Decimal(self.rng.choice((2500, 5000, 10000))).quantize(CENT),
                    received_on=recorded.astimezone(AEST).date(),
                    reference=REFERENCES.format(day=recorded.astimezone(AEST).date(), number=count),
                    state="pending",
                    recorded_at=recorded,
                    reason=reason,
                )
            )
        return extra

    def _notices(self, morning, evening):
        notices = []
        for spec in NOTICE_SPECS:
            listing = self.listings.get(spec.listing)
            if listing is None:
                continue
            holdings = morning if spec.window == "closed" else evening
            members = {investor: shares for (key, investor), shares in holdings.items() if key == spec.listing}
            notices.append(self._notice(spec, listing, members))
        return tuple(notices)

    def _meeting(self, days, hour=10):
        return self.at(-days, hour)

    def _notice(self, spec, listing, members):
        record = self.calendar.today
        meeting = self._meeting(spec.meeting).astimezone(AEST)
        lines = tuple(line.format(record=record, meeting=meeting) for line in spec.lines)
        title = spec.title.format(record=record)
        base = {
            "key": spec.key,
            "listing": spec.listing,
            "kind": spec.kind,
            "title": title,
            "lines": lines,
            "authority": spec.authority,
        }
        if spec.kind == "resolution":
            opens_at = self.at(-spec.opens, 9) if spec.window == "upcoming" else None
            closes_at = self._meeting(spec.meeting) if spec.window != "closed" else None
            return Notice(
                **base,
                question=spec.question,
                resolution_kind=spec.resolution_kind,
                window=spec.window,
                opens_at=opens_at,
                closes_at=closes_at,
                ballots=self._ballots(spec, listing, members),
                carried=spec.outcome == "carried" if spec.window == "closed" else None,
            )
        if spec.kind == "distribution":
            return Notice(
                **base,
                rate=Decimal(spec.rate),
                declared_on=record - timedelta(days=spec.declared),
                payment_date=record + timedelta(days=spec.payment),
                paid=self._payees(spec, listing, members),
            )
        return Notice(**base)

    def _voters(self, listing, members):
        founder = next((holder.investor for holder in listing.holders if holder.role == "company"), None)
        others = sorted(
            (investor for investor in members if investor not in (founder, TESTER) and investor in self.traders),
            key=lambda investor: (-members[investor], investor),
        )
        return founder if founder in members else None, others

    def _ballots(self, spec, listing, members):
        if spec.window == "upcoming" or not spec.outcome:
            return ()
        founder, others = self._voters(listing, members)
        ballots = []
        if spec.tester and TESTER in members:
            ballots.append(Ballot(TESTER, spec.tester))
        if spec.outcome == "some":
            count = min(len(others), self.rng.randint(3, 5))
            for investor in self.rng.sample(others, count):
                ballots.append(Ballot(investor, self.rng.choice((FOR, FOR, FOR, AGAINST, ABSTAIN))))
            return tuple(ballots)
        carried = spec.outcome == "carried"
        special = spec.resolution_kind == "special"
        voters = self.rng.sample(others, min(len(others), self.rng.randint(5, 8)))
        voters.sort(key=lambda investor: (-members[investor], investor))
        for position, investor in enumerate(voters):
            if carried:
                choice = AGAINST if position == 1 else ABSTAIN if position == len(voters) - 1 else FOR
            else:
                choice = AGAINST if position < max(2, len(voters) // 2) else FOR
            ballots.append(Ballot(investor, choice))
        fixed = {TESTER}
        if founder is not None:
            fixed.add(founder)
            choice = FOR if carried or special else ABSTAIN
            settled = self._settle_outcome([*ballots, Ballot(founder, choice)], members, carried, special, fixed)
            if settled is not None:
                return tuple(settled)
        settled = self._settle_outcome(ballots, members, carried, special, fixed)
        if settled is None:
            raise ValueError(f"The ballots planned for {spec.key} cannot reach the planned outcome.")
        return tuple(settled)

    @staticmethod
    def _outcome(ballots, members, special):
        shares = defaultdict(int)
        for ballot in ballots:
            shares[ballot.choice] += members.get(ballot.voter, 0)
        if special:
            return shares[FOR] + shares[AGAINST] > 0 and shares[FOR] * 4 >= (shares[FOR] + shares[AGAINST]) * 3
        return shares[FOR] > shares[AGAINST]

    def _settle_outcome(self, ballots, members, carried, special, fixed):
        ballots = list(ballots)
        right = FOR if carried else AGAINST
        for _ in range(len(ballots) + 1):
            if self._outcome(ballots, members, special) == carried:
                return ballots
            movable = [
                index for index, ballot in enumerate(ballots) if ballot.choice != right and ballot.voter not in fixed
            ]
            if not movable:
                return None
            index = max(movable, key=lambda position: (members.get(ballots[position].voter, 0), position))
            ballots[index] = Ballot(ballots[index].voter, right)
        return None

    def _payees(self, spec, listing, members):
        if spec.paid == "none":
            return ()
        everyone = sorted(investor for investor in members if investor != TESTER)
        if spec.paid == "all":
            return ("*",)
        count = max(1, len(everyone) // 2)
        return tuple(sorted(self.rng.sample(everyone, count)))
