from dataclasses import replace
from datetime import date, datetime, time, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import NamedTuple

from offerings.models import OfferingExemption
from shared.seeds.demo import DEMO_INVESTOR_EMAIL
from shared.seeds.synthetic import identities, keys
from shared.seeds.synthetic.chain.plan import (
    Application,
    FormerMember,
    IssuancePlan,
    Payment,
    Position,
    Raise,
    Request,
    Round,
    ShareClass,
    Treasury,
)
from shared.seeds.synthetic.clock import AEST, Calendar, utc
from shared.seeds.synthetic.plan import SEED, stream
from shared.seeds.synthetic.story import COMPANY_SPECS, DEMO_COMPANY

ISSUANCE_STREAM = "issuance"
CENT = Decimal("0.01")
LOT = 500
DEMO = DEMO_COMPANY.key
WATTLEFIELD, CORALGUM, SALTBUSH = (spec.key for spec in COMPANY_SPECS[:3])
TESTER = DEMO_INVESTOR_EMAIL
BANK = "bank_transfer"
STABLECOIN = "stablecoin"
ALLOTTED = "allotted"
SHORT = "short"
PAID = "paid"
AWAITING = "awaiting_payment"
PARTIAL = "partial"
ACCEPTED = "accepted"
SUBMITTED = "submitted"
DRAFT = "draft"
WITHDRAWN = "withdrawn"
LAPSED = "lapsed"
REJECTED = "rejected"
REFUNDED = "refunded"
EXPIRY_HOUR_UTC = 3


class ClassSpec(NamedTuple):
    company: str
    symbol: str
    name: str
    kind: str
    authorised: int
    target: str
    created_days: int
    existing: bool = False


class EarlyRound(NamedTuple):
    label: str
    first: date
    last: date
    price: Decimal
    count: int
    shares: tuple


class RoundSpec(NamedTuple):
    key: str
    share_class: str
    status: str
    exemption: str
    price: str
    minimum: int
    target: int
    cap: int
    maximum: int | None
    days: dict
    summary: str
    use_of_proceeds: str
    mix: tuple = ()
    reason: str = ""
    notes: str = ""
    fill: float = 0.0


class TesterApplication(NamedTuple):
    round: str
    wallet: int
    status: str
    quantity: int
    rail: str
    days: int


class RequestSpec(NamedTuple):
    key: str
    share_class: str
    status: str
    holder: str
    shares: int
    reason: str
    submitted: int
    review: int | None = None
    decided: int | None = None
    decision: str = ""


class RaiseSpec(NamedTuple):
    key: str
    share_class: str
    status: str
    additional: int
    purpose: str
    board_reference: str
    created: int
    submitted: int | None = None
    decided: int | None = None
    decision: str = ""


