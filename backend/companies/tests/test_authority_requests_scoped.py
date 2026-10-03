from contextlib import ExitStack
from unittest.mock import patch

from django.db import connections
from rest_framework.exceptions import PermissionDenied

from companies.models import Company, CompanyAuthorityRequest
from companies.tests import test_authority_requests as cases
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyAuthorityRequestTest(RunsOnTheScopedConnection, cases.AuthorityRequestApiTest):
    def test_creation_uses_bounded_operator_connection_and_reads_use_the_requester_app_connection(self):
        observed = []

        def record(execute, sql, params, many, context):
            if '"companies_companyauthorityrequest"' in sql:
                observed.append((context["connection"].alias, sql.split()[0]))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record))
            created = self.submit()
            self.assertEqual(created.status_code, 201, created.content)
            self.assertEqual(self.client.get(cases.URL).status_code, 200)
            self.assertEqual(self.client.get(f"{cases.URL}{created.json()['uuid']}/").status_code, 200)
        self.assertIn((OPERATOR_ALIAS, "INSERT"), observed)
        self.assertIn((APP_ALIAS, "SELECT"), observed)
        self.assertNotIn((APP_ALIAS, "INSERT"), observed)
        self.assertEqual(current_alias(), APP_ALIAS)
        self.assertIn(principal_of(OPERATOR_ALIAS), (None, ""))

    def test_public_company_and_staff_visibility_never_grant_request_or_file_access(self):
        created = self.submit()
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(status="active", is_open_to_investors=True)
            self.other.is_staff = True
            self.other.is_superuser = True
            self.other.save(update_fields=["is_staff", "is_superuser"])
        self.signed_in_as(self.other)
        self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
        self.assertFalse(CompanyAuthorityRequest.objects.exists())
        self.assertEqual(self.client.get(cases.URL).json()["results"], [])
        self.assertEqual(self.client.get(created.json()["fileUrl"]).status_code, 404)
        self.assertEqual(self.client.get(f"{cases.URL}{created.json()['uuid']}/").status_code, 404)

    def test_an_inactive_requester_is_rechecked_from_the_locked_database_row(self):
        from django.contrib.auth import get_user_model

        with use_operator():
            get_user_model().objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertTrue(self.user.is_active)
        with self.assertRaises(PermissionDenied):
            self.service_submit()
        with use_operator():
            self.assertFalse(CompanyAuthorityRequest.objects.exists())
        self.assertEqual(self.private_files(), [])

    def test_company_identity_is_frozen_after_validation_at_the_final_locked_read(self):
        from companies.services import authority_requests

        validate = authority_requests.validate_upload

        def change_then_validate(upload):
            with use_operator():
                Company.objects.filter(pk=self.company.pk).update(name="Changed during upload Pty Ltd")
            return validate(upload)

        with patch.object(authority_requests, "validate_upload", side_effect=change_then_validate):
            created = self.submit()
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["companyIdentityRaw"]["name"], "Changed during upload Pty Ltd")

    def test_company_owner_loss_during_validation_is_refused_at_the_final_locked_read(self):
        from companies.services import authority_requests

        validate = authority_requests.validate_upload

        def change_then_validate(upload):
            with use_operator():
                Company.objects.filter(pk=self.company.pk).update(owner=self.other)
            return validate(upload)

        with patch.object(authority_requests, "validate_upload", side_effect=change_then_validate):
            refused = self.submit()
        self.assertEqual(refused.status_code, 404, refused.content)
        self.assertEqual(self.private_files(), [])
