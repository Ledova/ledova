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
    ready_at: datetime | None = None


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
    requests: tuple
    raises: tuple
    directors: dict

    def share_class(self, key):
        return next(share_class for share_class in self.classes if share_class.key == key)

    def classes_of(self, company):
        return [share_class for share_class in self.classes if share_class.company == company]

    def treasury(self, key):
        return next(treasury for treasury in self.treasuries if treasury.key == key)
