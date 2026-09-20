import time
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RegisterCorrection, RegisterEntry, ShareRegister
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction_review,
    submit_correction,
)
from tokens.services.register_events import record_entry, verify_register
from tokens.tests.test_register_corrections import (
    correction_fixture,
    correction_payload,
)


class ScopedRegisterCorrectionTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.reviewer, self.document, self.issue = correction_fixture()
            self.stranger, _, _, _ = correction_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = submit_correction(actor=self.owner, **correction_payload(self.document, self.issue))
        with use_operator():
            _, self.confirmation = prepare_correction_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)

    def apply(self):
        return decide_correction(
            proposal_id=self.proposal.pk, reviewer=self.reviewer, confirmation=self.confirmation, decision="apply"
        )

    def test_app_submits_reads_and_cannot_review_or_forge_decisions(self):
        self.assertEqual(list(RegisterCorrection.objects.values_list("pk", flat=True)), [self.proposal.pk])
        with self.assertRaises(PermissionDenied):
            self.apply()
        for change in ({"status": "rejected", "rejection_reason": "forged"}, {"approving_director": "forged"}):
            with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                RegisterCorrection.objects.filter(pk=self.proposal.pk).update(**change)
        with self.assertRaises(DatabaseError), atomic():
            self.proposal.delete()
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertFalse(RegisterCorrection.objects.filter(pk=self.proposal.pk).exists())
        self.no_principal_is_set()
        self.assertFalse(RegisterCorrection.objects.exists())
        with use_operator():
            self.assertEqual(self.apply().status, "applied")

    def test_real_operator_rollback_preserves_submission_and_positions(self):
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            self.apply()
            raise RuntimeError("rollback")
        self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "submitted")
        with use_operator():
            self.assertEqual(verify_register(self.proposal.register_id)["issued_supply"], "105")
            self.assertFalse(RegisterEntry.objects.filter(operation_id=self.proposal.pk).exists())

    def test_operator_cannot_truncate_retained_authority(self):
        with use_operator(), self.assertRaises(DatabaseError), atomic(), connections[
            current_alias()
        ].cursor() as cursor:
            cursor.execute("TRUNCATE tokens_registercorrection CASCADE")
        self.assertTrue(self.proposal.file.storage.exists(self.proposal.file.name))

    def competing_review(self, mutate=False, register_change=False):
        reached = Queue()

        def review():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    try:
                        return self.apply().applied_entry_id
                    except ValidationError:
                        return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                if register_change:
                    ShareRegister.objects.select_for_update().get(pk=self.proposal.register_id)
                else:
                    Company.objects.select_for_update(no_key=True).get(pk=self.proposal.company_id)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                futures = [pool.submit(review) for _ in range(2)]
                workers = [reached.get(timeout=10) for _ in futures]
                self.assertEqual(len({blocker, *(pid for pid, _ in workers)}), 3)
                self.assertEqual({role for _, role in workers}, {settings.RLS_ROLES["operator"]})
                deadline = time.monotonic() + 10
                blocked = False
                while time.monotonic() < deadline:
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT bool_and(cardinality(pg_blocking_pids(pid)) > 0) "
                            "FROM pg_stat_activity WHERE pid = ANY(%s)",
                            [[pid for pid, _ in workers]],
                        )
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked)
                if register_change:
                    record_entry(
                        register_id=self.proposal.register_id,
                        operation_id=uuid4(),
                        kind="issue",
                        changes=self.issue.changes,
                        effective_on=self.issue.effective_on,
                        recorded_by=self.reviewer,
                    )
                if mutate:
                    Company.objects.filter(pk=self.proposal.company_id).update(name="Concurrent identity change")
            results = [future.result(timeout=15) for future in futures]
        with use_operator():
            if mutate or register_change:
                self.assertEqual(results, ["refused", "refused"])
                self.assertEqual(RegisterCorrection.objects.get(pk=self.proposal.pk).status, "submitted")
                self.assertEqual(
                    verify_register(self.proposal.register_id)["issued_supply"], "110" if register_change else "105"
                )
            else:
                self.assertEqual(len(set(results)), 1)
                self.assertEqual(verify_register(self.proposal.register_id)["issued_supply"], "100")
                self.assertEqual(RegisterEntry.objects.filter(operation_id=self.proposal.pk).count(), 1)

    def test_separate_connections_serialize_duplicate_approval(self):
        self.competing_review()

    def test_concurrent_company_change_is_rechecked_after_lock(self):
        self.competing_review(mutate=True)

    def test_concurrent_register_append_invalidates_waiting_approvals(self):
        self.competing_review(register_change=True)
