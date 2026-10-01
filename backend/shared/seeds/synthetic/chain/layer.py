from collections import Counter
from dataclasses import dataclass, field

from blockchain.models import SignedAttempt
from offerings.models import Offering, Subscription
from shared.seeds.synthetic.chain import population
from shared.seeds.synthetic.chain.approvals import approve_company, treasury_entries
from shared.seeds.synthetic.chain.classes import (
    apply_raise,
    create_class,
    deploy,
    pause,
)
from shared.seeds.synthetic.chain.deferred import captured
from shared.seeds.synthetic.chain.guard import GET_THE_CHAIN, chain_refusal
from shared.seeds.synthetic.chain.issues import apply_request, mint_positions
from shared.seeds.synthetic.chain.offerings import allot_round, apply_round
from shared.seeds.synthetic.chain.records import Records
from shared.seeds.synthetic.chain.registers import (
    import_particulars,
    open_register,
    settle,
)
from shared.seeds.synthetic.chain.settlement import (
    configure_settlement,
    fund_wallets,
    settlement_refusal,
)
from shared.seeds.synthetic.chain.story import DEMO, SALTBUSH, build_issuance
from shared.seeds.synthetic.staff import PERMISSIONS, permissions
from tokens.models import (
    CapitalIncreaseRequest,
    RegisterPosition,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
)
from whitelist.models import WhitelistApproval

ABSENT = "absent"
PRESENT = "present"
PARTIAL = "partial"
SKIPPED = "skipped"
FIRST_CLASS = f"{DEMO}/PRF"
SEALING_CLASS = f"{SALTBUSH}/ORD"
CLOSED = "closed"
EXECUTED = "executed"


@dataclass(frozen=True)
class Outcome:
    state: str
    plan: object = None
    reason: str = ""
    counts: dict = field(default_factory=dict)


def _class_exists(found, key):
    company_key, symbol = key.split("/")
    company = found.get(company_key)
    return company is not None and ShareToken.objects.filter(company=company, symbol=symbol).exists()


def issuance_state(found):
    if _class_exists(found, SEALING_CLASS):
        return PRESENT
    return PARTIAL if _class_exists(found, FIRST_CLASS) else ABSENT


def seed_issuance(now):
    found = population.companies()
    state = issuance_state(found)
    if state != ABSENT:
        return Outcome(state)
    refusal = chain_refusal()
    if refusal:
        return Outcome(SKIPPED, reason=f"{refusal} {GET_THE_CHAIN}")
    refusal = settlement_refusal()
    if refusal:
        return Outcome(SKIPPED, reason=refusal)
    plan = build_issuance(now, population.firms(found), population.candidates(found))
    signed = SignedAttempt.objects.count()
    with captured() as deferrals:
        records = Records(plan, found, deferrals)
        _apply(plan, records)
    return Outcome(PRESENT, plan, counts=summary(plan, SignedAttempt.objects.count() - signed))


def _grant_operations(records):
    records.operations.user_permissions.add(*permissions(PERMISSIONS["operations"]))
    records.staff["operations"] = type(records.operations).objects.get(pk=records.operations.pk)


def _apply(plan, records):
    _grant_operations(records)
    configure_settlement(plan, records)
    for share_class in plan.classes:
        if share_class.key != SEALING_CLASS:
            create_class(share_class, records)
    records.entries.update(treasury_entries(plan))
    deployed = [share_class for share_class in plan.classes if share_class.deployed]
    companies = {share_class.company for share_class in deployed}
    for company in sorted(companies, key=lambda key: (records.companies[key].activated_at, key)):
        classes = [share_class for share_class in deployed if share_class.company == company]
        for share_class in classes:
            deploy(share_class, records)
        approve_company(plan, company, records)
        for share_class in classes:
            mint_positions(share_class, records)
            for item in plan.rounds_of(share_class.key):
                if item.status == CLOSED:
                    apply_round(item, records)
                    allot_round(item, records)
            open_register(share_class, records)
            import_particulars(share_class, records)
    for request in plan.requests:
        if request.status == EXECUTED:
            apply_request(request, records)
    for item in plan.raises:
        if item.status == EXECUTED:
            apply_raise(item, records)
    for share_class in deployed:
        if share_class.target == "paused":
            pause(share_class, records)
    for item in sorted(plan.rounds, key=lambda item: item.created_at):
        if item.status != CLOSED:
            apply_round(item, records)
    for request in sorted(plan.requests, key=lambda request: request.submitted_at):
        if request.status != EXECUTED:
            apply_request(request, records)
    for item in sorted(plan.raises, key=lambda item: item.created_at):
        if item.status != EXECUTED:
            apply_raise(item, records)
    for share_class in deployed:
        settle(share_class, records)
    fund_wallets()
    seal(plan, records)


def seal(plan, records):
    records.run()
    records.deferrals.require_empty()
    create_class(plan.share_class(SEALING_CLASS), records)


def summary(plan, signed):
    tokens = ShareToken.objects.filter(company__name__in=population.COMPANY_KEYS)
    return {
        "classes": dict(Counter(tokens.values_list("status", flat=True))),
        "approvals": WhitelistApproval.objects.filter(company__name__in=population.COMPANY_KEYS).count(),
        "mints": ShareIssuance.objects.filter(token__in=tokens, status="completed").count(),
        "members": RegisterPosition.objects.filter(register__token__in=tokens, shares__gt=0).count(),
        "registers": tokens.exclude(register_openings=None).distinct().count(),
        "offerings": dict(Counter(Offering.objects.filter(token__in=tokens).values_list("status", flat=True))),
        "subscriptions": dict(
            Counter(Subscription.objects.filter(offering__token__in=tokens).values_list("status", flat=True))
        ),
        "requests": dict(
            Counter(ShareIssuanceRequest.objects.filter(token__in=tokens).values_list("status", flat=True))
        ),
        "raises": dict(
            Counter(CapitalIncreaseRequest.objects.filter(token__in=tokens).values_list("status", flat=True))
        ),
        "transactions": signed,
    }