CLASS_SPECS = (
    ClassSpec(DEMO, "ORD", "Ordinary Shares", "ordinary", 1_000_000, "deployed", 160, existing=True),
    ClassSpec(DEMO, "PRF", "Seed Preference Shares", "preference", 300_000, "deployed", 78),
    ClassSpec(DEMO, "SERA", "Series A Preference Shares", "preference", 400_000, "draft", 2),
    ClassSpec(WATTLEFIELD, "ORD", "Ordinary Shares", "ordinary", 2_000_000, "deployed", 120),
    ClassSpec(CORALGUM, "ORD", "Ordinary Shares", "ordinary", 5_000_000, "deployed", 90),
    ClassSpec(CORALGUM, "CPS", "Convertible Preference Shares", "preference", 400_000, "paused", 52),
    ClassSpec(SALTBUSH, "ORD", "Ordinary Shares", "ordinary", 1_500_000, "draft", 25),
)
CHAIRS = {
    DEMO: "Margaret Ashdown",
    WATTLEFIELD: "Peter Lindqvist",
    CORALGUM: "Ruth Okonkwo",
    SALTBUSH: "Colin Ferris",
}
TREASURY_LABELS = {
    DEMO: "Demo Robotics Employee Share Trust",
    WATTLEFIELD: "Wattlefield Employee Share Trust",
    CORALGUM: "Coralgum Medical Employee Share Trust",
}
FOUNDER_STAKES = {
    f"{DEMO}/ORD": (360_000, date(2021, 3, 15), Decimal("36.00")),
    f"{WATTLEFIELD}/ORD": (700_000, date(2019, 8, 1), Decimal("70.00")),
    f"{CORALGUM}/ORD": (1_800_000, date(2020, 5, 20), Decimal("180.00")),
}
POOL_STAKES = {
    f"{DEMO}/ORD": (60_000, date(2022, 2, 14)),
    f"{WATTLEFIELD}/ORD": (90_000, date(2021, 6, 30)),
    f"{CORALGUM}/ORD": (250_000, date(2021, 9, 1)),
}
DIRECTOR_STAKES = {
    DEMO: ((30_000, 50_000), date(2022, 6, 1), date(2022, 9, 30), Decimal("0.10")),
    WATTLEFIELD: ((25_000, 60_000), date(2020, 3, 1), date(2021, 5, 31), Decimal("0.20")),
    CORALGUM: ((40_000, 90_000), date(2021, 1, 1), date(2021, 12, 31), Decimal("0.30")),
}
EARLY_ROUNDS = {
    f"{DEMO}/ORD": (
        EarlyRound("Angel round", date(2023, 2, 1), date(2023, 5, 31), Decimal("0.40"), 4, (10_000, 30_000)),
        EarlyRound("Pre-seed round", date(2024, 5, 1), date(2024, 9, 30), Decimal("0.80"), 3, (8_000, 25_000)),
    ),
    f"{WATTLEFIELD}/ORD": (
        EarlyRound("Seed round", date(2022, 3, 1), date(2022, 8, 31), Decimal("0.45"), 2, (20_000, 50_000)),
        EarlyRound("Converted bridge notes", date(2024, 2, 1), date(2024, 6, 30), Decimal("0.70"), 2, (10_000, 40_000)),
    ),
    f"{CORALGUM}/ORD": (
        EarlyRound("Seed round", date(2021, 3, 1), date(2021, 8, 31), Decimal("0.60"), 3, (60_000, 180_000)),
        EarlyRound("Series A", date(2023, 4, 1), date(2023, 9, 30), Decimal("1.40"), 3, (40_000, 120_000)),
        EarlyRound("Bridge round", date(2025, 2, 1), date(2025, 6, 30), Decimal("2.10"), 3, (20_000, 80_000)),
    ),
}
CONVERTED_NOTES = (f"{CORALGUM}/CPS", f"{CORALGUM}/ORD", "Converted 2025 notes", Decimal("2.50"), 3, (15_000, 25_000))
TESTER_EARLY = {
    f"{DEMO}/ORD": (1, 12_500, date(2024, 6, 20), Decimal("0.80"), "Pre-seed round"),
    f"{CORALGUM}/ORD": (4, 8_000, date(2025, 4, 14), Decimal("2.10"), "Bridge round"),
}
FORMER_SPECS = {
    f"{DEMO}/ORD": (2, (8_000, 20_000), (420, 900)),
    f"{WATTLEFIELD}/ORD": (2, (10_000, 30_000), (500, 1400)),
    f"{CORALGUM}/ORD": (1, (30_000, 80_000), (700, 1500)),
}
ROUND_SPECS = (
    RoundSpec(
        "demo-bridge",
        f"{DEMO}/ORD",
        "withdrawn",
        OfferingExemption.PROFESSIONAL,
        "1.80",
        1_000,
        50_000,
        80_000,
        20_000,
        {"created": 150, "submitted": 148, "closed": 141, "opens": 134, "closes": 104},
        "A convertible bridge to fund the first commercial inspection fleet.",
        "Two inspection robots for the first solar-farm customer and six months of field engineering.",
        reason="Replaced by the seed preference round, which the board preferred to a convertible bridge.",
    ),
    RoundSpec(
        "demo-seed-preference",
        f"{DEMO}/PRF",
        "closed",
        OfferingExemption.NET_ASSETS,
        "1.50",
        1_000,
        150_000,
        200_000,
        40_000,
        {"created": 74, "submitted": 72, "review": 71, "decided": 68, "opens": 66, "closes": 12, "closed": 11},
        "Seed preference shares carrying a 1x non-participating liquidation preference.",
        "Manufacturing tooling for the second-generation robot and the first two field technicians.",
        mix=((ALLOTTED, 10), (REFUNDED, 1), (LAPSED, 1), (WITHDRAWN, 1)),
        notes="Information memorandum and risk disclosure checked against the constitution.",
        fill=1.07,
    ),
    RoundSpec(
        "demo-seed-extension",
        f"{DEMO}/PRF",
        "submitted",
        OfferingExemption.NET_ASSETS,
        "1.80",
        1_000,
        40_000,
        60_000,
        15_000,
        {"created": 3, "submitted": 1, "opens": -10, "closes": -45},
        "An extension of the seed preference round for investors who missed the first close.",
        "Working capital for the second-generation robot's certification.",
    ),
    RoundSpec(
        "demo-growth",
        f"{DEMO}/ORD",
        "approved",
        OfferingExemption.GROSS_INCOME,
        "2.40",
        500,
        100_000,
        150_000,
        25_000,
        {"created": 33, "submitted": 31, "review": 29, "decided": 25, "opens": 21, "closes": -17},
        "Ordinary shares to fund Demo Robotics' growth into substations and wind farms.",
        "Sales and field engineering for three new states, and a substation inspection pilot.",
        mix=(
            (PAID, 7),
            (AWAITING, 5),
            (PARTIAL, 1),
            (ACCEPTED, 1),
            (SUBMITTED, 3),
            (DRAFT, 2),
            (WITHDRAWN, 2),
            (LAPSED, 1),
            (REJECTED, 1),
            (REFUNDED, 2),
        ),
        notes="Approved for wholesale investors certified on gross income.",
        fill=0.85,
    ),
    RoundSpec(
        "demo-series-a",
        f"{DEMO}/ORD",
        "draft",
        OfferingExemption.PROFESSIONAL,
        "3.10",
        2_000,
        200_000,
        300_000,
        50_000,
        {"created": 2, "opens": -40, "closes": -85},
        "Series A ordinary shares, led by a professional investor.",
        "International expansion and the wind-turbine inspection product.",
    ),
    RoundSpec(
        "wattlefield-community-1",
        f"{WATTLEFIELD}/ORD",
        "closed",
        OfferingExemption.WHOLESALE_CLIENT,
        "0.85",
        2_000,
        200_000,
        300_000,
        60_000,
        {"created": 64, "submitted": 62, "review": 61, "decided": 59, "opens": 57, "closes": 9, "closed": 8},
        "Ordinary shares for the first community solar and battery project.",
        "Equity for the Mallee Springs solar farm and its 4 MWh battery.",
        mix=((ALLOTTED, 7), (SHORT, 1), (REFUNDED, 1), (LAPSED, 1), (WITHDRAWN, 1)),
        notes="Wholesale clients only; project budget reviewed against the business plan.",
        fill=0.86,
    ),
    RoundSpec(
        "wattlefield-community-2",
        f"{WATTLEFIELD}/ORD",
        "approved",
        OfferingExemption.WHOLESALE_CLIENT,
        "1.05",
        2_000,
        250_000,
        350_000,
        80_000,
        {"created": 7, "submitted": 6, "review": 5, "decided": 2, "opens": -12, "closes": -56},
        "Ordinary shares for the second community project, in Brolga Creek.",
        "Equity for the Brolga Creek solar farm and grid connection works.",
        notes="Opens once the grid connection agreement is signed.",
    ),
    RoundSpec(
        "coralgum-growth",
        f"{CORALGUM}/ORD",
        "rejected",
        OfferingExemption.MINIMUM_AMOUNT,
        "3.20",
        160_000,
        500_000,
        600_000,
        None,
        {"created": 52, "submitted": 50, "review": 48, "decided": 44, "opens": 30, "closes": -20},
        "Ordinary shares for investors committing at least AUD 500,000 each.",
        "Regulatory submissions for the point-of-care analyser in two new markets.",
        reason="The information memorandum does not say how the proceeds will be split between the two markets.",
    ),
    RoundSpec(
        "coralgum-growth-revised",
        f"{CORALGUM}/ORD",
        "under_review",
        OfferingExemption.MINIMUM_AMOUNT,
        "3.20",
        160_000,
        450_000,
        550_000,
        None,
        {"created": 6, "submitted": 4, "review": 2, "opens": -14, "closes": -60},
        "Ordinary shares for investors committing at least AUD 500,000 each, with the use of proceeds restated.",
        "AUD 1.1 million for the New Zealand submission and AUD 0.66 million for the Singapore submission.",
    ),
    RoundSpec(
        "coralgum-convertible",
        f"{CORALGUM}/CPS",
        "closed",
        OfferingExemption.PROFESSIONAL,
        "3.20",
        1_000,
        150_000,
        250_000,
        50_000,
        {"created": 48, "submitted": 46, "review": 45, "decided": 43, "opens": 41, "closes": 15, "closed": 14},
        "Convertible preference shares that convert into ordinary shares at the next priced round.",
        "Clinical trial sites in Queensland and Western Australia.",
        mix=((ALLOTTED, 8), (LAPSED, 1), (WITHDRAWN, 1)),
        notes="Professional investors only; conversion terms checked against the constitution.",
        fill=0.84,
    ),
)
TESTER_APPLICATIONS = (
    TesterApplication("demo-seed-preference", 1, ALLOTTED, 12_000, BANK, 40),
    TesterApplication("wattlefield-community-1", 2, ALLOTTED, 20_000, STABLECOIN, 35),
    TesterApplication("demo-growth", 1, PAID, 5_000, BANK, 14),
    TesterApplication("demo-growth", 4, AWAITING, 2_500, STABLECOIN, 2),
)
TESTER_WALLETS = {index: keys.evm_address(keys.hardhat_keys([index])[0].key) for index in (1, 2, 4)}
REQUEST_SPECS = (
    RequestSpec(
        "demo-pool-grant",
        f"{DEMO}/ORD",
        "submitted",
        "treasury",
        20_000,
        "Annual grant to the employee share trust for the 2026-27 plan year.",
        3,
    ),
    RequestSpec(
        "demo-advisory",
        f"{DEMO}/ORD",
        "under_review",
        "investor",
        6_000,
        "Shares in lieu of fees for advisory work on the substation inspection pilot.",
        9,
        review=7,
    ),
    RequestSpec(
        "demo-placement",
        f"{DEMO}/ORD",
        "rejected",
        "investor",
        30_000,
        "Placement to an existing holder.",
        24,
        review=23,
        decided=20,
        decision="The directors' resolution covers 15,000 shares, not 30,000. Submit a request that matches it.",
    ),
    RequestSpec(
        "demo-pool-top-up",
        f"{DEMO}/ORD",
        "executed",
        "treasury",
        15_000,
        "Top-up of the employee share trust for the engineering hires.",
        2,
        decided=1,
    ),
    RequestSpec(
        "coralgum-clinical-team",
        f"{CORALGUM}/ORD",
        "approved",
        "treasury",
        40_000,
        "Grant to the employee share trust for the new clinical team.",
        12,
        review=11,
        decided=5,
    ),
)
RAISE_SPECS = (
    RaiseSpec(
        "demo-headroom-first",
        f"{DEMO}/ORD",
        "rejected",
        500_000,
        "Headroom for the growth round.",
        "DR-2026-08-14",
        42,
        submitted=40,
        decided=37,
        decision="The board resolution reference does not match the minutes uploaded with the request.",
    ),
    RaiseSpec(
        "demo-headroom",
        f"{DEMO}/ORD",
        "executed",
        500_000,
        "Headroom for the growth round and the Series A, under the corrected resolution.",
        "DR-2026-09-27",
        4,
        submitted=3,
        decided=1,
    ),
    RaiseSpec(
        "coralgum-series-b",
        f"{CORALGUM}/ORD",
        "submitted",
        1_000_000,
        "Authorised capital for the Series B round planned for early 2027.",
        "DR-2026-09-24",
        3,
        submitted=2,
    ),
    RaiseSpec(
        "wattlefield-gippsland",
        f"{WATTLEFIELD}/ORD",
        "draft",
        500_000,
        "Authorised capital for the Gippsland battery project.",
        "DR-2026-09-29",
        1,
    ),
)
WITHDRAWAL_REASONS = (
    "Applied from the wrong wallet; applying again from my main wallet.",
    "Decided to wait for the next round.",
    "Changed my mind about the allocation size.",
)
REJECTION_REASON = "The applicant asked to apply through their family trust instead; a new application will follow."
REFUND_NOTES = {
    "late": "Payment arrived after the offer closed; returned in full.",
    "duplicate": "Paid twice in error; this application was refunded in full.",
    "changed": "The investor asked for the money back before allotment.",
    "residual": "Excess returned after the scale-back.",
    "short": "Balance returned after allotting the shares the payment covered.",
}


