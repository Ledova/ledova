import textwrap
from datetime import timedelta

from companies.models import CompanyDocument, DocumentType
from offerings.models import Offering, OfferingExemption, SubscriptionStatus
from offerings.services.offering import submit_offering, transition_offering
from offerings.services.subscription import (
    EXPIRY_NOTE,
    accept,
    allot_batch,
    confirm_payment,
    create_draft,
    issue_instruction,
    record_refund,
    reject,
    scale_back,
    submit,
    withdraw,
)
from shared.db import atomic
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.registers import (
    instruct,
    reference_prefix,
    subscription_item,
)
from shared.seeds.synthetic.chain.story import (
    ALLOTTED,
    LAPSED,
    REFUND_NOTES,
    REFUNDED,
    REJECTED,
    STABLECOIN,
    WITHDRAWN,
)
from shared.seeds.synthetic.clock import AEST, frozen
from shared.seeds.synthetic.paper import (
    acn_text,
    authority,
    company_document,
    pdf,
    verified,
)
from tokens.models import ShareToken

CLOSE_REASON = "Closed at the end of the offer period."
ALLOTMENT_NOTE = "Allotted after the offer closed, under the directors' allotment resolution."
APPROVED_ROUNDS = ("approved", "closed")
MEMORANDUM_WIDTH = 90
SCALED_DIFFERENTLY = "The {key} scale-back allotted {actual} to a subscription the plan scales to {planned}."
NOT_ALLOTTED = "The {key} allotment refused: {refusals}"
UNFINISHED = "Subscription {reference} of {key} ended {status}, not allotted."


def _step(records, at, action):
    with frozen(at):
        result = action()
        records.run()
        return result


def _local_day(moment):
    return f"{moment.astimezone(AEST):%d %B %Y}"


def memorandum(item, token, records):
    company = token.company
    limit = f", and at most {item.maximum:,} for any one investor" if item.maximum else ""
    content = pdf(
        f"Information memorandum: {token.name}",
        [
            company.name,
            acn_text(company.acn),
            f"Offer of {token.name} ({token.symbol}) at AUD {item.price} per share.",
            f"Minimum {item.minimum:,} shares, target {item.target:,} and cap {item.cap:,}{limit}.",
            f"Applications open {_local_day(item.opens_at)} and close {_local_day(item.closes_at)}.",
            f"Offered under: {OfferingExemption(item.exemption).label}.",
            "",
            *textwrap.wrap(item.summary, MEMORANDUM_WIDTH),
            "",
            "Use of proceeds",
            *textwrap.wrap(item.use_of_proceeds, MEMORANDUM_WIDTH),
        ],
    )
    name = f"{item.key}-information-memorandum.pdf"
    document = company_document(company, DocumentType.PROSPECTUS, name, content, at=item.created_at)
    if item.status in APPROVED_ROUNDS:
        return verified(document, records.documents, at=item.decided_at)
    return document


def apply_round(item, records):
    token = ShareToken.objects.select_related("company").get(pk=records.classes[item.share_class].pk)
    founder = token.company.owner
    staff = records.operations
    terms = memorandum(item, token, records)
    with atomic(), frozen(item.created_at):
        offering = Offering.objects.create(
            token=token,
            exemption=item.exemption,
            price_per_share=item.price,
            minimum_shares=item.minimum,
            target_shares=item.target,
            cap_shares=item.cap,
            maximum_shares=item.maximum,
            opens_at=item.opens_at,
            closes_at=item.closes_at,
            summary=item.summary,
            use_of_proceeds=item.use_of_proceeds,
            accepts_bank_transfer=True,
        )
        offering.settlement_assets.add(records.audy)
        offering.documents.add(
            terms,
            *CompanyDocument.objects.filter(
                company=token.company, document_type=DocumentType.RISK_DISCLOSURE, is_verified=True
            ),
        )
    if item.submitted_at:
        _step(records, item.submitted_at, lambda: submit_offering(offering, founder))
    if item.review_at:
        _step(records, item.review_at, lambda: transition_offering(offering, "start_review", reviewed_by=staff))
    if item.status in APPROVED_ROUNDS:
        _step(
            records,
            item.decided_at,
            lambda: transition_offering(offering, "approve", reviewed_by=staff, notes=item.notes),
        )
    elif item.status == "rejected":
        _step(
            records,
            item.decided_at,
            lambda: transition_offering(offering, "reject", reviewed_by=staff, reason=item.reason),
        )
    elif item.status == "withdrawn":
        _step(records, item.closed_at, lambda: transition_offering(offering, "withdraw", reason=item.reason))
    for application in item.applications:
        records.subscriptions[(item.key, application.investor, application.address)] = apply_application(
            application, offering, records
        )
    if item.status == "closed":
        _step(records, item.closed_at, lambda: transition_offering(offering, "close", reason=CLOSE_REASON))
        with frozen(item.closed_at + timedelta(minutes=40)):
            scale_back(offering)
    records.offerings[item.key] = offering
    return offering


