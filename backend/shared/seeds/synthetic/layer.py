from collections import Counter
from dataclasses import dataclass

from django.contrib.auth import get_user_model

from shared.seeds.synthetic.companies import apply_company
from shared.seeds.synthetic.compliance import apply_alerts
from shared.seeds.synthetic.context import Seeded
from shared.seeds.synthetic.identities import EMAIL_DOMAIN
from shared.seeds.synthetic.people import (
    apply_notifications,
    apply_person,
    create_identity,
)
from shared.seeds.synthetic.reference import seed_reference
from shared.seeds.synthetic.staff import adopt_superuser, seed_staff_member
from shared.seeds.synthetic.story import STAFF, build_plan

User = get_user_model()

ABSENT = "absent"
PRESENT = "present"
PARTIAL = "partial"
SEALING_STAFF = "former"


@dataclass(frozen=True)
class Outcome:
    state: str
    plan: object = None


def population_state():
    emails = User.objects.filter(email__in=[_staff_email(key) for key in ("compliance", SEALING_STAFF)])
    found = set(emails.values_list("email", flat=True))
    if _staff_email(SEALING_STAFF) in found:
        return PRESENT
    return PARTIAL if found else ABSENT


def _staff_email(key):
    handle = next(handle for staff_key, handle, *_ in STAFF if staff_key == key)
    return f"{handle}@{EMAIL_DOMAIN}"


def seed_population(now, investors):
    state = population_state()
    if state != ABSENT:
        return Outcome(state)
    plan = build_plan(now, investors)
    seeded = Seeded(plan)
    seed_reference(plan, seeded)
    adopt_superuser(seeded, min(member.joined_at for member in plan.staff))
    for member in plan.staff:
        if member.key != SEALING_STAFF:
            seed_staff_member(member, seeded)
    for person in (*plan.testers, *plan.people):
        create_identity(person, seeded)
    founders = [person for person in plan.everyone() if person.role == "company"]
    for person in founders:
        apply_person(person, seeded)
    for company in plan.companies:
        apply_company(company, seeded)
    for person in plan.everyone():
        if person.role != "company":
            apply_person(person, seeded)
    for person in plan.everyone():
        apply_notifications(person, seeded)
    apply_alerts(plan, seeded)
    seed_staff_member(plan.staff_member(SEALING_STAFF), seeded)
    return Outcome(PRESENT, plan)


def summary(plan):
    investors = [person for person in plan.people if person.role == "investor"]
    statuses = Counter(person.account_status for person in investors if person.signup_completed_at)
    cohorts = Counter(person.cohort for person in investors)
    companies = Counter(company.status for company in plan.companies)
    everyone = plan.everyone()
    wallets = [wallet for person in everyone for wallet in person.wallets]
    return {
        "investors": len(investors),
        "active": statuses["active"],
        "suspended": statuses["suspended"],
        "terminated": statuses["terminated"],
        "rejected": statuses["rejected"],
        "checking": cohorts["kyc_pending"] + cohorts["kyc_yellow"] + cohorts["kyc_red"],
        "unfinished": cohorts["unverified"] + cohorts["stalled"],
        "owners": len(plan.people) - len(investors),
        "companies": dict(companies),
        "staff": len(plan.staff),
        "claims": sum(len(person.claims) for person in everyone),
        "wallets": len(wallets),
        "transactions": sum(len(wallet.transfers) for wallet in wallets),
        "notifications": sum(len(person.notes) for person in everyone),
        "alerts": len(plan.alerts),
        "alert_statuses": dict(Counter(alert.status for alert in plan.alerts)),
    }
