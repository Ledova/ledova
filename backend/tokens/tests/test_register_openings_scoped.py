import time
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from queue import Queue
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import override_settings
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import (
    RegisterEntry,
    RegisterMemberWallet,
    RegisterOpening,
    ShareRegister,
)
from tokens.services.register_events import verify_register
from tokens.services.register_inclusions import (
    classified_inclusions,
    completed_inclusions,
    opening_boundary,
)
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
    submit_opening,
)
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_openings import (
    SETTINGS,
    opening_fixture,
    opening_payload,
)


@override_settings(**SETTINGS)
class ScopedRegisterOpeningTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.tenant, self.owner, self.reviewer, self.document, self.target, self.node = opening_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = submit_opening(actor=self.owner, **opening_payload(self.document, self.target))
        with use_operator():
            _, self.confirmation = prepare_opening_review(
                proposal_id=self.proposal.pk, reviewer=self.reviewer, client=self.node.client
            )

    def apply(self, proposal=None, confirmation=None):
        return decide_opening(
            proposal_id=(proposal or self.proposal).pk,
            reviewer=self.reviewer,
            confirmation=confirmation or self.confirmation,
            decision="apply",
            client=self.node.client,
        )

    def test_app_submits_reads_and_cannot_review_or_forge_decisions(self):
        self.assertEqual(list(RegisterOpening.objects.values_list("pk", flat=True)), [self.proposal.pk])
        self.assertIsNotNone(RegisterOpening.objects.get(pk=self.proposal.pk).boundary)
        with self.assertRaises(PermissionDenied):
            self.apply()
        for change in ({"status": "rejected", "rejection_reason": "forged"}, {"approving_director": "forged"}):
            with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                RegisterOpening.objects.filter(pk=self.proposal.pk).update(**change)
        with self.assertRaises(DatabaseError), atomic():
            self.proposal.delete()
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(RegisterOpening.objects.count(), 0)
        self.no_principal_is_set()
        self.assertEqual(RegisterOpening.objects.count(), 0)
        self.the_principal_the_middleware_would_set(self.owner)
        with use_operator():
            self.assertEqual(self.apply().status, "applied")
        self.assertEqual(RegisterMemberWallet.objects.count(), 2)
        self.assertEqual(RegisterEntry.objects.filter(kind="opening").count(), 1)

    def test_app_role_cannot_capture_boundaries_or_write_wallet_links(self):
        with self.assertRaises(PermissionDenied):
            prepare_opening_review(proposal_id=self.proposal.pk, reviewer=self.reviewer, client=self.node.client)
        member_id = self.proposal.mapping[0]["member"]
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberWallet.objects.create(
                company_id=self.proposal.company_id, member_id=member_id, address=self.proposal.mapping[0]["address"]
            )
        with use_operator():
            self.assertEqual(RegisterMemberWallet.objects.count(), 0)

    def test_operator_boundary_guard_refuses_missing_provenance_and_null_quantities(self):
        boundary = RegisterOpening.objects.get(pk=self.proposal.pk).boundary
        malformed = deepcopy(boundary)
        malformed["holdings"][0]["shares"] = None
        malformed["issued_supply"] = "20"
        missing_provenance = deepcopy(boundary)
        del missing_provenance["deployment"]
        for value in (malformed, missing_provenance):
            proposal = submit_opening(actor=self.owner, **opening_payload(self.document, self.target))
            with self.subTest(boundary=value), use_operator():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
                with self.assertRaises(DatabaseError), atomic():
                    RegisterOpening.objects.filter(pk=proposal.pk).update(boundary=value)
            self.assertIsNone(RegisterOpening.objects.get(pk=proposal.pk).boundary)
        with use_operator():
            self.assertEqual(self.apply().status, "applied")

    def test_operator_boundary_guard_refuses_a_missing_or_inconsistent_transfer_history(self):
        boundary = RegisterOpening.objects.get(pk=self.proposal.pk).boundary
        self.assertTrue(boundary["history"])
        entry = boundary["history"][0]
        deployment = {"block": boundary["deployment_block"], "block_hash": boundary["deployment_hash"]}
        absent = {key: value for key, value in boundary.items() if key != "history"}
        refusals = (
            absent,
            {**boundary, "history": {}},
            {**boundary, "history": [{key: value for key, value in entry.items() if key != "transaction"}]},
            {**boundary, "history": [{**entry, "transaction": "0xnope"}]},
            {**boundary, "history": [{**entry, "block": boundary["block"]["number"] + 1}]},
            {**boundary, "history": [entry, {**entry, "block_hash": "0x" + "ee" * 32}]},
            {**boundary, "history": [entry, entry]},
            {**boundary, "history": [{**item, "block_hash": "0x" + "ee" * 32} for item in boundary["history"]]},
            {**boundary, "history": [*boundary["history"], {**entry, **deployment, "block_hash": "0x" + "dd" * 32}]},
        )
        for value in refusals:
            proposal = submit_opening(actor=self.owner, **opening_payload(self.document, self.target))
            with self.subTest(history=value.get("history")):
                with use_operator(), self.assertRaises(DatabaseError), atomic():
                    RegisterOpening.objects.filter(pk=proposal.pk).update(boundary=value)
                self.assertIsNone(RegisterOpening.objects.get(pk=proposal.pk).boundary)
        anchored = {**boundary, "history": [*boundary["history"], {**entry, **deployment}]}
        proposal = submit_opening(actor=self.owner, **opening_payload(self.document, self.target))
        with use_operator():
            RegisterOpening.objects.filter(pk=proposal.pk).update(boundary=anchored)
            self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).boundary["history"], anchored["history"])
            self.assertEqual(self.apply().status, "applied")

    def test_only_the_operator_connection_classifies_inclusions(self):
        for read in (completed_inclusions, opening_boundary, classified_inclusions):
            with self.subTest(read=read.__name__), self.assertRaises(PermissionDenied):
                read(self.tenant.token.pk)
        with use_operator():
            self.assertIsNone(opening_boundary(self.tenant.token.pk))
            self.assertEqual(completed_inclusions(self.tenant.token.pk), [])
            report = classified_inclusions(self.tenant.token.pk)
            self.assertEqual((report["boundary"], report["inclusions"]), (None, []))
            applied = self.apply()
            boundary = classified_inclusions(self.tenant.token.pk)["boundary"]
            self.assertEqual(boundary["block"], applied.boundary["block"])
            self.assertEqual(opening_boundary(self.tenant.token.pk), applied.boundary)

    def test_real_operator_rollback_preserves_submission_and_initializes_nothing(self):
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            self.apply()
            raise RuntimeError("rollback")
        self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "submitted")
        self.assertFalse(RegisterEntry.objects.filter(operation_id=self.proposal.pk).exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())
        self.assertFalse(ShareRegister.objects.filter(token=self.tenant.token, sequence__gt=0).exists())

    def test_operator_cannot_truncate_retained_authority(self):
        with use_operator(), self.assertRaises(DatabaseError), atomic(), connections[
            current_alias()
        ].cursor() as cursor:
            cursor.execute("TRUNCATE tokens_registeropening CASCADE")
        self.assertTrue(self.proposal.file.storage.exists(self.proposal.file.name))

    def competing_initialization(self):
        second = submit_opening(actor=self.owner, **opening_payload(self.document, self.target, operation_id=uuid4()))
        confirmations = {}
        with use_operator():
            confirmations[self.proposal.pk] = self.confirmation
            confirmations[second.pk] = prepare_opening_review(
                proposal_id=second.pk, reviewer=self.reviewer, client=self.node.client
            )[1]
        reached = Queue()

        def initialize(proposal):
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    try:
                        return self.apply(proposal, confirmations[proposal.pk]).applied_entry_id
                    except ValidationError:
                        return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                ShareRegister.objects.get_or_create(
                    token=self.tenant.token, defaults={"company_id": self.tenant.company.pk}
                )
                blocker = ShareRegister.objects.select_for_update().get(token=self.tenant.token)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker_pid = cursor.fetchone()[0]
                futures = [pool.submit(initialize, proposal) for proposal in (self.proposal, second)]
                workers = [reached.get(timeout=10) for _ in futures]
                self.assertEqual(len({blocker_pid, *(pid for pid, _ in workers)}), 3)
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
                self.assertIsNotNone(blocker)
            results = [future.result(timeout=15) for future in futures]
        with use_operator():
            self.assertEqual(sorted(result == "refused" for result in results), [False, True])
            register = ShareRegister.objects.get(token=self.tenant.token)
            self.assertEqual(RegisterEntry.objects.filter(register=register).count(), 1)
            self.assertEqual(verify_register(register.pk)["issued_supply"], "100")
            applied = RegisterOpening.objects.get(status="applied")
            refused = RegisterOpening.objects.get(status="submitted")
            self.assertIn(refused.pk, {self.proposal.pk, second.pk})
            self.assertNotEqual(applied.pk, refused.pk)

    def test_competing_openings_initialize_the_register_exactly_once(self):
        self.competing_initialization()
