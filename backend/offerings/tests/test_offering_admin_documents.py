from unittest.mock import patch

from django import forms
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse

from companies.admin.document import OFFERED_DOCUMENT
from companies.models import CompanyDocument, DocumentType
from offerings.admin.offering import KEEPS_ITS_DOCUMENTS, KEPT_DOCUMENTS
from offerings.models import Offering, OfferingStatus
from offerings.tests.test_directory_documents import offer_document, publish
from offerings.tests.test_published_documents_stay import PUBLISHED, attached
from shared.tests.tenants import make_tenant

User = get_user_model()
TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def posted(form):
    payload = {}
    for field in form:
        value = field.value()
        if isinstance(field.field.widget, forms.MultiWidget):
            for index, part in enumerate(field.field.widget.decompress(value)):
                payload[f"{field.html_name}_{index}"] = "" if part is None else str(part)
        elif isinstance(value, (list, tuple)):
            payload[field.html_name] = [str(item) for item in value]
        else:
            payload[field.html_name] = "" if value is None else value
    return payload


def inline_payload(formset, deleting=()):
    payload = {
        f"{formset.prefix}-TOTAL_FORMS": str(len(formset.forms)),
        f"{formset.prefix}-INITIAL_FORMS": str(formset.initial_form_count()),
        f"{formset.prefix}-MIN_NUM_FORMS": "0",
        f"{formset.prefix}-MAX_NUM_FORMS": "1000",
    }
    for form in formset.forms:
        payload.update(posted(form))
        if form.instance.pk in deleting:
            payload[f"{form.prefix}-DELETE"] = "on"
    return payload


@override_settings(STORAGES=TEST_STORAGES)
class OfferingAdminDocumentsTest(TestCase):
    def setUp(self):
        patch("offerings.services.offering.send_push_notification").start()
        self.addCleanup(patch.stopall)
        self.tenant = make_tenant("admin-doc-issuer")
        self.offering = self.tenant.offering
        self.memorandum = offer_document(self.tenant.company)
        self.offering.documents.add(self.memorandum)
        self.supplement = offer_document(self.tenant.company, name="Supplementary memorandum")
        self.passport = offer_document(
            self.tenant.company, name="Director passport", document_type=DocumentType.DIRECTOR_ID
        )
        self.foreign = offer_document(make_tenant("admin-doc-other").company, name="Someone else's memorandum")
        self.client.force_login(User.objects.create_superuser(email="doc-operator@example.test", password="pw-1234"))

    def change_url(self):
        return reverse("admin:offerings_offering_change", args=[self.offering.pk])

    def form(self):
        return self.client.get(self.change_url()).context["adminform"].form

    def save(self, *documents):
        payload = posted(self.form())
        payload["documents"] = [str(document.pk) for document in documents]
        return self.client.post(self.change_url(), payload)

    def test_the_picker_offers_the_class_companys_offer_documents_and_what_is_attached(self):
        for status in OfferingStatus:
            with self.subTest(status=status):
                publish(self.offering, status=status)

                choices = set(self.form().fields["documents"].queryset)

                self.assertEqual(choices, {self.memorandum, self.supplement})

    def test_a_document_attached_some_other_way_stays_listed_so_it_is_never_dropped(self):
        self.offering.documents.add(self.passport)

        self.assertEqual(
            set(self.form().fields["documents"].queryset), {self.memorandum, self.supplement, self.passport}
        )

    def test_a_published_offering_takes_a_document_through_the_change_form(self):
        for status in PUBLISHED:
            with self.subTest(status=status):
                publish(self.offering, status=status)

                self.assertEqual(self.save(self.memorandum, self.supplement).status_code, 302)
                self.assertEqual(attached(self.offering), {self.memorandum.uuid, self.supplement.uuid})

    def test_a_published_offering_keeps_its_documents_through_the_change_form(self):
        for status in PUBLISHED:
            with self.subTest(status=status):
                publish(self.offering, status=status)

                response = self.save(self.supplement)

                self.assertEqual(response.status_code, 200)
                self.assertIn(KEPT_DOCUMENTS, response.context["adminform"].form.errors["documents"])
                self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_a_document_outside_the_choices_is_refused_whatever_the_status(self):
        for status in (OfferingStatus.DRAFT, OfferingStatus.APPROVED):
            for outsider in (self.foreign, self.passport):
                with self.subTest(status=status, document=outsider.name):
                    publish(self.offering, status=status)

                    response = self.save(self.memorandum, outsider)

                    self.assertEqual(response.status_code, 200)
                    self.assertIn("documents", response.context["adminform"].form.errors)
                    self.assertEqual(attached(self.offering), {self.memorandum.uuid})

    def test_an_unpublished_offering_still_lets_staff_remove_a_document(self):
        for status in (OfferingStatus.DRAFT, OfferingStatus.SUBMITTED, OfferingStatus.UNDER_REVIEW):
            with self.subTest(status=status):
                publish(self.offering, status=status)
                self.offering.documents.add(self.memorandum)

                self.assertEqual(self.save().status_code, 302)
                self.assertEqual(attached(self.offering), set())

    def unapplied(self):
        offering = Offering.objects.create(
            token=self.offering.token,
            exemption=self.offering.exemption,
            price_per_share=self.offering.price_per_share,
            minimum_shares=self.offering.minimum_shares,
            target_shares=self.offering.target_shares,
            cap_shares=self.offering.cap_shares,
            opens_at=self.offering.opens_at,
            closes_at=self.offering.closes_at,
            summary="An offering nobody has applied to",
        )
        offering.documents.add(self.memorandum)
        return offering

    def test_a_published_offering_that_carries_documents_is_not_deleted(self):
        offering = self.unapplied()
        delete = reverse("admin:offerings_offering_delete", args=[offering.pk])
        changelist = reverse("admin:offerings_offering_changelist")
        bulk = {"action": "delete_selected", "_selected_action": [offering.pk]}
        for status in PUBLISHED:
            with self.subTest(status=status):
                publish(offering, status=status)
                refusal = KEEPS_ITS_DOCUMENTS.format(offering=Offering.objects.get(pk=offering.pk))

                self.assertContains(self.client.get(delete), refusal)
                self.assertContains(self.client.post(delete, {"post": "yes"}), refusal)
                self.assertContains(self.client.post(changelist, bulk), refusal)
                self.assertContains(self.client.post(changelist, {**bulk, "post": "yes"}), refusal)

                self.assertEqual(attached(offering), {self.memorandum.uuid})

    def test_an_unpublished_offering_that_carries_documents_is_still_deleted(self):
        offering = self.unapplied()
        url = reverse("admin:offerings_offering_delete", args=[offering.pk])

        self.assertNotContains(self.client.get(url), "its investors can open")
        self.assertEqual(self.client.post(url, {"post": "yes"}).status_code, 302)
        self.assertFalse(Offering.objects.filter(pk=offering.pk).exists())


