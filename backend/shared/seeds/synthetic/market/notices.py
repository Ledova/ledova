import time
from contextlib import contextmanager
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections

from shared import uploads
from shared.db import current_alias
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.registers import reference_prefix
from shared.seeds.synthetic.paper import acn_text, authority, pdf
from shareholders.models import PublicationEventKind, PublicationRecipient
from shareholders.services.distributions import entitlement, record_payment
from shareholders.services.publications import publish_to_members
from shareholders.services.resolutions import cast_ballot, close_resolution
from shareholders.services.roll import frozen_rows
from tokens.models import ShareRegister

User = get_user_model()
PDF = "application/pdf"
CLOSING_WINDOW = timedelta(seconds=30)
CLOSE_SLACK = 0.5
RESOLUTION = "resolution"
DISTRIBUTION = "distribution"
CLOSED = "closed"
OPEN = "open"
EVERYONE = ("*",)
PAYMENT_AUTHORITY = "Payment advice from {company} listing the direct credits paid on {date:%-d %B %Y}"
NOT_CLOSED = "The resolution {key} closed {outcome}, and the plan expects it {planned}."


@contextmanager
def generated(contents):
    original = uploads.scan_upload

    def scan(raw):
        if raw in contents:
            return None
        return original(raw)

    uploads.scan_upload = scan
    try:
        yield
    finally:
        uploads.scan_upload = original


def database_now():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT now()")
        return cursor.fetchone()[0]


class Notices:
    def __init__(self, market, record_date):
        self.market = market
        self.record_date = record_date
        self.contents = set()
        self.authorities = {}
        self.closing = []
        self.payments = 0

    def _company(self, notice):
        return notice.listing.split("/")[0]

    def _authority(self, notice, token):
        if notice.authority not in self.authorities:
            self.authorities[notice.authority] = authority(
                self.market.companies[self._company(notice)],
                f"notice-{notice.authority}",
                notice.title.lower() if notice.kind != RESOLUTION else f"the resolutions put to {token.name} members",
                [
                    f"The directors resolved to publish to the members of {token.name} through Ledova the notice",
                    f"titled '{notice.title}', with a record date of {self.record_date:%-d %B %Y}.",
                ],
                self.market.documents,
            )
        return self.authorities[notice.authority]

    def _upload(self, name, title, lines):
        content = pdf(title, lines)
        self.contents.add(content)
        return SimpleUploadedFile(name, content, content_type=PDF)

    def _terms(self, notice, token, now):
        if notice.kind == RESOLUTION:
            return {
                "question": notice.question,
                "resolution_kind": notice.resolution_kind,
                "opens_at": notice.opens_at or now,
                "closes_at": notice.closes_at or now + CLOSING_WINDOW,
            }
        if notice.kind == DISTRIBUTION:
            register = ShareRegister.objects.get(token=token)
            rows = frozen_rows(token, register, self.record_date)
            return {
                "rate_per_share": notice.rate,
                "declared_on": notice.declared_on,
                "payment_date": notice.payment_date,
                "declared_total": entitlement(sum(int(row["shares"]) for row in rows), notice.rate),
            }
        return {}

    def publish(self, notice):
        market = self.market
        token = market.tokens[notice.listing]
        company = token.company
        document = self._authority(notice, token)
        upload = self._upload(
            f"{notice.key}.pdf",
            notice.title,
            [
                f"{company.name}, {acn_text(company.acn)}",
                f"{token.name} ({token.symbol}), record date {self.record_date:%-d %B %Y}",
                "",
                *notice.lines,
                *([f"Resolution: {notice.question}"] if notice.question else []),
            ],
        )
        terms = self._terms(notice, token, database_now())
        with generated(self.contents):
            publication = publish_to_members(
                token,
                market.operations,
                kind=notice.kind,
                title=notice.title,
                record_date=self.record_date,
                instruction=f"{reference_prefix(token)}-{notice.authority.split('-', 1)[-1].upper()}",
                authority_document=document.pk,
                upload=upload,
                **terms,
            )
        for ballot in notice.ballots:
            cast_ballot(market.user(ballot.voter), publication.pk, ballot.choice)
        market.run()
        if notice.kind == RESOLUTION and notice.window == CLOSED:
            self.closing.append((notice, publication))
        if notice.paid:
            self._pay(notice, publication, company)
        return publication

    def _pay(self, notice, publication, company):
        recipients = PublicationRecipient.objects.filter(publication=publication, entitlement__gt=0).order_by(
            "-shares", "member_id"
        )
        payees = None if notice.paid == EVERYONE else set(notice.paid)
        users = {user.pk: user.email for user in self._users(recipients)}
        for recipient in recipients:
            if payees is not None and users.get(recipient.user_id) not in payees:
                continue
            self.payments += 1
            reference = f"{reference_prefix(publication.token)}-DIV-{self.payments:04d}"
            evidence = self._upload(
                f"payment-{reference.lower()}.pdf",
                "Payment advice",
                [
                    f"{company.name}, {acn_text(company.acn)}",
                    f"{notice.title}",
                    f"Paid to {recipient.name}: AUD {recipient.entitlement:,.2f} by direct credit",
                    f"Paid on {self.record_date:%-d %B %Y}, reference {reference}",
                ],
            )
            with generated(self.contents):
                record_payment(
                    self.market.operations,
                    publication,
                    recipient,
                    paid_on=self.record_date,
                    reference=reference,
                    evidence=evidence,
                    authority=PAYMENT_AUTHORITY.format(company=company.name, date=self.record_date),
                )

    @staticmethod
    def _users(recipients):
        return User.objects.filter(pk__in=[recipient.user_id for recipient in recipients if recipient.user_id])

    def close(self):
        if not self.closing:
            return []
        latest = max(publication.closes_at for _, publication in self.closing)
        while database_now() < latest + timedelta(seconds=CLOSE_SLACK):
            time.sleep(CLOSE_SLACK)
        closed = []
        for notice, publication in self.closing:
            event = close_resolution(publication)
            if event.kind != PublicationEventKind.CLOSE or event.payload["carried"] != notice.carried:
                outcome = "carried" if event.payload and event.payload.get("carried") else "not carried"
                planned = "carried" if notice.carried else "not carried"
                raise ChainStepFailed(NOT_CLOSED.format(key=notice.key, outcome=outcome, planned=planned))
            closed.append(event)
        return closed
