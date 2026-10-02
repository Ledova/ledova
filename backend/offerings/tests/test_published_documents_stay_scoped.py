from django.db import IntegrityError
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyDocument
from offerings.models import Offering
from offerings.tests.test_directory_documents import offer_document, publish
from offerings.tests.test_published_documents_stay import ADD, STAYS, attached
from shared.db import acting_for, atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant


class ScopedPublishedDocumentsStayTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.issuer = make_tenant("scoped-stay-issuer")
            self.memorandum = offer_document(self.issuer.company)
            self.supplement = offer_document(self.issuer.company, name="Supplementary memorandum")
            self.issuer.offering.documents.add(self.memorandum)
            publish(self.issuer.offering)
        self.offering = self.issuer.offering
        self.client.force_authenticate(self.issuer.user)

    def kept(self):
        with use_operator():
            return attached(self.offering)

    def test_the_issuer_adds_a_document_on_the_app_connection(self):
        response = self.client.post(
            ADD.format(self.offering.uuid), {"documents": [str(self.supplement.uuid)]}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.kept(), {self.memorandum.uuid, self.supplement.uuid})

    def test_the_issuer_cannot_delete_an_offered_document_on_the_app_connection(self):
        response = self.client.delete(f"/api/v1/companies/{self.issuer.company.uuid}/documents/{self.memorandum.uuid}/")

        self.assertEqual(response.status_code, 409, response.content)
        with use_operator():
            self.assertTrue(CompanyDocument.objects.filter(pk=self.memorandum.pk).exists())
        self.assertEqual(self.kept(), {self.memorandum.uuid})

    def test_the_database_refuses_the_issuer_a_detach_under_its_own_policies(self):
        with acting_for(self.issuer.user.pk):
            offering = Offering.objects.get(pk=self.offering.pk)
            with self.assertRaisesMessage(IntegrityError, STAYS), atomic():
                offering.documents.remove(self.memorandum)

        self.assertEqual(self.kept(), {self.memorandum.uuid})

    def test_the_database_refuses_staff_a_detach_on_the_operator_connection(self):
        with use_operator():
            with self.assertRaisesMessage(IntegrityError, STAYS), atomic():
                Offering.objects.get(pk=self.offering.pk).documents.remove(self.memorandum)

        self.assertEqual(self.kept(), {self.memorandum.uuid})
