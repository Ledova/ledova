from datetime import timedelta
from uuid import uuid4

from django.core.files.base import ContentFile
from django.utils import timezone
from rest_framework.test import APITestCase

from companies.models import Company, CompanyDocument, DocumentType
from offerings.models import Offering, OfferingExemption, OfferingStatus
from offerings.tests.factories import eligible_subscriber
from shared.db import use_migrate
from shared.tests.tenants import make_tenant, open_to_investors
from shared.tests.test_cross_tenant_routes import _body
from shared.tests.upload_fixtures import pdf_bytes
from tokens.models import ShareToken, ShareTokenStatus
from users.models import InvestorCategory

DIRECTORY = "/api/v1/directory/tokens/"
MEMORANDUM = pdf_bytes(pages=2)
NOT_APPROVED = (
    OfferingStatus.DRAFT,
    OfferingStatus.SUBMITTED,
    OfferingStatus.UNDER_REVIEW,
    OfferingStatus.REJECTED,
    OfferingStatus.WITHDRAWN,
)
PAYLOAD_KEYS = {
    "uuid",
    "name",
    "documentType",
    "documentTypeDisplay",
    "fileSize",
    "mimeType",
    "validFrom",
    "validUntil",
    "createdAt",
    "fileUrl",
}


def documents_of(token):
    return f"{DIRECTORY}{token.uuid}/documents/"


def file_of(token, document):
    return f"{DIRECTORY}{token.uuid}/documents/{document.uuid}/file/"


def offer_document(company, name="Information memorandum", document_type=DocumentType.PROSPECTUS, content=MEMORANDUM):
    with use_migrate():
        document = CompanyDocument.objects.create(
            company=company,
            document_type=document_type,
            name=name,
            file_size=len(content),
            mime_type="application/pdf",
        )
        document.file.save(f"{document.uuid}.pdf", ContentFile(content), save=True)
    return document


def publish(offering, status=OfferingStatus.APPROVED, **window):
    window.setdefault("opens_at", timezone.now() - timedelta(days=1))
    Offering.objects.filter(pk=offering.pk).update(status=status, **window)


def streamed(response):
    return b"".join(response.streaming_content)


