import csv
import hashlib
import importlib
import io
from collections import defaultdict
from datetime import date, datetime, timedelta
from datetime import timezone as utc_zone
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import DatabaseError, IntegrityError, connections
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from offerings.models import (
    Offering,
    OfferingExemption,
    Subscription,
    SubscriptionStatus,
)
from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from tokens.models import (
    IssuanceStatus,
    RegisterEntry,
    RegisterExport,
    RegisterOutput,
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.services.former_holders import purge_register_exports
from tokens.services.register import (
    CHANGED_MEMBER_HEADERS,
    CHANGED_MEMBERS_HEADING,
    CLASS_HEADING,
    MEMBER_AMBIGUOUS_NAME,
    NOTICE_FIGURES_HEADING,
    PERIOD_ENTRIES_HEADING,
    PERIOD_ENTRY_HEADERS,
)
from tokens.services.register_events import open_register, record_entry
from tokens.tests.test_register_certificates import (
    entered,
    member_of,
    unused_address,
    wallet_of,
)
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_export_audit import (
    CERTIFICATE,
    NO_REQUEST,
    NOTICE_FIGURES,
    REQUEST,
    certified,
    noticed,
)
from wallets.models import Wallet

User = get_user_model()

SYDNEY_ONE_AM_ON_THE_22ND = datetime(2026, 9, 21, 15, 0, tzinfo=utc_zone.utc)
OPENED_ON = date(2026, 9, 1)
PERIOD_FROM = date(2026, 9, 2)
INSTRUCTION = "SYNTHETIC-INSTRUCTION-11"
PRICE = Decimal("2.50")
SELLER_NAME = "Zoë O'Brien-Łukasz"
SELLER_ADDRESS = "1 Synthetic Street, Sydney NSW 2000"
EARLIER_NAME = "Nguyễn Văn Tổng Hợp"
EARLIER_ADDRESS = "5 Synthetic Avenue, Hobart TAS 7000"
ALLOTTEE_NAME = "合成成员 Holdings"
ALLOTTEE_ADDRESS = "8 Synthetic Road, Melbourne VIC 3000"
BUYER_NAME = '=HYPERLINK("http://attacker.test/","Open")'
BUYER_ADDRESS = "-2+3 Synthetic Lane, Sydney NSW 2000"


def issued(token, address, shares, paid=False):
    issuance = ShareIssuance.objects.create(
        token=token,
        recipient_address=address,
        amount=str(shares),
        status=IssuanceStatus.COMPLETED,
        completed_at=timezone.now(),
    )
    if paid:
        wallet = Wallet.objects.select_related("user_account").get(address=address)
        request = ShareIssuanceRequest.objects.create(
            dispatch_id=None,
            token=token,
            recipient_address=address,
            amount=shares,
            reason="Allotment",
            status=RequestStatus.EXECUTED,
        )
        request.executed_issuance = issuance
        request.save(update_fields=["executed_issuance"])
        Subscription.objects.create(
            offering=Offering.objects.create(
                token=token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=PRICE,
                minimum_shares=1,
                target_shares=10,
                cap_shares=1000,
                opens_at=timezone.now() - timedelta(days=1),
            ),
            user_account=wallet.user_account,
            wallet=wallet,
            quantity=shares,
            price_per_share=PRICE,
            amount_due=shares * PRICE,
            amount_received=shares * PRICE,
            status=SubscriptionStatus.ALLOTTED,
            issuance_request=request,
        )
    return issuance


def dated(register, on, kind, *changes, **kwargs):
    return record_entry(
        register_id=register.pk,
        operation_id=kwargs.pop("operation_id", uuid4()),
        kind=kind,
        changes=[{"member": str(member.pk), "shares": str(shares)} for member, shares in changes],
        effective_on=on,
        recorded_by=register.company.owner,
        **kwargs,
    )


def issue(register, on, member, address, shares, paid=False):
    return dated(register, on, "issue", (member, shares), operation_id=issued(register.token, address, shares, paid).pk)


def opened_with(token, member, shares):
    return open_register(
        token_id=token.pk,
        operation_id=uuid4(),
        changes=[{"member": str(member.pk), "shares": str(shares)}],
        effective_on=OPENED_ON,
        recorded_by=token.company.owner,
    ).register


def rows_of(response):
    return list(csv.reader(io.StringIO(response.content.decode())))


def sections_of(response):
    sections = [[]]
    for row in rows_of(response):
        if row:
            sections[-1].append(row)
        else:
            sections.append([])
    return {section[0][0]: section[1:] for section in sections}


def inserted(token, owner, **columns):
    row = {
        "uuid": uuid4(),
        "created_at": timezone.now(),
        "updated_at": timezone.now(),
        "token_id": token.pk,
        "requested_by_id": owner.pk,
        "register_sequence": 1,
        "member_rows": 1,
        "former_rows": 0,
        **columns,
    }
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            f"INSERT INTO tokens_registerexport ({', '.join(row)}) VALUES ({', '.join(['%s'] * len(row))})",
            list(row.values()),
        )


