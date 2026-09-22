import hashlib
import importlib
from datetime import timedelta
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import DatabaseError, IntegrityError, connections
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from tokens.constants import STATUTORY_CALENDAR
from tokens.models import RegisterExport, RegisterOutput
from tokens.services.former_holders import purge_register_exports
from tokens.tasks.former_holders import purge_former_members_past_the_clock
from tokens.tests.test_register_certificates import entered, member_of, wallet_of
from tokens.tests.test_register_events import DAY, register_fixture

User = get_user_model()

DIGEST = "a" * 64
REQUEST = {
    "digest": DIGEST,
    "instruction": "SYNTHETIC-INSTRUCTION-1",
    "requested_on": DAY,
    "recipient": "Synthetic Requester",
    "late": False,
}
NO_REQUEST = {"digest": "", "instruction": "", "requested_on": None, "recipient": "", "late": None}
CERTIFICATE = {**NO_REQUEST, "kind": "certificate", "digest": DIGEST, "instruction": "SYNTHETIC-INSTRUCTION-3"}


def recorded(token, owner):
    return RegisterExport.objects.create(
        token=token,
        requested_by_id=owner.pk,
        kind="register_csv",
        register_sequence=1,
        member_rows=2,
        former_rows=0,
    )


def copied(token, owner):
    return RegisterExport.objects.create(
        token=token,
        requested_by_id=owner.pk,
        kind="inspection_copy",
        register_sequence=1,
        member_rows=1,
        former_rows=0,
        **REQUEST,
    )


def certified(token, owner):
    return RegisterExport.objects.create(
        token=token,
        requested_by_id=owner.pk,
        register_sequence=2,
        member_rows=2,
        former_rows=0,
        **CERTIFICATE,
    )


