from contextlib import ExitStack

from django.db import DatabaseError, connections
from rest_framework.test import APITransactionTestCase

from companies.tests import test_company_activation as cases
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    atomic,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedCompanyActivationTest(RunsOnTheScopedConnection, cases.CompanyActivationFixtures, APITransactionTestCase):
    def test_exact_activation_uses_operator_effects_and_restores_the_app_context(self):
        observed = []

        def record(execute, sql, params, many, context):
            if any(f'"companies_{table}"' in sql for table in ("company", "companyregistrycheck")):
                observed.append((context["connection"].alias, sql.split()[0]))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record))
            applied = self.activate()
            replayed = self.activate()
        self.assertEqual(applied.status_code, 200, applied.content)
        self.assertEqual(replayed.status_code, 200, replayed.content)
        self.provider.assert_called_once()
        self.assertIn((OPERATOR_ALIAS, "UPDATE"), observed)
        self.assertNotIn((APP_ALIAS, "UPDATE"), observed)
        self.assertEqual(current_alias(), APP_ALIAS)
        self.assertIn(principal_of(OPERATOR_ALIAS), (None, ""))
        with use_operator():
            company = cases.Company.objects.get(pk=self.company.pk)
            receipt = cases.CompanyRegistryCheck.objects.get(idempotency_key=self.key)
            self.assertEqual(company.status, "active")
            self.assertEqual(company.activated_at, receipt.applied_at)
            self.assertEqual(receipt.initiated_by_id, self.user.pk)
        self.the_principal_the_middleware_would_set(self.user)
        with self.assertRaises(DatabaseError), atomic():
            cases.Company.objects.filter(pk=self.company.pk).update(status="draft")
