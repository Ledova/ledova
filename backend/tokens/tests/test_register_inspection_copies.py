import csv
import hashlib
import io
from datetime import date, datetime, timedelta
from datetime import timezone as utc_zone
from unittest.mock import patch

from django.contrib import admin
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import CompanyCapability
from companies.services.team import revoke_company_appointment
from shared.db import use_operator
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from shared.utils import csv_cell
from tokens.models import (
    RegisterEvidenceKind,
    RegisterExport,
    RegisterOutput,
    ShareToken,
)
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
from tokens.tests.evidence_fixtures import owner_appointment, upload_evidence
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_particulars import (
    apply_change,
    change_payload,
    prepared,
)

SYDNEY_ONE_AM_ON_THE_22ND = datetime(2026, 9, 21, 15, 0, tzinfo=utc_zone.utc)
SEVEN_DAYS_BEFORE = "2026-09-15"
EIGHT_DAYS_BEFORE = "2026-09-14"
FORMULA = '=HYPERLINK("http://attacker.test/","Open")'


@override_settings(STORAGES=ADMIN_STORAGES)
class InspectionCopyTest(AppointsTeam, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, _, _ = register_fixture()
            self.owner.is_staff = False
            self.owner.save(update_fields=["is_staff"])
            self.administrator = owner_appointment(self.company)
        self.reader, self.appointment = self.appoint([CompanyCapability.READ_REGISTER])
        self.client.force_authenticate(self.reader)

    def page(self, token=None):
        return f"/api/v1/tokens/{(token or self.token).pk}/register/inspection-copy/"

    def preview(self, token=None):
        response = self.client.get(self.page(token))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def prepare(self, token=None, preview=None, **fields):
        preview = preview or self.preview()
        request = {
            "appointment": preview["appointment"],
            "sourceDigest": preview["sourceDigest"],
            "instruction": "SYNTHETIC-INSTRUCTION-7",
            "requestedOn": SEVEN_DAYS_BEFORE,
            "recipient": "Synthetic Requester",
            **fields,
        }
        with patch("tokens.services.register.timezone.now", return_value=SYDNEY_ONE_AM_ON_THE_22ND):
            return self.client.post(self.page(token), request, format="json")

    def records(self):
        with use_operator():
            return list(RegisterExport.objects.filter(kind="inspection_copy"))

    def rows(self, response):
        return list(csv.reader(io.StringIO(response.content.decode())))

    def test_the_copy_is_the_register_export_with_the_request_and_its_digest_is_of_the_bytes_served(self):
        source = self.preview()
        self.assertFalse(self.records())
        response = self.prepare(preview=source)

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="register-REG-inspection-copy.csv"')
        rows = self.rows(response)
        with use_operator():
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
        record = self.records()[0]
        self.assertEqual(record.digest, hashlib.sha256(response.content).hexdigest())
        self.assertEqual(
            (record.token_id, record.requested_by_id, record.register_sequence, record.member_rows, record.former_rows),
            (self.token.pk, self.reader.pk, 1, 1, 0),
        )
        self.assertEqual(
            (record.instruction, record.requested_on, record.recipient, record.late),
            ("SYNTHETIC-INSTRUCTION-7", date(2026, 9, 15), "Synthetic Requester", False),
        )

    def test_a_copy_prepared_more_than_seven_days_after_the_request_is_late_in_the_file_and_on_its_record(self):
        for requested_on, late, marked in ((SEVEN_DAYS_BEFORE, False, "no"), (EIGHT_DAYS_BEFORE, True, "yes")):
            with self.subTest(requested_on=requested_on):
                response = self.prepare(requestedOn=requested_on)

                self.assertIn([LATE_ROW, marked], self.rows(response))
                self.assertEqual(
                    next(row for row in self.records() if row.requested_on.isoformat() == requested_on).late, late
                )

    def test_refusals_record_nothing_and_an_accepted_request_records_exactly_one_copy(self):
        with use_operator():
            unopened = ShareToken.objects.create(
                company=self.company, name="Unopened shares", symbol="NEW", total_supply="1000"
            )
        source = self.preview()
        self.assertEqual(self.client.get(self.page(unopened)).status_code, 409)
        for token, fields, status in (
            (unopened, {}, 409),
            (self.token, {"requestedOn": "2026-09-23"}, 400),
            (self.token, {"instruction": "   "}, 400),
            (self.token, {"recipient": "x" * 256}, 400),
            (self.token, {"sourceDigest": "0" * 64}, 409),
        ):
            with self.subTest(fields=fields):
                response = self.prepare(token, preview=source, **fields)
                self.assertEqual(response.status_code, status, response.content)
                self.assertFalse(self.records())
        accepted = self.prepare(requestedOn="2026-09-22")
        self.assertEqual((accepted.status_code, accepted["Content-Type"]), (200, "text/csv"))
        self.assertEqual(len(self.records()), 1)

    def test_text_that_opens_a_formula_is_neutralised_in_the_file_and_recorded_as_entered(self):
        response = self.prepare(recipient=FORMULA)

        self.assertIn([RECIPIENT_ROW, csv_cell(FORMULA)], self.rows(response))
        self.assertNotEqual(csv_cell(FORMULA), FORMULA)
        self.assertEqual(self.records()[0].recipient, FORMULA)

    def test_revocation_stops_the_prepared_copy_and_another_persons_appointment_grants_nothing(self):
        source = self.preview()
        response = self.prepare(preview=source, appointment=str(self.administrator.pk))
        self.assertEqual(response.status_code, 404)
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        self.assertEqual(self.prepare(preview=source).status_code, 404)
        self.assertEqual(self.client.get(self.page()).status_code, 404)
        self.assertFalse(self.records())

    def test_staff_permission_and_ownership_without_a_current_appointment_do_not_produce_a_copy(self):
        source = self.preview()
        staff = grant(staff_user("register-outputs"), admin.site._registry[RegisterOutput], "change")
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get(self.page()).status_code, 404)
        self.assertEqual(self.prepare(preview=source).status_code, 404)
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(self.page()).status_code, 404)
        self.assertEqual(self.prepare(preview=source).status_code, 404)
        self.assertFalse(self.records())

    def test_an_actual_particulars_change_refuses_the_old_copy_even_at_the_same_register_sequence(self):
        source = self.preview()
        with use_operator():
            evidence = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SUPPORTING)
            change = prepared(self.owner, change_payload(self.member, evidence, self.administrator))
            apply_change(self.owner, self.administrator, change)
        refreshed = self.preview()
        self.assertEqual(refreshed["registerSequence"], source["registerSequence"])
        self.assertNotEqual(refreshed["sourceDigest"], source["sourceDigest"])
        self.assertEqual(self.prepare(preview=source).status_code, 409)
        self.assertFalse(self.records())
        self.assertEqual(self.prepare(preview=refreshed).status_code, 200)

    def test_foreign_classes_return_no_source_or_copy(self):
        source = self.preview()
        with use_operator():
            _, _, foreign, _, _, _ = register_fixture()
        self.assertEqual(self.client.get(self.page(foreign)).status_code, 404)
        self.assertEqual(self.prepare(foreign, preview=source).status_code, 404)
        self.assertFalse(self.records())

    def test_expiry_during_generation_rolls_back_the_record_and_serves_no_copy(self):
        from tokens.services.register import prepare_inspection_copy

        now = timezone.now()
        expires = now + timedelta(hours=1)
        reader, _ = self.appoint([CompanyCapability.READ_REGISTER], expires_at=expires)
        self.client.force_authenticate(reader)
        source = self.preview()
        finished = False

        def produce(*args, **kwargs):
            nonlocal finished
            content = prepare_inspection_copy(*args, **kwargs)
            finished = True
            return content

        with patch("tokens.services.register_inspection_copies.prepare_inspection_copy", side_effect=produce):
            with patch(
                "tokens.services.register_inspection_copies.timezone.now",
                side_effect=lambda: expires if finished else now,
            ):
                response = self.client.post(
                    self.page(),
                    {
                        "appointment": source["appointment"],
                        "sourceDigest": source["sourceDigest"],
                        "instruction": "SYNTHETIC-EXPIRING-COPY",
                        "requestedOn": now.date().isoformat(),
                        "recipient": "Synthetic Requester",
                    },
                    format="json",
                )
        self.assertTrue(finished)
        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.records())

    def test_the_share_class_cannot_be_edited_through_its_register_outputs(self):
        self.client = APIClient()
        staff = grant(staff_user("readonly-register-outputs"), admin.site._registry[RegisterOutput], "change")
        self.client.force_login(staff)
        change = reverse("admin:tokens_registeroutput_change", args=[self.token.pk])
        page = self.client.get(change)

        self.assertEqual(page.status_code, 200)
        self.assertNotContains(page, 'name="_save"')
        self.assertEqual(self.client.post(change, {"name": "Renamed shares", "symbol": "REG"}).status_code, 405)
        with use_operator():
            self.assertEqual(ShareToken.objects.get(pk=self.token.pk).name, "Synthetic shares")
