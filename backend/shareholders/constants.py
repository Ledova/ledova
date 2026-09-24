from fractions import Fraction

PUBLICATION_FILE_SUFFIX = ".bin"

PUBLICATION_NOTICE = "publication"

READ_AS_MEMBER = "member"
READ_AS_COMPANY = "company"
READ_AS_STAFF = "staff"

PUBLICATION_READ_KINDS = [
    (READ_AS_MEMBER, "Member"),
    (READ_AS_COMPANY, "Company"),
    (READ_AS_STAFF, "Staff"),
]

SPECIAL_RESOLUTION_MAJORITY = Fraction(3, 4)