def _received_on(moment):
    return moment.astimezone(AEST).date()


def _payment_hash(application, number):
    return (
        "0x"
        + keys.secret("audy-payment", application.investor, application.address, application.created_at, number).hex()
    )


def apply_application(application, offering, records):
    account = records.account(application.investor)
    user = account.user_profile.user
    wallet = records.wallet(application.investor, application.address)
    with atomic(), frozen(application.created_at):
        subscription = create_draft(offering, account, wallet, application.quantity, submitted_by=user)
    if application.submitted_at:
        with frozen(application.submitted_at):
            submit(subscription, submitted_by=user)
    if application.status == WITHDRAWN:
        with frozen(application.closed_at):
            withdraw(subscription, application.reason)
        return subscription
    if application.status == REJECTED and application.reason != LAPSED:
        with frozen(application.closed_at):
            reject(subscription, application.reason)
        return subscription
    if application.accepted_at:
        with frozen(application.accepted_at):
            accept(subscription)
    if application.instructed_at:
        with frozen(application.instructed_at):
            issue_instruction(
                subscription,
                rail=application.rail,
                settlement_asset=records.audy if application.rail == STABLECOIN else None,
            )
    for number, payment in enumerate(application.payments):
        stablecoin = application.rail == STABLECOIN
        with frozen(payment.at):
            subscription.refresh_from_db()
            confirm_payment(
                subscription,
                confirmed_by=records.operations,
                amount_received=payment.amount,
                received_on=_received_on(payment.at),
                reference_seen="" if stablecoin else subscription.reference,
                tx_hash=_payment_hash(application, number) if stablecoin else "",
                accept_as_final=payment.final,
            )
    if application.status == REJECTED:
        with frozen(application.closed_at):
            subscription.refresh_from_db()
            reject(subscription, EXPIRY_NOTE.format(due=subscription.payment_due_at.isoformat()))
    if application.status == REFUNDED:
        with frozen(application.closed_at):
            record_refund(
                subscription,
                amount=application.refund,
                reference=f"RTN-{subscription.reference}",
                notes=REFUND_NOTES[application.reason],
            )
    subscription.refresh_from_db()
    return subscription


def allot_round(item, records):
    token = ShareToken.objects.select_related("company").get(pk=records.classes[item.share_class].pk)
    allotted = [application for application in item.applications if application.status == ALLOTTED]
    subscriptions = []
    for application in allotted:
        subscription = records.subscriptions[(item.key, application.investor, application.address)]
        subscription.refresh_from_db()
        if subscription.allotment_quantity != application.allotted:
            raise ChainStepFailed(
                SCALED_DIFFERENTLY.format(
                    key=item.key, actual=subscription.allotment_quantity, planned=application.allotted
                )
            )
        subscriptions.append(subscription)
    company_key = item.share_class.split("/")[0]
    document = authority(
        records.companies[company_key],
        f"allotment-{item.key}",
        f"allotment of the {token.symbol} offer",
        [
            f"The directors resolved to allot {sum(application.allotted for application in allotted):,} {token.name}",
            f"to the {len(allotted)} applicants who paid by the close of the offer, on the terms listed.",
        ],
        records.documents,
    )
    instruct(
        token,
        [subscription_item(subscription) for subscription in subscriptions],
        document,
        records,
        reference=f"{reference_prefix(token)}-ALT-{token.symbol}",
        reason=f"Allot the {token.symbol} shares the applicants paid for.",
    )
    result = allot_batch(subscriptions, records.operations, notes=ALLOTMENT_NOTE)
    if result["refusals"]:
        raise ChainStepFailed(NOT_ALLOTTED.format(key=item.key, refusals="; ".join(result["refusals"])))
    records.run()
    for application, subscription in zip(allotted, subscriptions):
        subscription.refresh_from_db()
        if subscription.status != SubscriptionStatus.ALLOTTED:
            raise ChainStepFailed(
                UNFINISHED.format(reference=subscription.reference, key=item.key, status=subscription.status)
            )
        if application.refund:
            final = any(payment.final for payment in application.payments)
            record_refund(
                subscription,
                amount=application.refund,
                reference=f"RTN-{subscription.reference}",
                notes=REFUND_NOTES["short" if final else "residual"],
            )
    return subscriptions
