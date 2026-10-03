from contextlib import ExitStack

from django.contrib.auth import get_user_model
from django.db import connections
from rest_framework.exceptions import PermissionDenied

from companies.models import CompanyAuthorityRequestWithdrawal
from companies.services.authority_requests import withdraw_authority_request
from companies.tests import test_authority_request_withdrawal as cases
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyAuthorityRequestWithdrawalTest(
    RunsOnTheScopedConnection, cases.CompanyAuthorityRequestWithdrawalTest
):
    def test_scoped_withdrawal_uses_bounded_operator_insert_and_requester_app_reads(self):
        observed = []

        def record(execute, sql, params, many, context):
            if '"companies_companyauthorityrequestwithdrawal"' in sql:
                observed.append((context["connection"].alias, sql.split()[0]))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record))
            self.assertEqual(self.withdraw().status_code, 200)
            self.assertEqual(self.client.get(self.url.replace("withdraw/", "")).status_code, 200)
        self.assertIn((OPERATOR_ALIAS, "INSERT"), observed)
        self.assertIn((APP_ALIAS, "SELECT"), observed)
        self.assertNotIn((APP_ALIAS, "INSERT"), observed)
        self.assertEqual(current_alias(), APP_ALIAS)
        self.assertIn(principal_of(OPERATOR_ALIAS), (None, ""))

    def test_stale_active_or_email_verified_actor_is_rechecked_from_the_locked_row(self):
        for field in ("is_active", "is_email_verified"):
            with use_operator():
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
            self.assertTrue(getattr(self.user, field))
            with self.assertRaises(PermissionDenied):
                withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
            with use_operator():
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})
                self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())
