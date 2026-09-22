from datetime import date, datetime
from datetime import timezone as utc_zone
from unittest.mock import patch
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from companies.models import Company, CompanyType
from shared.tests.tenants import make_tenant
from shared.tests.test_admin_row_actions import (
    ADMIN_STORAGES,
    grant,
    row_action_routes,
    staff_user,
)
from tokens.models import RegisterOutput, ShareToken
from tokens.services.register import (
    months_after,
    outputs_due,
    prepare_certificate,
    prepare_notice_figures,
)
from tokens.services.register_events import open_register
from tokens.tests.test_register_certificates import member_of, wallet_of
from tokens.tests.test_register_notice_figures import (
    SYDNEY_ONE_AM_ON_THE_22ND,
    dated,
)

User = get_user_model()

CERTIFICATE = "certificate"
NOTICE = "notice_figures"
INSTRUCTION = "SYNTHETIC-INSTRUCTION-21"
SYDNEY_ONE_MINUTE_TO_MIDNIGHT_ON_THE_21ST = datetime(2026, 9, 21, 13, 59, tzinfo=utc_zone.utc)
SYDNEY_HALF_PAST_MIDNIGHT_ON_1_AUGUST = datetime(2026, 7, 31, 14, 30, tzinfo=utc_zone.utc)


def opened_on(token, day, member):
    return open_register(
        token_id=token.pk,
        operation_id=uuid4(),
        changes=[{"member": str(member.pk), "shares": "100"}],
        effective_on=day,
        recorded_by=token.company.owner,
    ).register


def items(at=SYDNEY_ONE_AM_ON_THE_22ND):
    with patch("tokens.services.register.timezone.now", return_value=at):
        return outputs_due()


def due(at=SYDNEY_ONE_AM_ON_THE_22ND):
    return [
        (item["token"].symbol, item["sequence"], item["output"], item["due_on"], item["overdue"]) for item in items(at)
    ]


def prepared_today(prepare, token, requested_by, **request):
    with patch("tokens.services.register.timezone.now", return_value=SYDNEY_ONE_AM_ON_THE_22ND):
        return prepare(token, requested_by, instruction=INSTRUCTION, **request)


def settled_at(label, moment):
    with patch("django.utils.timezone.now", return_value=moment):
        return make_tenant(label)


def identified(company, label):
    return member_of(company, wallet_of(f"Synthetic {label}", f"{uuid4().hex[:4]} Synthetic Street, Sydney NSW 2000"))


class OutputsDueTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="due-owner@example.test", password="pw-12345678")
        self.staff = staff_user("outputs-due")
        self.company = Company.objects.create(owner=self.owner, name="Synthetic Due Pty Ltd", acn="123456789")
        self.token = ShareToken.objects.create(
            company=self.company, name="Synthetic ordinary shares", symbol="DUE", total_supply="1000"
        )
        self.other = ShareToken.objects.create(
            company=self.company, name="Synthetic other shares", symbol="OTH", total_supply="1000"
        )
        self.founder = identified(self.company, "Founder")
        self.allottee = identified(self.company, "Allottee")

    def test_an_issue_is_due_two_calendar_months_after_its_entry_until_its_certificate_is_prepared(self):
        register = opened_on(self.token, date(2026, 7, 1), self.founder)
        other = opened_on(self.other, date(2026, 7, 1), self.founder)
        dated(register, date(2026, 7, 10), "issue", (self.allottee, 25))
        dated(other, date(2026, 7, 10), "issue", (self.allottee, 25))
        dated(register, date(2026, 7, 31), "issue", (self.allottee, 5))

        self.assertEqual(
            items()[0],
            {
                "token": self.token,
                "sequence": 2,
                "kind": "issue",
                "effective_on": date(2026, 7, 10),
                "output": NOTICE,
                "due_on": date(2026, 8, 7),
                "overdue": True,
            },
        )
        self.assertEqual(
            due(),
            [
                ("DUE", 2, NOTICE, date(2026, 8, 7), True),
                ("OTH", 2, NOTICE, date(2026, 8, 7), True),
                ("DUE", 3, NOTICE, date(2026, 8, 28), True),
                ("DUE", 2, CERTIFICATE, date(2026, 9, 10), True),
                ("OTH", 2, CERTIFICATE, date(2026, 9, 10), True),
                ("DUE", 3, CERTIFICATE, date(2026, 9, 30), False),
            ],
        )

        prepared_today(prepare_certificate, self.token, self.staff, sequence=2)

        self.assertEqual(
            due(),
            [
                ("DUE", 2, NOTICE, date(2026, 8, 7), True),
                ("OTH", 2, NOTICE, date(2026, 8, 7), True),
                ("DUE", 3, NOTICE, date(2026, 8, 28), True),
                ("OTH", 2, CERTIFICATE, date(2026, 9, 10), True),
                ("DUE", 3, CERTIFICATE, date(2026, 9, 30), False),
            ],
        )

    def test_a_transfer_is_due_one_calendar_month_after_its_order_was_created_in_sydney_until_certified(self):
        tenant = settled_at("due-transfer", SYDNEY_HALF_PAST_MIDNIGHT_ON_1_AUGUST)
        seller, buyer = identified(tenant.company, "Seller"), identified(tenant.company, "Buyer")
        register = opened_on(tenant.deployed_token, date(2026, 7, 1), seller)
        dated(register, date(2026, 8, 5), "transfer", (seller, -10), (buyer, 10), operation_id=tenant.swap.pk)

        self.assertEqual(
            due(),
            [
                ("DEP", 2, CERTIFICATE, date(2026, 9, 1), True),
                ("DEP", 2, NOTICE, date(2026, 9, 2), True),
            ],
        )

        prepared_today(prepare_certificate, tenant.deployed_token, self.staff, sequence=2)

        self.assertEqual(due(), [("DEP", 2, NOTICE, date(2026, 9, 2), True)])

    def test_notice_figures_cover_an_entry_only_from_a_period_starting_on_or_before_it_and_running_to_it(self):
        register = opened_on(self.token, date(2026, 9, 1), self.founder)
        other = opened_on(self.other, date(2026, 9, 1), self.founder)
        dated(register, date(2026, 9, 2), "issue", (self.allottee, 5))
        dated(other, date(2026, 9, 2), "issue", (self.allottee, 5))

        def notices():
            return [row for row in due() if row[2] == NOTICE]

        prepared_today(prepare_notice_figures, self.token, self.staff, period_from=date(2026, 9, 3))

        self.assertEqual(
            notices(),
            [("DUE", 2, NOTICE, date(2026, 9, 30), False), ("OTH", 2, NOTICE, date(2026, 9, 30), False)],
        )

        prepared_today(prepare_notice_figures, self.token, self.staff, period_from=date(2026, 9, 2))

        self.assertEqual(notices(), [("OTH", 2, NOTICE, date(2026, 9, 30), False)])

        dated(register, date(2026, 9, 4), "issue", (self.allottee, 7))

        self.assertEqual(
            notices(),
            [("OTH", 2, NOTICE, date(2026, 9, 30), False), ("DUE", 3, NOTICE, date(2026, 10, 2), False)],
        )

        prepared_today(prepare_notice_figures, self.token, self.staff, period_from=date(2026, 9, 1))

        self.assertEqual(notices(), [("OTH", 2, NOTICE, date(2026, 9, 30), False)])

    def test_a_public_companys_transfer_has_no_notice_item_but_its_issue_does(self):
        tenant = settled_at("due-public", datetime(2026, 9, 1, 0, 0, tzinfo=utc_zone.utc))
        seller, buyer = identified(tenant.company, "Seller"), identified(tenant.company, "Buyer")
        register = opened_on(tenant.deployed_token, date(2026, 9, 1), seller)
        dated(register, date(2026, 9, 2), "issue", (buyer, 5))
        dated(register, date(2026, 9, 3), "transfer", (seller, -10), (buyer, 10), operation_id=tenant.swap.pk)
        certificates = [
            ("DEP", 3, CERTIFICATE, date(2026, 10, 1), False),
            ("DEP", 2, CERTIFICATE, date(2026, 11, 2), False),
        ]

        self.assertEqual(
            due(),
            [
                ("DEP", 2, NOTICE, date(2026, 9, 30), False),
                ("DEP", 3, CERTIFICATE, date(2026, 10, 1), False),
                ("DEP", 3, NOTICE, date(2026, 10, 1), False),
                ("DEP", 2, CERTIFICATE, date(2026, 11, 2), False),
            ],
        )
        for company_type in (CompanyType.PUBLIC, CompanyType.UNLISTED_PUBLIC):
            with self.subTest(company_type=company_type):
                Company.objects.filter(pk=tenant.company.pk).update(company_type=company_type)

                self.assertEqual(due(), [("DEP", 2, NOTICE, date(2026, 9, 30), False), *certificates])

    def test_reversed_entries_openings_and_corrections_are_never_listed(self):
        register = opened_on(self.token, date(2026, 9, 1), self.founder)
        mistaken = dated(register, date(2026, 9, 2), "issue", (self.allottee, 5))
        dated(register, date(2026, 9, 3), "issue", (self.allottee, 7))

        self.assertEqual(
            due(),
            [
                ("DUE", 2, NOTICE, date(2026, 9, 30), False),
                ("DUE", 3, NOTICE, date(2026, 10, 1), False),
                ("DUE", 2, CERTIFICATE, date(2026, 11, 2), False),
                ("DUE", 3, CERTIFICATE, date(2026, 11, 3), False),
            ],
        )

        dated(register, date(2026, 9, 4), "correction", (self.allottee, -5), corrects_id=mistaken.pk)

        self.assertEqual(
            due(),
            [("DUE", 3, NOTICE, date(2026, 10, 1), False), ("DUE", 3, CERTIFICATE, date(2026, 11, 3), False)],
        )

    def test_a_calendar_month_is_the_same_day_or_the_last_day_of_a_shorter_month(self):
        for day, months, expected in (
            (date(2026, 1, 31), 1, date(2026, 2, 28)),
            (date(2028, 1, 31), 1, date(2028, 2, 29)),
            (date(2025, 11, 30), 3, date(2026, 2, 28)),
            (date(2027, 11, 30), 3, date(2028, 2, 29)),
            (date(2026, 1, 31), 2, date(2026, 3, 31)),
            (date(2026, 7, 10), 2, date(2026, 9, 10)),
            (date(2026, 12, 31), 1, date(2027, 1, 31)),
        ):
            with self.subTest(day=day, months=months):
                self.assertEqual(months_after(day, months), expected)

        register = opened_on(self.token, date(2023, 12, 1), self.founder)
        dated(register, date(2023, 12, 31), "issue", (self.allottee, 5))

        self.assertEqual(
            due(),
            [("DUE", 2, NOTICE, date(2024, 1, 28), True), ("DUE", 2, CERTIFICATE, date(2024, 2, 29), True)],
        )

    def test_an_output_is_overdue_only_once_its_due_date_has_passed_in_sydney(self):
        register = opened_on(self.token, date(2026, 8, 1), self.founder)
        dated(register, date(2026, 8, 24), "issue", (self.allottee, 5))
        dated(register, date(2026, 8, 25), "issue", (self.allottee, 7))

        self.assertEqual(
            due(SYDNEY_ONE_AM_ON_THE_22ND)[:2],
            [("DUE", 2, NOTICE, date(2026, 9, 21), True), ("DUE", 3, NOTICE, date(2026, 9, 22), False)],
        )
        self.assertEqual(
            due(SYDNEY_ONE_MINUTE_TO_MIDNIGHT_ON_THE_21ST)[:2],
            [("DUE", 2, NOTICE, date(2026, 9, 21), False), ("DUE", 3, NOTICE, date(2026, 9, 22), False)],
        )

    def test_items_are_ordered_by_due_date_then_company_class_and_entry(self):
        beta = Company.objects.create(owner=self.owner, name="Beta Synthetic Pty Ltd", acn="223456789")
        alpha = Company.objects.create(owner=self.owner, name="Alpha Synthetic Pty Ltd", acn="323456789")
        registers = {}
        for company, symbol in ((beta, "AAA"), (alpha, "ZZZ"), (alpha, "MMM")):
            token = ShareToken.objects.create(
                company=company, name=f"{symbol} shares", symbol=symbol, total_supply="1000"
            )
            member = member_of(company)
            registers[symbol] = (opened_on(token, date(2026, 8, 1), member), member)
        for symbol, day in (
            ("AAA", date(2026, 8, 1)),
            ("AAA", date(2026, 9, 1)),
            ("ZZZ", date(2026, 9, 1)),
            ("MMM", date(2026, 9, 1)),
            ("MMM", date(2026, 9, 1)),
        ):
            register, member = registers[symbol]
            dated(register, day, "issue", (member, 1))

        self.assertEqual(
            due(),
            [
                ("AAA", 2, NOTICE, date(2026, 8, 29), True),
                ("MMM", 2, NOTICE, date(2026, 9, 29), False),
                ("MMM", 3, NOTICE, date(2026, 9, 29), False),
                ("ZZZ", 2, NOTICE, date(2026, 9, 29), False),
                ("AAA", 3, NOTICE, date(2026, 9, 29), False),
                ("AAA", 2, CERTIFICATE, date(2026, 10, 1), False),
                ("MMM", 2, CERTIFICATE, date(2026, 11, 1), False),
                ("MMM", 3, CERTIFICATE, date(2026, 11, 1), False),
                ("ZZZ", 2, CERTIFICATE, date(2026, 11, 1), False),
                ("AAA", 3, CERTIFICATE, date(2026, 11, 1), False),
            ],
        )