class OfferingDocumentsTest(APITestCase):
    def setUp(self):
        self.investor = make_tenant("doc-investor")
        self.issuer = make_tenant("doc-issuer")
        eligible_subscriber(self.issuer)
        open_to_investors(self.issuer)
        eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)
        self.token = self.issuer.deployed_token
        self.memorandum = offer_document(self.issuer.company)
        self.issuer.offering.documents.add(self.memorandum)
        self.client.force_authenticate(self.investor.user)

    def listed(self, token=None):
        response = self.client.get(documents_of(token or self.token))
        self.assertEqual(response.status_code, 200, response.content)
        return [row["uuid"] for row in response.json()]

    def assert_hidden(self, document, token=None):
        token = token or self.token
        real = self.client.get(file_of(token, document))
        phantom = self.client.get(f"{DIRECTORY}{token.uuid}/documents/{uuid4()}/file/")
        self.assertEqual(real.status_code, 404, _body(real))
        self.assertEqual(phantom.status_code, 404, _body(phantom))
        self.assertEqual(_body(real), _body(phantom))

    def test_an_open_offering_lists_and_serves_its_documents(self):
        publish(self.issuer.offering)

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        response = self.client.get(file_of(self.token, self.memorandum))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertEqual(streamed(response), MEMORANDUM)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(response["Content-Disposition"].startswith("inline"))
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_an_upcoming_offering_already_shares_its_documents(self):
        publish(self.issuer.offering, opens_at=timezone.now() + timedelta(days=7))

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assertEqual(self.client.get(file_of(self.token, self.memorandum)).status_code, 200)

    def test_an_approved_offering_past_its_closing_time_still_shares_its_documents(self):
        publish(
            self.issuer.offering,
            opens_at=timezone.now() - timedelta(days=30),
            closes_at=timezone.now() - timedelta(minutes=1),
        )

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assertEqual(self.client.get(file_of(self.token, self.memorandum)).status_code, 200)

    def test_a_closed_offering_still_shares_its_documents(self):
        publish(self.issuer.offering, status=OfferingStatus.CLOSED, closed_at=timezone.now())

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assertEqual(self.client.get(file_of(self.token, self.memorandum)).status_code, 200)

    def test_an_offering_the_operator_has_not_approved_shares_nothing(self):
        for status in NOT_APPROVED:
            with self.subTest(status=status):
                publish(self.issuer.offering, status=status)

                self.assertEqual(self.listed(), [])
                self.assert_hidden(self.memorandum)

    def test_a_company_document_not_attached_to_the_offering_is_never_served(self):
        publish(self.issuer.offering)
        unattached = offer_document(self.issuer.company, name="Board minutes", document_type=DocumentType.OTHER)

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assert_hidden(unattached)
        self.assert_hidden(self.issuer.company_document)

    def test_another_companys_document_is_not_reached_through_this_share_class(self):
        publish(self.issuer.offering)
        other = make_tenant("doc-other-issuer")
        eligible_subscriber(other)
        open_to_investors(other)
        eligible_subscriber(self.investor, issuer_decision=other.eligibility_decision)
        publish(other.offering)
        theirs = offer_document(other.company, name="Their memorandum")
        other.offering.documents.add(theirs)

        self.assertEqual(self.client.get(file_of(other.deployed_token, theirs)).status_code, 200)
        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assert_hidden(theirs)

    def test_a_document_of_another_company_attached_to_this_offering_is_not_served(self):
        publish(self.issuer.offering)
        other = make_tenant("doc-stray-issuer")
        stray = offer_document(other.company, name="Someone else's memorandum")
        self.issuer.offering.documents.add(stray)

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assert_hidden(stray)

    def test_a_document_of_another_share_class_of_the_same_company_is_not_served_through_this_one(self):
        publish(self.issuer.offering)
        second = ShareToken.objects.create(
            company=self.issuer.company,
            name="doc-issuer preference shares",
            symbol="PRF",
            total_supply="500",
            status=ShareTokenStatus.DEPLOYED,
            contract_address="0x" + "e" * 40,
            chain=self.token.chain,
            deployment_tx_hash="0x" + "e" * 64,
        )
        offering = Offering.objects.create(
            token=second,
            status=OfferingStatus.APPROVED,
            exemption=OfferingExemption.PROFESSIONAL,
            price_per_share="1.00",
            minimum_shares=1,
            target_shares=10,
            cap_shares=20,
            opens_at=timezone.now() - timedelta(days=1),
        )
        preference = offer_document(self.issuer.company, name="Preference terms")
        offering.documents.add(preference)

        self.assertEqual(self.listed(second), [str(preference.uuid)])
        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assert_hidden(preference)

    def test_a_document_without_a_stored_file_is_not_offered(self):
        publish(self.issuer.offering)
        with use_migrate():
            linked = CompanyDocument.objects.create(
                company=self.issuer.company,
                document_type=DocumentType.BUSINESS_PLAN,
                name="Linked plan",
                external_url="https://docs.example.test/plan.pdf",
                file_size=1,
                mime_type="application/pdf",
            )
        self.issuer.offering.documents.add(linked)

        self.assertEqual(self.listed(), [str(self.memorandum.uuid)])
        self.assert_hidden(linked)
        self.assertNotIn(b"docs.example.test", self.client.get(documents_of(self.token)).content)

    def test_a_document_attached_to_two_published_offerings_is_listed_once_and_newest_first(self):
        publish(self.issuer.offering)
        earlier = Offering.objects.create(
            token=self.token,
            status=OfferingStatus.CLOSED,
            exemption=OfferingExemption.PROFESSIONAL,
            price_per_share="1.00",
            minimum_shares=1,
            target_shares=10,
            cap_shares=20,
            opens_at=timezone.now() - timedelta(days=90),
            closes_at=timezone.now() - timedelta(days=60),
        )
        risks = offer_document(self.issuer.company, name="Risk disclosure", document_type=DocumentType.RISK_DISCLOSURE)
        with use_migrate():
            CompanyDocument.objects.filter(pk=risks.pk).update(created_at=timezone.now() + timedelta(minutes=5))
        earlier.documents.add(self.memorandum, risks)

        self.assertEqual(self.listed(), [str(risks.uuid), str(self.memorandum.uuid)])

    def test_the_payload_describes_the_document_and_nothing_private(self):
        publish(self.issuer.offering)
        with use_migrate():
            CompanyDocument.objects.filter(pk=self.memorandum.pk).update(
                notes="Internal note", rejection_reason="Old rejection", external_url="https://docs.example.test/im"
            )

        response = self.client.get(documents_of(self.token))
        [row] = response.json()

        self.assertEqual(set(row), PAYLOAD_KEYS)
        self.assertEqual(
            (row["name"], row["documentType"], row["documentTypeDisplay"], row["fileSize"], row["mimeType"]),
            (
                "Information memorandum",
                "prospectus",
                "Prospectus or Information Memorandum",
                len(MEMORANDUM),
                "application/pdf",
            ),
        )
        self.assertTrue(row["fileUrl"].endswith(file_of(self.token, self.memorandum)))
        for private in (b"Internal note", b"Old rejection", b"docs.example.test", self.issuer.company.acn.encode()):
            self.assertNotIn(private, response.content)

    def test_the_company_document_route_still_refuses_the_investor(self):
        publish(self.issuer.offering)

        owned = f"/api/v1/companies/{self.issuer.company.uuid}/documents/{self.memorandum.uuid}/file/"
        self.assertEqual(self.client.get(owned).status_code, 404)


