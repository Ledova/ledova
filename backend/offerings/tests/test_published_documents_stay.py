from django.db import IntegrityError, transaction
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APITestCase

from companies.exceptions import OfferedDocumentException
from companies.models import (
    OFFER_DOCUMENT_TYPES,
    Company,
    CompanyDocument,
    CompanyType,
    DocumentType,
)
from offerings.models import Offering, OfferingStatus
from offerings.serializers.offering import FOREIGN_DOCUMENT, OFFER_DOCUMENTS_ONLY
from offerings.services.offering import NOT_ATTACHABLE
from offerings.tests.test_directory_documents import file_of, offer_document, publish
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import an_acn, make_eligible, make_tenant, open_to_investors

ADD = "/api/v1/offerings/{}/documents/"
PUBLISHED = (OfferingStatus.APPROVED, OfferingStatus.CLOSED)
UNPUBLISHED = (OfferingStatus.DRAFT, OfferingStatus.SUBMITTED, OfferingStatus.UNDER_REVIEW, OfferingStatus.REJECTED)
STAYS = "stays attached"
KEEPS_ITS_COMPANY = "keeps its company"
BEFORE_THE_RULE = [("offerings", "0008_subscription_snapshots")]


def attached(offering):
    return set(Offering.objects.get(pk=offering.pk).documents.values_list("uuid", flat=True))


def reattach(offering, *documents, status):
    publish(offering, status=OfferingStatus.DRAFT)
    offering.documents.set(documents)
    publish(offering, status=status)


class PublishedOfferingsOnlyGainDocumentsTest(APITestCase):
    def setUp(self):
        self.issuer = make_tenant("stay-issuer")
        self.offering = self.issuer.offering
        self.memorandum = offer_document(self.issuer.company)
        self.offering.documents.add(self.memorandum)
        self.supplement = offer_document(self.issuer.company, name="Supplementary memorandum")
        self.client.force_authenticate(self.issuer.user)

    def add(self, *documents, offering=None):
        return self.client.post(
            ADD.format((offering or self.offering).uuid),
            {"documents": [str(document.uuid) for document in documents]},
            format="json",
        )

    def delete(self, document):
        return self.client.delete(f"/api/v1/companies/{self.issuer.company.uuid}/documents/{document.uuid}/")

    def test_an_approved_or_closed_offering_takes_another_document(self):
        for status in PUBLISHED:
            with self.subTest(status=status):
                reattach(self.offering, self.memorandum, status=status)

                response = self.add(self.supplement)

                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(
                    set(response.json()["documents"]), {str(self.memorandum.uuid), str(self.supplement.uuid)}
                )
                self.assertEqual(attached(self.offering), {self.memorandum.uuid, self.supplement.uuid})

    def test_an_eligible_investor_opens_the_added_document_at_once(self):
        investor = make_tenant("stay-investor")
        make_eligible(investor)
        open_to_investors(self.issuer)
        publish(self.offering)

        self.assertEqual(self.add(self.supplement).status_code, 200)

        self.client.force_authenticate(investor.user)
        self.assertEqual(self.client.get(file_of(self.issuer.deployed_token, self.supplement)).status_code, 200)

    def test_a_draft_or_rejected_offering_takes_documents_too(self):
        for status in (OfferingStatus.DRAFT, OfferingStatus.REJECTED):
            with self.subTest(status=status):
                reattach(self.offering, self.memorandum, status=status)

                self.assertEqual(self.add(self.supplement).status_code, 200)
                self.assertEqual(attached(self.offering), {self.memorandum.uuid, self.supplement.uuid})

    def test_an_offering_in_review_or_withdrawn_takes_none(self):
        for status in (OfferingStatus.SUBMITTED, OfferingStatus.UNDER_REVIEW, OfferingStatus.WITHDRAWN):
            with self.subTest(status=status):
                reattach(self.offering, self.memorandum, status=status)
                self.offering.refresh_from_db()

                response = self.add(self.supplement)

                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(
                    response.json()["detail"],
                    NOT_ATTACHABLE.format(status=self.offering.get_status_display().lower()),
                )
                self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_another_companys_document_is_refused(self):
        publish(self.offering)
        sibling = Company.objects.create(
            owner=self.issuer.user, name="Sibling Pty Ltd", company_type=CompanyType.PROPRIETARY, acn=an_acn(9_000_002)
        )
        stray = offer_document(sibling, name="Sibling memorandum")

        response = self.add(stray)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["documents"], [FOREIGN_DOCUMENT])
        self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_every_offer_document_type_can_be_added(self):
        publish(self.offering)
        documents = [
            offer_document(self.issuer.company, name=f"Offer {kind}", document_type=kind)
            for kind in OFFER_DOCUMENT_TYPES
        ]

        response = self.add(*documents)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(attached(self.offering), {self.memorandum.uuid, *(it.uuid for it in documents)})

    def test_a_record_that_is_not_an_offer_document_is_refused_since_it_could_never_be_removed(self):
        publish(self.offering)
        for kind in (DocumentType.DIRECTOR_ID, DocumentType.SHARE_REGISTER, DocumentType.OTHER):
            with self.subTest(document_type=kind):
                record = offer_document(self.issuer.company, name=f"Record {kind}", document_type=kind)

                response = self.add(self.supplement, record)

                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(response.json()["documents"], [OFFER_DOCUMENTS_ONLY])
                self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_an_empty_list_is_refused(self):
        publish(self.offering)

        response = self.client.post(ADD.format(self.offering.uuid), {"documents": []}, format="json")

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("documents", response.json())

    def test_another_issuers_offering_is_not_found(self):
        other = make_tenant("stay-other-issuer")
        publish(other.offering)
        theirs = offer_document(other.company, name="Their supplement")

        response = self.add(theirs, offering=other.offering)

        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(attached(other.offering), set())

    def test_an_edit_cannot_detach_a_document_from_a_published_offering(self):
        for status in PUBLISHED:
            with self.subTest(status=status):
                reattach(self.offering, self.memorandum, status=status)

                response = self.client.patch(
                    f"/api/v1/offerings/{self.offering.uuid}/", {"documents": []}, format="json"
                )

                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_a_document_attached_to_a_published_offering_cannot_be_deleted(self):
        for status in PUBLISHED:
            with self.subTest(status=status):
                reattach(self.offering, self.memorandum, status=status)

                response = self.delete(self.memorandum)

                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["detail"], OfferedDocumentException.default_detail)
                self.assertTrue(CompanyDocument.objects.filter(pk=self.memorandum.pk).exists())
                self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_a_document_no_published_offering_carries_can_still_be_deleted(self):
        for status in UNPUBLISHED + (OfferingStatus.WITHDRAWN,):
            with self.subTest(status=status):
                document = offer_document(self.issuer.company, name=f"Draft memorandum {status}")
                reattach(self.offering, document, status=status)

                self.assertEqual(self.delete(document).status_code, 204)
                self.assertFalse(CompanyDocument.objects.filter(pk=document.pk).exists())
        self.assertEqual(self.delete(self.supplement).status_code, 204)


