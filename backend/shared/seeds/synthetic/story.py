import math
from dataclasses import replace
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import NamedTuple

from companies.models import DocumentType
from shared.seeds.demo import (
    DEMO_ACN,
    DEMO_COMPANY_NAME,
    DEMO_INVESTOR_EMAIL,
    DEMO_INVESTOR_NAME,
    DEMO_OWNER_EMAIL,
    DEMO_OWNER_NAME,
)
from shared.seeds.synthetic import identities, keys
from shared.seeds.synthetic.alerts import AlertBook
from shared.seeds.synthetic.clock import Calendar, nearest_midnight, utc_midnight
from shared.seeds.synthetic.plan import (
    DEFAULT_INVESTORS,
    MINIMUM_INVESTORS,
    SEED,
    STEP_STATUS,
    WINDOW_DAYS,
    Attempt,
    Certificate,
    Claim,
    CompanyDocumentPlan,
    CompanyPlan,
    Device,
    Financial,
    Kyc,
    Note,
    Payslip,
    Person,
    Plan,
    Ref,
    StaffMember,
    Step,
    Transfer,
    WalletPlan,
    stream,
)
from users.models.investor_classification import plus_years
from users.services.identity import REVIEW_OUTCOME_MESSAGES
from users.services.notifications import transaction_message

PEOPLE_STREAM = "people"
CURRENT_PRICES = {
    "BTC": Decimal("98400.00"),
    "ETH": Decimal("3620.00"),
    "USDC": Decimal("1.0000"),
    "USDT": Decimal("1.0002"),
}
VOLATILITY = {"BTC": 0.024, "ETH": 0.033, "USDC": 0.0003, "USDT": 0.0003}
STABLECOINS = ("USDC", "USDT")
CENT = Decimal("0.01")
PRICE_PLACES = {"BTC": CENT, "ETH": CENT, "USDC": Decimal("0.0001"), "USDT": Decimal("0.0001")}
AMOUNT_PLACES = {"BTC": Decimal("0.00000001"), "ETH": Decimal("0.000001"), "USDC": CENT, "USDT": CENT}
USD_AUD = Decimal("1.5240")
SEND_CEILING = Decimal("4500")
DUST = Decimal("20")
NATIVE = {"base": "ETH", "ethereum": "ETH", "bitcoin": "BTC"}
FEES = {
    "base": (Decimal("0.000002"), Decimal("0.000021")),
    "ethereum": (Decimal("0.00012"), Decimal("0.0016")),
    "bitcoin": (Decimal("0.0000045"), Decimal("0.000031")),
}
FEE_PLACES = {"base": Decimal("0.000000001"), "ethereum": Decimal("0.000000001"), "bitcoin": Decimal("0.00000001")}
BLOCKS = {"base": (45_120_000, 2), "ethereum": (10_640_000, 12), "bitcoin": (4_611_000, 600)}

STAFF = (
    ("compliance", "helena.marsh", "Compliance officer", 198, None),
    ("documents", "tomas.reyes", "Document reviewer", 196, None),
    ("operations", "grace.okafor", "Operations officer", 194, None),
    ("former", "daniel.burke", "Former operations officer", 199, 76),
)
STAFF_NAMES = (("Helena", "Marsh"), ("Tomas", "Reyes"), ("Grace", "Okafor"), ("Daniel", "Burke"))

SPECIAL_COHORTS = (
    ("unverified", 2),
    ("stalled", 3),
    ("kyc_pending", 4),
    ("kyc_resubmit", 2),
    ("kyc_red", 3),
    ("kyc_rejected", 1),
)
JOIN_RANGES = {
    "unverified": (2, 24),
    "stalled": (8, 120),
    "kyc_pending": (2, 45),
    "kyc_resubmit": (5, 90),
    "kyc_red": (6, 150),
    "kyc_rejected": (30, 150),
}
STALLED_STEPS = ("account-type", "identity-verification", "financial-profile")
PENDING_STATES = (("kycaid", "pending"), ("sumsub", "queued"), ("sumsub", "onHold"), ("kycaid", "pending"))
RED_LABELS = (("DOCUMENT_EXPIRED",), ("SELFIE_MISMATCH",), ("DOCUMENT_DAMAGED", "BAD_PHOTO_QUALITY"))
RESUBMIT_LABELS = (("UNSATISFACTORY_PHOTOS",), ("DOCUMENT_PAGE_MISSING", "INCOMPLETE_DOCUMENT"))
COVERAGE_STORIES = (
    "accountant",
    "professional",
    "product_value",
    "associated",
    "awaiting",
    "expired_renewing",
    "rejected",
    "revoked",
    "withdrawn",
    "rejected_then_verified",
    "expired",
    "unclassified",
    "withdrawn_then_professional",
)
FILL_STORIES = {
    "accountant": 16,
    "professional": 5,
    "product_value": 2,
    "associated": 2,
    "awaiting": 2,
    "unclassified": 4,
    "rejected_then_verified": 1,
}
HISTORY_DAYS = {
    "expired_renewing": 125,
    "revoked": 100,
    "rejected_then_verified": 90,
    "expired": 150,
    "withdrawn_then_professional": 80,
}
ROLE_DAYS = {
    "suspended": 60,
    "terminated": 90,
    "structuring": 125,
    "large_deposit": 135,
    "sof_deposit": 95,
    "screened_send": 70,
    "high_volume": 45,
    "dormant": 150,
    "rapid": 50,
    "media": 70,
    "discrepancy": 20,
}
RISKS = (("medium_occupation", 2), ("medium_sof", 2), ("medium_pep", 1), ("high_pep", 1))
FOREIGN_CITIZENSHIPS = ("NZ", "GB", "SG", "US", "IN")
FUND_SOURCES = ("employment_income", "savings", "investment_income", "sale_of_assets", "inheritance")
OTHER_FUND_SOURCES = ("Distribution from a family trust", "Proceeds of a business sale settled in instalments")
INTENDED_OTHER = "Building a position in companies I know personally"