def build_issuance(now, firms, candidates, seed=SEED):
    return IssuanceStory(now, firms, candidates, seed).build()


def lots(value):
    return max(LOT, int(value) // LOT * LOT)


def money(value):
    return Decimal(value).quantize(CENT)


class IssuanceStory:
    def __init__(self, now, firms, candidates, seed):
        self.rng = stream(ISSUANCE_STREAM, seed)
        self.calendar = Calendar(now)
        self.now = self.calendar.anchor
        self.ceiling = self.now - timedelta(hours=2)
        self.firms = {firm.key: firm for firm in firms}
        self.candidates = {candidate.key: candidate for candidate in sorted(candidates, key=lambda item: item.key)}
        self.wallet_choice = {}
        self.chosen = {}
        self.requested = set()
        self.taken_names = {candidate.name for candidate in self.candidates.values()}
        self.taken_names.update(CHAIRS.values())

    def build(self):
        treasuries = tuple(self._treasury(company) for company in sorted(TREASURY_LABELS) if company in self.firms)
        classes = tuple(self._share_class(spec) for spec in CLASS_SPECS if spec.company in self.firms)
        rounds = tuple(self._round(spec) for spec in ROUND_SPECS if self._has_class(classes, spec.share_class))
        requests = tuple(
            self._request(spec, classes) for spec in REQUEST_SPECS if self._has_class(classes, spec.share_class)
        )
        raises = tuple(self._raise(spec, classes) for spec in RAISE_SPECS if self._has_class(classes, spec.share_class))
        return IssuancePlan(
            now=self.now,
            classes=classes,
            treasuries=treasuries,
            rounds=rounds,
            requests=tuple(request for request in requests if request is not None),
            raises=raises,
            directors={company: CHAIRS[company] for company in sorted(self.firms) if company in CHAIRS},
            receiving_wallet=keys.evm_address(keys.secret("operator", "receiving")),
        )

    @staticmethod
    def _has_class(classes, key):
        return any(share_class.key == key for share_class in classes)

    def at(self, days, hour=10, minute=0):
        local = datetime.combine(self.calendar.today - timedelta(days=days), time(hour, minute), AEST)
        return utc(local)

    def moment(self, days, first_hour=9, last_hour=17):
        hour = self.rng.randint(first_hour, last_hour)
        return self.at(days, hour, self.rng.randint(0, 59)) + timedelta(seconds=self.rng.randint(0, 59))

    def after(self, moment, low_minutes, high_minutes):
        later = (moment + timedelta(minutes=self.rng.uniform(low_minutes, high_minutes))).replace(microsecond=0)
        return max(moment, min(later, self.ceiling))

    def between(self, start, end):
        if end <= start:
            return start
        return (start + (end - start) * self.rng.random()).replace(microsecond=0)

    def day_between(self, first, last):
        return first + timedelta(days=self.rng.randint(0, (last - first).days))

    def _treasury(self, company):
        return Treasury(
            key=f"treasury:{company}",
            company=company,
            label=TREASURY_LABELS[company],
            address=keys.evm_address(keys.secret("treasury", company)),
        )

    def investors(self, company, *, subscribing=False):
        return [
            candidate
            for candidate in self.candidates.values()
            if candidate.role == "investor"
            and company in candidate.companies
            and candidate.key != TESTER
            and not (subscribing and candidate.large_only)
        ]

    def wallet(self, candidate, company):
        cache_key = (candidate.key, company)
        if cache_key not in self.wallet_choice:
            self.wallet_choice[cache_key] = self.rng.choice(candidate.wallets).address
        return self.wallet_choice[cache_key]

    def _share_class(self, spec):
        key = f"{spec.company}/{spec.symbol}"
        firm = self.firms[spec.company]
        created = self.moment(spec.created_days)
        if firm.activated_at is not None and spec.created_days > 2:
            created = max(created, firm.activated_at + timedelta(hours=self.rng.randint(20, 60)))
        positions = self._positions(key, spec) if spec.target != "draft" else ()
        return ShareClass(
            key=key,
            company=spec.company,
            symbol=spec.symbol,
            name=spec.name,
            kind=spec.kind,
            authorised=spec.authorised,
            target=spec.target,
            created_at=min(created, self.ceiling),
            existing=spec.existing,
            positions=positions,
            former=self._former(key),
        )

    def _positions(self, key, spec):
        positions = []
        firm = self.firms[spec.company]
        founder = self.candidates.get(firm.owner)
        if key in FOUNDER_STAKES and founder is not None and founder.wallets:
            shares, entered, paid = FOUNDER_STAKES[key]
            positions.append(
                Position(founder.key, founder.wallets[0].address, shares, entered, paid, "Founder's shares", True)
            )
        if key in POOL_STAKES:
            shares, entered = POOL_STAKES[key]
            treasury = self._treasury(spec.company)
            positions.append(
                Position(treasury.key, treasury.address, shares, entered, None, "Employee share trust allocation")
            )
        if spec.symbol == "ORD" and spec.company in DIRECTOR_STAKES:
            positions += self._director_positions(spec.company)
        taken = {position.holder for position in positions}
        for early in EARLY_ROUNDS.get(key, ()):
            pool = [candidate for candidate in self.investors(spec.company) if candidate.key not in taken]
            for candidate in self.rng.sample(pool, k=min(early.count, len(pool))):
                taken.add(candidate.key)
                shares = lots(self.rng.randint(*early.shares))
                entered = self.day_between(early.first, early.last)
                positions.append(
                    Position(
                        candidate.key,
                        self.wallet(candidate, spec.company),
                        shares,
                        entered,
                        money(shares * early.price),
                        early.label,
                    )
                )
        if key in TESTER_EARLY and TESTER in self.candidates:
            wallet, shares, entered, price, label = TESTER_EARLY[key]
            positions.append(Position(TESTER, TESTER_WALLETS[wallet], shares, entered, money(shares * price), label))
        if key == CONVERTED_NOTES[0]:
            positions += self._converted_notes()
        self.chosen[key] = [position.holder for position in positions]
        return tuple(positions)

    def _director_positions(self, company):
        (low, high), first, last, price = DIRECTOR_STAKES[company]
        positions = []
        for candidate in self.candidates.values():
            if (
                candidate.role != "investor"
                or company not in candidate.associated
                or company not in candidate.companies
            ):
                continue
            shares = lots(self.rng.randint(low, high))
            positions.append(
                Position(
                    candidate.key,
                    self.wallet(candidate, company),
                    shares,
                    self.day_between(first, last),
                    money(shares * price),
                    "Director's shares",
                )
            )
        return positions

    def _converted_notes(self):
        _, source, label, price, count, (low, high) = CONVERTED_NOTES
        earlier = set(self.chosen.get(source, ()))
        holders = [candidate for candidate in self.investors(CORALGUM) if candidate.key in earlier]
        positions = []
        first = self.calendar.today - timedelta(days=118)
        for candidate in self.rng.sample(holders, k=min(count, len(holders))):
            shares = lots(self.rng.randint(low, high))
            positions.append(
                Position(
                    candidate.key,
                    self.wallet(candidate, CORALGUM),
                    shares,
                    self.day_between(first, first + timedelta(days=20)),
                    money(shares * price),
                    label,
                )
            )
        return tuple(positions)

    def _former(self, key):
        if key not in FORMER_SPECS:
            return ()
        count, (low, high), (first, last) = FORMER_SPECS[key]
        former = []
        for _ in range(count):
            name = self._outside_name()
            address, _ = identities.home_address(self.rng)
            ceased = self.calendar.today - timedelta(days=self.rng.randint(first, last))
            former.append(FormerMember(name, address, lots(self.rng.randint(low, high)), ceased))
        return tuple(sorted(former, key=lambda member: member.ceased_on))

    def _outside_name(self):
        while True:
            name = f"{self.rng.choice(identities.FIRST_NAMES)} {self.rng.choice(identities.LAST_NAMES)}"
            if name not in self.taken_names:
                self.taken_names.add(name)
                return name

    def _times(self, spec):
        days = spec.days
        stamp = {name: self.moment(value) if value > 0 else self.at(value, 10) for name, value in days.items()}
        stamp["opens"] = self.at(days["opens"], 9)
        stamp["closes"] = self.at(days["closes"], 17)
        return stamp

    def _round(self, spec):
        times = self._times(spec)
        applications = self._applications(spec, times) if spec.mix else ()
        return Round(
            key=spec.key,
            share_class=spec.share_class,
            status=spec.status,
            exemption=spec.exemption,
            price=Decimal(spec.price),
            minimum=spec.minimum,
            target=spec.target,
            cap=spec.cap,
            maximum=spec.maximum,
            opens_at=times["opens"],
            closes_at=times["closes"],
            created_at=times["created"],
            submitted_at=times.get("submitted"),
            review_at=times.get("review"),
            decided_at=times.get("decided"),
            closed_at=times.get("closed"),
            reason=spec.reason,
            notes=spec.notes,
            summary=spec.summary,
            use_of_proceeds=spec.use_of_proceeds,
            applications=applications,
        )

    def _applications(self, spec, times):
        company = spec.share_class.split("/")[0]
        price = Decimal(spec.price)
        statuses = [status for status, count in spec.mix for _ in range(count)]
        self.rng.shuffle(statuses)
        statuses.sort(key=lambda status: self._window(status, times)[1])
        testers = [item for item in TESTER_APPLICATIONS if item.round == spec.key and TESTER in self.candidates]
        pool = self.investors(company, subscribing=True)
        self.rng.shuffle(pool)
        drafts = []
        for status in statuses:
            earliest, latest = self._window(status, times)
            margin = latest - timedelta(hours=1)
            chosen = next((candidate for candidate in pool if candidate.ready_by(margin)), None)
            if chosen is None:
                continue
            pool.remove(chosen)
            verified = min(wallet.verified_at for wallet in chosen.wallets_ready_by(margin))
            start = max(earliest, chosen.ready_at + timedelta(hours=1), verified + timedelta(hours=1))
            created = self.between(start, latest)
            ready = [wallet.address for wallet in chosen.wallets_ready_by(created)]
            address = self.wallet(chosen, company)
            drafts.append((chosen.key, address if address in ready else ready[0], status, created))
        quantities = self._quantities(spec, [status for _, _, status, _ in drafts], testers)
        applications = [
            self._timeline(spec, times, key, address, status, quantity, self._rail(), created, price)
            for (key, address, status, created), quantity in zip(drafts, quantities)
        ]
        applications += [self._tester_application(spec, times, item, price) for item in testers]
        applications.sort(key=lambda application: (application.created_at, application.investor))
        if spec.status == "closed":
            applications = self._scale_back(spec, applications, price)
        return tuple(applications)

    def _window(self, status, times):
        opens, closes = times["opens"], times["closes"]
        if closes < self.now:
            if status in (ALLOTTED, SHORT, PAID, REFUNDED):
                return opens, closes - timedelta(days=6)
            if status == LAPSED:
                return opens, closes - timedelta(days=9)
            return opens, closes - timedelta(days=4)
        windows = {
            PAID: (opens, self.now - timedelta(days=6)),
            REFUNDED: (opens, self.now - timedelta(days=8)),
            LAPSED: (opens, self.now - timedelta(days=11)),
            WITHDRAWN: (opens, self.now - timedelta(days=3)),
            REJECTED: (opens, self.now - timedelta(days=2)),
            AWAITING: (self.now - timedelta(days=4), self.now - timedelta(hours=30)),
            PARTIAL: (self.now - timedelta(days=4), self.now - timedelta(hours=40)),
            ACCEPTED: (self.now - timedelta(days=3), self.now - timedelta(hours=28)),
            SUBMITTED: (self.now - timedelta(days=2), self.now - timedelta(hours=3)),
            DRAFT: (self.now - timedelta(days=3), self.now - timedelta(hours=3)),
        }
        earliest, latest = windows[status]
        return max(earliest, opens), latest

    def _quantities(self, spec, statuses, testers):
        committed = [status for status in statuses if status in (ALLOTTED, SHORT, PAID)]
        tester_committed = sum(item.quantity for item in testers if item.status in (ALLOTTED, PAID))
        goal = int(spec.cap * spec.fill) - tester_committed
        shares = self._split(goal, len(committed), spec.minimum, spec.maximum or spec.cap)
        quantities = []
        for status in statuses:
            if status in (ALLOTTED, SHORT, PAID):
                quantities.append(shares.pop(0))
            else:
                ceiling = min(spec.maximum or spec.cap, 20_000)
                quantities.append(lots(self.rng.randint(max(spec.minimum, 2_000), max(spec.minimum, ceiling))))
        return quantities

    def _split(self, total, count, minimum, maximum):
        if count == 0:
            return []
        weights = [self.rng.uniform(0.55, 1.45) for _ in range(count)]
        scale = sum(weights)
        shares = [min(maximum, max(minimum, lots(total * weight / scale))) for weight in weights]
        gap = total - sum(shares)
        index = 0
        while abs(gap) >= LOT and index < count * 4:
            position = index % count
            step = LOT if gap > 0 else -LOT
            if minimum <= shares[position] + step <= maximum:
                shares[position] += step
                gap -= step
            index += 1
        return shares

    def _rail(self):
        return STABLECOIN if self.rng.random() < 0.34 else BANK

    def _tester_application(self, spec, times, item, price):
        candidate = self.candidates[TESTER]
        earliest, latest = self._window(item.status, times)
        created = self.at(item.days, 20, self.rng.randint(0, 59))
        created = min(max(created, earliest, candidate.ready_at + timedelta(hours=1)), latest)
        address = TESTER_WALLETS[item.wallet]
        return self._timeline(spec, times, TESTER, address, item.status, item.quantity, item.rail, created, price)

    def _timeline(self, spec, times, investor, address, status, quantity, rail, created, price):
        due = money(quantity * price)
        submitted = self.after(created, 3, 40)
        base = {"investor": investor, "address": address, "quantity": quantity, "created_at": created}
        if status == DRAFT:
            return Application(**base, rail=BANK, status=DRAFT)
        if status == SUBMITTED:
            return Application(**base, rail=BANK, status=SUBMITTED, submitted_at=submitted)
        if status == WITHDRAWN:
            return Application(
                **base,
                rail=BANK,
                status=WITHDRAWN,
                submitted_at=submitted,
                closed_at=self.after(submitted, 600, 4000),
                reason=self.rng.choice(WITHDRAWAL_REASONS),
            )
        if status == REJECTED:
            return Application(
                **base,
                rail=BANK,
                status=REJECTED,
                submitted_at=submitted,
                closed_at=self.after(submitted, 200, 2000),
                reason=REJECTION_REASON,
            )
        accepted = self.after(submitted, 180, 1500)
        if status == ACCEPTED:
            return Application(**base, rail=BANK, status=ACCEPTED, submitted_at=submitted, accepted_at=accepted)
        instructed = self.after(accepted, 1, 20)
        timeline = {
            **base,
            "rail": rail,
            "submitted_at": submitted,
            "accepted_at": accepted,
            "instructed_at": instructed,
        }
        if status == AWAITING:
            return Application(**timeline, status=AWAITING)
        if status == PARTIAL:
            paid = self.after(instructed, 300, 1500)
            return Application(**timeline, status=AWAITING, payments=(Payment(paid, money(due / 2)),))
        if status == LAPSED:
            payment_due = min(instructed + timedelta(days=7), times["closes"])
            return Application(**timeline, status=REJECTED, closed_at=self._expiry_run(payment_due), reason=LAPSED)
        paid_at = self.after(instructed, *((20, 240) if rail == STABLECOIN else (1440, 5760)))
        if status == REFUNDED:
            return self._refunded(spec, times, timeline, due, paid_at)
        if status == SHORT:
            amount = money(due * Decimal("0.9"))
            return Application(**timeline, status=ALLOTTED, payments=(Payment(paid_at, amount, final=True),))
        final = ALLOTTED if status == ALLOTTED else PAID
        return Application(**timeline, status=final, payments=(Payment(paid_at, due),))

    def _refunded(self, spec, times, timeline, due, paid_at):
        if spec.status == "closed":
            paid_at = self.after(times["closed"], 120, 1200)
            note = "late"
        else:
            note = self.rng.choice(("duplicate", "changed"))
        return Application(
            **timeline,
            status=REFUNDED,
            payments=(Payment(paid_at, due),),
            closed_at=self.after(paid_at, 600, 2880),
            reason=note,
            refund=due,
        )

    def _expiry_run(self, due):
        run = utc(due).replace(hour=EXPIRY_HOUR_UTC, minute=0, second=0, microsecond=0)
        if run <= due:
            run += timedelta(days=1)
        return run + timedelta(seconds=self.rng.randint(4, 50))

    def _scale_back(self, spec, applications, price):
        paid = [application for application in applications if application.status == ALLOTTED]
        requested = sum(self._allotment(application, price) for application in paid)
        room = spec.cap
        result = []
        for application in applications:
            if application.status != ALLOTTED:
                result.append(application)
                continue
            base = self._allotment(application, price)
            allotted = base if requested <= room else max(min(base, base * room // requested), 0)
            refund = application.received - money(allotted * price)
            result.append(replace(application, allotted=allotted, refund=refund if refund > 0 else None))
        return result

    @staticmethod
    def _allotment(application, price):
        payment = application.payments[0]
        if not payment.final:
            return application.quantity
        covered = (payment.amount / price).to_integral_value(rounding=ROUND_DOWN)
        return min(application.quantity, int(covered))

    def _request(self, spec, classes):
        share_class = next(item for item in classes if item.key == spec.share_class)
        company = share_class.company
        if spec.holder == "treasury":
            treasury = self._treasury(company)
            holder, address = treasury.key, treasury.address
        else:
            holders = [
                position
                for position in share_class.positions
                if position.holder in self.candidates
                and self.candidates[position.holder].role == "investor"
                and position.holder not in self.requested
            ]
            if not holders:
                return None
            chosen = self.rng.choice(holders)
            holder, address = chosen.holder, chosen.address
            self.requested.add(holder)
        submitted = self.moment(spec.submitted)
        review = self.moment(spec.review) if spec.review else None
        decided = self.moment(spec.decided) if spec.decided else None
        return Request(
            key=spec.key,
            share_class=spec.share_class,
            holder=holder,
            address=address,
            shares=spec.shares,
            status=spec.status,
            reason=spec.reason,
            submitted_at=submitted,
            review_at=max(review, submitted) if review else None,
            decided_at=max(decided, review or submitted) if decided else None,
            decision=spec.decision,
        )

    def _raise(self, spec, classes):
        share_class = next(item for item in classes if item.key == spec.share_class)
        created = self.moment(spec.created)
        submitted = self.moment(spec.submitted) if spec.submitted else None
        decided = self.moment(spec.decided) if spec.decided else None
        return Raise(
            key=spec.key,
            share_class=spec.share_class,
            status=spec.status,
            additional=spec.additional,
            new_total=share_class.authorised + spec.additional,
            purpose=spec.purpose,
            board_reference=spec.board_reference,
            created_at=created,
            submitted_at=max(submitted, created) if submitted else None,
            decided_at=max(decided, submitted or created) if decided else None,
            decision=spec.decision,
        )