class TheDatabaseKeepsPublishedDocumentsTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("kept-issuer")
        self.offering = self.tenant.offering
        self.memorandum = offer_document(self.tenant.company)
        self.offering.documents.add(self.memorandum)

    def test_a_published_offering_cannot_lose_a_document_however_it_is_asked(self):
        elsewhere = make_tenant("kept-elsewhere").offering
        attachments = Offering.documents.through.objects.filter(offering=self.offering)
        for status in PUBLISHED:
            publish(self.offering, status=status)
            for name, act in (
                ("remove", lambda: self.offering.documents.remove(self.memorandum)),
                ("clear", lambda: self.offering.documents.clear()),
                ("delete", lambda: CompanyDocument.objects.filter(pk=self.memorandum.pk).delete()),
                ("re-point", lambda: attachments.update(offering=elsewhere)),
            ):
                with self.subTest(status=status, act=name):
                    with self.assertRaisesMessage(IntegrityError, STAYS), transaction.atomic():
                        act()
                    self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_an_unpublished_offering_still_lets_its_documents_go(self):
        for status in UNPUBLISHED + (OfferingStatus.WITHDRAWN,):
            with self.subTest(status=status):
                publish(self.offering, status=status)
                self.offering.documents.add(self.memorandum)

                self.offering.documents.remove(self.memorandum)

                self.assertEqual(attached(self.offering), set())

    def test_a_document_attached_to_a_published_offering_keeps_its_company(self):
        other = make_tenant("kept-other")
        for status in PUBLISHED:
            with self.subTest(status=status):
                publish(self.offering, status=status)

                with self.assertRaisesMessage(IntegrityError, KEEPS_ITS_COMPANY), transaction.atomic():
                    CompanyDocument.objects.filter(pk=self.memorandum.pk).update(company=other.company)

                self.assertEqual(CompanyDocument.objects.get(pk=self.memorandum.pk).company_id, self.tenant.company.pk)

    def test_an_offered_document_can_still_be_corrected_in_place(self):
        for status in PUBLISHED:
            with self.subTest(status=status):
                publish(self.offering, status=status)
                self.memorandum.name = f"Information memorandum, {status} edition"

                self.memorandum.save()

                self.assertEqual(CompanyDocument.objects.get(pk=self.memorandum.pk).name, self.memorandum.name)
                self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_an_unattached_document_or_one_on_a_draft_may_still_move(self):
        other = make_tenant("kept-mover")
        loose = offer_document(self.tenant.company, name="Loose", document_type=DocumentType.BUSINESS_PLAN)

        CompanyDocument.objects.filter(pk__in=[loose.pk, self.memorandum.pk]).update(company=other.company)

        self.assertEqual(
            set(
                CompanyDocument.objects.filter(pk__in=[loose.pk, self.memorandum.pk]).values_list("company", flat=True)
            ),
            {other.company.pk},
        )


class TheRuleMigrationReversesTest(TransactionTestCase):
    def tearDown(self):
        restore_every_migration()
        super().tearDown()

    def test_rolling_back_lifts_the_rule_and_reapplying_restores_it(self):
        tenant = make_tenant("kept-migration")
        memorandum = offer_document(tenant.company)
        tenant.offering.documents.add(memorandum)
        publish(tenant.offering)

        migrate_to(BEFORE_THE_RULE)
        tenant.offering.documents.remove(memorandum)
        self.assertEqual(attached(tenant.offering), set())

        restore_every_migration()
        tenant.offering.documents.add(memorandum)
        with self.assertRaisesMessage(IntegrityError, STAYS), transaction.atomic():
            tenant.offering.documents.remove(memorandum)
        self.assertEqual(attached(tenant.offering), {memorandum.uuid})
