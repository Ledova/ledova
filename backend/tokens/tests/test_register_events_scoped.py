import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from queue import Queue
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase
from rest_framework.exceptions import PermissionDenied

from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RegisterEntry, RegisterMember, RegisterPosition, ShareRegister
from tokens.services.register_events import create_member, record_entry, verify_register
from tokens.tests.test_register_events import register_fixture


class ScopedRegisterFoundationTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.actor, self.company, self.token, self.member, self.other, self.opening = register_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
            self.register = self.opening.register

    def record(self, operation=None):
        return record_entry(
            register_id=self.register.pk,
            operation_id=operation or uuid4(),
            kind="issue",
            changes=[{"member": str(self.member.pk), "shares": "5"}],
            effective_on=date(2026, 9, 20),
            recorded_by=self.actor,
        )

    def test_issuer_reads_own_register_but_not_another_company_or_unset_principal(self):
        self.the_principal_the_middleware_would_set(self.actor)
        self.assertEqual(list(ShareRegister.objects.values_list("pk", flat=True)), [self.register.pk])
        self.assertEqual(set(RegisterMember.objects.values_list("pk", flat=True)), {self.member.pk, self.other.pk})
        self.assertEqual(list(RegisterEntry.objects.values_list("pk", flat=True)), [self.opening.pk])
        self.assertEqual(list(RegisterPosition.objects.values_list("member_id", flat=True)), [self.member.pk])
        self.the_principal_the_middleware_would_set(self.stranger)
        for model in (ShareRegister, RegisterMember, RegisterEntry, RegisterPosition):
            with self.subTest(model=model.__name__):
                self.assertTrue(model.objects.exists())
                if model is RegisterMember:
                    self.assertFalse(model.objects.filter(pk=self.member.pk).exists())
                elif model is ShareRegister:
                    self.assertFalse(model.objects.filter(pk=self.register.pk).exists())
                else:
                    self.assertFalse(model.objects.filter(register=self.register).exists())
        self.no_principal_is_set()
        for model in (ShareRegister, RegisterMember, RegisterEntry, RegisterPosition):
            self.assertFalse(model.objects.exists())

    def test_app_service_refuses_authority_and_raw_orm_cannot_write(self):
        self.the_principal_the_middleware_would_set(self.actor)
        with self.assertRaises(PermissionDenied):
            self.record()
        with self.assertRaises(PermissionDenied):
            create_member(company_id=self.company.pk, member_id=uuid4())
        with self.assertRaises(PermissionDenied):
            verify_register(self.register.pk)
        with self.assertRaises(DatabaseError), atomic():
            RegisterMember.objects.create(company=self.company)
        with self.assertRaises(DatabaseError), atomic():
            RegisterEntry.objects.create(
                register=self.register,
                operation_id=uuid4(),
                kind="issue",
                changes=[{"member": str(self.member.pk), "shares": "5"}],
                effective_on=date(2026, 9, 20),
                recorded_by=self.actor,
            )
        with self.assertRaises(DatabaseError), atomic():
            RegisterPosition.objects.filter(member=self.member).update(shares=105)
        with use_operator():
            self.record()
            self.assertEqual(verify_register(self.register.pk)["issued_supply"], "105")

    def test_operator_transaction_rolls_back_real_separate_connection(self):
        with self.assertRaisesRegex(RuntimeError, "rollback"), use_operator(), atomic():
            self.record()
            raise RuntimeError("rollback")
        with use_operator():
            self.assertEqual(verify_register(self.register.pk)["issued_supply"], "100")
            self.assertEqual(RegisterEntry.objects.filter(register=self.register).count(), 1)
        self.the_principal_the_middleware_would_set(self.actor)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_operator_cannot_truncate_the_event_history(self):
        with use_operator():
            with self.assertRaises(DatabaseError), atomic(), connections[current_alias()].cursor() as cursor:
                cursor.execute("TRUNCATE tokens_registerentry CASCADE")
            self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def competing_records(self, same_operation):
        waiting = Queue()
        operations = [uuid4(), uuid4()]
        if same_operation:
            operations[1] = operations[0]

        def append(operation):
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        waiting.put(cursor.fetchone())
                    return self.record(operation).pk
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                ShareRegister.objects.select_for_update().get(pk=self.register.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                futures = [pool.submit(append, operation) for operation in operations]
                workers = [waiting.get(timeout=10) for _ in futures]
                self.assertEqual(len({blocker, *(pid for pid, _ in workers)}), 3)
                self.assertEqual({role for _, role in workers}, {settings.RLS_ROLES["operator"]})
                deadline = time.monotonic() + 10
                blocked = False
                while time.monotonic() < deadline:
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT bool_and(cardinality(pg_blocking_pids(pid)) > 0) FROM pg_stat_activity WHERE pid = ANY(%s)",
                            [[pid for pid, _ in workers]],
                        )
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked, "The independent writers did not reach the register lock")
            results = [future.result(timeout=15) for future in futures]
        with use_operator():
            result = verify_register(self.register.pk)
            self.assertEqual(result["entries"], 2 if same_operation else 3)
            self.assertEqual(result["issued_supply"], "105" if same_operation else "110")
        self.assertEqual(len(set(results)), 1 if same_operation else 2)

    def test_separate_postgres_connections_serialize_distinct_appends(self):
        self.competing_records(False)

    def test_separate_postgres_connections_recover_one_idempotent_append(self):
        self.competing_records(True)
