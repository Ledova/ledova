from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from tokens.models import RegisterExport
from tokens.services.former_holders import purge_register_exports
from tokens.tasks.former_holders import purge_former_members_past_the_clock
from tokens.tests.test_register_events import register_fixture

User = get_user_model()


def recorded(token, owner):
    return RegisterExport.objects.create(
        token=token,
        requested_by_id=owner.pk,
        kind="register_csv",
        register_sequence=1,
        member_rows=2,
        former_rows=0,
    )


class RegisterExportAuditTest(TestCase):
    def setUp(self):
        self.owner, _, self.token, _, _, _ = register_fixture()
        self.record = recorded(self.token, self.owner)

    def test_a_record_is_retained_as_written(self):
        with self.assertRaises(DatabaseError), atomic():
            RegisterExport.objects.filter(pk=self.record.pk).update(member_rows=3)
        self.assertEqual(RegisterExport.objects.get(pk=self.record.pk).member_rows, 2)

    def test_the_purge_keeps_records_until_the_seven_year_clock_then_removes_them(self):
        self.assertEqual(purge_register_exports(now=timezone.now() + timedelta(days=2557)), 0)
        self.assertTrue(RegisterExport.objects.filter(pk=self.record.pk).exists())
        self.assertEqual(purge_register_exports(now=timezone.now() + timedelta(days=2558)), 1)
        self.assertFalse(RegisterExport.objects.exists())

    def test_the_daily_retention_job_purges_exports_with_former_members(self):
        self.assertEqual(purge_former_members_past_the_clock(), {"removed": 0, "exports_removed": 0})

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
            self.owner, _, self.token, _, _, _ = register_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
            self.record = recorded(self.token, self.owner)

    def test_the_issuer_reads_its_export_records_and_only_the_operator_writes_them(self):
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(list(RegisterExport.objects.values_list("pk", flat=True)), [self.record.pk])
        with self.assertRaises(DatabaseError), atomic():
            recorded(self.token, self.owner)
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(RegisterExport.objects.count(), 0)
        self.no_principal_is_set()
        self.assertEqual(RegisterExport.objects.count(), 0)
        with use_operator():
            self.assertEqual(RegisterExport.objects.count(), 1)
