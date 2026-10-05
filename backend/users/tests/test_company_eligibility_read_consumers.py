from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from django.core.exceptions import ImproperlyConfigured
from django.db import connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from companies.services.editing import update_company
from feature_flags.models import FeatureFlag
from offerings.models import Offering, OfferingExemption
from offerings.services.offering import submit_offering, transition_offering
from offerings.tests.test_directory_documents import (
    documents_of,
    file_of,
    offer_document,
    streamed,
)
from operators.models import Operator
from operators.serializers import OperatorSerializer
from shared.db import (
    current_alias,
    principal_of,
    reset_principal,
    use_migrate,
    use_operator,
)
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.services.market_data_service import list_market_tokens
from users.models import InvestorCategory, UserAccount, UserProfile
from users.services.eligibility import (
    ACCOUNT_NOT_IN_GOOD_STANDING,
    IDENTITY_NOT_VERIFIED,
    PRINCIPAL_REQUIRED,
    directory_admission,
    investor_readiness,
    secondary_company_ids,
)
from users.tests.factories import (
    attach_evidence,
    make_investor,
    verified_classification,
)
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from users.tests.test_company_eligibility_requests import PDF, REQUESTS, SOURCES

DIRECTORY = "/api/v1/directory/tokens/"
MARKET = "/api/v1/trading/tokens/"


class CompanyEligibilityReadCases(CompanyEligibilityConsumptionCases):
    def setUp(self):
        super().setUp()
        self.company = update_company(self.company, {"is_open_to_investors": True}, actor=self.owner)
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            Operator.objects.filter(pk=1).update(bank_account_name="Synthetic settlement account")
        self.first = self.offering(price="500000.00", label="READFIRST")
        self.second = self.offering(price="500000.00", label="READSECOND")
        self.client.force_authenticate(self.participant)

    @contextmanager
    def reader(self, actor=None):
        with self.app_as(actor or self.participant):
            yield

    def rows(self, path):
        self.client.force_authenticate(self.participant)
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.content)
        return {row["uuid"]: row for row in response.json()["results"]}

    def payment_instructions(self, actor=None):
        actor = actor or self.participant
        with self.reader(actor), use_operator(), _requester_principal(actor.pk):
            return OperatorSerializer(
                Operator.objects.get(pk=1), context={"request": SimpleNamespace(user=actor)}
            ).data["payment_instructions"]

    def same_token_offering(self):
        with use_operator():
            transition_offering(self.first, "close", reason="Synthetic former published offer closes normally")
            offering = Offering.objects.create(
                token=self.first.token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=Decimal("500000.00"),
                price_currency="AUD",
                minimum_shares=1,
                target_shares=5,
                cap_shares=10,
                maximum_shares=10,
                opens_at=timezone.now() - timedelta(days=1),
                summary="Synthetic sibling terms for the same class",
            )
            publisher, _ = make_investor("read-sibling-publisher", staff=True)
            submit_offering(offering, submitted_by=self.owner)
            transition_offering(offering, "approve", reviewed_by=publisher)
        return offering