class RegisterExportAuditTest(TestCase):
    def setUp(self):
        self.owner, _, self.token, _, _, _ = register_fixture()
        self.record = recorded(self.token, self.owner)

    def insert(self, **columns):
        row = {
            "uuid": uuid4(),
            "created_at": timezone.now(),
            "updated_at": timezone.now(),
            "token_id": self.token.pk,
            "requested_by_id": self.owner.pk,
            "kind": "inspection_copy",
            "register_sequence": 1,
            "member_rows": 1,
            "former_rows": 0,
            **REQUEST,
            **columns,
        }
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                f"INSERT INTO tokens_registerexport ({', '.join(row)}) VALUES ({', '.join(['%s'] * len(row))})",
                list(row.values()),
            )

    def test_a_record_is_retained_as_written(self):
        copy = copied(self.token, self.owner)
        certificate = certified(self.token, self.owner)
        for record, change in (
            (self.record, {"member_rows": 3}),
            (copy, {"digest": "b" * 64}),
            (certificate, {"digest": "b" * 64}),
        ):
            with self.subTest(kind=record.kind), self.assertRaises(DatabaseError), atomic():
                RegisterExport.objects.filter(pk=record.pk).update(**change)
        self.assertEqual(RegisterExport.objects.get(pk=self.record.pk).member_rows, 2)
        self.assertEqual(RegisterExport.objects.get(pk=copy.pk).digest, DIGEST)
        self.assertEqual(RegisterExport.objects.get(pk=certificate.pk).digest, DIGEST)

    def test_the_database_holds_each_kind_to_its_own_request_fields(self):
        self.insert()
        self.insert(kind="register_csv", **NO_REQUEST)
        self.assertEqual(
            sorted(RegisterExport.objects.values_list("kind", flat=True)),
            ["inspection_copy", "register_csv", "register_csv"],
        )
        for columns, constraint in (
            *(
                ({field: value}, "register_export_inspection_copy_request")
                for field, value in (
                    ("digest", ""),
                    ("digest", "A" * 64),
                    ("digest", "a" * 63),
                    ("instruction", ""),
                    ("instruction", " \t"),
                    ("recipient", ""),
                    ("requested_on", None),
                    ("late", None),
                )
            ),
            *(
                ({**NO_REQUEST, "kind": "register_csv", field: value}, "register_export_csv_carries_no_request")
                for field, value in REQUEST.items()
            ),
        ):
            with self.subTest(columns=columns), self.assertRaisesMessage(IntegrityError, constraint), atomic():
                self.insert(**columns)
        self.assertEqual(RegisterExport.objects.count(), 3)

    def test_the_database_holds_a_certificate_to_its_digest_instruction_and_one_or_two_pages(self):
        self.insert(**CERTIFICATE)
        self.insert(**CERTIFICATE, member_rows=2)
        self.insert(**{**NO_REQUEST, "kind": "register_csv", "member_rows": 3, "former_rows": 1})
        self.assertEqual(
            sorted(RegisterExport.objects.values_list("kind", "member_rows", "former_rows")),
            [("certificate", 1, 0), ("certificate", 2, 0), ("register_csv", 2, 0), ("register_csv", 3, 1)],
        )
        for field, value in (
            ("digest", ""),
            ("digest", "A" * 64),
            ("digest", "a" * 63),
            ("instruction", ""),
            ("instruction", " \t"),
            ("member_rows", 0),
            ("member_rows", 3),
            ("former_rows", 1),
            ("recipient", "Synthetic Requester"),
            ("requested_on", DAY),
            ("late", False),
        ):
            with (
                self.subTest(field=field, value=value),
                self.assertRaisesMessage(IntegrityError, "register_export_certificate_shape"),
                atomic(),
            ):
                self.insert(**{**CERTIFICATE, field: value})
        self.assertEqual(RegisterExport.objects.count(), 4)

    def test_downgrade_refuses_to_discard_certificate_records(self):
        migration = importlib.import_module("tokens.migrations.0075_register_certificates")
        copied(self.token, self.owner)
        with atomic(), connections[current_alias()].schema_editor() as editor:
            migration.refuse_reversal(None, editor)
        certificate = certified(self.token, self.owner)
        with self.assertRaisesRegex(RuntimeError, "Retain certificate records"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.refuse_reversal(None, editor)
        self.assertTrue(RegisterExport.objects.filter(pk=certificate.pk).exists())

    def test_the_purge_keeps_records_until_the_seven_year_clock_then_removes_them(self):
        exported_at = self.record.created_at
        self.assertEqual(purge_register_exports(now=exported_at + timedelta(days=2557)), 0)
        self.assertTrue(RegisterExport.objects.filter(pk=self.record.pk).exists())
        self.assertEqual(purge_register_exports(now=exported_at + timedelta(days=2558)), 1)
        self.assertFalse(RegisterExport.objects.exists())

    def test_the_purge_keeps_an_inspection_copy_record_until_the_seven_year_clock_then_removes_it(self):
        copy = copied(self.token, self.owner)
        purge_register_exports(now=copy.created_at + timedelta(days=2557))
        self.assertTrue(RegisterExport.objects.filter(pk=copy.pk).exists())
        purge_register_exports(now=copy.created_at + timedelta(days=2558))
        self.assertFalse(RegisterExport.objects.filter(pk=copy.pk).exists())

    def test_the_purge_keeps_a_certificate_record_until_the_seven_year_clock_then_removes_it(self):
        certificate = certified(self.token, self.owner)
        purge_register_exports(now=certificate.created_at + timedelta(days=2557))
        self.assertTrue(RegisterExport.objects.filter(pk=certificate.pk).exists())
        purge_register_exports(now=certificate.created_at + timedelta(days=2558))
        self.assertFalse(RegisterExport.objects.filter(pk=certificate.pk).exists())

    def test_the_daily_retention_job_purges_exports_with_former_members(self):
        self.assertEqual(
            purge_former_members_past_the_clock(),
            {"removed": 0, "imported_removed": 0, "particulars_removed": 0, "exports_removed": 0},
        )

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_operators_can_query_records_but_not_add_change_or_delete_them(self):
        operator = User.objects.create_superuser(email="exports-operator@example.test", password="pw-12345678")
        self.client.force_login(operator)
        changelist = self.client.get(reverse("admin:tokens_registerexport_changelist"))
        self.assertEqual(changelist.status_code, 200)
        self.assertContains(changelist, self.token.symbol)
        self.assertEqual(self.client.get(reverse("admin:tokens_registerexport_add")).status_code, 403)
        change = self.client.get(reverse("admin:tokens_registerexport_change", args=[self.record.pk]))
        self.assertEqual(change.status_code, 200)
        self.assertNotContains(change, 'name="_save"')
        delete = self.client.post(reverse("admin:tokens_registerexport_delete", args=[self.record.pk]), {"post": "yes"})
        self.assertEqual(delete.status_code, 403)
        self.assertTrue(RegisterExport.objects.filter(pk=self.record.pk).exists())


class ScopedRegisterExportAuditTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, _, _, self.opening = register_fixture()
            recorded(self.token, self.owner)

    def test_only_the_operator_reads_or_writes_export_records_and_the_issuer_is_refused_both(self):
        self.the_principal_the_middleware_would_set(self.owner)
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            RegisterExport.objects.exists()
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            recorded(self.token, self.owner)
        with use_operator():
            recorded(self.token, self.owner)
            self.assertEqual(RegisterExport.objects.count(), 2)

    def test_the_issuer_can_neither_read_nor_write_an_inspection_copy_record(self):
        with use_operator():
            copy = copied(self.token, self.owner)
        self.the_principal_the_middleware_would_set(self.owner)
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            RegisterExport.objects.filter(pk=copy.pk).exists()
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            copied(self.token, self.owner)
        with use_operator():
            self.assertEqual(list(RegisterExport.objects.filter(kind="inspection_copy")), [copy])

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_register_outputs_page_records_its_copy_on_the_operator_connection(self):
        with use_operator():
            staff = grant(staff_user("scoped-register-outputs"), admin.site._registry[RegisterOutput], "change")
            self.client.force_login(staff)
        requested_on = timezone.localdate(timezone=STATUTORY_CALENDAR) - timedelta(days=1)
        response = self.client.post(
            reverse("admin:tokens_registeroutput_inspection_copy", args=[self.token.pk]),
            {
                "instruction": "SYNTHETIC-INSTRUCTION-2",
                "requested_on": requested_on,
                "recipient": "Synthetic Requester",
            },
        )
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        with use_operator():
            record = RegisterExport.objects.get(kind="inspection_copy")
        self.assertEqual(
            (record.requested_by_id, record.digest, record.requested_on),
            (staff.pk, hashlib.sha256(response.content).hexdigest(), requested_on),
        )

    def test_the_issuer_can_neither_read_nor_write_a_certificate_record(self):
        with use_operator():
            certificate = certified(self.token, self.owner)
        self.the_principal_the_middleware_would_set(self.owner)
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            RegisterExport.objects.filter(pk=certificate.pk).exists()
        with self.assertRaisesRegex(DatabaseError, "permission denied for table tokens_registerexport"), atomic():
            certified(self.token, self.owner)
        with use_operator():
            self.assertEqual(list(RegisterExport.objects.filter(kind="certificate")), [certificate])

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_register_outputs_page_records_its_certificate_on_the_operator_connection(self):
        with use_operator():
            member = member_of(self.company, wallet_of("Synthetic Scoped Member", "4 Synthetic Street"))
            entered(self.opening.register, "issue", (member, 5))
            staff = grant(staff_user("scoped-certificates"), admin.site._registry[RegisterOutput], "change")
            self.client.force_login(staff)
        response = self.client.post(
            reverse("admin:tokens_registeroutput_certificate", args=[self.token.pk]),
            {"sequence": 2, "instruction": "SYNTHETIC-INSTRUCTION-4"},
        )
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/pdf"))
        with use_operator():
            record = RegisterExport.objects.get(kind="certificate")
        self.assertEqual(
            (record.requested_by_id, record.digest, record.register_sequence, record.member_rows),
            (staff.pk, hashlib.sha256(response.content).hexdigest(), 2, 1),
        )
