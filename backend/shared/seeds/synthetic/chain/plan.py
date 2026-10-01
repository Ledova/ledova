from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal


@dataclass(frozen=True)
class HoldingWallet:
    address: str
    verified_at: datetime


@dataclass(frozen=True)
class Candidate:
    key: str
    name: str
    role: str
    joined_at: datetime
    wallets: tuple
    companies: frozenset = frozenset()
    associated: frozenset = frozenset()
    ready_at: datetime | None = None
    large_only: bool = False

    def wallets_ready_by(self, moment):
        return [wallet for wallet in self.wallets if wallet.verified_at <= moment]

    def ready_by(self, moment):
        return self.ready_at is not None and self.ready_at <= moment and bool(self.wallets_ready_by(moment))


@dataclass(frozen=True)
class Firm:
    key: str
    name: str
    owner: str
    activated_at: datetime | None
    address: str


@dataclass(frozen=True)
class Treasury:
    key: str
    company: str
    label: str
    address: str


@dataclass(frozen=True)
class Position:
    holder: str
    address: str
    shares: int
    entered_on: date
    amount_paid: Decimal | None
    reason: str
    initial: bool = False


@dataclass(frozen=True)
class FormerMember:
    name: str
    address: str
    shares: int
    ceased_on: date


@dataclass(frozen=True)
class Payment:
    at: datetime
    amount: Decimal
    final: bool = False


@dataclass(frozen=True)
class Application:
    investor: str
    address: str
    quantity: int
    rail: str
    status: str
    created_at: datetime
    submitted_at: datetime | None = None
    accepted_at: datetime | None = None
    instructed_at: datetime | None = None
    payments: tuple = ()
    closed_at: datetime | None = None
    reason: str = ""
    allotted: int | None = None
    refund: Decimal | None = None

    @property
    def received(self):
        return sum((payment.amount for payment in self.payments), Decimal("0.00"))


@dataclass(frozen=True)
class Round:
    key: str
    share_class: str
    status: str
    exemption: str
    price: Decimal
    minimum: int
    target: int
    cap: int
    maximum: int | None
    opens_at: datetime
    closes_at: datetime
    created_at: datetime
    summary: str
    use_of_proceeds: str
    submitted_at: datetime | None = None
    review_at: datetime | None = None
    decided_at: datetime | None = None
    closed_at: datetime | None = None
    reason: str = ""
    notes: str = ""
    applications: tuple = ()

    @property
    def scaled_back(self):
        return any(
            application.allotted is not None and application.allotted < application.quantity
            for application in self.applications
        )


@dataclass(frozen=True)
class Request:
    key: str
    share_class: str
    holder: str
    address: str
    shares: int
    status: str
    reason: str
    submitted_at: datetime
    review_at: datetime | None = None
    decided_at: datetime | None = None
    decision: str = ""


@dataclass(frozen=True)
class Raise:
    key: str
    share_class: str
    status: str
    additional: int
    new_total: int
    purpose: str
    board_reference: str
    created_at: datetime
    submitted_at: datetime | None = None
    decided_at: datetime | None = None
    decision: str = ""


@dataclass(frozen=True)
class ShareClass:
    key: str
    company: str
    symbol: str
    name: str
    kind: str
    authorised: int
    target: str
    created_at: datetime
    existing: bool = False
    positions: tuple = ()
    former: tuple = ()

    @property
    def deployed(self):
        return self.target in ("deployed", "paused")


@dataclass(frozen=True)
class IssuancePlan:
    now: datetime
    classes: tuple
    treasuries: tuple
    rounds: tuple
    requests: tuple
    raises: tuple
    directors: dict
    receiving_wallet: str

    def share_class(self, key):
        return next(share_class for share_class in self.classes if share_class.key == key)

    def classes_of(self, company):
        return [share_class for share_class in self.classes if share_class.company == company]

    def rounds_of(self, share_class):
        return [item for item in self.rounds if item.share_class == share_class]

    def treasury(self, key):
        return next(treasury for treasury in self.treasuries if treasury.key == key)

    def applications(self):
        return [application for item in self.rounds for application in item.applications]
