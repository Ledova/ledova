from decimal import Decimal
from fractions import Fraction

from shared.constants import CURRENCY_AUD

PUBLICATION_FILE_SUFFIX = ".bin"

PUBLICATION_NOTICE = "publication"

RECENTLY_PUBLISHED_DAYS = 30

READ_AS_MEMBER = "member"
READ_AS_COMPANY = "company"
READ_AS_STAFF = "staff"

PUBLICATION_READ_KINDS = [
    (READ_AS_MEMBER, "Member"),
    (READ_AS_COMPANY, "Company"),
    (READ_AS_STAFF, "Staff"),
]

SPECIAL_RESOLUTION_MAJORITY = Fraction(3, 4)

DISTRIBUTION_CURRENCIES = (CURRENCY_AUD,)
CENT = Decimal("0.01")
RATE_STEP = Decimal("0.000001")
RATE_CEILING = Decimal(10) ** 12
MONEY_CEILING = Decimal(10) ** 16
