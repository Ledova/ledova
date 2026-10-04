import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.db.models import ProtectedError
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAuthorityRequest,
    CompanyAuthorityRequestWithdrawal,
)
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
    withdraw_authority_request,
)
from companies.tests.test_authority_requests import (
    PDF,
    STORAGES,
    URL,
    AuthorityRequestCases,
    authority_fixture,
    evidence,
)
from shared.db import (
    atomic,
    current_alias,
    principal_of,
    set_principal,
    use_app,
    use_migrate,
    use_operator,
)
from shared.tests.upload_fixtures import StubUploadDependencies


class CompanyAuthorityRequestWithdrawalTest(StubUploadDependencies, APITransactionTestCase):
    app_as = AuthorityRequestCases.app_as

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("withdrawal", "112233445")
            self.other, self.other_profile, self.other_company = authority_fixture("other-withdrawal", "998877665")
        self.key = uuid4()
        self.proposal, created = self.submit()
        self.assertTrue(created)
        self.url = f"{URL}{self.proposal.pk}/withdraw/"
        self.client.force_authenticate(self.user)

    def submit(self, **changes):
        return submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=changes.pop("idempotency_key", self.key),
            file=changes.pop("file", evidence()),
            requested_capabilities=["admin"],
            **changes,
        )

    def withdraw(self):
        return self.client.post(self.url, {}, format="json")

    def withdrawal(self):
        with use_operator():
            return CompanyAuthorityRequestWithdrawal.objects.get(request=self.proposal)

    def private_files(self):
        return sorted(path for path in self.root.rglob("*") if path.is_file())

    def test_withdrawal_derives_state_and_keeps_original_terms_evidence_and_company_unchanged(self):
        pending = self.client.get(f"{URL}{self.proposal.pk}/").json()
        self.assertEqual((pending["status"], pending["withdrawnAt"]), ("pending", None))
        before = {field.attname: getattr(self.proposal, field.attname) for field in self.proposal._meta.fields}
        response = self.withdraw()
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["status"], body["verificationStatus"]), ("withdrawn", "unavailable"))
        self.assertIsNotNone(body["withdrawnAt"])
        self.assertIn("remain retained and accessible", body["verificationMessage"])
        self.assertNotIn("awaiting", body["verificationMessage"])
        self.assertIn("grants no company authority", body["verificationMessage"])
        recorded = self.withdrawal()
        self.assertEqual(recorded.withdrawn_by_id, self.user.pk)
        self.assertEqual(recorded.request_id, self.proposal.pk)
        self.assertEqual(self.client.get(f"{URL}{self.proposal.pk}/").json(), body)
        self.assertEqual(self.client.get(URL).json()["results"], [body])
        download = self.client.get(body["fileUrl"])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b"".join(download.streaming_content), PDF)
        self.assertEqual(download["Cache-Control"], "private, no-store")
        with use_operator():
            current = CompanyAuthorityRequest.objects.get(pk=self.proposal.pk)
            self.assertEqual({field.attname: getattr(current, field.attname) for field in current._meta.fields}, before)
            self.company.refresh_from_db()
            self.assertEqual(self.company.status, "draft")
            self.profile.refresh_from_db()
            self.assertFalse(self.profile.is_id_verified)
        self.assertEqual(len(self.private_files()), 1)

    def test_repeated_withdrawal_and_original_submission_retry_return_the_withdrawn_record(self):
        first = self.withdraw()
        recorded = self.withdrawal()
        self.assertEqual(self.withdraw().json(), first.json())
        retried = self.client.post(
            URL,
            {
                "company": str(self.company.pk),
                "idempotency_key": str(self.key),
                "requested_capabilities": ["admin"],
                "file": evidence(),
            },
            format="multipart",
        )
        self.assertEqual(retried.status_code, 200, retried.content)
        self.assertEqual(retried.json(), first.json())
        repeated = self.withdrawal()
        self.assertEqual((repeated.pk, repeated.created_at), (recorded.pk, recorded.created_at))
        with use_operator():
            self.assertEqual(CompanyAuthorityRequestWithdrawal.objects.count(), 1)
        self.assertEqual(len(self.private_files()), 1)
        fresh, created = self.submit(idempotency_key=uuid4())
        self.assertTrue(created)
        new = self.client.get(f"{URL}{fresh.pk}/").json()
        self.assertEqual((new["status"], new["withdrawnAt"]), ("pending", None))
        self.assertEqual(self.client.get(f"{URL}{self.proposal.pk}/").json()["status"], "withdrawn")

    def test_empty_object_only_refuses_claimed_actor_scope_state_reason_and_non_object_bodies(self):
        for data in (
            {"withdrawn_by": self.other.pk},
            {"requester": self.other.pk},
            {"company": str(self.other_company.pk)},
            {"requested_capabilities": ["approve"]},
            {"status": "withdrawn"},
            {"verification_status": "verified"},
            {"reason": "mistaken evidence"},
            [],
            "",
        ):
            with self.subTest(data=data):
                response = self.client.post(self.url, data, format="json")
                self.assertEqual(response.status_code, 400, response.content)
        null = self.client.generic("POST", self.url, "null", content_type="application/json")
        self.assertEqual(null.status_code, 400, null.content)
        with use_operator():
            self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())
        self.assertEqual(self.client.post(self.url).status_code, 200)

    def test_original_requester_can_withdraw_after_company_owner_and_status_change(self):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(
                owner=self.other, status="active", is_open_to_investors=True
            )
        self.client.force_authenticate(self.other)
        refused = self.withdraw()
        missing = self.client.post(self.url.replace(str(self.proposal.pk), str(uuid4())), {}, format="json")
        self.assertEqual((refused.status_code, refused.content), (missing.status_code, missing.content))
        self.assertEqual(refused.status_code, 404)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.withdraw().status_code, 200)

    def test_inactive_email_unverified_and_anonymous_accounts_cannot_withdraw(self):
        for field in ("is_active", "is_email_verified"):
            with use_operator():
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
                self.user.refresh_from_db()
            self.assertEqual(self.withdraw().status_code, 403)
            with use_operator():
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})
                self.user.refresh_from_db()
        self.client.force_authenticate(None)
        self.assertEqual(self.withdraw().status_code, 401)
        with use_operator():
            self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())

    def test_app_writes_and_operator_forged_actor_or_principal_cannot_create_a_withdrawal(self):
        with self.app_as(self.user), self.assertRaises(DatabaseError), atomic():
            CompanyAuthorityRequestWithdrawal.objects.create(request=self.proposal, withdrawn_by=self.user)
        for principal, actor in ((self.user, self.other), (self.other, self.other), (self.other, self.user)):
            with self.subTest(principal=principal.pk, actor=actor.pk), use_operator(), _requester_principal(
                principal.pk
            ):
                with self.assertRaises(DatabaseError), atomic():
                    CompanyAuthorityRequestWithdrawal.objects.create(request=self.proposal, withdrawn_by=actor)
                with self.assertRaises(DatabaseError), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "INSERT INTO companies_companyauthorityrequestwithdrawal "
                            "(uuid, request_id, withdrawn_by_id, created_at, updated_at) "
                            "VALUES (%s, %s, %s, statement_timestamp(), statement_timestamp())",
                            [uuid4(), self.proposal.pk, actor.pk],
                        )
        with use_operator():
            self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())

    def test_withdrawal_and_parent_history_refuse_orm_and_sql_updates_or_deletion(self):
        self.assertEqual(self.withdraw().status_code, 200)
        recorded = self.withdrawal()
        with self.app_as(self.user):
            self.assertTrue(CompanyAuthorityRequestWithdrawal.objects.filter(pk=recorded.pk).exists())
            with self.assertRaises(DatabaseError), atomic():
                CompanyAuthorityRequestWithdrawal.objects.filter(pk=recorded.pk).update(withdrawn_by=self.other)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("DELETE FROM companies_companyauthorityrequestwithdrawal WHERE uuid = %s", [recorded.pk])
                self.assertEqual(cursor.rowcount, 0)
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                CompanyAuthorityRequestWithdrawal.objects.filter(pk=recorded.pk).update(withdrawn_by=self.other)
            for statement in (
                "UPDATE companies_companyauthorityrequestwithdrawal SET created_at = created_at WHERE uuid = %s",
                "DELETE FROM companies_companyauthorityrequestwithdrawal WHERE uuid = %s",
            ):
                with self.subTest(statement=statement), self.assertRaises(DatabaseError), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(statement, [recorded.pk])
            with self.assertRaises(DatabaseError), atomic():
                recorded.delete()
            with self.assertRaises(ProtectedError):
                self.proposal.delete()
            self.assertEqual(
                CompanyAuthorityRequestWithdrawal.objects.get(pk=recorded.pk).withdrawn_by_id, self.user.pk
            )
        with self.proposal.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)

    def test_failed_insertion_rolls_back_without_modifying_request_or_evidence(self):
        with patch.object(
            CompanyAuthorityRequestWithdrawal, "save", side_effect=DatabaseError("synthetic insert failure")
        ):
            with self.assertRaises(DatabaseError):
                withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
        with use_operator():
            self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())
            self.assertEqual(
                CompanyAuthorityRequest.objects.get(pk=self.proposal.pk).request_digest, self.proposal.request_digest
            )
        self.assertEqual(len(self.private_files()), 1)
        self.assertEqual(self.withdraw().status_code, 200)

    def test_service_restores_prior_app_and_operator_principals_on_success_and_failure(self):
        with use_app():
            set_principal(self.other.pk)
            app_before = principal_of()
        with use_operator():
            set_principal(self.other.pk)
            operator_before = principal_of()
        withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
        fresh, created = self.submit(idempotency_key=uuid4())
        self.assertTrue(created)
        with patch.object(
            CompanyAuthorityRequestWithdrawal, "save", side_effect=DatabaseError("synthetic insert failure")
        ):
            with self.assertRaises(DatabaseError):
                withdraw_authority_request(requester=self.user, request_id=fresh.pk)
        with use_app():
            self.assertEqual(principal_of(), app_before)
        with use_operator():
            self.assertEqual(principal_of(), operator_before)

    def test_concurrent_withdrawals_keep_one_immutable_outcome(self):
        def withdraw():
            try:
                proposal = withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
                return proposal.withdrawal.pk, proposal.withdrawal.created_at
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = [job.result(timeout=30) for job in (pool.submit(withdraw), pool.submit(withdraw))]
        self.assertEqual(first, second)
        with use_operator():
            self.assertEqual(CompanyAuthorityRequestWithdrawal.objects.count(), 1)
            self.assertEqual(CompanyAuthorityRequest.objects.count(), 1)
        self.assertEqual(len(self.private_files()), 1)

    def test_history_loads_withdrawals_in_the_same_query_for_all_rows(self):
        self.assertEqual(self.withdraw().status_code, 200)
        self.submit(idempotency_key=uuid4())
        self.submit(idempotency_key=uuid4())
        observed = []

        def record(execute, sql, params, many, context):
            if sql.lstrip().startswith("SELECT") and '"companies_companyauthorityrequestwithdrawal"' in sql:
                observed.append(sql)
            return execute(sql, params, many, context)

        with connections[current_alias()].execute_wrapper(record):
            response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["results"]), 3)
        self.assertEqual(len(observed), 1, observed)
        self.assertIn("JOIN", observed[0])