@override_settings(STORAGES=ADMIN_STORAGES)
class NoticeFiguresTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="notices-owner@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=self.owner, name="Synthetic Notices Pty Ltd", acn="123456789")
        self.token = ShareToken.objects.create(
            company=self.company, name="Synthetic ordinary shares", symbol="NTC", total_supply="1000"
        )
        self.seller = member_of(self.company, wallet_of(SELLER_NAME, SELLER_ADDRESS))
        earlier_wallet = wallet_of(EARLIER_NAME, EARLIER_ADDRESS)
        self.earlier = member_of(self.company, earlier_wallet)
        allottee_wallet = wallet_of(ALLOTTEE_NAME, ALLOTTEE_ADDRESS)
        self.allottee = member_of(self.company, allottee_wallet)
        unidentified_wallet = unused_address()
        self.unidentified = member_of(self.company, unidentified_wallet)
        self.buyer = member_of(self.company, wallet_of(BUYER_NAME, BUYER_ADDRESS))
        ambiguous_wallet = wallet_of("Ann Synthetic", "2 Synthetic Street")
        self.ambiguous = member_of(self.company, ambiguous_wallet, wallet_of("Bob Synthetic", "3 Synthetic Street"))
        self.register = opened_with(self.token, self.seller, 100)
        issue(self.register, OPENED_ON, self.earlier, earlier_wallet, 10)
        issue(self.register, PERIOD_FROM, self.allottee, allottee_wallet, 40, paid=True)
        unbacked = issue(self.register, date(2026, 9, 3), self.unidentified, unidentified_wallet, 5)
        dated(self.register, date(2026, 9, 4), "transfer", (self.seller, -30), (self.buyer, 30))
        issue(self.register, date(2026, 9, 4), self.ambiguous, ambiguous_wallet, 3)
        dated(self.register, date(2026, 9, 5), "correction", (self.unidentified, -5), corrects_id=unbacked.pk)
        self.staff = grant(staff_user("notice-figures"), admin.site._registry[RegisterOutput], "change")
        self.client.force_login(self.staff)

    def page(self, token=None):
        return reverse("admin:tokens_registeroutput_notice_figures", args=[(token or self.token).pk])

    def prepare(self, token=None, **fields):
        request = {"period_from": PERIOD_FROM.isoformat(), "instruction": INSTRUCTION, **fields}
        with patch("tokens.services.register.timezone.now", return_value=SYDNEY_ONE_AM_ON_THE_22ND):
            return self.client.post(self.page(token), request)

    def test_the_figures_list_the_period_the_class_and_each_changed_member_and_the_record_fingerprints_them(self):
        response = self.prepare()

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        self.assertEqual(
            response["Content-Disposition"], 'attachment; filename="notice-figures-NTC-2026-09-02-to-7.csv"'
        )
        seller, buyer = str(self.seller.pk), str(self.buyer.pk)
        unidentified = str(self.unidentified.pk)
        self.assertEqual(
            rows_of(response),
            [
                [NOTICE_FIGURES_HEADING],
                ["Share class", "Synthetic ordinary shares (NTC)"],
                ["Period from", "2026-09-02"],
                ["To register entry", "7"],
                ["Company's written instruction", INSTRUCTION],
                ["Produced on", "2026-09-22"],
                [],
                [PERIOD_ENTRIES_HEADING],
                ["Entry", "Kind", "Effective date", "Corrects entry", "Member ID", "Name", "Shares", "Amount paid"],
                ["3", "Issue", "2026-09-02", "", str(self.allottee.pk), ALLOTTEE_NAME, "40", "100.00"],
                ["4", "Issue", "2026-09-03", "", unidentified, "", "5", "not recorded"],
                *sorted(
                    [
                        ["5", "Transfer", "2026-09-04", "", seller, SELLER_NAME, "'-30", ""],
                        ["5", "Transfer", "2026-09-04", "", buyer, f"'{BUYER_NAME}", "30", ""],
                    ],
                    key=lambda row: row[4],
                ),
                ["6", "Issue", "2026-09-04", "", str(self.ambiguous.pk), MEMBER_AMBIGUOUS_NAME, "3", "not recorded"],
                ["7", "Compensating correction", "2026-09-05", "4", unidentified, "", "'-5", ""],
                [],
                [CLASS_HEADING],
                ["Issued supply", "153"],
                ["Members holding shares", "5"],
                ["Total amount paid", "not recorded"],
                [],
                [CHANGED_MEMBERS_HEADING],
                ["Member ID", "Name", "Residential address", "Shares held", "Amount paid"],
                *sorted(
                    [
                        [str(self.allottee.pk), ALLOTTEE_NAME, ALLOTTEE_ADDRESS, "40", "100.00"],
                        [unidentified, "", "", "0", "not recorded"],
                        [seller, SELLER_NAME, SELLER_ADDRESS, "70", "not recorded"],
                        [buyer, f"'{BUYER_NAME}", f"'{BUYER_ADDRESS}", "30", "not recorded"],
                        [str(self.ambiguous.pk), MEMBER_AMBIGUOUS_NAME, "", "3", "not recorded"],
                    ]
                ),
            ],
        )
        record = RegisterExport.objects.get()
        self.assertEqual(record.digest, hashlib.sha256(response.content).hexdigest())
        self.assertEqual(
            (record.kind, record.token_id, record.requested_by_id, record.register_sequence, record.instruction),
            ("notice_figures", self.token.pk, self.staff.pk, 7, INSTRUCTION),
        )
        self.assertEqual(
            (record.period_from, record.member_rows, record.former_rows, record.recipient, record.requested_on),
            (PERIOD_FROM, 5, 0, "", None),
        )
        self.assertIsNone(record.late)

    def test_preparing_the_same_period_again_gives_the_same_file_and_a_second_record(self):
        first = self.prepare()
        again = self.prepare()

        self.assertEqual(again.content, first.content)
        self.assertEqual(
            list(RegisterExport.objects.values_list("digest", flat=True)),
            [hashlib.sha256(first.content).hexdigest()] * 2,
        )

    def test_the_period_includes_its_first_day_and_never_lists_the_opening(self):
        response = self.prepare(period_from=OPENED_ON.isoformat())

        sections = sections_of(response)
        self.assertEqual([row[0] for row in sections[PERIOD_ENTRIES_HEADING][1:]], ["2", "3", "4", "5", "5", "6", "7"])
        self.assertIn(
            [str(self.earlier.pk), EARLIER_NAME, EARLIER_ADDRESS, "10", "not recorded"],
            sections[CHANGED_MEMBERS_HEADING],
        )
        self.assertEqual(
            list(RegisterExport.objects.values_list("period_from", "register_sequence", "member_rows")),
            [(OPENED_ON, 7, 6)],
        )

    def test_the_issued_supply_and_each_changed_members_holding_equal_a_replay_of_the_entries(self):
        response = self.prepare()

        replayed = defaultdict(int)
        for changes in RegisterEntry.objects.filter(register=self.register).values_list("changes", flat=True):
            for change in changes:
                replayed[change["member"]] += int(change["shares"])
        changed = {
            change["member"]
            for changes in RegisterEntry.objects.filter(register=self.register, effective_on__gte=PERIOD_FROM)
            .exclude(kind="opening")
            .values_list("changes", flat=True)
            for change in changes
        }
        sections = sections_of(response)
        self.assertEqual(sections[CLASS_HEADING][0], ["Issued supply", str(sum(replayed.values()))])
        self.assertEqual(
            {row[0]: int(row[3]) for row in sections[CHANGED_MEMBERS_HEADING][1:]},
            {member: replayed[member] for member in changed},
        )

    def test_the_class_total_is_the_sum_only_while_every_current_members_amount_paid_is_established(self):
        token = ShareToken.objects.create(
            company=self.company, name="Synthetic paid shares", symbol="PAID", total_supply="1000"
        )
        founder_wallet = wallet_of("Synthetic Founder", "6 Synthetic Street")
        founder = member_of(self.company, founder_wallet)
        issued(token, founder_wallet, 40, paid=True)
        register = opened_with(token, founder, 40)
        investor_wallet = wallet_of("Synthetic Investor", "7 Synthetic Street")
        investor = member_of(self.company, investor_wallet)
        issue(register, PERIOD_FROM, investor, investor_wallet, 20, paid=True)

        paid = self.prepare(token=token)
        issue(register, PERIOD_FROM, investor, investor_wallet, 1)
        unpaid = self.prepare(token=token)

        self.assertEqual(
            sections_of(paid)[CLASS_HEADING],
            [["Issued supply", "60"], ["Members holding shares", "2"], ["Total amount paid", "150.00"]],
        )
        self.assertEqual(
            sections_of(unpaid)[CLASS_HEADING],
            [["Issued supply", "61"], ["Members holding shares", "2"], ["Total amount paid", "not recorded"]],
        )
        self.assertEqual(
            sections_of(unpaid)[CHANGED_MEMBERS_HEADING][1:],
            [[str(investor.pk), "Synthetic Investor", "7 Synthetic Street", "21", "not recorded"]],
        )

    def test_refusals_record_nothing_and_an_accepted_period_records_exactly_one_record(self):
        unopened = ShareToken.objects.create(
            company=self.company, name="Unopened shares", symbol="NEW", total_supply="1000"
        )
        for token, fields, refusal in (
            (unopened, {}, "This share class&#x27;s register has not been opened, so there are no figures to prepare."),
            (self.token, {"period_from": "2026-09-23"}, "The period cannot start in the future."),
            (self.token, {"instruction": "   "}, "This field is required."),
            (self.token, {"period_from": ""}, "This field is required."),
        ):
            with self.subTest(fields=fields, refusal=refusal):
                response = self.prepare(token, **fields)

                self.assertContains(response, refusal)
                self.assertFalse(RegisterExport.objects.exists())

        accepted = self.prepare(period_from="2026-09-22")

        self.assertEqual((accepted.status_code, accepted["Content-Type"]), (200, "text/csv"))
        sections = sections_of(accepted)
        self.assertEqual(sections[PERIOD_ENTRIES_HEADING], [PERIOD_ENTRY_HEADERS])
        self.assertEqual(sections[CHANGED_MEMBERS_HEADING], [CHANGED_MEMBER_HEADERS])
        self.assertEqual(
            list(RegisterExport.objects.values_list("kind", "period_from", "member_rows")),
            [("notice_figures", date(2026, 9, 22), 0)],
        )

    def test_only_the_register_outputs_permission_opens_the_notice_figures_page(self):
        share_tokens = admin.site._registry[ShareToken]
        self.client.force_login(
            grant(grant(staff_user("notice-figures-share-token-editor"), share_tokens, "view"), share_tokens, "change")
        )

        self.assertEqual(self.client.get(self.page()).status_code, 403)
        self.assertEqual(self.prepare().status_code, 403)
        self.assertFalse(RegisterExport.objects.exists())

        self.client.force_login(self.staff)

        self.assertContains(self.client.get(reverse("admin:tokens_registeroutput_changelist")), self.page())
        self.assertContains(
            self.client.get(reverse("admin:tokens_registeroutput_change", args=[self.token.pk])), self.page()
        )
        self.assertContains(self.client.get(self.page()), "First day of the period")
        self.assertEqual(self.prepare().status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 1)


