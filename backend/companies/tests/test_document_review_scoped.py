import time
from concurrent.futures import ThreadPoolExecutor
from queue import Queue

from django.conf import settings
from django.db import DatabaseError, connections
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase

from companies.models import Company, CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import (
    attach_file,
    make_company,
    make_document,
)
from companies.tests.test_document_review import review_fixture
from shared.db import atomic, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyDocumentReviewTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.reviewer, self.document = review_fixture()
            self.other, other_company = make_company("scoped-review-other", "456789012")
            self.other_document = attach_file(make_document(other_company))
            _, self.confirmation = prepare_document_review(document_id=self.document.pk, reviewer=self.reviewer)

    def verify(self):
        return verify_document(document_id=self.document.pk, reviewer=self.reviewer, confirmation=self.confirmation)

    def test_app_cannot_verify_through_service_or_raw_verification_writes(self):
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertTrue(CompanyDocument.objects.filter(pk=self.document.pk).exists())
        with self.assertRaises(PermissionDenied):
            self.verify()
        with self.assertRaises(PermissionDenied):
            prepare_document_review(document_id=self.document.pk, reviewer=self.reviewer)
        for change in (
            {"is_verified": True},
            {"verified_fingerprint": "a" * 64},
            {"verified_by_id": self.reviewer.pk},
        ):
            with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                CompanyDocument.objects.filter(pk=self.document.pk).update(**change)
        with self.assertRaises(DatabaseError), atomic():
            CompanyDocument.objects.create(
                company=self.company,
                document_type="other",
                name="Forged",
                file_size=10,
                mime_type="application/pdf",
                is_verified=True,
            )
        with use_operator():
            self.assertTrue(self.verify().is_verified)
        self.assertTrue(CompanyDocument.objects.get(pk=self.document.pk).is_verified)

    def test_metadata_edit_revokes_verification_on_the_real_app_connection(self):
        with use_operator():
            self.verify()
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(CompanyDocument.objects.filter(pk=self.document.pk).update(name="New name"), 1)
        document = CompanyDocument.objects.get(pk=self.document.pk)
        self.assertFalse(document.is_verified)
        self.assertEqual(document.verified_fingerprint, "")
        with use_operator(), self.assertRaises(ValidationError):
            self.verify()

    def test_private_documents_remain_isolated_and_unset_principal_sees_nothing(self):
        self.the_principal_the_middleware_would_set(self.other)
        self.assertEqual(set(CompanyDocument.objects.values_list("pk", flat=True)), {self.other_document.pk})
        self.assertEqual(CompanyDocument.objects.filter(pk=self.document.pk).update(name="Wrong owner"), 0)
        self.no_principal_is_set()
        self.assertFalse(CompanyDocument.objects.exists())
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(set(CompanyDocument.objects.values_list("pk", flat=True)), {self.document.pk})

    def test_operator_verification_rolls_back_on_its_actual_connection(self):
        with self.assertRaises(RuntimeError), use_operator(), atomic():
            self.verify()
            raise RuntimeError("rollback")
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertFalse(CompanyDocument.objects.get(pk=self.document.pk).is_verified)
        with use_operator():
            self.assertTrue(self.verify().is_verified)

    def test_app_company_identity_edit_revokes_the_companys_verified_documents(self):
        with use_operator():
            self.verify()
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(Company.objects.filter(pk=self.company.pk).update(name="New registered name"), 1)
        self.assertFalse(CompanyDocument.objects.get(pk=self.document.pk).is_verified)
        with use_operator(), self.assertRaisesMessage(ValidationError, "changed"):
            self.verify()

    def competing_confirmation(self, company=False):
        reached = Queue()

        def confirm():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    return self.verify()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_operator(), atomic():
                model, pk = (Company, self.company.pk) if company else (CompanyDocument, self.document.pk)
                model.objects.select_for_update().get(pk=pk)
                future = pool.submit(confirm)
                pid, role = reached.get(timeout=10)
                self.assertEqual(role, settings.RLS_ROLES["operator"])
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    self.assertNotEqual(cursor.fetchone()[0], pid)
                deadline = time.monotonic() + 10
                blocked = False
                while time.monotonic() < deadline:
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT cardinality(pg_blocking_pids(%s)) > 0", [pid])
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked, "The verifier did not reach the held row lock")
                model.objects.filter(pk=pk).update(name="Concurrent edit")
            with self.assertRaisesMessage(ValidationError, "changed"):
                future.result(timeout=15)
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertFalse(CompanyDocument.objects.get(pk=self.document.pk).is_verified)

    def test_concurrent_metadata_commit_is_rechecked_after_the_document_lock(self):
        self.competing_confirmation()

    def test_concurrent_company_identity_commit_is_rechecked_after_the_company_lock(self):
        self.competing_confirmation(company=True)