@override_settings(STORAGES=ADMIN_STORAGES)
class OutputsDuePageTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="due-page-owner@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=self.owner, name="Synthetic Due Page Pty Ltd", acn="123456789")
        self.token = ShareToken.objects.create(
            company=self.company, name="Synthetic ordinary shares", symbol="DUE", total_supply="1000"
        )
        founder = member_of(self.company)
        self.allottee = member_of(self.company)
        self.register = opened_on(self.token, date(2026, 7, 1), founder)
        self.staff = grant(staff_user("outputs-due-page"), admin.site._registry[RegisterOutput], "change")
        self.client.force_login(self.staff)

    def page(self):
        with patch("tokens.services.register.timezone.now", return_value=SYDNEY_ONE_AM_ON_THE_22ND):
            return self.client.get(reverse("admin:tokens_registeroutput_due"))

    def test_only_the_register_outputs_permission_opens_the_page_and_the_register_outputs_list_links_to_it(self):
        share_tokens = admin.site._registry[ShareToken]
        self.client.force_login(
            grant(grant(staff_user("outputs-due-share-token-editor"), share_tokens, "view"), share_tokens, "change")
        )

        self.assertEqual(self.page().status_code, 403)

        self.client.force_login(self.staff)

        self.assertEqual(self.page().status_code, 200)
        self.assertContains(
            self.client.get(reverse("admin:tokens_registeroutput_changelist")),
            reverse("admin:tokens_registeroutput_due"),
        )
        self.assertIn("tokens_registeroutput_due", [name for name, _, _ in row_action_routes()])

    def test_each_row_links_to_the_page_that_prepares_its_output_for_its_class(self):
        dated(self.register, date(2026, 7, 10), "issue", (self.allottee, 25))

        response = self.page()

        for url, output, due_on in (
            ("admin:tokens_registeroutput_notice_figures", "Notice figures", "2026-08-07"),
            ("admin:tokens_registeroutput_certificate", "Certificate", "2026-09-10"),
        ):
            with self.subTest(output=output):
                self.assertContains(
                    response,
                    f"<tr><td>Synthetic Due Page Pty Ltd</td><td>DUE</td><td>2</td><td>Issue</td><td>2026-07-10</td>"
                    f'<td><a href="{reverse(url, args=[self.token.pk])}">{output}</a></td><td>{due_on}</td>'
                    "<td>yes</td></tr>",
                    html=True,
                )
        self.assertNotContains(response, "No certificates or notice figures are due.")

    def test_with_nothing_due_the_page_says_so(self):
        response = self.page()

        self.assertContains(response, "No certificates or notice figures are due.")
        self.assertNotContains(response, "<th>Due date</th>")
