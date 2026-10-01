from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal


@dataclass(frozen=True)
class Holder:
    investor: str
    address: str
    shares: int
    role: str = "investor"


@dataclass(frozen=True)
class Listing:
    key: str
    company: str
    symbol: str
    name: str
    holders: tuple

    def held(self, investor):
        return sum(holder.shares for holder in self.holders if holder.investor == investor)


@dataclass(frozen=True)
class TraderWallet:
    address: str
    verified_at: datetime
    approved: frozenset = frozenset()


@dataclass(frozen=True)
class Trader:
    key: str
    name: str
    ready_at: datetime
    companies: frozenset
    associated: frozenset
    wallets: tuple

    def wallet(self, address):
        return next(wallet for wallet in self.wallets if wallet.address.lower() == address.lower())


@dataclass(frozen=True)
class Deposit:
    key: str
    investor: str
    address: str
    amount: Decimal
    received_on: date
    reference: str
    state: str
    recorded_at: datetime | None = None
    decided_at: datetime | None = None
    reason: str = ""


@dataclass(frozen=True)
class Approval:
    investor: str
    address: str
    company: str


@dataclass(frozen=True)
class Order:
    key: str
    listing: str
    investor: str
    address: str
    side: str
    quantity: int
    price: Decimal
    placed_at: datetime | None = None
    cancelled_at: datetime | None = None
    fate: str = "open"
    filled: int = 0


@dataclass(frozen=True)
class Fill:
    listing: str
    taker: str
    maker: str
    quantity: int
    price: Decimal
    lapsed: bool = False


@dataclass(frozen=True)
class Ballot:
    voter: str
    choice: str


@dataclass(frozen=True)
class Notice:
    key: str
    listing: str
    kind: str
    title: str
    lines: tuple
    authority: str
    question: str = ""
    resolution_kind: str = ""
    window: str = ""
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    ballots: tuple = ()
    carried: bool | None = None
    rate: Decimal | None = None
    declared_on: date | None = None
    payment_date: date | None = None
    paid: tuple = ()


@dataclass(frozen=True)
class MarketPlan:
    now: datetime
    listings: tuple
    approvals: tuple
    deposits: tuple
    orders: tuple
    fills: tuple
    notices: tuple
    holdings: dict = field(default_factory=dict)

    def order(self, key):
        return next(order for order in self.orders if order.key == key)

    def listing(self, key):
        return next(listing for listing in self.listings if listing.key == key)

    def today(self):
        return [fill for fill in self.fills if not fill.lapsed]

    def lapses(self):
        return [fill for fill in self.fills if fill.lapsed]
