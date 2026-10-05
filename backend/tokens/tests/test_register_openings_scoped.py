import time
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterOpeningDecision,
    RegisterWalletLink,
    ShareRegister,
)
from tokens.services.register_events import verify_register
from tokens.services.register_inclusions import (
    classified_inclusions,
    completed_inclusions,
    opening_boundary,
    record_completed_effects,
)
from tokens.services.register_openings import (
    decide_link,
    decide_opening,
    prepare_link_review,
    submit_link,
)
from tokens.services.register_snapshot import capture_snapshot
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_links import link_fixture, link_payload
from tokens.tests.test_register_openings import (
    SETTINGS,
    apply_opening,
    decide,
    opening_fixture,
    opening_payload,
    prepared,
    preview,
    reading,
)


@override_settings(**SETTINGS)
class ScopedRegisterOpeningTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.tenant, self.owner, self.administrator, self.evidence, self.target, self.node = opening_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
        reading(self, self.node)
        self.the_principal_the_middleware_would_set(self.owner)
        self.payload = opening_payload(self.target.token_id, self.evidence, self.administrator)
        self.proposal = prepared(self.owner, self.payload)

    def apply(self, proposal=None):
        return apply_opening(self.owner, self.administrator, proposal or self.proposal)

    def test_the_app_reads_but_only_the_bounded_operator_command_prepares_and_decides(self):
        self.assertEqual(list(RegisterOpening.objects.values_list("pk", flat=True)), [self.proposal.pk])
        self.assertIsNotNone(RegisterOpening.objects.get(pk=self.proposal.pk).boundary)
        for write in (
            lambda: RegisterOpening.objects.filter(pk=self.proposal.pk).update(status="rejected"),
            lambda: RegisterOpening.objects.filter(pk=self.proposal.pk).update(approving_director="Forged"),
            lambda: list(RegisterOpeningDecision.objects.all()),
            self.proposal.delete,
        ):
            with self.assertRaises(DatabaseError), atomic():
                write()
        applied = self.apply()
        self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "applied")
        self.assertEqual(RegisterEntry.objects.get(operation_id=self.proposal.pk).pk, applied.applied_entry_id)
        self.assertEqual(RegisterMemberWallet.objects.count(), 2)
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertFalse(RegisterOpening.objects.filter(pk=self.proposal.pk).exists())
        self.no_principal_is_set()
        self.assertFalse(RegisterOpening.objects.exists())

    def test_the_owner_reads_the_applied_register_and_its_waiting_count_on_the_app_connection(self):
        self.apply()
        self.client.force_authenticate(self.owner)
        path = f"/api/v1/tokens/{self.tenant.token.uuid}/"
        holders = self.client.get(f"{path}holders/")
        export = self.client.get(f"{path}register/export/")
        self.assertEqual((holders.status_code, export.status_code), (200, 200))
        self.assertEqual(
            [holders.json()[key] for key in ("initialized", "issuedSupply", "waitingEffects")], [True, "100", 0]
        )
        self.assertEqual(sorted(row["balance"] for row in holders.json()["holders"]), ["20", "80"])

    def test_the_owner_reads_what_waits_to_be_entered_and_another_issuer_does_not(self):
        self.apply()
        path = f"/api/v1/tokens/{self.tenant.token.uuid}/register/waiting/"
        self.client.force_authenticate(self.owner)
        waiting = self.client.get(path)
        self.assertEqual((waiting.status_code, waiting.json()), (200, {"effects": []}))
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_the_app_role_cannot_capture_boundaries_or_write_wallet_links(self):
        with self.assertRaises(PermissionDenied):
            capture_snapshot(self.tenant.token.pk, client=self.node.client)
        member_id = self.proposal.mapping[0]["member"]
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberWallet.objects.create(
                company_id=self.proposal.company_id, member_id=member_id, address=self.proposal.mapping[0]["address"]
            )
        with use_operator():
            self.assertEqual(RegisterMemberWallet.objects.count(), 0)

    def test_only_the_operator_connection_classifies_inclusions(self):
        for read in (completed_inclusions, opening_boundary, classified_inclusions, record_completed_effects):
            with self.subTest(read=read.__name__), self.assertRaises(PermissionDenied):
                read(self.tenant.token.pk)
        with use_operator():
            self.assertIsNone(opening_boundary(self.tenant.token.pk))
            self.assertEqual(completed_inclusions(self.tenant.token.pk), [])
            self.assertEqual(record_completed_effects(self.tenant.token.pk), [])
            report = classified_inclusions(self.tenant.token.pk)
            self.assertEqual((report["boundary"], report["inclusions"]), (None, []))
        applied = self.apply()
        with use_operator():
            boundary = classified_inclusions(self.tenant.token.pk)["boundary"]
            self.assertEqual(boundary["block"], applied.boundary["block"])
            self.assertEqual(opening_boundary(self.tenant.token.pk), applied.boundary)

    def test_a_failed_application_leaves_the_opening_register_and_decisions_as_they_were(self):
        decide(self.owner, self.administrator, self.proposal, "approve")
        digest = preview(self.owner, self.administrator, self.proposal, "apply")["preview_digest"]
        with patch.object(RegisterOpening, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaisesMessage(RuntimeError, "write failed"):
                decide_opening(
                    actor=self.owner,
                    opening_id=self.proposal.pk,
                    appointment=self.administrator.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=digest,
                    confirmation=True,
                )
        self.assertEqual(RegisterOpening.objects.get(pk=self.proposal.pk).status, "submitted")
        with use_operator():
            self.assertFalse(RegisterEntry.objects.filter(operation_id=self.proposal.pk).exists())
            self.assertFalse(RegisterMemberWallet.objects.exists())
            self.assertFalse(ShareRegister.objects.filter(token=self.tenant.token, sequence__gt=0).exists())
            self.assertEqual(list(RegisterOpeningDecision.objects.values_list("kind", flat=True)), ["approve"])

    def test_the_operator_cannot_truncate_retained_authority(self):
        with use_operator(), self.assertRaises(DatabaseError), atomic(), connections[
            current_alias()
        ].cursor() as cursor:
            cursor.execute("TRUNCATE tokens_registeropening CASCADE")
        self.assertTrue(self.proposal.file.storage.exists(self.proposal.file.name))

    def test_competing_openings_initialise_the_register_exactly_once(self):
        second = prepared(self.owner, {**self.payload, "operation_id": uuid4()})
        digests = {}
        for proposal in (self.proposal, second):
            decide(self.owner, self.administrator, proposal, "approve")
            digests[proposal.pk] = preview(self.owner, self.administrator, proposal, "apply")["preview_digest"]
        reached = Queue()

        def initialise(proposal):
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    try:
                        return decide_opening(
                            actor=self.owner,
                            opening_id=proposal.pk,
                            appointment=self.administrator.pk,
                            kind="apply",
                            idempotency_key=uuid4(),
                            preview_digest=digests[proposal.pk],
                            confirmation=True,
                        ).applied_entry_id
                    except RegisterChangeConflict:
                        return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                Company.objects.select_for_update().get(pk=self.tenant.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker_pid = cursor.fetchone()[0]
                futures = [pool.submit(initialise, proposal) for proposal in (self.proposal, second)]
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


class ScopedRegisterWalletLinkTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, _, self.reviewer, self.document = link_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = submit_link(actor=self.owner, **link_payload(self.company, self.document))

    def test_app_submits_and_reads_but_only_the_operator_reviews_decides_and_links(self):
        self.assertEqual(list(RegisterWalletLink.objects.values_list("pk", flat=True)), [self.proposal.pk])
        with self.assertRaises(PermissionDenied):
            prepare_link_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
        with self.assertRaises(PermissionDenied):
            decide_link(proposal_id=self.proposal.pk, reviewer=self.reviewer, confirmation="", decision="apply")
        for change in ({"status": "rejected", "rejection_reason": "forged"}, {"reason": "forged"}):
            with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                RegisterWalletLink.objects.filter(pk=self.proposal.pk).update(**change)
        with self.assertRaises(DatabaseError), atomic():
            self.proposal.delete()
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(RegisterWalletLink.objects.count(), 0)
        self.no_principal_is_set()
        self.assertEqual(RegisterWalletLink.objects.count(), 0)
        self.the_principal_the_middleware_would_set(self.owner)
        with use_operator():
            _, confirmation = prepare_link_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
            applied = decide_link(
                proposal_id=self.proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        self.assertEqual(applied.status, "applied")
        self.assertEqual(
            list(RegisterMemberWallet.objects.values_list("address", flat=True)),
            [self.proposal.mapping[0]["address"]],
        )
