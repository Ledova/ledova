import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from contextlib import contextmanager
from datetime import timedelta
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import APIException
from rest_framework.test import APITransactionTestCase

from companies.models import Company
from companies.services.authority_requests import _requester_principal
from companies.services.company import transition_company
from documents.models import Document, DocumentExtraction, DocumentRead
from documents.services.document import attach_document
from documents.services.retention import purge_document
from offerings.models import Offering
from offerings.services.offering import transition_offering
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.evidence_retention import installed_evidence_retention_policy
from shared.tests.row_contention import RealRowContention
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.models import ShareToken
from users.models import (
    InvestorCategory,
    InvestorClassification,
    InvestorClassificationStatus,
)
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
)
from users.services.company_eligibility import (
    _stamp,
    decide_eligibility_request,
    eligibility_operation,
    preview_eligibility_decision,
    preview_eligibility_request,
    submit_eligibility_request,
)
from users.services.investor_classification import (
    evidence_operation,
    purge_evidence,
    withdraw_classification,
)
from users.tests import test_company_eligibility_categories as categories
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_requests import CompanyEligibilityCases

logger = logging.getLogger(__name__)
SUPPORTING_PDF = pdf_bytes(width=643)
ELIGIBILITY_LOCK_QUERY = "users_lock_company_eligibility_context"


