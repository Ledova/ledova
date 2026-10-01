import random
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from shared.seeds.synthetic.keys import Derivation

SEED = 846
WINDOW_DAYS = 183
DEFAULT_INVESTORS = 60
MINIMUM_INVESTORS = 20


def stream(name, seed=SEED):
    return random.Random(f"{seed}/{name}")


@dataclass(frozen=True)
class Ref:
    kind: str
    key: str


@dataclass(frozen=True)
class StaffMember:
    key: str
    email: str
    title: str
    joined_at: datetime
    last_login: datetime
    left_at: datetime | None = None


@dataclass(frozen=True)
class Kyc:
    provider: str
    status: str
    result: str
    decided_at: datetime
    document_type: str
    document_country: str
    labels: tuple = ()
    pep_type: str = "none"


@dataclass(frozen=True)
class Attempt:
    result: str
    at: datetime


@dataclass(frozen=True)
class Financial:
    occupation: str
    source_of_funds: tuple
    intended_use: str
    at: datetime
    source_other: str = ""
    intended_other: str = ""


@dataclass(frozen=True)
class Transfer:
    tx_hash: str
    chain: str
    symbol: str
    incoming: bool
    counterparty: str
    amount: Decimal
    status: str
    app_sent: bool
    block_number: int
    block_hash: str
    at: datetime
    market_value: Decimal
    market_value_aud: Decimal
    recorded_at: datetime
    settled_at: datetime
    monitored_at: datetime
    fee: Decimal | None = None
    nonce: int | None = None


@dataclass(frozen=True)
class WalletPlan:
    chain: str
    address: str
    key: bytes
    registered_at: datetime
    name: str | None = None
    signing: str | None = None
    verified_at: datetime | None = None
    challenged_at: datetime | None = None
    synced_at: datetime | None = None
    derivation: Derivation | None = None
    transfers: tuple = ()
    holdings: tuple = ()


@dataclass(frozen=True)
class Payslip:
    filename: str
    uploaded_at: datetime
    employer: str
    employer_abn: str
    employee: str
    period_start: date
    period_end: date
    gross: Decimal
    tax: Decimal
    superannuation: Decimal
    ytd_gross: Decimal
    ytd_tax: Decimal
    succeeded: bool
    confidence: float
    duration_ms: int
    warnings: tuple = ()


@dataclass(frozen=True)
class Certificate:
    issued_on: date
    certifier: str
    body: str
    membership: str


@dataclass(frozen=True)
class Claim:
    category: str
    status: str
    submitted_at: datetime
    declared_basis: str
    reviewed_at: datetime | None = None
    reviewer: str | None = None
    expires_at: datetime | None = None
    review_notes: str = ""
    rejection_reason: str = ""
    verified_at: datetime | None = None
    verifier: str | None = None
    certificate: Certificate | None = None
    company: str | None = None
    payslips: tuple = ()
    existing: bool = False


@dataclass(frozen=True)
class Device:
    token: str
    device_type: str
    registered_at: datetime
    last_used_at: datetime


@dataclass(frozen=True)
class Note:
    at: datetime
    title: str
    body: str
    kind: str
    data: dict
    read_at: datetime | None = None
    archived: bool = False


@dataclass(frozen=True)
class Person:
    key: str
    email: str
    full_name: str
    role: str
    joined_at: datetime
    cohort: str
    email_verified_at: datetime | None = None
    signup_step: str | None = None
    signup_completed_at: datetime | None = None
    phone: str | None = None
    birth_date: date | None = None
    address: str | None = None
    citizenship: str | None = None
    kyc: Kyc | None = None
    attempts: tuple = ()
    financial: Financial | None = None
    account_status: str = "pending"
    rejection_reason: str = ""
    status_changed_at: datetime | None = None
    last_login: datetime | None = None
    alerts_enabled: bool = True
    wallets: tuple = ()
    claims: tuple = ()
    payslips: tuple = ()
    devices: tuple = ()
    notes: tuple = ()
    existing: bool = False

    @property
    def prescreened(self):
        return self.signup_step not in ("account-type", "pre-screening")

    @property
    def profiled(self):
        return self.signup_step in (None, "financial-profile")


@dataclass(frozen=True)
class CompanyDocumentPlan:
    document_type: str
    name: str
    uploaded_at: datetime
    valid_from: date | None = None
    verified_at: datetime | None = None
    rejection_reason: str = ""


@dataclass(frozen=True)
class Step:
    method: str
    at: datetime
    reason: str = ""


@dataclass(frozen=True)
class CompanyPlan:
    key: str
    name: str
    trading_name: str
    company_type: str
    acn: str
    abn: str
    industry: str
    description: str
    founded_year: int
    incorporated_on: date
    phone: str
    address_line_1: str
    address_line_2: str
    city: str
    state: str
    postcode: str
    owner: str
    registered_at: datetime
    declarant_name: str
    board_resolution_reference: str
    open_to_investors: bool
    operator_wallet: str | None = None
    documents: tuple = ()
    steps: tuple = ()
    existing: bool = False

    @property
    def status(self):
        return STEP_STATUS[self.steps[-1].method] if self.steps else "draft"


STEP_STATUS = {
    "submit": "submitted",
    "start_review": "review",
    "request_info": "info_required",
    "resubmit": "submitted",
    "approve": "approved",
    "activate": "active",
}


@dataclass(frozen=True)
class AlertPlan:
    person: str
    rule: str
    alert_type: str
    severity: str
    description: str
    data: dict
    created_at: datetime
    status: str
    assignee: str | None = None
    assigned_at: datetime | None = None
    resolver: str | None = None
    resolved_at: datetime | None = None
    outcome: str | None = None
    notes: str = ""
    transfer: str | None = None
    screened: bool = False
    smr_type: str | None = None
    smr_reference: str | None = None
    smr_filed_at: datetime | None = None
    account_action: str | None = None
    account_action_at: datetime | None = None


@dataclass(frozen=True)
class Plan:
    now: datetime
    staff: tuple
    people: tuple
    testers: tuple
    companies: tuple
    alerts: tuple
    prices: dict = field(default_factory=dict)
    usd_aud: Decimal = Decimal("0")

    def everyone(self):
        return (*self.testers, *self.people)

    def person(self, key):
        return next(person for person in self.everyone() if person.key == key)

    def staff_member(self, key):
        return next(member for member in self.staff if member.key == key)