INCOME_BASIS = "Gross income of at least AUD 250,000 in each of the last two financial years"
ASSETS_BASIS = "Net assets of at least AUD 2.5 million"
PROFESSIONAL_BASES = (
    "Controls gross assets of at least AUD 10 million through a family investment company",
    "Holds an Australian financial services licence",
)
PRODUCT_VALUE_BASIS = "Will commit at least AUD 500,000 to each offering I apply for"
ASSOCIATED_BASES = ("Non-executive director of {company}", "Chief financial officer of {company}")
VERIFIED_NOTES = (
    "Certificate checked against the professional body's member register.",
    "Certifier's practising certificate confirmed; figures consistent with the payslips provided.",
    "Evidence reviewed; no inconsistencies found.",
)
REJECTION_REASONS = (
    "The certificate is dated more than two years ago.",
    "The certificate does not say which test the investor meets.",
    "The certifier's membership could not be confirmed with the professional body.",
)
REVOCATION_REASON = "The certifying accountant has withdrawn the certificate."
PAY_DATE_WARNING = "Pay date was not printed; used the period end date."

COMPANY_STREETS = ("Gantry Way", "Foundry Lane", "Harbourview Parade", "Commerce Rise", "Innovation Walk")
INFO_REQUESTS = {
    "coralgum": (
        "Upload a signed beneficial ownership declaration; the copy provided is unsigned.",
        "Signed declaration uploaded.",
        "beneficial_ownership",
    ),
    "saltbush": (
        "The ASIC company extract is more than 12 months old. Upload one issued in the last three months.",
        "",
        "asic",
    ),
}
HISTORICAL_DOCUMENT_TYPES = (
    "cert_inc",
    "asic",
    "constitution",
    "share_register",
    "financials",
    "director_id",
    "beneficial_ownership",
    "business_plan",
    "risk_disclosure",
)
HISTORICAL_APPLICATION_NOTIFICATIONS = {
    "submit": ("Application submitted", "{name} was submitted for review."),
    "resubmit": ("Application resubmitted", "{name} was resubmitted with your response."),
    "start_review": ("Review started", "The review of {name} has started."),
    "request_info": ("More information requested", "More information requested: {reason}"),
    "approve": ("Application approved", "{name} has been approved."),
    "reject": ("Application rejected", "{name} was rejected: {reason}"),
    "activate": ("Company activated", "{name} is now active."),
    "withdraw": ("Application withdrawn", "{name} was withdrawn."),
}
REQUIRED_TYPES = HISTORICAL_DOCUMENT_TYPES
OPTIONAL_TYPES = tuple(choice.value for choice in DocumentType if choice.value not in REQUIRED_TYPES)


class CompanySpec(NamedTuple):
    key: str
    name: str
    trading_name: str
    company_type: str
    industry: str
    description: str
    founded_year: int
    state: str
    owner_days: int
    target: str


DEMO_COMPANY = CompanySpec(
    "demo-robotics",
    DEMO_COMPANY_NAME,
    "Demo Robotics",
    "pty",
    "Robotics",
    "Builds autonomous inspection robots for solar farms and electrical substations.",
    2021,
    "NSW",
    181,
    "active",
)
COMPANY_SPECS = (
    CompanySpec(
        "wattlefield",
        "Wattlefield Energy Pty Ltd",
        "Wattlefield",
        "pty",
        "Renewable energy",
        "Develops community-scale solar and battery projects for regional towns.",
        2019,
        "VIC",
        152,
        "active",
    ),
    CompanySpec(
        "coralgum",
        "Coralgum Medical Limited",
        "Coralgum",
        "unlisted",
        "Medical technology",
        "Makes point-of-care diagnostic devices for rural and remote clinics.",
        2020,
        "QLD",
        118,
        "active",
    ),
    CompanySpec(
        "saltbush",
        "Saltbush Paddock Analytics Pty Ltd",
        "Saltbush Analytics",
        "pty",
        "Agricultural technology",
        "Soil-moisture sensing and irrigation scheduling software for broadacre farms.",
        2022,
        "SA",
        44,
        "info_required",
    ),
    CompanySpec(
        "bilbyline",
        "Bilbyline Freight Pty Ltd",
        "Bilbyline",
        "pty",
        "Logistics",
        "Route-planning and load-matching software for regional freight carriers.",
        2023,
        "WA",
        16,
        "submitted",
    ),
)
COMPANY_NAMES = {spec.key: spec.name for spec in (DEMO_COMPANY, *COMPANY_SPECS)}


def build_plan(now, investors=DEFAULT_INVESTORS, seed=SEED):
    return Story(now, investors, seed).build()


def quantized(value, places):
    return value.quantize(places, rounding=ROUND_DOWN)


def decimal(value):
    return Decimal(repr(value))