@override_settings(STORAGES=TEST_STORAGES)
class CompanyDocumentAdminKeepsOfferedDocumentsTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("admin-kept-issuer")
        self.memorandum = offer_document(self.tenant.company)
        self.tenant.offering.documents.add(self.memorandum)
        self.loose = offer_document(self.tenant.company, name="Loose plan", document_type=DocumentType.BUSINESS_PLAN)
        publish(self.tenant.offering)
        self.client.force_login(User.objects.create_superuser(email="kept-operator@example.test", password="pw-1234"))

    def exists(self, document):
        return CompanyDocument.objects.filter(pk=document.pk).exists()

    def test_its_delete_page_refuses_an_offered_document(self):
        url = reverse("admin:companies_companydocument_delete", args=[self.memorandum.pk])

        page = self.client.get(url)
        self.client.post(url, {"post": "yes"})

        self.assertContains(page, OFFERED_DOCUMENT.format(document=self.memorandum))
        self.assertTrue(self.exists(self.memorandum))

    def test_the_bulk_delete_refuses_a_selection_holding_an_offered_document(self):
        url = reverse("admin:companies_companydocument_changelist")
        selection = {"action": "delete_selected", "_selected_action": [self.memorandum.pk, self.loose.pk]}

        page = self.client.post(url, selection)
        self.client.post(url, {**selection, "post": "yes"})

        self.assertContains(page, OFFERED_DOCUMENT.format(document=self.memorandum))
        self.assertTrue(self.exists(self.memorandum))
        self.assertTrue(self.exists(self.loose))

    def test_a_document_no_published_offering_carries_is_still_deleted(self):
        url = reverse("admin:companies_companydocument_delete", args=[self.loose.pk])

        self.assertEqual(self.client.post(url, {"post": "yes"}).status_code, 302)
        self.assertFalse(self.exists(self.loose))

    def test_an_offered_document_keeps_its_company(self):
        url = reverse("admin:companies_companydocument_change", args=[self.memorandum.pk])

        self.assertNotIn("company", self.client.get(url).context["adminform"].form.fields)

    def company_page_deleting(self, document):
        url = reverse("admin:companies_company_change", args=[self.tenant.company.pk])
        page = self.client.get(url)
        payload = posted(page.context["adminform"].form)
        for inline in page.context["inline_admin_formsets"]:
            payload.update(inline_payload(inline.formset, deleting=(document.pk,)))
        return self.client.post(url, payload)

    def test_the_company_page_refuses_to_delete_an_offered_document(self):
        response = self.company_page_deleting(self.memorandum)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, OFFERED_DOCUMENT.format(document=self.memorandum))
        self.assertTrue(self.exists(self.memorandum))

    def test_the_company_page_still_deletes_a_document_no_published_offering_carries(self):
        response = self.company_page_deleting(self.loose)

        self.assertEqual(response.status_code, 302)
        self.assertFalse(self.exists(self.loose))