class NoticeFiguresRecordTest(TestCase):
    def setUp(self):
        self.owner, _, self.token, _, _, _ = register_fixture()

    def test_the_database_holds_notice_figures_to_their_shape_and_every_other_kind_to_no_period(self):
        others = (
            {**NO_REQUEST, "kind": "register_csv"},
            {**REQUEST, "kind": "inspection_copy"},
            CERTIFICATE,
        )
        inserted(self.token, self.owner, **NOTICE_FIGURES)
        inserted(self.token, self.owner, **NOTICE_FIGURES, member_rows=0)
        for other in others:
            inserted(self.token, self.owner, **other)
        self.assertEqual(
            sorted(RegisterExport.objects.values_list("kind", "member_rows", "period_from")),
            [
                ("certificate", 1, None),
                ("inspection_copy", 1, None),
                ("notice_figures", 0, DAY),
                ("notice_figures", 1, DAY),
                ("register_csv", 1, None),
            ],
        )
        for columns, constraint in (
            *(
                ({**NOTICE_FIGURES, field: value}, "register_export_notice_figures_shape")
                for field, value in (
                    ("digest", ""),
                    ("digest", "A" * 64),
                    ("digest", "a" * 63),
                    ("instruction", ""),
                    ("instruction", " \t"),
                    ("period_from", None),
                    ("former_rows", 1),
                    ("recipient", "Synthetic Requester"),
                    ("requested_on", DAY),
                    ("late", False),
                )
            ),
            *(({**other, "period_from": DAY}, "register_export_period_only_for_notice_figures") for other in others),
        ):
            with self.subTest(columns=columns), self.assertRaisesMessage(IntegrityError, constraint), atomic():
                inserted(self.token, self.owner, **columns)
        self.assertEqual(RegisterExport.objects.count(), 5)

    def test_the_purge_keeps_a_notice_figures_record_until_the_seven_year_clock_then_removes_it(self):
        figures = noticed(self.token, self.owner)
        purge_register_exports(now=figures.created_at + timedelta(days=2557))
        self.assertTrue(RegisterExport.objects.filter(pk=figures.pk).exists())
        purge_register_exports(now=figures.created_at + timedelta(days=2558))
        self.assertFalse(RegisterExport.objects.filter(pk=figures.pk).exists())

    def test_downgrade_refuses_to_discard_notice_figures_records(self):
        migration = importlib.import_module("tokens.migrations.0078_register_notice_figures")
        certified(self.token, self.owner)
        with atomic(), connections[current_alias()].schema_editor() as editor:
            migration.refuse_reversal(None, editor)
        figures = noticed(self.token, self.owner)
        with self.assertRaisesRegex(RuntimeError, "Retain notice figures records"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.refuse_reversal(None, editor)
        self.assertTrue(RegisterExport.objects.filter(pk=figures.pk).exists())


class ScopedNoticeFiguresTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, _, _, self.opening = register_fixture()

    def test_the_issuer_can_neither_read_nor_write_a_notice_figures_record(self):
        with use_operator():
            figures = noticed(self.token, self.owner)
        self.the_principal_the_middleware_would_set(self.owner)
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            RegisterExport.objects.filter(pk=figures.pk).exists()
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            noticed(self.token, self.owner)
        with use_operator():
            self.assertEqual(list(RegisterExport.objects.filter(kind="notice_figures")), [figures])

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_register_outputs_page_records_its_notice_figures_on_the_operator_connection(self):
        with use_operator():
            member = member_of(self.company, wallet_of("Synthetic Scoped Member", "4 Synthetic Street"))
            entered(self.opening.register, "issue", (member, 5))
            staff = grant(staff_user("scoped-notice-figures"), admin.site._registry[RegisterOutput], "change")
            self.client.force_login(staff)
        response = self.client.post(
            reverse("admin:tokens_registeroutput_notice_figures", args=[self.token.pk]),
            {"period_from": DAY, "instruction": "SYNTHETIC-INSTRUCTION-12"},
        )
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        with use_operator():
            record = RegisterExport.objects.get(kind="notice_figures")
        self.assertEqual(
            (record.requested_by_id, record.digest, record.register_sequence, record.member_rows, record.period_from),
            (staff.pk, hashlib.sha256(response.content).hexdigest(), 2, 1, DAY),
        )