class Story:
    def __init__(self, now, investors, seed):
        if investors < MINIMUM_INVESTORS:
            raise ValueError(f"Seed at least {MINIMUM_INVESTORS} investors so that every state is represented.")
        self.rng = stream(PEOPLE_STREAM, seed)
        self.calendar = Calendar(now)
        self.now = self.calendar.anchor
        self.ceiling = (self.now - timedelta(minutes=240)).replace(microsecond=0)
        self.window_start = self.now - timedelta(days=WINDOW_DAYS)
        self.price_origin = utc_midnight(self.now)
        self.investor_total = investors
        self.prices = self._price_series()
        self.taken = {f"{first}.{last}".lower() for first, last in STAFF_NAMES}
        self.pairs = self._name_pairs()
        self.mobiles = list(identities.MOBILE_NUMBERS)
        self.rng.shuffle(self.mobiles)
        self.tester_mobile = self.mobiles.pop()
        self.acns = {DEMO_ACN}
        self.activations = {}
        self.pending = 0
        self.alerts = AlertBook(self)

    def build(self):
        staff = self._staff()
        founder_tester, demo_company = self._founder(DEMO_COMPANY, tester=True)
        founders, companies = [], [demo_company]
        for spec in COMPANY_SPECS:
            founder, company = self._founder(spec)
            founders.append(founder)
            companies.append(company)
        investors = [self._investor(index, *spec) for index, spec in enumerate(self._cohorts(), start=1)]
        tester = self._investor_tester()
        people = sorted((*founders, *investors), key=lambda person: (person.joined_at, person.key))
        return Plan(
            now=self.now,
            staff=staff,
            people=tuple(people),
            testers=(founder_tester, tester),
            companies=tuple(companies),
            alerts=self.alerts.plans(),
            prices={symbol: tuple(values) for symbol, values in self.prices.items()},
            usd_aud=USD_AUD,
        )

    def _price_series(self):
        series = {}
        for symbol, current in CURRENT_PRICES.items():
            values = [current]
            for _ in range(WINDOW_DAYS):
                previous = values[-1] / decimal(math.exp(self.rng.gauss(0, VOLATILITY[symbol])))
                if symbol in STABLECOINS:
                    previous = 1 + (previous - 1) / 2
                values.append(previous)
            series[symbol] = [value.quantize(PRICE_PLACES[symbol]) for value in values]
        return series

    def price_on(self, symbol, moment):
        days = (self.price_origin - nearest_midnight(moment)).days
        return self.prices[symbol][min(max(days, 0), WINDOW_DAYS)]

    def aud_price_on(self, symbol, moment):
        return self.price_on(symbol, moment) * USD_AUD

    def _name_pairs(self):
        pairs = [
            (first, last)
            for first in identities.FIRST_NAMES
            for last in identities.LAST_NAMES
            if (first, last) not in STAFF_NAMES
        ]
        self.rng.shuffle(pairs)
        return pairs

    def moment(self, days_ago, first_hour=8, last_hour=21):
        hour = self.rng.randint(first_hour, last_hour)
        return min(self.calendar.day(days_ago, hour, self.rng.randint(0, 59), self.rng.randint(0, 59)), self.ceiling)

    def after(self, moment, low, high):
        later = moment + timedelta(minutes=self.rng.uniform(low, high))
        return max(moment, min(later.replace(microsecond=0), self.ceiling))

    def before(self, moment, low, high):
        return (moment - timedelta(minutes=self.rng.uniform(low, high))).replace(microsecond=0)

    def recently(self, low_days, high_days):
        return (self.now - timedelta(days=self.rng.uniform(low_days, high_days))).replace(microsecond=0)

    def between(self, start, end):
        if end <= start:
            return start
        return (start + (end - start) * self.rng.random()).replace(microsecond=0)

    def reviewer(self):
        return "compliance" if self.rng.random() < 0.8 else "admin"

    def _staff(self):
        members = []
        for key, handle, title, days, left in STAFF:
            joined = self.moment(days, 9, 11)
            left_at = self.moment(left, 16, 17) if left else None
            last_login = self.before(left_at, 30, 300) if left_at else self.before(self.now, 20, 600)
            members.append(
                StaffMember(
                    key=key,
                    email=f"{handle}@{identities.EMAIL_DOMAIN}",
                    title=title,
                    joined_at=joined,
                    last_login=last_login,
                    left_at=left_at,
                )
            )
        return tuple(members)

    def _identity(self):
        first, last = self.pairs.pop()
        return f"{first} {last}", identities.email_for(first, last, self.taken)

    def _contact(self):
        address, state = identities.home_address(self.rng)
        if self.mobiles and self.rng.random() < 0.85:
            phone = self.mobiles.pop()
        else:
            phone = identities.landline(self.rng, state)
        age = self.rng.randint(26, 71)
        birth = self.calendar.today - timedelta(days=age * 365 + self.rng.randint(0, 364))
        return phone, birth, address

    def _citizenship(self, risk):
        if risk == "medium_occupation":
            country = self.rng.choice(FOREIGN_CITIZENSHIPS)
            return country, ("PASSPORT", country)
        if risk == "high_pep":
            return "AU", ("PASSPORT", "GB")
        country = "AU" if self.rng.random() < 0.82 else self.rng.choice(FOREIGN_CITIZENSHIPS)
        if country == "AU" and self.rng.random() < 0.6:
            return country, ("DRIVERS_LICENSE", "AU")
        return country, ("PASSPORT", country)

    def _financial(self, at, risk, role):
        occupation = self.rng.choice(identities.OCCUPATIONS)
        if risk == "medium_occupation":
            occupation = identities.HIGH_RISK_OCCUPATIONS[0]
        elif risk == "medium_sof":
            occupation = self.rng.choice(identities.HIGH_RISK_OCCUPATIONS[1:])
        elif risk == "high_pep":
            occupation = "Politician"
        sources = tuple(self.rng.sample(FUND_SOURCES, k=self.rng.choice((1, 1, 2))))
        other = ""
        if risk == "medium_sof" or role == "sof_deposit":
            sources, other = ("other",), self.rng.choice(OTHER_FUND_SOURCES)
        intended = self.rng.choices(
            ("long_term_investment", "savings", "trading_crypto", "other"), weights=(70, 15, 10, 5)
        )[0]
        return Financial(
            occupation=occupation,
            source_of_funds=sources,
            intended_use=intended,
            at=at,
            source_other=other,
            intended_other=INTENDED_OTHER if intended == "other" else "",
        )

    def _cohorts(self):
        specials = [
            (name, max(1, round(count * self.investor_total / DEFAULT_INVESTORS))) for name, count in SPECIAL_COHORTS
        ]
        green = self.investor_total - sum(count for _, count in specials)
        stories = list(COVERAGE_STORIES[:green]) + self.rng.choices(
            list(FILL_STORIES), weights=list(FILL_STORIES.values()), k=max(0, green - len(COVERAGE_STORIES))
        )
        roles = self._roles(stories)
        risks = self._risks(green)
        entries = [(name, None, None, "low") for name, count in specials for _ in range(count)]
        entries += [("green", stories[index], roles.get(index), risks[index]) for index in range(green)]
        return entries

    def _roles(self, stories):
        free = list(range(len(stories)))
        self.rng.shuffle(free)
        roles = {}
        for role in ROLE_DAYS:
            if not free:
                break
            wanted = {"terminated": "unclassified", "suspended": "accountant"}.get(role)
            index = next((index for index in free if stories[index] == wanted), free[0])
            free.remove(index)
            roles[index] = role
        return roles

    def _risks(self, green):
        risks = ["low"] * green
        slots = list(range(green))
        self.rng.shuffle(slots)
        for name, count in RISKS:
            for _ in range(count):
                if slots:
                    risks[slots.pop()] = name
        return risks

    def _join_days(self, cohort, story, role):
        if cohort == "green":
            low, high = max(5, HISTORY_DAYS.get(story, 0), ROLE_DAYS.get(role, 0)), 179
        else:
            low, high = JOIN_RANGES[cohort]
        return low + int((high - low) * self.rng.random() ** 1.7)

    def _investor(self, index, cohort, story, role, risk):
        key = f"investor-{index:02d}"
        full_name, email = self._identity()
        joined = self.moment(self._join_days(cohort, story, role), 6, 22)
        if cohort == "unverified":
            return Person(key=key, email=email, full_name=full_name, role="investor", joined_at=joined, cohort=cohort)
        step = STALLED_STEPS[index % len(STALLED_STEPS)] if cohort == "stalled" else None
        completed = None if cohort == "stalled" else self.after(joined, 18, 40)
        profiled = step in (None, "financial-profile")
        phone, birth, address = self._contact() if profiled else (None, None, None)
        citizenship, document = self._citizenship(risk)
        kyc, attempts, status, rejection = self._kyc(cohort, step, joined, document, risk)
        financial = self._financial(self.after(joined, 14, 30), risk, role) if completed else None
        start = kyc.decided_at if kyc and kyc.result == "GREEN" else (completed or joined)
        status_changed = self.alerts.account_change(role) if role in ("suspended", "terminated") else None
        person = Person(
            key=key,
            email=email,
            full_name=full_name,
            role="investor",
            joined_at=joined,
            cohort=cohort,
            email_verified_at=self.after(joined, 1, 4),
            signup_step=step,
            signup_completed_at=completed,
            phone=phone,
            birth_date=birth,
            address=address,
            citizenship=citizenship if profiled else None,
            kyc=kyc,
            attempts=attempts,
            financial=financial,
            account_status=role if status_changed else status,
            rejection_reason=rejection,
            status_changed_at=status_changed,
            last_login=self._last_login(completed, status_changed),
            alerts_enabled=self.rng.random() < 0.85,
            wallets=self._investor_wallets(key, cohort, role, start),
            claims=self._claims(full_name, story, start) if cohort == "green" else (),
            payslips=self._loose_payslips(full_name) if cohort == "green" and self.rng.random() < 0.15 else (),
        )
        if role:
            self.alerts.subject(role, person)
        return self._finish(person)

    def _kyc(self, cohort, step, joined, document, risk):
        document_type, country = document
        if cohort == "stalled" and step != "financial-profile":
            return None, (), "pending", ""
        submitted = self.after(joined, 8, 15)
        if cohort == "kyc_pending":
            provider, status = PENDING_STATES[self.pending % len(PENDING_STATES)]
            self.pending += 1
            return Kyc(provider, status, None, submitted, document_type, country), (), "pending", ""
        if cohort == "kyc_resubmit":
            labels = self.rng.choice(RESUBMIT_LABELS)
            kyc = Kyc("sumsub", "completed", "RED", self.after(submitted, 30, 1800), document_type, country, labels)
            return kyc, (), "pending", ""
        if cohort == "kyc_red":
            labels = self.rng.choice(RED_LABELS)
            kyc = Kyc("kycaid", "completed", "RED", self.after(submitted, 30, 2400), document_type, country, labels)
            return kyc, (), "pending", ""
        attempts = ()
        if cohort == "green" and self.rng.random() < 0.1:
            attempts = (Attempt("RED", self.after(submitted, 20, 90)),)
            submitted = self.after(attempts[0].at, 600, 2880)
        decided = self.after(submitted, 4, 900)
        if cohort == "kyc_rejected":
            kyc = Kyc("kycaid", "completed", "GREEN", decided, "PASSPORT", "GB", pep_type="foreign")
            return kyc, attempts, "rejected", "pep_policy"
        provider, pep = ("sumsub", "domestic") if risk in ("medium_pep", "high_pep") else ("kycaid", "none")
        kyc = Kyc(provider, "completed", "GREEN", decided, document_type, country, pep_type=pep)
        return kyc, attempts, "active", ""

    def _last_login(self, completed, status_changed=None):
        if completed is None:
            return None
        if status_changed:
            return self.before(status_changed, 60, 4320)
        if self.rng.random() < 0.78:
            moment = self.now - timedelta(hours=self.rng.uniform(0.3, 340))
        else:
            moment = self.now - timedelta(days=self.rng.uniform(14, 75))
        return max(moment.replace(microsecond=0), completed + timedelta(minutes=5))

    def _wallet(self, chain, key, registered, verified=True, signing="software", name=None, derivation=None):
        address = keys.bitcoin_address(key) if chain == "bitcoin" else keys.evm_address(key)
        challenged = None if verified or self.rng.random() < 0.5 else self.after(registered, 1, 3)
        return WalletPlan(
            chain=chain,
            address=address,
            key=key,
            registered_at=registered,
            name=name,
            signing=signing,
            verified_at=self.after(registered, 1, 12) if verified else None,
            challenged_at=challenged,
            synced_at=self.before(self.now, 4, 58) if verified else None,
            derivation=derivation,
        )

    def _slots(self, role):
        slots = ["base" if self.rng.random() < 0.88 else "ethereum"]
        for _ in range(self.rng.choices((1, 2, 3, 4), weights=(45, 35, 15, 5))[0] - 1):
            options = [kind for kind in ("mirror", "bitcoin", "base", "ethereum") if kind not in slots[1:]]
            weights = {"mirror": 35, "bitcoin": 25, "base": 25, "ethereum": 15}
            slots.append(self.rng.choices(options, weights=[weights[kind] for kind in options])[0])
        wanted = self.alerts.chain_for(role)
        if wanted == "ethereum" and not {"ethereum", "mirror"} & set(slots):
            slots.append("mirror" if slots[0] == "base" else "ethereum")
        if wanted == "bitcoin" and "bitcoin" not in slots:
            slots.append("bitcoin")
        return slots

    def _investor_wallets(self, key, cohort, role, start):
        if cohort in ("kyc_pending", "kyc_resubmit", "kyc_red"):
            if self.rng.random() < 0.5:
                return (self._wallet("base", keys.secret("wallet", key, 0), self.after(start, 30, 4000), False),)
            return ()
        if cohort != "green":
            return ()
        wallets, first = [], None
        for position, kind in enumerate(self._slots(role)):
            early = position == 0 or role is not None
            registered = self.after(start, 20, 2880) if early else self.after(first.registered_at, 60, 40000)
            verified = early or self.rng.random() < 0.85
            if kind == "bitcoin":
                name = self.rng.choice(identities.BITCOIN_NAMES) if self.rng.random() < 0.6 else None
                wallet = self._wallet("bitcoin", keys.secret("bitcoin", key, position), registered, verified, name=name)
            elif kind == "mirror" and first.chain == "base":
                wallet = self._wallet(
                    "ethereum", first.key, registered, verified, first.signing, first.name, first.derivation
                )
            else:
                chain = "base" if kind == "base" else "ethereum"
                if self.rng.random() < 0.2:
                    piece = keys.hardware_keys(keys.secret("keystone", key), [position])[0]
                    name = self.rng.choice(identities.HARDWARE_NAMES)
                    wallet = self._wallet(chain, piece.key, registered, verified, "hardware", name, piece.derivation)
                else:
                    signing = "software" if self.rng.random() < 0.93 else None
                    name = self.rng.choice(identities.WALLET_NAMES) if self.rng.random() < 0.6 else None
                    wallet_key = keys.secret("wallet", key, position)
                    wallet = self._wallet(chain, wallet_key, registered, verified, signing, name)
            first = first or wallet
            wallets.append(wallet)
        return self._with_activity(wallets, role)

    def _with_activity(self, wallets, role):
        verified = [wallet for wallet in wallets if wallet.verified_at]
        wanted = self.alerts.chain_for(role)
        role_wallet = next((wallet for wallet in verified if wallet.chain == wanted), verified[0]) if role else None
        chosen = verified[:2] if role or self.rng.random() < 0.5 else []
        if role_wallet is not None and role_wallet not in chosen:
            chosen.append(role_wallet)
        result = []
        for wallet in wallets:
            if wallet in chosen:
                own = wallet is role_wallet
                forced = self.alerts.forced_events(role, wallet) if own else []
                end = self.alerts.activity_end(role) if own else None
                start = self.after(wallet.verified_at, 60, 2880)
                transfers, holdings = self.activity(wallet, start, self.rng.randint(3, 8), forced, end)
                if own:
                    self.alerts.record(role, transfers)
                wallet = replace(wallet, transfers=transfers, holdings=holdings)
            result.append(wallet)
        return tuple(result)

    def activity(self, wallet, start, count, forced=(), end=None, app_share=0.7):
        end = min(end or self.ceiling, self.ceiling)
        events = sorted(
            [(self.between(start, end), None) for _ in range(count if end > start else 0)] + list(forced),
            key=lambda event: event[0],
        )
        ledger = Ledger(self, wallet, app_share)
        for at, spec in events:
            symbol, incoming, value, app_sent, label = spec or self._random_event(wallet.chain, ledger.balances)
            if not incoming and not ledger.can_send(symbol, value, at):
                if spec is None:
                    symbol, incoming, value, app_sent = NATIVE[wallet.chain], True, None, False
                else:
                    ledger.receive(symbol, decimal(value) * Decimal("1.3"), self.before(at, 60, 360))
            transfer = ledger.receive(symbol, value, at) if incoming else ledger.send(symbol, value, at, app_sent, spec)
            if label:
                self.alerts.label(label, transfer)
        return ledger.result()

    def _random_event(self, chain, balances):
        native = NATIVE[chain]
        if balances.get(native, Decimal(0)) * self.aud_price_on(native, self.now) < 25:
            return native, True, None, False, None
        symbols = ("ETH", "USDC", "USDT") if chain == "ethereum" else (native,)
        if self.rng.random() < 0.45:
            return self.rng.choices(symbols, weights=(5, 3, 2)[: len(symbols)])[0], True, None, False, None
        held = [symbol for symbol in symbols if balances.get(symbol, Decimal(0)) > 0]
        return self.rng.choice(held), False, None, None, None

    def _certificate(self, issued_on):
        certifier, body = self.rng.choice(identities.CERTIFIERS)
        return Certificate(issued_on, certifier, body, f"{self.rng.randint(100000, 999999)}")

    def _payslips(self, full_name, uploaded, count=2, attached=True):
        employer = self.rng.choice(identities.EMPLOYERS)
        employer_abn = identities.abn_for(self._new_acn())
        annual = Decimal(self.rng.randint(262, 418)) * 1000
        slips = []
        for number in range(count):
            period_end = (uploaded - timedelta(days=4 + 14 * number)).date()
            year = period_end.year if period_end.month >= 7 else period_end.year - 1
            fortnights = max(1, (period_end - date(year, 7, 1)).days // 14 + 1)
            gross = (annual / 26).quantize(CENT)
            tax = (gross * Decimal("0.37")).quantize(CENT)
            slips.append(
                Payslip(
                    filename=f"payslip-{period_end:%Y-%m-%d}.pdf",
                    uploaded_at=uploaded,
                    employer=employer,
                    employer_abn=employer_abn,
                    employee=full_name,
                    period_start=period_end - timedelta(days=13),
                    period_end=period_end,
                    gross=gross,
                    tax=tax,
                    superannuation=(gross * Decimal("0.12")).quantize(CENT),
                    ytd_gross=gross * fortnights,
                    ytd_tax=tax * fortnights,
                    succeeded=attached or self.rng.random() > 0.3,
                    confidence=round(self.rng.uniform(0.84, 0.97), 2),
                    duration_ms=self.rng.randint(2400, 6900),
                    warnings=(PAY_DATE_WARNING,) if self.rng.random() < 0.3 else (),
                )
            )
        return tuple(slips)

    def _loose_payslips(self, full_name):
        return self._payslips(full_name, self.recently(2, 26), count=self.rng.choice((1, 2)), attached=False)

    def _new_acn(self):
        while True:
            candidate = identities.acn(self.rng.randint(0, 999999))
            if candidate not in self.acns:
                self.acns.add(candidate)
                return candidate

    def _accountant(self, full_name, submitted, status="verified", issued_on=None):
        issued_on = issued_on or (submitted - timedelta(days=self.rng.randint(20, 400))).date()
        income = self.rng.random() < 0.5
        reviewed = self.after(submitted, 180, 4200) if status != "submitted" else None
        return Claim(
            category="accountant_certificate",
            status=status,
            submitted_at=submitted,
            declared_basis=INCOME_BASIS if income else ASSETS_BASIS,
            reviewed_at=reviewed,
            reviewer=self.reviewer() if reviewed else None,
            expires_at=plus_years(issued_on) if status == "verified" else None,
            review_notes=self.rng.choice(VERIFIED_NOTES) if status == "verified" else "",
            rejection_reason=self.rng.choice(REJECTION_REASONS) if status == "rejected" else "",
            certificate=self._certificate(issued_on),
            payslips=self._payslips(full_name, self.before(submitted, 5, 90)) if income else (),
        )

    def _simple(self, category, submitted, status="verified", basis="", company=None):
        reviewed = self.after(submitted, 120, 4000) if status != "submitted" else None
        return Claim(
            category=category,
            status=status,
            submitted_at=submitted,
            declared_basis=basis,
            reviewed_at=reviewed,
            reviewer=self.reviewer() if status == "verified" else None,
            expires_at=plus_years(reviewed) if status == "verified" else None,
            review_notes=self.rng.choice(VERIFIED_NOTES) if status == "verified" else "",
            company=company,
        )

    def _professional(self, submitted, status="verified"):
        return self._simple("professional_investor", submitted, status, self.rng.choice(PROFESSIONAL_BASES))

    def _claims(self, full_name, story, start):
        first = self.after(start, 60, 8000)
        if story == "accountant":
            return (self._accountant(full_name, first),)
        if story == "professional":
            return (self._professional(first),)
        if story == "product_value":
            return (self._simple("product_value", first, basis=PRODUCT_VALUE_BASIS),)
        if story == "associated":
            return self._associated(full_name, first)
        if story == "awaiting":
            submitted = max(first, self.recently(1, 6))
            if self.rng.random() < 0.75:
                return (self._accountant(full_name, submitted, status="submitted"),)
            return (self._professional(submitted, "submitted"),)
        if story in ("expired", "expired_renewing"):
            expiry = self.now - timedelta(days=self.rng.uniform(15, 60))
            expired = self._accountant(full_name, first, issued_on=(expiry - timedelta(days=730)).date())
            if story == "expired":
                return (expired,)
            renewal = max(expired.reviewed_at, self.recently(1, 5))
            return expired, self._accountant(full_name, renewal, status="submitted")
        if story == "rejected":
            return (self._accountant(full_name, first, status="rejected"),)
        if story == "rejected_then_verified":
            rejected = self._accountant(full_name, first, status="rejected")
            return rejected, self._accountant(full_name, self.after(rejected.reviewed_at, 2880, 20000))
        if story == "revoked":
            verified = self._accountant(full_name, first)
            revoked = replace(
                verified,
                status="revoked",
                verified_at=verified.reviewed_at,
                verifier=verified.reviewer,
                reviewed_at=max(self.recently(12, 40), verified.reviewed_at),
                reviewer="compliance",
                rejection_reason=REVOCATION_REASON,
            )
            return (revoked,)
        if story in ("withdrawn", "withdrawn_then_professional"):
            withdrawn = self._simple("product_value", first, "withdrawn", PRODUCT_VALUE_BASIS)
            if story == "withdrawn":
                return (withdrawn,)
            return withdrawn, self._professional(self.after(withdrawn.reviewed_at, 1440, 30000))
        return ()

    def _associated(self, full_name, submitted):
        open_to = [key for key, activated in self.activations.items() if activated <= submitted]
        if not open_to:
            return (self._accountant(full_name, submitted),)
        company = self.rng.choice(open_to)
        basis = self.rng.choice(ASSOCIATED_BASES).format(company=COMPANY_NAMES[company])
        return (self._simple("associated_person", submitted, basis=basis, company=company),)

    def _devices(self, key, start, notes):
        if start is None or self.rng.random() > 0.55:
            return ()
        count = 2 if self.rng.random() < 0.15 else 1
        devices = []
        for number in range(count):
            registered = self.after(start, 5, 30) if number == 0 else self.after(start, 4320, 60000)
            pushed = [note.at for note in notes if note.at >= registered]
            last_used = max(pushed) if pushed and number == count - 1 else self.after(registered, 600, 20000)
            devices.append(
                Device(
                    token=keys.device_token(key, number),
                    device_type="ios" if self.rng.random() < 0.6 else "android",
                    registered_at=registered,
                    last_used_at=max(last_used, registered),
                )
            )
        return tuple(devices)

    def _finish(self, person, company_steps=(), company_key=None):
        raw = [self._identity_note(attempt.result, attempt.at) for attempt in person.attempts]
        if person.kyc and person.kyc.result in REVIEW_OUTCOME_MESSAGES:
            raw.append(self._identity_note(person.kyc.result, person.kyc.decided_at))
        for step in company_steps:
            title, body = HISTORICAL_APPLICATION_NOTIFICATIONS[step.method]
            data = {
                "type": "company",
                "event": step.method,
                "company_id": Ref("company", company_key),
                "status": STEP_STATUS[step.method],
            }
            text = body.format(name=COMPANY_NAMES[company_key], reason=step.reason)
            raw.append((step.at + timedelta(seconds=2), title, text, "general", data))
        for wallet in person.wallets:
            for transfer in wallet.transfers:
                if transfer.app_sent:
                    title, text = transaction_message(transfer.status, transfer.amount, transfer.symbol)
                    data = {
                        "type": "transaction",
                        "event": transfer.status,
                        "transaction_id": Ref("transaction", transfer.tx_hash),
                    }
                    raw.append(
                        (transfer.at + timedelta(seconds=self.rng.randint(30, 240)), title, text, "transaction", data)
                    )
        notes = tuple(self._note(*entry, person.last_login) for entry in sorted(raw, key=lambda entry: entry[0]))
        return replace(person, notes=notes, devices=self._devices(person.key, person.signup_completed_at, notes))

    def _identity_note(self, result, at):
        title, body = REVIEW_OUTCOME_MESSAGES[result]
        return at + timedelta(seconds=2), title, body, "general", {"type": "identity", "event": result}

    def _note(self, at, title, body, kind, data, last_login):
        read_at, archived = None, False
        if last_login and at < last_login and self.rng.random() < 0.8:
            read_at = self.after(at, 5, min(4320, max(6, (last_login - at).total_seconds() / 60)))
            archived = self.rng.random() < 0.12
        return Note(at=at, title=title, body=body, kind=kind, data=data, read_at=read_at, archived=archived)

    def _company_steps(self, spec, documents_ready):
        steps = [Step("submit", self.after(documents_ready, 180, 2880))]
        if spec.target == "submitted":
            return steps
        steps.append(Step("start_review", self.after(steps[-1].at, 1200, 3000)))
        info = INFO_REQUESTS.get(spec.key)
        if info:
            steps.append(Step("request_info", self.after(steps[-1].at, 1440, 4320), info[0]))
            if spec.target == "info_required":
                return steps
            steps.append(Step("resubmit", self.after(steps[-1].at, 1440, 5760), info[1]))
            steps.append(Step("start_review", self.after(steps[-1].at, 1080, 2400)))
        steps.append(Step("approve", self.after(steps[-1].at, 2880, 7200)))
        steps.append(Step("activate", self.after(steps[-1].at, 120, 1560)))
        return steps

    def _company_documents(self, spec, registered, steps):
        chosen = list(REQUIRED_TYPES)
        if spec.target == "active":
            chosen += OPTIONAL_TYPES
        elif spec.target == "info_required":
            chosen += OPTIONAL_TYPES[:2]
        at = {step.method: step.at for step in steps}
        reviews = [step.at for step in steps if step.method == "start_review"]
        window_end = at.get("approve") or at.get("request_info")
        info = INFO_REQUESTS.get(spec.key)
        slug = identities.slug(spec.trading_name)
        documents = []
        for document_type in chosen:
            uploaded = self.between(registered, steps[0].at)
            replaced = info and info[2] == document_type
            if replaced and "resubmit" in at:
                uploaded = self.before(at["resubmit"], 30, 240)
            rejected = replaced and spec.target == "info_required"
            verified = None
            if reviews and window_end and not rejected:
                verified = self.between(max(reviews[-1], uploaded), window_end)
            valid_from = None
            if document_type == "asic":
                valid_from = (uploaded - timedelta(days=430 if rejected else 3)).date()
            label = DocumentType(document_type).label.lower().replace(" ", "-")
            documents.append(
                CompanyDocumentPlan(
                    document_type=document_type,
                    name=f"{slug}-{label}.pdf",
                    uploaded_at=uploaded,
                    valid_from=valid_from,
                    verified_at=verified,
                    rejection_reason=info[0] if rejected else "",
                )
            )
        return tuple(sorted(documents, key=lambda document: document.uploaded_at))

    def _company(self, spec, owner_key, owner_name, registered, operator_wallet, acn):
        steps = self._company_steps(spec, self.after(registered, 1440, 7200))
        if spec.target == "active":
            self.activations[spec.key] = steps[-1].at
        suburb, _, postcode = self.rng.choice(
            [entry for entry in identities.SUBURBS if entry[1] == spec.state] or identities.SUBURBS
        )
        area = identities.AREA_CODES[spec.state]
        street = f"Level {self.rng.randint(1, 9)}, {self.rng.randint(10, 240)} {self.rng.choice(COMPANY_STREETS)}"
        return CompanyPlan(
            key=spec.key,
            name=spec.name,
            trading_name=spec.trading_name,
            company_type=spec.company_type,
            acn=acn,
            abn=identities.abn_for(acn),
            industry=spec.industry,
            description=spec.description,
            founded_year=spec.founded_year,
            incorporated_on=date(spec.founded_year, self.rng.randint(1, 12), self.rng.randint(1, 28)),
            phone=f"+61 {area} {self.rng.choice(('5550', '7010'))} {self.rng.randint(0, 9999):04d}",
            address_line_1=street,
            address_line_2="",
            city=suburb,
            state=spec.state,
            postcode=postcode,
            owner=owner_key,
            registered_at=registered,
            declarant_name=owner_name,
            board_resolution_reference=f"Board resolution {registered:%Y}-{self.rng.randint(2, 9):02d}",
            open_to_investors=spec.target == "active",
            operator_wallet=operator_wallet,
            documents=self._company_documents(spec, registered, steps),
            steps=tuple(steps),
            existing=spec.key == DEMO_COMPANY.key,
        )

    def _founder_wallet(self, spec, key, decided, tester):
        if tester:
            hardhat = keys.hardhat_keys([0])[0]
            wallet = self._wallet("base", hardhat.key, self.after(decided, 600, 2000))
        elif spec.key == "coralgum":
            piece = keys.hardware_keys(keys.secret("keystone", key), [0])[0]
            registered = self.after(decided, 600, 4000)
            wallet = self._wallet("base", piece.key, registered, True, "hardware", "Keystone", piece.derivation)
        elif spec.target in ("active", "info_required"):
            wallet = self._wallet("base", keys.secret("wallet", key, 0), self.after(decided, 600, 4000), name="Company")
        else:
            return ()
        transfers, holdings = self.activity(wallet, self.after(wallet.verified_at, 60, 600), self.rng.randint(3, 5))
        return (replace(wallet, transfers=transfers, holdings=holdings),)

    def _founder(self, spec, tester=False):
        if tester:
            key, full_name, email = "tester-founder", DEMO_OWNER_NAME, DEMO_OWNER_EMAIL
        else:
            key = f"founder-{spec.key}"
            full_name, email = self._identity()
        joined = self.moment(spec.owner_days, 8, 18)
        completed = self.after(joined, 20, 45)
        phone, birth, address = self._contact()
        pending = spec.target == "submitted"
        submitted = self.after(joined, 6, 12)
        decided = submitted if pending else self.after(submitted, 5, 240)
        result = None if pending else "GREEN"
        kyc = Kyc("kycaid", "pending" if pending else "completed", result, decided, "DRIVERS_LICENSE", "AU")
        wallets = self._founder_wallet(spec, key, decided, tester)
        operator = wallets[0].address if wallets and spec.target == "active" else None
        acn = DEMO_ACN if tester else self._new_acn()
        company = self._company(spec, key, full_name, self.after(joined, 12, 30), operator, acn)
        person = Person(
            key=key,
            email=email,
            full_name=full_name,
            role="company",
            joined_at=joined,
            cohort="founder",
            email_verified_at=self.after(joined, 1, 3),
            signup_completed_at=completed,
            phone=phone,
            birth_date=birth,
            address=address,
            citizenship="AU",
            kyc=kyc,
            account_status="pending" if pending else "active",
            last_login=self._last_login(completed),
            wallets=wallets,
            existing=tester,
        )
        return self._finish(person, company.steps, spec.key), company

    def _investor_tester_wallets(self, decided):
        hardhat = keys.hardhat_keys(range(5))
        bitcoin = keys.secret("bitcoin", "tester-investor", 0)
        wallets = [
            self._wallet("base", hardhat[1].key, self.after(decided, 30, 60), name="MetaMask"),
            self._wallet("ethereum", hardhat[1].key, self.after(decided, 14000, 15000), name="MetaMask"),
            self._wallet(
                "base",
                hardhat[2].key,
                self.after(decided, 36000, 37000),
                True,
                "hardware",
                "Keystone",
                hardhat[2].derivation,
            ),
            self._wallet("bitcoin", bitcoin, self.after(decided, 50000, 52000), name="Sparrow"),
            self._wallet("base", hardhat[4].key, self.after(decided, 120000, 125000), name="Trading"),
            self._wallet("ethereum", hardhat[3].key, self.moment(31), False, name="Spare"),
            self._wallet("bitcoin", keys.secret("bitcoin", "tester-investor", 1), self.moment(9), False),
        ]
        for position, count in enumerate((24, 16, 12, 14, 14)):
            wallet = wallets[position]
            start = self.after(wallet.verified_at, 120, 900)
            transfers, holdings = self.activity(wallet, start, count, app_share=0.95)
            wallets[position] = replace(wallet, transfers=transfers, holdings=holdings)
        return tuple(wallets)

    def _investor_tester_claims(self, decided):
        rejected = self._accountant(DEMO_INVESTOR_NAME, self.after(decided, 600, 900), status="rejected")
        withdrawn = self._simple(
            "product_value", self.after(rejected.reviewed_at, 4000, 6000), "withdrawn", PRODUCT_VALUE_BASIS
        )
        expiry = self.now - timedelta(days=38)
        expired = self._accountant(
            DEMO_INVESTOR_NAME,
            self.after(withdrawn.reviewed_at, 2000, 3000),
            issued_on=(expiry - timedelta(days=730)).date(),
        )
        if not expired.payslips:
            payslips = self._payslips(DEMO_INVESTOR_NAME, self.before(expired.submitted_at, 10, 60))
            expired = replace(expired, declared_basis=INCOME_BASIS, payslips=payslips)
        submitted = self.moment(46, 9, 17)
        live = Claim(
            category="professional_investor",
            status="verified",
            submitted_at=submitted,
            declared_basis=PROFESSIONAL_BASES[0],
            reviewed_at=self.after(submitted, 300, 1200),
            reviewer="compliance",
            review_notes=VERIFIED_NOTES[2],
            existing=True,
        )
        return rejected, withdrawn, expired, live

    def _investor_tester(self):
        joined = self.moment(176, 19, 20)
        failed = self.after(joined, 25, 35)
        decided = self.after(failed, 1300, 1500)
        loose = self._payslips(DEMO_INVESTOR_NAME, self.recently(11, 13), 2, attached=False)
        loose += self._payslips(DEMO_INVESTOR_NAME, self.recently(2, 4), 1, attached=False)
        person = Person(
            key="tester-investor",
            email=DEMO_INVESTOR_EMAIL,
            full_name=DEMO_INVESTOR_NAME,
            role="investor",
            joined_at=joined,
            cohort="tester",
            email_verified_at=self.after(joined, 1, 2),
            signup_completed_at=self.after(joined, 18, 24),
            phone=self.tester_mobile,
            birth_date=self.calendar.today - timedelta(days=41 * 365 + 120),
            address="27 Wattlebird Crescent, Lyrebird Downs NSW 2577",
            citizenship="AU",
            kyc=Kyc("kycaid", "completed", "GREEN", decided, "DRIVERS_LICENSE", "AU"),
            attempts=(Attempt("RED", failed),),
            financial=Financial(
                occupation="Software engineer",
                source_of_funds=("employment_income", "investment_income"),
                intended_use="long_term_investment",
                at=self.after(joined, 12, 16),
            ),
            account_status="active",
            last_login=self.before(self.now, 120, 150),
            wallets=self._investor_tester_wallets(decided),
            claims=self._investor_tester_claims(decided),
            payslips=loose,
            existing=True,
        )
        return self._finish(person)


class Ledger:
    def __init__(self, story, wallet, app_share):
        self.story = story
        self.wallet = wallet
        self.native = NATIVE[wallet.chain]
        self.balances = {}
        self.transfers = []
        self.nonce = 0
        self.app_share = app_share

    def can_send(self, symbol, value, at):
        fee_ceiling = FEES[self.wallet.chain][1]
        native = self.balances.get(self.native, Decimal(0))
        held = self.balances.get(symbol, Decimal(0))
        if native <= fee_ceiling * 2 or held * self.story.aud_price_on(symbol, at) < DUST:
            return False
        reserve = fee_ceiling if symbol == self.native else 0
        return value is None or decimal(value) / self.story.aud_price_on(symbol, at) <= held - reserve

    def receive(self, symbol, value, at):
        price = self.story.aud_price_on(symbol, at)
        worth = decimal(value) if value is not None else decimal(self.story.rng.uniform(150, 4200))
        amount = quantized(worth / price, AMOUNT_PLACES[symbol])
        self.balances[symbol] = self.balances.get(symbol, Decimal(0)) + amount
        return self._record(symbol, True, amount, at, "confirmed", False, None)

    def send(self, symbol, value, at, app_sent, forced):
        story, chain = self.story, self.wallet.chain
        low, high = FEES[chain]
        fee = quantized(low + (high - low) * decimal(story.rng.random()), FEE_PLACES[chain])
        spare = self.balances[symbol] - (fee if symbol == self.native else 0)
        if value is None:
            share = spare * decimal(story.rng.uniform(0.1, 0.55))
            cap = SEND_CEILING / story.aud_price_on(symbol, at)
            amount = quantized(min(share, cap), AMOUNT_PLACES[symbol])
        else:
            amount = quantized(min(decimal(value) / story.aud_price_on(symbol, at), spare), AMOUNT_PLACES[symbol])
        app_sent = story.rng.random() < self.app_share if app_sent is None else app_sent
        failed = app_sent and chain != "bitcoin" and not forced and story.rng.random() < 0.06
        self.balances[self.native] = self.balances.get(self.native, Decimal(0)) - fee
        if not failed:
            self.balances[symbol] -= amount
        return self._record(symbol, False, amount, at, "failed" if failed else "confirmed", app_sent, fee)

    def _record(self, symbol, incoming, amount, at, status, app_sent, fee):
        story, chain = self.story, self.wallet.chain
        block_base, block_seconds = BLOCKS[chain]
        block = block_base + int((at - story.window_start).total_seconds() / block_seconds)
        nonce = None
        if not incoming and chain != "bitcoin":
            nonce, self.nonce = self.nonce, self.nonce + 1
        tx_hash = keys.transaction_hash(chain, self.wallet.address, len(self.transfers))
        spread = int(tx_hash[-6:], 16)
        if app_sent:
            recorded = at - timedelta(seconds=12 + spread % 58)
            settled = at + timedelta(seconds=40 + spread % 160)
        else:
            recorded = settled = at + timedelta(minutes=6 + spread % 52)
        transfer = Transfer(
            tx_hash=tx_hash,
            chain=chain,
            symbol=symbol,
            incoming=incoming,
            counterparty=keys.counterparty_address(chain, story.rng.randrange(14)),
            amount=amount,
            status=status,
            app_sent=app_sent,
            block_number=block,
            block_hash=keys.block_hash(chain, block),
            at=at,
            market_value=(amount * story.price_on(symbol, at)).quantize(CENT),
            market_value_aud=(amount * story.aud_price_on(symbol, at)).quantize(CENT),
            recorded_at=recorded,
            settled_at=settled,
            monitored_at=recorded + timedelta(seconds=5 + spread % 35),
            fee=fee,
            nonce=nonce,
        )
        self.transfers.append(transfer)
        return transfer

    def result(self):
        holdings = tuple((symbol, quantity) for symbol, quantity in self.balances.items() if quantity > 0)
        return tuple(self.transfers), holdings
