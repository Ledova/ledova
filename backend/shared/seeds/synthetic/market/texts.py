from typing import NamedTuple

from shared.seeds.synthetic.chain.story import CORALGUM, DEMO, WATTLEFIELD


class NoticeSpec(NamedTuple):
    key: str
    listing: str
    kind: str
    title: str
    lines: tuple
    authority: str
    meeting: int = 0
    question: str = ""
    resolution_kind: str = ""
    window: str = ""
    opens: int = 0
    outcome: str = ""
    tester: str | None = None
    rate: str = ""
    declared: int = 0
    payment: int = 0
    paid: str = ""


AS_AT = "as at {record:%-d %B %Y}"
STATEMENT_LINES = (
    "This statement sets out the shares registered in your name in the company's register of members",
    "on the record date. Keep it with your records; the register itself is the evidence of title.",
)
AGM_LINES = (
    "The annual general meeting will be held on {meeting:%A %-d %B %Y} at {meeting:%-I.%M %p} (AEST)",
    "at the company's registered office and online. Members may vote on each resolution in advance,",
    "from the moment its voting window opens until it closes at the start of the meeting.",
)
DEMO_ORD = f"{DEMO}/ORD"
DEMO_PRF = f"{DEMO}/PRF"
WATT_ORD = f"{WATTLEFIELD}/ORD"
CORAL_ORD = f"{CORALGUM}/ORD"

