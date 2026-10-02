from contextlib import ExitStack
from uuid import UUID, uuid4

from django.conf import settings
from django.db import connections
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyDocument
from offerings.models import OfferingStatus
from offerings.tests.test_directory_documents import (
    MEMORANDUM,
    documents_of,
    file_of,
    offer_document,
    publish,
    streamed,
)
from shared.db import APP_ALIAS, OPERATOR_ALIAS, acting_for, principal_of, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_eligible, make_tenant, open_to_investors


class ScopedDirectoryDocumentsTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.reader = make_tenant("scoped-doc-reader")
            self.issuer = make_tenant("scoped-doc-issuer")
            make_eligible(self.reader)
            open_to_investors(self.issuer)
            publish(self.issuer.offering)
            self.memorandum = offer_document(self.issuer.company)
            self.unattached = offer_document(self.issuer.company, name="Board minutes")
            self.issuer.offering.documents.add(self.memorandum)
        self.token = self.issuer.deployed_token
        self.client.force_authenticate(self.reader.user)
        self.statements = []

    def record_sql(self, execute, sql, params, many, context):
        if 'FROM "companies_companydocument"' in sql:
            connection = context["connection"]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            self.statements.append((connection.alias, role, params))
        return execute(sql, params, many, context)

    def recorded(self, path):
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(self.record_sql))
            return self.client.get(path)

    def test_the_listing_reads_the_documents_once_on_the_operator_bounded_to_the_published_offering(self):
        response = self.recorded(documents_of(self.token))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([row["uuid"] for row in response.json()], [str(self.memorandum.uuid)])
        self.assertEqual(len(self.statements), 1)
        alias, role, params = self.statements[0]
        self.assertEqual((alias, role), (OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS]))
        self.assertEqual(
            {str(value) for value in params if isinstance(value, UUID)},
            {str(self.issuer.offering.pk), str(self.issuer.company.pk)},
        )
        with acting_for(self.reader.user.pk):
            self.assertFalse(CompanyDocument.objects.filter(pk=self.memorandum.pk).exists())
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def test_the_file_streams_through_the_same_bounded_read(self):
        response = self.recorded(file_of(self.token, self.memorandum))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(streamed(response), MEMORANDUM)
        self.assertEqual(
            [(alias, role) for alias, role, _ in self.statements],
            [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS])],
        )
        self.assertEqual(self.recorded(file_of(self.token, self.unattached)).status_code, 404)

    def test_unpublished_ineligible_and_unknown_requests_never_reach_the_operator_read(self):
        with use_operator():
            publish(self.issuer.offering, status=OfferingStatus.UNDER_REVIEW)
        self.assertEqual(self.recorded(documents_of(self.token)).json(), [])
        self.assertEqual(self.recorded(file_of(self.token, self.memorandum)).status_code, 404)
        with use_operator():
            publish(self.issuer.offering)
            visitor = make_tenant("scoped-doc-visitor")
        self.client.force_authenticate(visitor.user)
        for token_id in (self.token.pk, uuid4()):
            self.assertEqual(self.recorded(f"/api/v1/directory/tokens/{token_id}/documents/").status_code, 404)
            path = f"/api/v1/directory/tokens/{token_id}/documents/{self.memorandum.pk}/file/"
            self.assertEqual(self.recorded(path).status_code, 404)

        self.assertEqual(self.statements, [])