class CompanyEligibilityReadConsumerTest(CompanyEligibilityReadCases, StubUploadDependencies, APITransactionTestCase):
    def test_readiness_is_account_readiness_without_investment_authorization(self):
        response = self.client.get(f"{SOURCES}eligibility/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"isReady": True, "reasons": [], "account": str(self.account.pk)})
        self.assertEqual(self.rows(DIRECTORY), {})
        self.assertEqual(self.rows(MARKET), {})
        self.assertIsNone(self.payment_instructions())

    def test_retained_global_verified_evidence_grants_no_directory_market_or_payment_permission(self):
        with use_migrate():
            legacy = verified_classification(self.other_account, self.owner)
            attach_evidence(legacy, PDF)
        with self.reader(self.other):
            self.assertEqual(directory_admission(self.other).company_ids, frozenset())
            self.assertEqual(secondary_company_ids(self.other), frozenset())
            self.assertFalse(list_market_tokens(self.other).exists())
        self.assertIsNone(self.payment_instructions(self.other))

    def test_real_general_acceptance_reaches_only_its_issuer_and_current_published_documents(self):
        request, decision = self.accepted()
        foreign, initial = self.company_fixture("Read Other Pty Ltd", "004085616")
        foreign = update_company(foreign, {"is_open_to_investors": True}, actor=self.owner)
        foreign_offer = self.offering(company=foreign, label="READOTHER")
        first_document = offer_document(self.company, name="First exact company offer", content=PDF)
        second_document = offer_document(self.company, name="Second exact company offer")
        private = offer_document(self.company, name="Unpublished private record")
        with use_operator():
            self.first.documents.add(first_document)
            self.second.documents.add(second_document)
        expected = {str(self.first.token_id), str(self.second.token_id)}
        self.assertEqual(set(self.rows(DIRECTORY)), expected)
        self.assertEqual(set(self.rows(MARKET)), expected)
        self.assertNotIn(str(foreign_offer.token_id), expected)
        self.client.force_authenticate(self.participant)
        listed = self.client.get(documents_of(self.first.token))
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row["uuid"] for row in listed.json()], [str(first_document.pk)])
        self.assertEqual(streamed(self.client.get(file_of(self.first.token, first_document))), PDF)
        for document in (second_document, private):
            self.assertEqual(self.client.get(file_of(self.first.token, document)).status_code, 404)
        self.assertEqual(self.payment_instructions(), {"bank_account_name": "Synthetic settlement account"})
        with self.reader():
            self.assertEqual(directory_admission(self.participant).company_ids, frozenset({self.company.pk}))
            self.assertEqual(secondary_company_ids(self.participant), frozenset({self.company.pk}))
        self.assertEqual(request.company_id, self.company.pk)
        self.assertEqual(decision.request_id, request.pk)

    def test_associated_person_is_exact_primary_only_and_does_not_show_secondary_payment_instructions(self):
        self.replace_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(self.company.pk))
        self.accepted()
        self.assertEqual(set(self.rows(DIRECTORY)), {str(self.first.token_id), str(self.second.token_id)})
        self.assertEqual(self.rows(MARKET), {})
        self.assertIsNone(self.payment_instructions())

    def test_product_decision_never_exposes_a_sibling_offering_class_or_document(self):
        sibling = self.same_token_offering()
        allowed = offer_document(self.company, name="Exact admitted product memorandum")
        same_class_sibling = offer_document(self.company, name="Same class unrelated offer memorandum")
        other_class = offer_document(self.company, name="Unrelated class memorandum")
        with use_operator():
            sibling.documents.add(allowed)
            self.first.documents.add(same_class_sibling)
            self.second.documents.add(other_class)
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(sibling.pk), quantity=1)
        rows = self.rows(DIRECTORY)
        self.assertEqual(set(rows), {str(self.first.token_id)})
        self.assertEqual(rows[str(self.first.token_id)]["openOffering"]["uuid"], str(sibling.pk))
        self.assertEqual(self.rows(MARKET), {})
        self.assertIsNone(self.payment_instructions())
        self.client.force_authenticate(self.participant)
        listed = self.client.get(documents_of(self.first.token))
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row["uuid"] for row in listed.json()], [str(allowed.pk)])
        self.assertEqual(self.client.get(file_of(self.first.token, allowed)).status_code, 200)
        self.assertEqual(self.client.get(file_of(self.first.token, same_class_sibling)).status_code, 404)
        self.assertEqual(self.client.get(documents_of(self.second.token)).status_code, 404)
        with self.reader():
            admission = directory_admission(self.participant)
            self.assertEqual(admission.company_ids, frozenset())
            self.assertEqual(admission.offering_ids, frozenset({sibling.pk}))
            self.assertEqual(admission.token_ids, frozenset({self.first.token_id}))
        self.assertEqual(request.quantity, 1)
        self.assertEqual(decision.request_id, request.pk)

    def test_product_terms_drift_removes_the_exact_directory_admission(self):
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(self.first.pk), quantity=1)
        self.assertEqual(set(self.rows(DIRECTORY)), {str(self.first.token_id)})
        with use_operator():
            Offering.objects.filter(pk=self.first.pk).update(price_per_share=Decimal("500001.00"))
        self.assertEqual(self.rows(DIRECTORY), {})
        self.client.force_authenticate(self.participant)
        self.assertEqual(self.client.get(f"{DIRECTORY}{self.first.token_id}/").status_code, 404)
        self.assertEqual(request.price_per_share, Decimal("500000.00"))
        self.assertEqual(decision.request_id, request.pk)

    def test_company_directory_opt_in_does_not_broaden_or_block_exact_secondary_permission(self):
        self.accepted()
        self.company = update_company(self.company, {"is_open_to_investors": False}, actor=self.owner)
        self.assertEqual(self.rows(DIRECTORY), {})
        self.assertEqual(set(self.rows(MARKET)), {str(self.first.token_id), str(self.second.token_id)})

    def test_real_revocation_and_withdrawal_hide_reads_without_rewriting_the_acceptance(self):
        request, decision = self.accepted()
        self.assertTrue(self.rows(DIRECTORY))
        self.revoke(request)
        self.assertEqual(self.rows(DIRECTORY), {})
        self.assertEqual(self.rows(MARKET), {})
        self.assertIsNone(self.payment_instructions())
        request_two, decision_two = self.accepted()
        self.assertTrue(self.rows(DIRECTORY))
        self.client.force_authenticate(self.participant)
        response = self.client.post(
            f"{REQUESTS}{request_two.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.rows(DIRECTORY), {})
        with use_operator():
            decision.refresh_from_db()
            decision_two.refresh_from_db()
        self.assertEqual((decision.outcome, decision_two.outcome), ("accepted", "accepted"))

    def test_actual_missing_evidence_bytes_stops_disclosure(self):
        self.accepted()
        self.assertTrue(self.rows(DIRECTORY))
        self.source.evidence_file.storage.delete(self.source.evidence_file.name)
        self.assertEqual(self.rows(DIRECTORY), {})
        self.assertEqual(self.rows(MARKET), {})
        self.assertIsNone(self.payment_instructions())

    def test_missing_and_wrong_ambient_principal_are_not_replaced_from_the_supplied_user(self):
        self.accepted()
        with self.reader(self.other):
            previous = principal_of()
            self.assertEqual(directory_admission(self.participant).company_ids, frozenset())
            self.assertEqual(secondary_company_ids(self.participant), frozenset())
            self.assertEqual(investor_readiness(self.participant).reasons, (PRINCIPAL_REQUIRED,))
            self.assertEqual(principal_of(), previous)
        with self.reader():
            reset_principal()
            self.assertEqual(directory_admission(self.participant).company_ids, frozenset())
            self.assertEqual(secondary_company_ids(self.participant), frozenset())
            self.assertEqual(investor_readiness(self.participant).reasons, (PRINCIPAL_REQUIRED,))
            self.assertIn(principal_of(), (None, ""))

    def test_bounded_operator_reads_restore_both_real_connection_principals(self):
        self.accepted()
        with use_operator():
            operator_principal = principal_of()
        with self.reader():
            principal = principal_of()
            self.assertTrue(directory_admission(self.participant).company_ids)
            self.assertTrue(secondary_company_ids(self.participant))
            self.assertTrue(investor_readiness(self.participant).is_ready)
            self.assertEqual(principal_of(), principal)
        with use_operator():
            self.assertEqual(principal_of(), operator_principal)

    def test_current_account_and_identity_are_read_again_for_readiness_and_admission(self):
        self.accepted()
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
        with self.reader():
            self.assertEqual(investor_readiness(self.participant).reasons, (ACCOUNT_NOT_IN_GOOD_STANDING,))
            self.assertEqual(secondary_company_ids(self.participant), frozenset())
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")
            UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
        with self.reader():
            self.assertEqual(investor_readiness(self.participant).reasons, (IDENTITY_NOT_VERIFIED,))
            self.assertEqual(directory_admission(self.participant).company_ids, frozenset())

    def test_staff_technical_payment_read_is_independent_of_company_participant_admission(self):
        with use_operator():
            staff, _ = make_investor("read-technical-staff", staff=True)
        self.assertEqual(self.payment_instructions(staff), {"bank_account_name": "Synthetic settlement account"})
        with self.reader(staff):
            self.assertEqual(directory_admission(staff).company_ids, frozenset())
            self.assertEqual(secondary_company_ids(staff), frozenset())

    def test_configuration_failure_does_not_create_operator_configuration(self):
        self.accepted()
        with use_operator():
            Operator.objects.filter(pk=1).delete()
        with self.reader(), self.assertRaises(ImproperlyConfigured):
            investor_readiness(self.participant)
        with use_operator():
            self.assertFalse(Operator.objects.exists())

    def test_expired_real_decision_stops_directory_market_and_payment_disclosure(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=5)
        request, decision = self.accepted()
        self.assertTrue(self.rows(DIRECTORY))
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM %s::timestamptz - clock_timestamp())) + 0.02)",
                [decision.expires_at],
            )
        self.assertEqual(self.rows(DIRECTORY), {})
        self.assertEqual(self.rows(MARKET), {})
        self.assertIsNone(self.payment_instructions())
        self.assertEqual(request.company_id, self.company.pk)