class OfferingDocumentsFollowTheDirectoryTest(APITestCase):
    def setUp(self):
        self.investor = make_tenant("dir-doc-investor")
        self.issuer = make_tenant("dir-doc-issuer")
        eligible_subscriber(self.issuer)
        open_to_investors(self.issuer)
        publish(self.issuer.offering)
        self.token = self.issuer.deployed_token
        self.memorandum = offer_document(self.issuer.company)
        self.issuer.offering.documents.add(self.memorandum)
        self.client.force_authenticate(self.investor.user)

    def assert_a_phantom(self, token):
        phantom = uuid4()
        for real, missing in (
            (documents_of(token), f"{DIRECTORY}{phantom}/documents/"),
            (file_of(token, self.memorandum), f"{DIRECTORY}{phantom}/documents/{self.memorandum.uuid}/file/"),
        ):
            with self.subTest(path=real):
                answered = self.client.get(real)
                expected = self.client.get(missing)
                self.assertEqual(answered.status_code, 404, _body(answered))
                self.assertEqual(_body(answered), _body(expected))

    def test_an_ineligible_investor_reaches_nothing(self):
        self.assert_a_phantom(self.token)

    def test_an_eligible_investor_reaches_the_documents(self):
        eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)

        self.assertEqual(self.client.get(documents_of(self.token)).status_code, 200)
        self.assertEqual(self.client.get(file_of(self.token, self.memorandum)).status_code, 200)

    def test_a_company_that_is_not_open_to_investors_shares_nothing(self):
        eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)
        with use_migrate():
            Company.objects.filter(pk=self.issuer.company.pk).update(is_open_to_investors=False)

        self.assert_a_phantom(self.token)

    def test_a_paused_share_class_leaves_the_directory_with_its_documents(self):
        eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)
        ShareToken.objects.filter(pk=self.token.pk).update(status=ShareTokenStatus.PAUSED)

        self.assert_a_phantom(self.token)

    def test_an_association_reaches_the_named_issuer_and_no_other(self):
        stranger = make_tenant("dir-doc-stranger")
        eligible_subscriber(stranger)
        open_to_investors(stranger)
        publish(stranger.offering)
        stranger.offering.documents.add(offer_document(stranger.company))
        eligible_subscriber(
            self.investor, issuer_decision=self.issuer.eligibility_decision, category=InvestorCategory.ASSOCIATED_PERSON
        )

        self.assertEqual(self.client.get(file_of(self.token, self.memorandum)).status_code, 200)
        self.assert_a_phantom(stranger.deployed_token)

    def test_a_malformed_document_identifier_is_not_found(self):
        eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)

        response = self.client.get(f"{documents_of(self.token)}not-a-uuid/file/")

        self.assertEqual(response.status_code, 404)

    def test_an_anonymous_caller_is_refused(self):
        eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)
        self.client.force_authenticate(None)

        self.assertEqual(self.client.get(documents_of(self.token)).status_code, 401)
        self.assertEqual(self.client.get(file_of(self.token, self.memorandum)).status_code, 401)
