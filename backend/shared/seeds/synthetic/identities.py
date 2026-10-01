import re

from companies.validators import abn_is_valid, acn_check_digit

EMAIL_DOMAIN = "demo.ledova.test"

FIRST_NAMES = (
    "Olivia Liam Charlotte Noah Amelia Jack Isla William Mia Oliver Ava Henry Grace Thomas Chloe James Sophie "
    "Lucas Ruby Ethan Harper Leo Zoe Samuel Matilda Mei Wei Jun Hiroshi Yuki Priya Arjun Ananya Rohan Aisha "
    "Omar Fatima Karim Linh Minh Thanh Huong Nikos Eleni Dimitri Sofia Marco Giulia Luca Francesca Rami Layla "
    "Elias Aroha Tane Mere Wiremu Siobhan Declan Bronwyn Callum Hamish Imogen Jasper Keira Lachlan Maeve Nadia"
).split()

LAST_NAMES = (
    "Smith Jones Williams Brown Wilson Taylor Johnson White Martin Anderson Thompson Nguyen Tran Le Pham Chen "
    "Wang Li Zhang Liu Wong Lee Patel Singh Sharma Kumar Khan Ali Haddad Khoury Nasser Papadopoulos Georgiou "
    "Nikolaidis Rossi Russo Romano Marino Kelly Murphy O'Brien Walsh Ryan Campbell Stewart Robertson Mitchell "
    "Clarke Hughes Edwards Parata Ngata Tipene Kowalski Novak Schmidt Fischer Becker Yamamoto Tanaka Sato Kim "
    "Park Choi Fernandes Silva Costa Mendes Okafor Mensah"
).split()

SUBURBS = (
    ("Lyrebird Downs", "NSW", "2577"),
    ("Bottlebrush Bay", "NSW", "2263"),
    ("Coolabah Rise", "NSW", "2759"),
    ("Kurrajong Hollow", "NSW", "2083"),
    ("Quandong Vale", "VIC", "3437"),
    ("Mallee Springs", "VIC", "3156"),
    ("Brolga Creek", "VIC", "3818"),
    ("Saltbush Flats", "SA", "5114"),
    ("Boobook Point", "QLD", "4573"),
    ("Gidgee Park", "QLD", "4118"),
    ("Tuart Glen", "WA", "6168"),
    ("Spinifex Heights", "WA", "6065"),
    ("Mulga Ridge", "ACT", "2913"),
    ("Waratah Gardens", "TAS", "7052"),
)

STREETS = (
    "Ironbark Lane",
    "Wattlebird Crescent",
    "Lilly Pilly Close",
    "Paperbark Way",
    "Kingfisher Parade",
    "Bluewren Street",
    "Currawong Avenue",
    "Grevillea Grove",
    "Blackbutt Road",
    "Rosella Terrace",
    "Angophora Drive",
    "Pardalote Place",
    "Firewheel Circuit",
    "Corella Street",
    "Tallowood Court",
)

MOBILE_NUMBERS = (
    "491570006 491570156 491570157 491570158 491570159 491570110 491570313 491570737 491571266 491571491 "
    "491571804 491572549 491572665 491572983 491573770 491573087 491574118 491574632 491575254 491575789 "
    "491576398 491576801 491577426 491577644 491578957 491578148 491578888 491579212 491579455 491579760"
).split()

AREA_CODES = {"NSW": "2", "ACT": "2", "VIC": "3", "TAS": "3", "QLD": "7", "SA": "8", "WA": "8", "NT": "8"}

OCCUPATIONS = (
    "Software engineer",
    "Civil engineer",
    "Medical practitioner",
    "Dentist",
    "Pharmacist",
    "Architect",
    "Business owner",
    "Company director",
    "Financial planner",
    "Data scientist",
    "Mining engineer",
    "Retired",
    "Physiotherapist",
    "Veterinarian",
    "University lecturer",
    "Project manager",
    "Airline pilot",
    "Chartered accountant",
    "Orthopaedic surgeon",
    "Barrister",
    "Agronomist",
    "Product designer",
)

HIGH_RISK_OCCUPATIONS = ("Real estate agent", "Precious metals dealer", "Money services operator")

EMPLOYERS = (
    "Harbourline Engineering Pty Ltd",
    "Southgate Health Services Pty Ltd",
    "Meridian Data Works Pty Ltd",
    "Coastal Rail Maintenance Pty Ltd",
    "Banksia Legal Partners Pty Ltd",
    "Redgum Mining Services Pty Ltd",
)

CERTIFIERS = (
    ("Morgan Hale", "ca_anz"),
    ("Priya Natarajan", "cpa_australia"),
    ("Connor Blake", "ipa"),
    ("Hannah Weiss", "ca_anz"),
    ("Tomasz Wrona", "cpa_australia"),
)

WALLET_NAMES = ("Main", "Savings", "Trading", "MetaMask", "Rabby", "Coinbase Wallet", "Everyday")
HARDWARE_NAMES = ("Keystone", "Cold storage", "Keystone vault")
BITCOIN_NAMES = ("Sparrow", "Bitcoin savings", "BlueWallet")


def slug(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def email_for(first, last, taken):
    base = f"{slug(first)}.{slug(last)}"
    candidate, suffix = base, 2
    while candidate in taken:
        candidate, suffix = f"{base}{suffix}", suffix + 1
    taken.add(candidate)
    return f"{candidate}@{EMAIL_DOMAIN}"


def home_address(rng):
    suburb, state, postcode = rng.choice(SUBURBS)
    unit = f"{rng.randint(1, 24)}/" if rng.random() < 0.25 else ""
    return f"{unit}{rng.randint(2, 180)} {rng.choice(STREETS)}, {suburb} {state} {postcode}", state


def landline(rng, state):
    return f"{AREA_CODES[state]}{rng.choice(('5550', '7010'))}{rng.randint(0, 9999):04d}"


def acn(number):
    base = f"99{number:06d}"
    return base + str(acn_check_digit(base))


def abn_for(acn_digits):
    for prefix in range(10, 100):
        candidate = f"{prefix}{acn_digits}"
        if abn_is_valid(candidate):
            return candidate
    raise ValueError("No ABN prefix satisfies the check for this ACN.")


def spaced_abn(abn):
    return f"{abn[:2]} {abn[2:5]} {abn[5:8]} {abn[8:]}"
