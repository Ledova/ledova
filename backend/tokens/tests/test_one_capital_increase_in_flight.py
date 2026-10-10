from unittest.mock import patch

from django.db import DatabaseError, IntegrityError
from django.test import TransactionTestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from shared.db import use_migrate
from shared.tests.retained_rows import retained_rows
from shared.tests.tenants import make_tenant
from tokens.exceptions import RegisterChangeConflict
from tokens.models import CapitalIncreaseRequest, RequestStatus
from tokens.services.register_capital_increases import prepare_capital_increase
from tokens.tests.company_capital_fixtures import CompanyCapitalCases
from tokens.tests.retained_guards import CAPITAL_GUARDS


class ASecondRaiseIsRefusedWithAReasonTest(CompanyCapitalCases, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.first = self.prepare_capital()

    def a_draft(self, additional=50):
        return CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=additional,
            new_authorized_total=int(self.token.total_supply) + additional,
            purpose="Second raise",
            board_resolution_reference="BOARD-2",
        )

    def test_the_second_preparation_is_refused_before_the_constraint_sees_it(self):
        second = self.a_draft()
        before = CapitalIncreaseRequest.objects.filter(pk=second.pk).values().get()
        with self.assertRaises(ValidationError) as refusal:
            self.prepare_capital(additional_shares=50, new_authorized_total=1050)
        self.assertEqual(refusal.exception.detail, {"unmet_requirements": ["capital_in_flight"]})
        self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=second.pk).values().get(), before)

    def test_human_approval_keeps_the_same_one_in_flight(self):
        self.capital_decide(self.first, "approve")
        with self.assertRaises(ValidationError) as refusal:
            self.prepare_capital(additional_shares=50, new_authorized_total=1050)
        self.assertEqual(refusal.exception.detail, {"unmet_requirements": ["capital_in_flight"]})
        self.first.request.refresh_from_db()
        self.assertEqual(self.first.request.status, RequestStatus.UNDER_REVIEW)
        self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.token).in_flight().count(), 1)

    def test_the_company_can_reject_the_one_in_flight_without_an_operator(self):
        self.capital_decide(self.first, "reject", reason="Prepare the replacement")
        self.first.request.refresh_from_db()
        self.assertEqual(
            (self.first.request.status, self.first.request.rejection_reason), ("rejected", "Prepare the replacement")
        )
        replacement = self.prepare_capital(additional_shares=50, new_authorized_total=1050)
        self.assertEqual(replacement.request.status, RequestStatus.UNDER_REVIEW)
        self.assertEqual(replacement.submitted_by_id, self.owner.pk)

    def test_a_retained_draft_beside_one_in_flight_is_allowed_to_exist(self):
        self.a_draft()
        self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.token).count(), 2)

    def test_the_raise_is_allowed_once_the_first_one_is_rejected(self):
        self.capital_decide(self.first, "reject", reason="Prepare the replacement")
        second = self.prepare_capital(additional_shares=50, new_authorized_total=1050)
        self.capital_decide(second, "approve")
        self.capital_decide(second, "apply")
        second.request.refresh_from_db()
        self.assertEqual(second.request.status, RequestStatus.EXECUTING)
        second.refresh_from_db()
        self.assertEqual(second.reviewed_by_id, self.owner.pk)

    def test_a_second_company_token_raises_on_its_own_schedule(self):
        from tokens.tests.capital_fixtures import capital_request

        other, actor = capital_request(self)
        self.assertNotEqual(other.token.pk, self.token.pk)
        self.assertEqual(other.capital_increase.status, RequestStatus.UNDER_REVIEW)
        self.assertEqual(CapitalIncreaseRequest.objects.in_flight().count(), 2)
        self.assertEqual(other.capital_increase.submitted_by_id, actor.pk)


class TheDatabaseRefusesASecondInFlightRowTest(TransactionTestCase):

    def setUp(self):
        super().setUp()
        self.tenant = make_tenant("constraint")
        self.token = self.tenant.deployed_token
        with use_migrate(), retained_rows(*CAPITAL_GUARDS[:2]):
            CapitalIncreaseRequest.objects.filter(pk=self.tenant.capital_increase.pk).update(
                status=RequestStatus.SUBMITTED
            )

    def a_row(self, status):
        with use_migrate(), retained_rows(*CAPITAL_GUARDS[:2]):
            return CapitalIncreaseRequest.objects.create(
                token=self.token,
                additional_shares=50,
                new_authorized_total=int(self.token.total_supply) + 50,
                purpose="Second raise",
                board_resolution_reference="BOARD-2",
                status=status,
                dispatch_id=None,
            )

    def test_a_second_in_flight_row_cannot_be_written_at_all(self):
        for status in (
            RequestStatus.SUBMITTED,
            RequestStatus.UNDER_REVIEW,
            RequestStatus.APPROVED,
            RequestStatus.EXECUTING,
        ):
            refusal = None
            try:
                self.a_row(status)
            except IntegrityError as error:
                refusal = error
            with self.subTest(status=status):
                self.assertIsNotNone(refusal)
                self.assertEqual(refusal.__cause__.diag.constraint_name, "one_capital_increase_in_flight_per_token")
                self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.token).count(), 1)

    def test_a_terminal_row_is_not_in_the_index(self):
        for status in (RequestStatus.DRAFT, RequestStatus.REJECTED, RequestStatus.EXECUTED, RequestStatus.FAILED):
            with self.subTest(status=status):
                row = self.a_row(status)
                self.assertEqual(CapitalIncreaseRequest.objects.get(pk=row.pk).status, status)


class PreparationRetainsTheExactRequestTest(CompanyCapitalCases, APITransactionTestCase):
    def test_an_identical_preparation_returns_the_original_and_changed_terms_conflict(self):
        payload = self.capital_payload()
        original = prepare_capital_increase(**payload)
        before = CapitalIncreaseRequest.objects.filter(pk=original.request_id).values().get()
        replay = prepare_capital_increase(**payload)
        self.assertEqual(replay.pk, original.pk)
        with self.assertRaises(RegisterChangeConflict):
            prepare_capital_increase(**(payload | {"purpose": "Changed request"}))
        self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=original.request_id).values().get(), before)
        self.assertEqual(CapitalIncreaseRequest.objects.filter(token=self.token).count(), 1)

    def test_an_unrelated_database_failure_is_not_called_competition(self):
        payload = self.capital_payload()
        failure = DatabaseError("unrelated failure")
        with patch("tokens.services.dilution.dilution_for", side_effect=failure):
            with self.assertRaises(DatabaseError) as raised:
                prepare_capital_increase(**payload)
        self.assertIs(raised.exception, failure)
        self.assertFalse(CapitalIncreaseRequest.objects.filter(token=self.token).exists())
