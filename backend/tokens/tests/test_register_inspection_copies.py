import csv
import hashlib
import io
from datetime import date, datetime
from datetime import timezone as utc_zone
from unittest.mock import patch

from django.contrib import admin
from django.test import TestCase, override_settings
from django.urls import reverse

from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from shared.utils import csv_cell
from tokens.models import RegisterExport, RegisterOutput, ShareToken
from tokens.services.register import (
    INSPECTION_COPY_HEADING,
    INSTRUCTION_ROW,
    LATE_ROW,
    PRODUCED_ON_ROW,
    RECIPIENT_ROW,
    REGISTER_HEADERS,
    REQUESTED_ON_ROW,
    export_rows,
)
from tokens.tests.test_register_events import register_fixture

SYDNEY_ONE_AM_ON_THE_22ND = datetime(2026, 9, 21, 15, 0, tzinfo=utc_zone.utc)
SEVEN_DAYS_BEFORE = "2026-09-15"
EIGHT_DAYS_BEFORE = "2026-09-14"
FORMULA = '=HYPERLINK("http://attacker.test/","Open")'


@override_settings(STORAGES=ADMIN_STORAGES)
class InspectionCopyTest(TestCase):
    def setUp(self):
        self.owner, self.company, self.token, _, _, _ = register_fixture()
        self.staff = grant(staff_user("register-outputs"), admin.site._registry[RegisterOutput], "change")
        self.client.force_login(self.staff)

    def page(self, token=None):
        return reverse("admin:tokens_registeroutput_inspection_copy", args=[(token or self.token).pk])

    def prepare(self, token=None, **fields):
        request = {
            "instruction": "SYNTHETIC-INSTRUCTION-7",
            "requested_on": SEVEN_DAYS_BEFORE,
            "recipient": "Synthetic Requester",
            **fields,
        }
        with patch("tokens.services.register.timezone.now", return_value=SYDNEY_ONE_AM_ON_THE_22ND):
            return self.client.post(self.page(token), request)

    def rows(self, response):
        return list(csv.reader(io.StringIO(response.content.decode())))

    def test_the_copy_is_the_register_export_with_the_request_and_its_digest_is_of_the_bytes_served(self):
        response = self.prepare()

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="register-REG-inspection-copy.csv"')
        rows = self.rows(response)
        sheet = [REGISTER_HEADERS, *export_rows(self.token, self.owner)]
        self.assertEqual(rows[: len(sheet)], sheet)
        self.assertEqual(
            rows[len(sheet) :],
            [
                [],
                [INSPECTION_COPY_HEADING],
                [REQUESTED_ON_ROW, SEVEN_DAYS_BEFORE],
                [INSTRUCTION_ROW, "SYNTHETIC-INSTRUCTION-7"],
                [RECIPIENT_ROW, "Synthetic Requester"],
                [PRODUCED_ON_ROW, "2026-09-22"],
                [LATE_ROW, "no"],
            ],
        )
        record = RegisterExport.objects.get(kind="inspection_copy")
        self.assertEqual(record.digest, hashlib.sha256(response.content).hexdigest())
        self.assertEqual(
            (record.token_id, record.requested_by_id, record.register_sequence, record.member_rows, record.former_rows),
            (self.token.pk, self.staff.pk, 1, 1, 0),
        )
        self.assertEqual(
            (record.instruction, record.requested_on, record.recipient, record.late),
            ("SYNTHETIC-INSTRUCTION-7", date(2026, 9, 15), "Synthetic Requester", False),
        )

    def test_a_copy_prepared_more_than_seven_days_after_the_request_is_late_in_the_file_and_on_its_record(self):
        for requested_on, late, marked in ((SEVEN_DAYS_BEFORE, False, "no"), (EIGHT_DAYS_BEFORE, True, "yes")):
            with self.subTest(requested_on=requested_on):
                response = self.prepare(requested_on=requested_on)

                self.assertIn([LATE_ROW, marked], self.rows(response))
                self.assertEqual(RegisterExport.objects.get(requested_on=requested_on).late, late)

    def test_refusals_record_nothing_and_an_accepted_request_records_exactly_one_copy(self):
        unopened = ShareToken.objects.create(
            company=self.company, name="Unopened shares", symbol="NEW", total_supply="1000"
        )
        for token, fields, refusal in (
            (unopened, {}, "has not been opened"),
            (self.token, {"requested_on": "2026-09-23"}, "The request date cannot be in the future."),
            (self.token, {"instruction": "   "}, "This field is required."),
        ):
            with self.subTest(refusal=refusal):
                response = self.prepare(token, **fields)

                self.assertContains(response, refusal)
                self.assertFalse(RegisterExport.objects.exists())

        accepted = self.prepare(requested_on="2026-09-22")

        self.assertEqual((accepted.status_code, accepted["Content-Type"]), (200, "text/csv"))
        self.assertEqual(list(RegisterExport.objects.values_list("kind", flat=True)), ["inspection_copy"])

    def test_text_that_opens_a_formula_is_neutralised_in_the_file_and_recorded_as_entered(self):
        response = self.prepare(recipient=FORMULA)

        self.assertIn([RECIPIENT_ROW, csv_cell(FORMULA)], self.rows(response))
        self.assertNotEqual(csv_cell(FORMULA), FORMULA)
        self.assertEqual(RegisterExport.objects.get().recipient, FORMULA)

    def test_only_the_register_outputs_permission_opens_the_page_and_it_opens_nothing_else(self):
        share_tokens = admin.site._registry[ShareToken]
        self.client.force_login(
            grant(grant(staff_user("share-token-editor"), share_tokens, "view"), share_tokens, "change")
        )

        self.assertEqual(self.client.get(self.page()).status_code, 403)
        self.assertEqual(self.prepare().status_code, 403)
        self.assertFalse(RegisterExport.objects.exists())

        self.client.force_login(self.staff)

        self.assertEqual(
            self.client.get(reverse("admin:tokens_sharetoken_deploy", args=[self.token.pk])).status_code, 403
        )
        self.assertEqual(self.client.get(self.page()).status_code, 200)
        self.assertEqual(self.prepare().status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 1)

    def test_the_share_class_cannot_be_edited_through_its_register_outputs(self):
        change = reverse("admin:tokens_registeroutput_change", args=[self.token.pk])
        page = self.client.get(change)

        self.assertEqual(page.status_code, 200)
        self.assertContains(page, self.page())
        self.assertNotContains(page, 'name="_save"')
        self.assertEqual(self.client.post(change, {"name": "Renamed shares", "symbol": "REG"}).status_code, 405)
        self.assertEqual(ShareToken.objects.get(pk=self.token.pk).name, "Synthetic shares")
