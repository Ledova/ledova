from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import NamedTuple

from shared.seeds.demo import DEMO_INVESTOR_EMAIL
from shared.seeds.synthetic import identities, keys
from shared.seeds.synthetic.chain.plan import (
    FormerMember,
    IssuancePlan,
    Position,
    Raise,
    Request,
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
    first: date | int
    last: date | int
    price: Decimal
    count: int
    shares: tuple


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
EARLY_ROUNDS = {
    f"{DEMO}/PRF": (EarlyRound("Seed preference round", 66, 12, Decimal("1.50"), 10, (8_000, 20_000)),),
    f"{DEMO}/ORD": (
        EarlyRound("Angel round", date(2023, 2, 1), date(2023, 5, 31), Decimal("0.40"), 4, (10_000, 30_000)),
        EarlyRound("Pre-seed round", date(2024, 5, 1), date(2024, 9, 30), Decimal("0.80"), 3, (8_000, 25_000)),
    ),
    f"{WATTLEFIELD}/ORD": (
        EarlyRound("Seed round", date(2022, 3, 1), date(2022, 8, 31), Decimal("0.45"), 2, (20_000, 50_000)),
        EarlyRound("Converted bridge notes", date(2024, 2, 1), date(2024, 6, 30), Decimal("0.70"), 2, (10_000, 40_000)),
        EarlyRound("Community round", 57, 9, Decimal("0.85"), 8, (10_000, 30_000)),
    ),
    f"{CORALGUM}/ORD": (
        EarlyRound("Seed round", date(2021, 3, 1), date(2021, 8, 31), Decimal("0.60"), 3, (60_000, 180_000)),
        EarlyRound("Series A", date(2023, 4, 1), date(2023, 9, 30), Decimal("1.40"), 3, (40_000, 120_000)),
        EarlyRound("Bridge round", date(2025, 2, 1), date(2025, 6, 30), Decimal("2.10"), 3, (20_000, 80_000)),
    ),
    f"{CORALGUM}/CPS": (EarlyRound("Convertible preference round", 41, 15, Decimal("3.20"), 8, (8_000, 25_000)),),
}
CONVERTED_NOTES = (f"{CORALGUM}/CPS", f"{CORALGUM}/ORD", "Converted 2025 notes", Decimal("2.50"), 3, (15_000, 25_000))
TESTER_EARLY = {
    f"{DEMO}/PRF": (1, 12_000, 40, Decimal("1.50"), "Seed preference round"),
    f"{DEMO}/ORD": (1, 12_500, date(2024, 6, 20), Decimal("0.80"), "Pre-seed round"),
    f"{WATTLEFIELD}/ORD": (2, 20_000, 35, Decimal("0.85"), "Community round"),
    f"{CORALGUM}/ORD": (4, 8_000, date(2025, 4, 14), Decimal("2.10"), "Bridge round"),
}
FORMER_SPECS = {
    f"{DEMO}/ORD": (2, (8_000, 20_000), (420, 900)),
    f"{WATTLEFIELD}/ORD": (2, (10_000, 30_000), (500, 1400)),
    f"{CORALGUM}/ORD": (1, (30_000, 80_000), (700, 1500)),
}
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
        requests = tuple(
            self._request(spec, classes) for spec in REQUEST_SPECS if self._has_class(classes, spec.share_class)
        )
        raises = tuple(self._raise(spec, classes) for spec in RAISE_SPECS if self._has_class(classes, spec.share_class))
        return IssuancePlan(
            now=self.now,
            classes=classes,
            treasuries=treasuries,
            requests=tuple(request for request in requests if request is not None),
            raises=raises,
            directors={company: CHAIRS[company] for company in sorted(self.firms) if company in CHAIRS},
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

    def day_between(self, first, last):
        return first + timedelta(days=self.rng.randint(0, (last - first).days))

    def day(self, value):
        return value if isinstance(value, date) else self.calendar.today - timedelta(days=value)

    def _treasury(self, company):
        return Treasury(
            key=f"treasury:{company}",
            company=company,
            label=TREASURY_LABELS[company],
            address=keys.evm_address(keys.secret("treasury", company)),
        )

    def investors(self, company):
        return [
            candidate
            for candidate in self.candidates.values()
            if candidate.role == "investor" and company in candidate.companies and candidate.key != TESTER
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
        taken = {position.holder for position in positions}
        for early in EARLY_ROUNDS.get(key, ()):
            pool = [candidate for candidate in self.investors(spec.company) if candidate.key not in taken]
            for candidate in self.rng.sample(pool, k=min(early.count, len(pool))):
                taken.add(candidate.key)
                shares = lots(self.rng.randint(*early.shares))
                entered = self.day_between(self.day(early.first), self.day(early.last))
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
            positions.append(
                Position(TESTER, TESTER_WALLETS[wallet], shares, self.day(entered), money(shares * price), label)
            )
        if key == CONVERTED_NOTES[0]:
            positions += self._converted_notes()
        self.chosen[key] = [position.holder for position in positions]
        return tuple(positions)

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