NOTICE_SPECS = (
    NoticeSpec(
        "demo-ord-statement",
        DEMO_ORD,
        "holding_statement",
        "Holding statement " + AS_AT,
        STATEMENT_LINES,
        "demo-statements",
    ),
    NoticeSpec(
        "demo-agm",
        DEMO_ORD,
        "meeting_notice",
        "Notice of the 2026 annual general meeting",
        AGM_LINES,
        "demo-agm",
        meeting=35,
    ),
    NoticeSpec(
        "demo-reelect-chair",
        DEMO_ORD,
        "resolution",
        "Resolution 1: re-election of Margaret Ashdown as a director",
        AGM_LINES,
        "demo-agm",
        meeting=35,
        question=(
            "That Margaret Ashdown, who retires by rotation and offers herself for re-election, "
            "be re-elected as a director of the company."
        ),
        resolution_kind="ordinary",
        window="open",
        outcome="some",
    ),
    NoticeSpec(
        "demo-share-plan",
        DEMO_ORD,
        "resolution",
        "Resolution 2: adoption of the 2026 employee share plan",
        AGM_LINES,
        "demo-agm",
        meeting=35,
        question=(
            "That the company adopt the 2026 employee share plan on the terms set out in the explanatory "
            "memorandum, and that up to 40,000 ordinary shares be issued under it."
        ),
        resolution_kind="ordinary",
        window="open",
        outcome="some",
        tester="for",
    ),
    NoticeSpec(
        "demo-auditor",
        DEMO_ORD,
        "resolution",
        "Resolution 3: appointment of the auditor",
        AGM_LINES,
        "demo-agm",
        meeting=35,
        question="That Harlow Kerr Audit, having consented, be appointed as auditor of the company.",
        resolution_kind="ordinary",
        window="open",
    ),
    NoticeSpec(
        "demo-fee-pool",
        DEMO_ORD,
        "resolution",
        "Resolution 4: non-executive directors' fee pool",
        AGM_LINES,
        "demo-agm",
        meeting=35,
        question="That the maximum aggregate fees payable to non-executive directors be AUD 180,000 a year.",
        resolution_kind="ordinary",
        window="open",
    ),
    NoticeSpec(
        "demo-constitution",
        DEMO_ORD,
        "resolution",
        "Resolution 5: adoption of an amended constitution",
        AGM_LINES,
        "demo-agm",
        meeting=35,
        question=(
            "That the company adopt the amended constitution tabled with this notice, in place of its "
            "current constitution, with effect from the close of the meeting."
        ),
        resolution_kind="special",
        window="upcoming",
        opens=7,
    ),
    NoticeSpec(
        "demo-ratify-trust",
        DEMO_ORD,
        "resolution",
        "Ratification of the issue of 15,000 shares to the employee share trust",
        (
            "The directors put this resolution to members by circular, with a short voting window, so that",
            "the trust's allocation for the engineering hires counts towards this year's placement capacity.",
        ),
        "demo-circular",
        question=(
            "That the issue of 15,000 ordinary shares to the Demo Robotics Employee Share Trust be ratified "
            "for all purposes."
        ),
        resolution_kind="ordinary",
        window="closed",
        outcome="carried",
    ),
    NoticeSpec(
        "demo-director-options",
        DEMO_ORD,
        "resolution",
        "Grant of 50,000 options to a non-executive director",
        (
            "The directors put this resolution to members by circular, with a short voting window. The director",
            "concerned and her associates did not vote.",
        ),
        "demo-circular",
        question=(
            "That the company grant 50,000 options over ordinary shares, exercisable at AUD 2.40 within four "
            "years, to a non-executive director."
        ),
        resolution_kind="ordinary",
        window="closed",
        outcome="defeated",
    ),
    NoticeSpec(
        "demo-prf-statement",
        DEMO_PRF,
        "holding_statement",
        "Holding statement " + AS_AT,
        STATEMENT_LINES,
        "demo-statements",
    ),
    NoticeSpec(
        "demo-prf-meeting",
        DEMO_PRF,
        "meeting_notice",
        "Notice of a meeting of seed preference shareholders",
        (
            "A meeting of the holders of seed preference shares will be held on {meeting:%A %-d %B %Y} at",
            "{meeting:%-I.%M %p} (AEST) to consider a variation of the rights attached to the class.",
        ),
        "demo-prf-meeting",
        meeting=21,
    ),
    NoticeSpec(
        "demo-prf-variation",
        DEMO_PRF,
        "resolution",
        "Variation of the conversion terms of the seed preference shares",
        (
            "A special resolution of the class, put to its holders under the constitution's variation of",
            "rights clause. Voting closes at the start of the class meeting.",
        ),
        "demo-prf-meeting",
        meeting=21,
        question=(
            "That the conversion price of the seed preference shares be the lower of AUD 1.50 and 80% of the "
            "price of the next priced round, and that the rights of the class be varied accordingly."
        ),
        resolution_kind="special",
        window="open",
        outcome="some",
    ),
    NoticeSpec(
        "demo-prf-dividend",
        DEMO_PRF,
        "distribution",
        "Preference dividend for the half-year to 30 September 2026",
        (
            "The directors declared the fixed preference dividend of 8% a year on the issue price of AUD 1.50",
            "for the half-year to 30 September 2026, paid by direct credit to each holder's nominated account.",
        ),
        "demo-prf-dividend",
        rate="0.06",
        declared=6,
        payment=0,
        paid="some",
    ),
    NoticeSpec(
        "wattlefield-statement",
        WATT_ORD,
        "holding_statement",
        "Holding statement " + AS_AT,
        STATEMENT_LINES,
        "wattlefield-statements",
    ),
    NoticeSpec(
        "wattlefield-agm",
        WATT_ORD,
        "meeting_notice",
        "Notice of the 2026 annual general meeting",
        AGM_LINES,
        "wattlefield-agm",
        meeting=28,
    ),
    NoticeSpec(
        "wattlefield-final-dividend",
        WATT_ORD,
        "distribution",
        "Final dividend for the year ended 30 June 2026",
        (
            "The directors declared a fully franked final dividend from the Mallee Springs solar farm's first",
            "full year of operation, paid by direct credit to each member's nominated account.",
        ),
        "wattlefield-final-dividend",
        rate="0.015",
        declared=9,
        payment=0,
        paid="all",
    ),
    NoticeSpec(
        "wattlefield-special-dividend",
        WATT_ORD,
        "distribution",
        "Special dividend from renewable energy certificate sales",
        (
            "The directors declared a special dividend of 0.12 cents a share from the sale of the large-scale",
            "generation certificates created in the year. Holdings worth less than a cent receive nothing.",
        ),
        "wattlefield-special-dividend",
        rate="0.0012",
        declared=2,
        payment=21,
        paid="none",
    ),
    NoticeSpec(
        "wattlefield-reelect-chair",
        WATT_ORD,
        "resolution",
        "Re-election of Peter Lindqvist as a director",
        (
            "The directors put this resolution to members by circular, with a short voting window, to fill the",
            "casual vacancy before the project finance documents are signed.",
        ),
        "wattlefield-circular",
        question="That Peter Lindqvist be re-elected as a director of the company.",
        resolution_kind="ordinary",
        window="closed",
        outcome="carried",
        tester="for",
    ),
    NoticeSpec(
        "wattlefield-holding-cap",
        WATT_ORD,
        "resolution",
        "Removal of the cap on community members' holdings",
        (
            "The directors put this special resolution to members by circular, with a short voting window, at",
            "the request of members holding more than 5% of the votes.",
        ),
        "wattlefield-circular",
        question=(
            "That clause 14.3 of the constitution, which limits any community member to 5% of the issued "
            "ordinary shares, be deleted."
        ),
        resolution_kind="special",
        window="closed",
        outcome="defeated",
    ),
    NoticeSpec(
        "wattlefield-project-finance",
        WATT_ORD,
        "resolution",
        "Resolution 1: Brolga Creek project finance facility",
        AGM_LINES,
        "wattlefield-agm",
        meeting=28,
        question=(
            "That the company enter into a AUD 4.2 million project finance facility for the Brolga Creek solar "
            "farm, secured over the project's assets."
        ),
        resolution_kind="ordinary",
        window="open",
    ),
    NoticeSpec(
        "wattlefield-auditor",
        WATT_ORD,
        "resolution",
        "Resolution 2: appointment of the auditor",
        AGM_LINES,
        "wattlefield-agm",
        meeting=28,
        question="That Ellery Grant Assurance, having consented, be appointed as auditor of the company.",
        resolution_kind="ordinary",
        window="upcoming",
        opens=5,
    ),
    NoticeSpec(
        "coralgum-statement",
        CORAL_ORD,
        "holding_statement",
        "Holding statement " + AS_AT,
        STATEMENT_LINES,
        "coralgum-statements",
    ),
    NoticeSpec(
        "coralgum-egm",
        CORAL_ORD,
        "meeting_notice",
        "Notice of an extraordinary general meeting",
        (
            "An extraordinary general meeting will be held on {meeting:%A %-d %B %Y} at {meeting:%-I.%M %p} (AEST)",
            "to consider the Series B capital raising and the conversion of the convertible preference shares.",
        ),
        "coralgum-egm",
        meeting=14,
    ),
    NoticeSpec(
        "coralgum-series-b",
        CORAL_ORD,
        "resolution",
        "Resolution 1: Series B capital raising",
        ("Voting on this resolution opens a week before the extraordinary general meeting.",),
        "coralgum-egm",
        meeting=14,
        question=(
            "That the directors be authorised to issue up to 1,000,000 ordinary shares at not less than "
            "AUD 3.00 each in a Series B capital raising."
        ),
        resolution_kind="ordinary",
        window="upcoming",
        opens=7,
    ),
    NoticeSpec(
        "coralgum-conversion",
        CORAL_ORD,
        "resolution",
        "Resolution 2: conversion of the convertible preference shares",
        ("A special resolution, put to the meeting with the directors' unanimous recommendation.",),
        "coralgum-egm",
        meeting=14,
        question=(
            "That the convertible preference shares convert into ordinary shares one for one at the close of "
            "the Series B capital raising."
        ),
        resolution_kind="special",
        window="open",
        outcome="some",
    ),
    NoticeSpec(
        "coralgum-reelect-chair",
        CORAL_ORD,
        "resolution",
        "Resolution 3: re-election of Ruth Okonkwo as a director",
        ("An ordinary resolution, put to the meeting with the other directors' recommendation.",),
        "coralgum-egm",
        meeting=14,
        question="That Ruth Okonkwo, who retires by rotation, be re-elected as a director of the company.",
        resolution_kind="ordinary",
        window="open",
        outcome="some",
    ),
    NoticeSpec(
        "coralgum-cmo-options",
        CORAL_ORD,
        "resolution",
        "Grant of 120,000 options to the chief medical officer",
        (
            "The directors put this resolution to members by circular, with a short voting window, before the",
            "chief medical officer's employment agreement is signed.",
        ),
        "coralgum-circular",
        question=(
            "That the company grant 120,000 options over ordinary shares, exercisable at AUD 2.80 within five "
            "years, to the chief medical officer."
        ),
        resolution_kind="ordinary",
        window="closed",
        outcome="defeated",
    ),
)
