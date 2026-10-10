from contextlib import ExitStack

from django.db import connections
from rest_framework.test import APITransactionTestCase

from shared.db import APP_ALIAS, OPERATOR_ALIAS, current_alias, principal_of
from shared.tests.scoped import RunsOnTheScopedConnection
from users.models import InvestorClassification
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
)
from users.tests import test_company_eligibility_requests as requests


class ScopedCompanyEligibilityRequestTest(
    RunsOnTheScopedConnection, requests.CompanyEligibilityRequestFixtures, APITransactionTestCase
):
    def test_company_policy_reads_shared_records_without_joining_the_private_source(self):
        request, decision, _ = self.accepted_request()
        with self.app_as(self.approver):
            self.assertEqual(list(CompanyEligibilityRequest.objects.values_list("pk", flat=True)), [request.pk])
            self.assertEqual(list(CompanyEligibilityDecision.objects.values_list("pk", flat=True)), [decision.pk])
            self.assertFalse(InvestorClassification.objects.filter(pk=self.source.pk).exists())
        with self.app_as(self.other):
            self.assertFalse(CompanyEligibilityRequest.objects.exists())
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
        with self.app_as(self.participant):
            self.assertTrue(CompanyEligibilityRequest.objects.filter(pk=request.pk).exists())
            self.assertTrue(InvestorClassification.objects.filter(pk=self.source.pk).exists())

    def test_bounded_operator_writes_app_reads_and_principal_restoration(self):
        recorded = []

        def record(execute, sql, params, many, context):
            if any(f'"users_{table}"' in sql for table in ("companyeligibilityrequest", "companyeligibilitydecision")):
                recorded.append((context["connection"].alias, sql.split()[0]))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record))
            request, _ = self.created_request()
            self.client.force_authenticate(self.approver)
            self.assertEqual(self.decide(request).status_code, 200)
            self.assertEqual(self.client.get(self.company_url(request)).status_code, 200)
        self.assertIn((OPERATOR_ALIAS, "INSERT"), recorded)
        self.assertIn((APP_ALIAS, "SELECT"), recorded)
        self.assertNotIn((APP_ALIAS, "INSERT"), recorded)
        self.assertEqual(current_alias(), APP_ALIAS)
        self.assertIn(principal_of(OPERATOR_ALIAS), (None, ""))
