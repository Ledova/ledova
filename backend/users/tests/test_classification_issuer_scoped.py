from contextlib import ExitStack
from uuid import uuid4

from django.conf import settings
from django.db import connections
from rest_framework.test import APITransactionTestCase

from companies.models import Company, CompanyStatus, CompanyType
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import InvestorCategory, InvestorClassification
from users.services.classification_issuer import active_issuer_for_claim
from users.tests.factories import make_investor
from users.tests.test_investor_classification_api import BASE, _pdf


class ScopedClassificationIssuerTest(RunsOnTheScopedConnection, StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.user, self.account = make_investor("claimant")
            owner, _ = make_investor("unlisted-issuer")
            self.company = Company.objects.create(
                owner=owner,
                name="Unlisted Active Issuer",
                company_type=CompanyType.PROPRIETARY,
                acn="555666777",
                status=CompanyStatus.ACTIVE,
            )
        self.client.force_authenticate(self.user)
        self.statements = []

    def record_sql(self, execute, sql, params, many, context):
        if 'FROM "companies_company"' in sql or 'INSERT INTO "users_investorclassification"' in sql:
            connection = context["connection"]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            self.statements.append((connection.alias, role, sql, params))
        return execute(sql, params, many, context)

    def submit(self, company):
        return self.client.post(
            BASE,
            {
                "category": InvestorCategory.ASSOCIATED_PERSON,
                "company": str(company),
                "declaration_accepted": "true",
                "declared_basis": "Associated with this issuer",
                "evidence_file": _pdf(),
            },
            format="multipart",
        )

    def test_a_hidden_active_issuer_is_validated_by_uuid_and_the_claim_is_written_as_the_app(self):
        with acting_for(self.user.pk):
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(self.record_sql))
            response = self.submit(self.company.pk)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["company"], str(self.company.pk))
        operator_reads = [row for row in self.statements if row[0] == OPERATOR_ALIAS]
        self.assertEqual(len(operator_reads), 1)
        _, role, sql, params = operator_reads[0]
        self.assertEqual(role, settings.RLS_ROLES[OPERATOR_ALIAS])
        self.assertTrue(sql.startswith('SELECT "companies_company"."uuid" FROM '), sql)
        self.assertIn(self.company.pk, params)
        self.assertIn(CompanyStatus.ACTIVE, params)
        self.assertTrue(any(alias == APP_ALIAS and sql.startswith("INSERT") for alias, _, sql, _ in self.statements))
        with acting_for(self.user.pk):
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
            self.assertEqual(InvestorClassification.objects.get(pk=response.json()["uuid"]).company_id, self.company.pk)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def test_inactive_unknown_and_malformed_issuers_are_refused_before_an_active_issuer_succeeds(self):
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(status=CompanyStatus.DRAFT)
        for company in (self.company.pk, uuid4(), "not-a-uuid"):
            with self.subTest(company=company):
                self.assertEqual(self.submit(company).status_code, 400)
        with use_operator():
            self.assertFalse(InvestorClassification.objects.filter(user_account=self.account).exists())
            Company.objects.filter(pk=self.company.pk).update(status=CompanyStatus.ACTIVE)
        self.assertEqual(self.submit(self.company.pk).status_code, 201)

    def test_the_lookup_requires_an_authenticated_applicant_and_restores_their_context(self):
        with acting_for(self.user.pk):
            self.assertIsNone(active_issuer_for_claim(None, self.company.pk))
            self.assertIsNone(active_issuer_for_claim(self.user, uuid4()))
            company = active_issuer_for_claim(self.user, self.company.pk)
            self.assertEqual(company.pk, self.company.pk)
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.user.pk))