class CompanyEligibilityContentionTest(
    CompanyEligibilityCases, RealRowContention, StubUploadDependencies, APITransactionTestCase
):
    @contextmanager
    def operator_role(self):
        with use_operator():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role')")
                previous = cursor.fetchone()[0]
                cursor.execute(f"SET ROLE {connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
            try:
                yield
            finally:
                with connection.cursor() as cursor:
                    if previous == "none":
                        cursor.execute("RESET ROLE")
                    else:
                        cursor.execute(f"SET ROLE {connection.ops.quote_name(previous)}")

    def run_command(self, command, started, pids):
        connections.close_all()
        try:
            with self.operator_role():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET lock_timeout = '10s'")
                    cursor.execute("SET statement_timeout = '15s'")
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.append(cursor.fetchone()[0])
                started.set()
                return command()
        finally:
            connections.close_all()

    def wait_for_queued_pid(self, inspection, waiter, blockers, row, *, query=None):
        deadline = monotonic() + 5
        last = None
        while monotonic() < deadline:
            with inspection.cursor() as cursor:
                cursor.execute("SELECT pg_blocking_pids(%s)", [waiter])
                last = cursor.fetchone()[0]
            actual = set(last) & set(blockers)
            if actual:
                self.wait_for_pid(inspection, waiter, min(actual), row=row, query=query)
                return
            sleep(0.01)
        self.fail(f"PID {waiter} did not join the row queue held by {blockers}: {last}")

    def two_waiters(self, first, second, row, *, first_query=None, second_query=None, after_wait=None):
        started = [Event(), Event()]
        pids = [[], []]
        inspection = connections["default"].copy()
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                with use_migrate(), atomic():
                    type(row).objects.select_for_update(no_key=True).get(pk=row.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '5s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    futures = []
                    for index, command in enumerate((first, second)):
                        future = pool.submit(self.run_command, command, started[index], pids[index])
                        futures.append(future)
                        self.assertTrue(started[index].wait(5))
                        try:
                            blockers = [blocker] + [prior[0] for prior in pids[:index]]
                            self.wait_for_queued_pid(
                                inspection,
                                pids[index][0],
                                blockers,
                                row,
                                query=(first_query, second_query)[index],
                            )
                        except AssertionError:
                            if future.done():
                                future.result()
                            raise
                        self.assertFalse(future.done())
                    self.assertEqual(len({blocker, pids[0][0], pids[1][0]}), 3)
                    if after_wait is not None:
                        after_wait()
                return [future.result(timeout=10) for future in futures]
        finally:
            inspection.close()

    def submit_command(self, *, digest=None, key=None, **changes):
        terms = {
            "actor": self.participant,
            "source": self.source.pk,
            "company": self.company.pk,
            "requested_expires_at": self.requested_expiry,
            **changes,
        }
        if digest is None:
            with self.operator_role():
                preview = preview_eligibility_request(**terms)
            self.assertTrue(preview["can_submit"], preview)
            digest = preview["preview_digest"]
        return {
            **terms,
            "preview_digest": digest,
            "idempotency_key": key or self.key,
            "sharing_accepted": True,
            "declaration_accepted": True,
        }

    def submit_result(self, command):
        try:
            proposal, created = submit_eligibility_request(**command)
            return {"status": 201 if created else 200, "request": proposal.pk}
        except APIException as error:
            return {"status": error.status_code, "detail": error.detail}

    def decision_command(self, request, *, expires_at=None):
        terms = {
            "actor": self.approver,
            "request_id": request.pk,
            "company_id": self.company.pk,
            "appointment": self.appointment.pk,
            "outcome": "accepted",
            "expires_at": expires_at or self.requested_expiry,
            "reason": "",
        }
        with self.operator_role():
            preview = preview_eligibility_decision(**terms)
        self.assertTrue(preview["can_decide"], preview)
        return {**terms, "preview_digest": preview["preview_digest"], "idempotency_key": uuid4(), "confirmation": True}

    def decision_result(self, command):
        try:
            proposal = decide_eligibility_request(**command)
            return {"status": 200, "request": proposal.pk}
        except APIException as error:
            return {"status": error.status_code, "detail": error.detail}

    def supporting_document(self, *, attach=False):
        self.client.force_authenticate(self.participant)
        with patch("documents.services.document.extract_document.defer"):
            response = self.client.post(
                "/api/v1/documents/",
                {
                    "file": SimpleUploadedFile(
                        "synthetic-contention-payslip.pdf", SUPPORTING_PDF, content_type="application/pdf"
                    ),
                },
                format="multipart",
            )
        self.assertEqual(response.status_code, 202, response.content)
        with use_operator():
            document = Document.objects.get(pk=response.json()["uuid"])
        if attach:
            with self.operator_role(), _requester_principal(self.participant.pk):
                document = attach_document(document, self.source.pk)
        return document

    def attachment_result(self, document):
        try:
            with _requester_principal(self.participant.pk):
                attached = attach_document(document, self.source.pk)
            return {"status": 200, "document": attached.pk}
        except APIException as error:
            return {"status": error.status_code, "detail": error.detail}

    def installed_retention_days(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT users_classification_evidence_retention_days()")
            days = cursor.fetchone()[0]
        self.assertEqual(days, settings.CLASSIFICATION_EVIDENCE_RETENTION_DAYS)
        return days

    def await_database_expiry(self, expiry):
        deadline = monotonic() + 6
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT transaction_timestamp(), clock_timestamp()")
            transaction_started, before = cursor.fetchone()
            self.assertLess(transaction_started, expiry)
            self.assertLess(before, expiry)
            while monotonic() < deadline:
                cursor.execute("SELECT clock_timestamp()")
                after = cursor.fetchone()[0]
                if after > expiry:
                    logger.info(
                        "Observed real PostgreSQL expiry transaction_started=%s before=%s expires=%s after=%s",
                        transaction_started,
                        before,
                        expiry,
                        after,
                    )
                    return
                sleep(0.01)
        self.fail(f"The real PostgreSQL clock did not pass {expiry}")

    def test_duplicate_request_key_waits_on_company_then_retains_one_durable_effect_after_suspension(self):
        command = self.submit_command()
        results = self.two_waiters(
            lambda: self.submit_result(dict(command)),
            lambda: self.submit_result(dict(command)),
            self.company,
            first_query=ELIGIBILITY_LOCK_QUERY,
            second_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(sorted(result["status"] for result in results), [200, 201])
        self.assertEqual(results[0]["request"], results[1]["request"])
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)
            request = CompanyEligibilityRequest.objects.get(pk=results[0]["request"])
            self.assertEqual(request.digest, command["preview_digest"])
            self.assertEqual(request.submitted_by_id, self.participant.pk)
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            technical, _ = make_investor("eligibility-contention-suspension", staff=True)
        before = self.snapshots()
        suspended = transition_company(
            self.company, "suspend", actor=technical, reason="Synthetic contention suspension"
        )
        self.assertEqual(suspended.status, "suspended")
        with self.operator_role():
            replay = self.submit_result(dict(command))
            changed = self.submit_result({**command, "requested_expires_at": self.requested_expiry + timedelta(days=1)})
        self.assertEqual(replay, {"status": 200, "request": request.pk})
        self.assertEqual(changed["status"], 409)
        self.assertEqual(self.snapshots(), before)

    def test_changed_offering_token_refuses_before_waiting_on_the_same_company_replacement_token(self):
        withdraw_classification(actor=self.participant, classification_id=self.source.pk)
        self.source = self.submit_source(category=InvestorCategory.PRODUCT_VALUE)
        offering = categories.CompanyEligibilityCategoryTest.offering(self)
        replacement_offering = categories.CompanyEligibilityCategoryTest.offering(self, label="REPLACE")
        with use_operator():
            transition_offering(replacement_offering, "close", reason="Synthetic replacement fixture")
            replacement_offering.refresh_from_db()
            self.assertEqual(replacement_offering.status, "closed")
            replacement = replacement_offering.token
        captured_token = offering.token_id
        command = self.submit_command(company=None, offering=offering.pk, quantity=1)
        company_held, release_company, candidate_started = Event(), Event(), Event()
        company_pids, candidate_pids = [], []
        inspection = connections["default"].copy()
        replacement_wait = False

        def replace_token():
            connections.close_all()
            try:
                with use_migrate(), atomic():
                    Company.objects.select_for_update(no_key=True).get(pk=self.company.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        company_pids.append(cursor.fetchone()[0])
                    company_held.set()
                    if not release_company.wait(10):
                        raise AssertionError("The offering replacement Company barrier was not released")
                    Offering.objects.filter(pk=offering.pk).update(token=replacement)
                return "replacement-committed"
            finally:
                connections.close_all()

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                with use_migrate(), atomic():
                    ShareToken.objects.select_for_update(no_key=True).get(pk=replacement.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        replacement_pid = cursor.fetchone()[0]
                    changing = pool.submit(replace_token)
                    self.assertTrue(company_held.wait(5))
                    submitting = pool.submit(
                        self.run_command, lambda: self.submit_result(command), candidate_started, candidate_pids
                    )
                    self.assertTrue(candidate_started.wait(5))
                    self.assertEqual(len({replacement_pid, company_pids[0], candidate_pids[0]}), 3)
                    self.wait_for_pid(
                        inspection, candidate_pids[0], company_pids[0], row=self.company, query=ELIGIBILITY_LOCK_QUERY
                    )
                    release_company.set()
                    self.assertEqual(changing.result(timeout=5), "replacement-committed")
                    with inspection.cursor() as cursor:
                        cursor.execute(
                            "SELECT company_id, token_id FROM offerings_offering WHERE uuid = %s", [offering.pk]
                        )
                        self.assertEqual(cursor.fetchone(), (self.company.pk, replacement.pk))
                    logger.info(
                        "Observed committed offering replacement offering=%s old_token=%s new_token=%s "
                        "company_holder=%s candidate=%s replacement_holder=%s",
                        offering.pk,
                        captured_token,
                        replacement.pk,
                        company_pids[0],
                        candidate_pids[0],
                        replacement_pid,
                    )
                    try:
                        self.assertEqual(submitting.result(timeout=3)["status"], 409)
                    except TimeoutError:
                        self.wait_for_pid(
                            inspection,
                            candidate_pids[0],
                            replacement_pid,
                            row=replacement,
                            query=ELIGIBILITY_LOCK_QUERY,
                        )
                        replacement_wait = True
                    self.assert_row_lock(inspection, replacement, held=True)
                self.assertEqual(submitting.result(timeout=5)["status"], 409)
            with use_operator():
                self.assertFalse(CompanyEligibilityRequest.objects.exists())
                self.assertFalse(CompanyEligibilityDecision.objects.exists())
                self.assertEqual(Offering.objects.get(pk=offering.pk).token_id, replacement.pk)
            self.assertFalse(replacement_wait, "The stale offering refusal waited on its newly named replacement token")
        finally:
            release_company.set()
            inspection.close()

    def test_real_source_expiry_after_company_prefix_wait_refuses_acceptance_without_a_decision(self):
        with use_migrate(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT clock_timestamp() + interval '5 seconds'")
            expiry = cursor.fetchone()[0]
            InvestorClassification.objects.filter(pk=self.source.pk).update(
                status=InvestorClassificationStatus.VERIFIED, expires_at=expiry
            )
        with use_operator():
            self.source.refresh_from_db()
        self.requested_expiry = expiry
        request, _ = self.created_request()
        command = self.decision_command(request)

        def decide():
            with self.operator_role():
                return self.decision_result(command)

        result = self.while_row_is_held(
            decide,
            self.company,
            free=(self.source, request, self.appointment),
            after_wait=lambda: self.await_database_expiry(expiry),
            no_key=True,
            wait_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(result["status"], 400, result)
        self.assertIn("source_expired", result["detail"]["unmet_requirements"])
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertEqual(CompanyEligibilityRequest.objects.get(pk=request.pk).digest, request.digest)
            self.assertTrue(InvestorClassification.objects.get(pk=self.source.pk).evidence_file)

    def test_raw_acceptance_cannot_use_a_forged_clock_after_waiting_past_real_source_expiry(self):
        with use_migrate(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT clock_timestamp() + interval '5 seconds'")
            expiry = cursor.fetchone()[0]
            InvestorClassification.objects.filter(pk=self.source.pk).update(
                status=InvestorClassificationStatus.VERIFIED, expires_at=expiry
            )
        self.requested_expiry = expiry
        request, _ = self.created_request()
        command = self.decision_command(request)

        def raw_decision():
            try:
                with self.operator_role(), eligibility_operation(
                    self.approver,
                    "decide",
                    request=request.pk,
                    company=self.company.pk,
                    appointment=self.appointment.pk,
                    outcome="accepted",
                    expires_at=_stamp(expiry),
                    reason="",
                    preview_digest=command["preview_digest"],
                    idempotency_key=command["idempotency_key"],
                    confirmation=True,
                ):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT transaction_timestamp()")
                        started_at = cursor.fetchone()[0]
                        self.assertLess(started_at, expiry)
                        cursor.execute(
                            "SELECT set_config('app.company_eligibility_now', %s, true)", [started_at.isoformat()]
                        )
                        cursor.execute("SELECT users_lock_company_eligibility_context()")
                        cursor.execute("SELECT clock_timestamp()")
                        self.assertGreater(cursor.fetchone()[0], expiry)
                    CompanyEligibilityDecision.objects.create(
                        request_id=request.pk,
                        decided_by_id=self.approver.pk,
                        appointment_id=self.appointment.pk,
                        idempotency_key=command["idempotency_key"],
                        request_digest=request.digest,
                        digest=command["preview_digest"],
                        outcome="accepted",
                        decided_at=started_at,
                        expires_at=expiry,
                        reason="",
                    )
                return "accepted"
            except DatabaseError as error:
                self.assertEqual(error.__cause__.sqlstate, "23514")
                return "refused"

        result = self.while_row_is_held(
            raw_decision,
            self.company,
            free=(self.source, request, self.appointment),
            after_wait=lambda: self.await_database_expiry(expiry),
            no_key=True,
            wait_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(result, "refused")
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertEqual(CompanyEligibilityRequest.objects.get(pk=request.pk).digest, request.digest)

    def test_first_request_commits_before_waiting_attachment_and_freezes_the_exact_evidence_set(self):
        document = self.supporting_document()
        original_name = document.file.name
        command = self.submit_command()
        created, attached = self.two_waiters(
            lambda: self.submit_result(command),
            lambda: self.attachment_result(document),
            self.source,
            first_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(created["status"], 201, created)
        self.assertEqual(attached["status"], 400, attached)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)
            request = CompanyEligibilityRequest.objects.get(pk=created["request"])
            self.assertEqual(request.digest, command["preview_digest"])
            document.refresh_from_db()
            self.assertIsNone(document.classification_id)
            self.assertIsNone(document.attached_at)
            self.assertEqual(document.file.name, original_name)
            self.assertEqual(self.source.supporting_documents.count(), 0)
            with document.file.storage.open(document.file.name, "rb") as retained:
                self.assertEqual(retained.read(), SUPPORTING_PDF)

    def test_attachment_commits_before_waiting_request_and_requires_a_new_evidence_confirmation(self):
        document = self.supporting_document()
        command = self.submit_command()
        attached, stale = self.two_waiters(
            lambda: self.attachment_result(document),
            lambda: self.submit_result(command),
            self.source,
            second_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(attached, {"status": 200, "document": document.pk})
        self.assertEqual(stale["status"], 409, stale)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())
            document.refresh_from_db()
            self.assertEqual(document.classification_id, self.source.pk)
            self.assertIsNotNone(document.attached_at)
        fresh = self.submit_command()
        self.assertNotEqual(fresh["preview_digest"], command["preview_digest"])
        with self.operator_role():
            created = self.submit_result(fresh)
        self.assertEqual(created["status"], 201, created)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)
            self.assertEqual(
                CompanyEligibilityRequest.objects.get(pk=created["request"]).digest, fresh["preview_digest"]
            )

    def test_primary_purge_waits_for_acceptance_and_keeps_current_evidence_under_the_installed_policy(self):
        request, _ = self.created_request()
        command = self.decision_command(request)
        before_name = self.source.evidence_file.name
        accepted, purged = self.two_waiters(
            lambda: self.decision_result(command),
            lambda: purge_evidence(self.source),
            self.source,
            first_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(accepted, {"status": 200, "request": request.pk})
        self.assertFalse(purged)
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.evidence_file.name, before_name)
            self.assertTrue(self.source.evidence_file.storage.exists(before_name))
            self.assertEqual(CompanyEligibilityDecision.objects.get(request=request).outcome, "accepted")

    def test_supporting_purge_waits_for_acceptance_and_keeps_current_extraction_and_audit(self):
        document = self.supporting_document(attach=True)
        with use_operator():
            extraction = DocumentExtraction.objects.create(
                document=document, status="succeeded", raw_output="Synthetic"
            )
            audit = DocumentRead.objects.create(
                actor_id=self.participant.pk, document_uuid=document.pk, classification_uuid=self.source.pk, kind="file"
            )
        request, _ = self.created_request()
        command = self.decision_command(request)
        accepted, purged = self.two_waiters(
            lambda: self.decision_result(command),
            lambda: purge_document(document.pk, timezone.now() + timedelta(days=36500)),
            self.source,
            first_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertEqual(accepted, {"status": 200, "request": request.pk})
        self.assertFalse(purged)
        with use_operator():
            document.refresh_from_db()
            self.assertIsNone(document.purged_at)
            self.assertTrue(document.file.storage.exists(document.file.name))
            self.assertTrue(DocumentExtraction.objects.filter(pk=extraction.pk).exists())
            self.assertTrue(DocumentRead.objects.filter(pk=audit.pk).exists())
            self.assertEqual(CompanyEligibilityDecision.objects.get(request=request).outcome, "accepted")

    def past_horizon_fixture(self):
        days = self.installed_retention_days()
        self.assertGreater(days, 0)
        with use_migrate():
            InvestorClassification.objects.filter(pk=self.source.pk).update(
                status=InvestorClassificationStatus.VERIFIED, expires_at=timezone.now() - timedelta(days=days + 1)
            )
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT users_classification_evidence_purge_due(%s)", [self.source.pk])
            self.assertTrue(cursor.fetchone()[0])

    def test_actual_primary_retention_horizon_allows_purge_and_refuses_waiting_acceptance(self):
        request, _ = self.created_request()
        command = self.decision_command(request)
        before = self.snapshots()
        before_name = self.source.evidence_file.name
        self.past_horizon_fixture()
        purged, refused = self.two_waiters(
            lambda: purge_evidence(self.source),
            lambda: self.decision_result(command),
            self.source,
            second_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertTrue(purged)
        self.assertEqual(refused["status"], 400, refused)
        self.assertIn("source_evidence_unavailable", refused["detail"]["unmet_requirements"])
        with use_operator():
            self.source.refresh_from_db()
            self.assertFalse(self.source.evidence_file)
            self.assertFalse(self.source.evidence_file.storage.exists(before_name))
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        self.assertEqual(self.snapshots(), before)

    def test_actual_supporting_retention_horizon_purges_extraction_but_retains_request_link_and_audit(self):
        document = self.supporting_document(attach=True)
        with use_operator():
            extraction = DocumentExtraction.objects.create(
                document=document, status="succeeded", raw_output="Synthetic private retained extraction"
            )
            audit = DocumentRead.objects.create(
                actor_id=self.participant.pk, document_uuid=document.pk, classification_uuid=self.source.pk, kind="file"
            )
        request, _ = self.created_request()
        command = self.decision_command(request)
        before = self.snapshots()
        before_name = document.file.name
        self.past_horizon_fixture()
        purged, refused = self.two_waiters(
            lambda: purge_document(document.pk, timezone.now()),
            lambda: self.decision_result(command),
            self.source,
            second_query=ELIGIBILITY_LOCK_QUERY,
        )
        self.assertTrue(purged)
        self.assertEqual(refused["status"], 400, refused)
        self.assertIn("source_evidence_unavailable", refused["detail"]["unmet_requirements"])
        with use_operator():
            document.refresh_from_db()
            self.assertIsNotNone(document.purged_at)
            self.assertFalse(document.file)
            self.assertFalse(document.file.storage.exists(before_name))
            self.assertEqual(document.classification_id, self.source.pk)
            self.assertFalse(DocumentExtraction.objects.filter(pk=extraction.pk).exists())
            self.assertTrue(DocumentRead.objects.filter(pk=audit.pk).exists())
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        self.assertEqual(self.snapshots(), before)

    def test_raw_purge_cannot_forge_a_future_clock_or_shorter_days_before_the_installed_horizon(self):
        document = self.supporting_document(attach=True)
        days = self.installed_retention_days()
        self.assertGreater(days, 0)
        with use_migrate():
            InvestorClassification.objects.filter(pk=self.source.pk).update(
                status=InvestorClassificationStatus.VERIFIED, expires_at=timezone.now() - timedelta(days=days / 2)
            )
        source_name, document_name = self.source.evidence_file.name, document.file.name
        future = timezone.now() + timedelta(days=36500)
        for operation, identifier in (("purge_classification", self.source.pk), ("purge_document", document.pk)):
            with self.subTest(operation=operation):
                with self.assertRaises(DatabaseError) as rejected:
                    with self.operator_role(), evidence_operation(
                        operation, source_id=self.source.pk, document_id=document.pk
                    ), atomic():
                        with connections[current_alias()].cursor() as cursor:
                            for name, value in (
                                ("app.classification_evidence_retention_days", "1"),
                                ("app.unattached_document_retention_days", "1"),
                                ("app.classification_evidence_now", future.isoformat()),
                                ("app.document_evidence_now", future.isoformat()),
                            ):
                                cursor.execute("SELECT set_config(%s, %s, true)", [name, value])
                            cursor.execute(
                                "SELECT users_classification_evidence_retention_days(), "
                                "users_classification_evidence_purge_due(%s), documents_evidence_purge_due(%s)",
                                [self.source.pk, document.pk],
                            )
                            self.assertEqual(cursor.fetchone(), (days, False, False))
                            if operation == "purge_classification":
                                cursor.execute(
                                    "UPDATE users_investorclassification SET evidence_file = NULL, updated_at = %s "
                                    "WHERE uuid = %s",
                                    [future, identifier],
                                )
                            else:
                                cursor.execute(
                                    "UPDATE documents SET file = '', original_filename = '', note = '', "
                                    "mime_type = '', purged_at = %s, updated_at = %s WHERE uuid = %s",
                                    [future, future, identifier],
                                )
                self.assertEqual(rejected.exception.__cause__.sqlstate, "23514")
        with use_operator():
            self.source.refresh_from_db()
            document.refresh_from_db()
            self.assertEqual(self.source.evidence_file.name, source_name)
            self.assertEqual(document.file.name, document_name)
            self.assertIsNone(document.purged_at)
            self.assertTrue(self.source.evidence_file.storage.exists(source_name))
            self.assertTrue(document.file.storage.exists(document_name))

    @override_settings(CLASSIFICATION_EVIDENCE_RETENTION_DAYS=0, UNATTACHED_DOCUMENT_RETENTION_DAYS=0)
    def test_installed_zero_retention_keeps_real_primary_and_supporting_bytes_without_restoring_expired_eligibility(
        self,
    ):
        with installed_evidence_retention_policy():
            self.assertEqual(self.installed_retention_days(), 0)
            document = self.supporting_document(attach=True)
            request, _ = self.created_request()
            command = self.decision_command(request)
            with use_migrate():
                InvestorClassification.objects.filter(pk=self.source.pk).update(
                    status=InvestorClassificationStatus.VERIFIED, expires_at=timezone.now() - timedelta(days=3650)
                )
            source_name, document_name = self.source.evidence_file.name, document.file.name
            primary, refused = self.two_waiters(
                lambda: purge_evidence(self.source),
                lambda: self.decision_result(command),
                self.source,
                second_query=ELIGIBILITY_LOCK_QUERY,
            )
            self.assertFalse(primary)
            self.assertEqual(refused["status"], 400, refused)
            self.assertIn("source_expired", refused["detail"]["unmet_requirements"])
            with self.operator_role():
                self.assertFalse(purge_document(document.pk, timezone.now() + timedelta(days=36500)))
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "SELECT users_classification_evidence_purge_due(%s), documents_evidence_purge_due(%s)",
                        [self.source.pk, document.pk],
                    )
                    self.assertEqual(cursor.fetchone(), (False, False))
            with use_operator():
                self.source.refresh_from_db()
                document.refresh_from_db()
                self.assertEqual(self.source.evidence_file.name, source_name)
                self.assertEqual(document.file.name, document_name)
                self.assertIsNone(document.purged_at)
                self.assertTrue(self.source.evidence_file.storage.exists(source_name))
                self.assertTrue(document.file.storage.exists(document_name))
                self.assertFalse(CompanyEligibilityDecision.objects.exists())
