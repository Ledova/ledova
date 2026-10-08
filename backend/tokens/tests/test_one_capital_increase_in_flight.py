from importlib import import_module
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError, IntegrityError, connection, transaction
from django.test import TransactionTestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.exceptions import RegisterChangeConflict
from tokens.models import CapitalIncreaseRequest, RequestStatus, ShareToken
from tokens.services.register_capital_increases import prepare_capital_increase
from tokens.tests.company_capital_fixtures import CompanyCapitalCases

CONSTRAINT_NAME = "one_capital_increase_in_flight_per_token"
GUARD = import_module("tokens.migrations.0026_one_capital_increase_in_flight").refuse_a_token_that_already_has_two


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
        self.addCleanup(restore_every_migration)
        migrate_to([("tokens", "0102_company_register_capital_increases")])
        self.tenant = make_tenant("constraint")
        self.token = self.tenant.deployed_token
        CapitalIncreaseRequest.objects.filter(pk=self.tenant.capital_increase.pk).update(status=RequestStatus.SUBMITTED)

    def a_row(self, status):
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
            with self.subTest(status=status), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    self.a_row(status)

    def test_a_terminal_row_is_not_in_the_index(self):
        for status in (RequestStatus.DRAFT, RequestStatus.REJECTED, RequestStatus.EXECUTED, RequestStatus.FAILED):
            with self.subTest(status=status):
                row = self.a_row(status)
                self.assertEqual(CapitalIncreaseRequest.objects.get(pk=row.pk).status, status)


class TheMigrationGuardRefusesRatherThanChoosingTest(TransactionTestCase):

    reset_sequences = False

    def setUp(self):
        super().setUp()
        self.tenant = make_tenant("crowded")
        self.token = self.tenant.deployed_token
        self.addCleanup(restore_every_migration)
        self.history = migrate_to([("tokens", "0044_token_deployment_guards")])
        self.model = self.history.get_model("tokens", "CapitalIncreaseRequest")
        self.model.objects.all().delete()
        self.constraint = next(c for c in self.model._meta.constraints if c.name == CONSTRAINT_NAME)
        with connection.schema_editor(atomic=False) as editor:
            editor.remove_constraint(self.model, self.constraint)
        self.addCleanup(self.put_the_constraint_back)

    def put_the_constraint_back(self):
        self.model.objects.all().delete()
        with connection.schema_editor(atomic=False) as editor:
            editor.add_constraint(self.model, self.constraint)

    def a_request(self, status, additional=25):
        return self.model.objects.create(
            token_id=self.token.pk,
            company_id=self.token.company_id,
            additional_shares=additional,
            new_authorized_total=int(self.token.total_supply) + additional,
            purpose="Raise",
            board_resolution_reference=f"BOARD-{additional}",
            status=status,
        )

    def run_the_guard(self):
        return GUARD(self.history, SimpleNamespace(connection=SimpleNamespace(alias="default")))

    def test_one_in_flight_request_per_share_class_lets_the_migration_run(self):
        self.a_request(RequestStatus.SUBMITTED)
        self.a_request(RequestStatus.EXECUTED, additional=30)
        self.a_request(RequestStatus.DRAFT, additional=35)

        self.assertIsNone(self.run_the_guard())

    def test_two_in_flight_requests_stop_the_migration_and_name_both(self):
        first = self.a_request(RequestStatus.SUBMITTED)
        second = self.a_request(RequestStatus.APPROVED, additional=30)

        with self.assertRaises(RuntimeError) as refusal:
            self.run_the_guard()

        said = str(refusal.exception)
        self.assertIn(self.token.symbol, said)
        self.assertIn(str(self.token.uuid), said)
        self.assertIn(f"{first.uuid} (submitted)", said)
        self.assertIn(f"{second.uuid} (approved)", said)
        self.assertIn("a decision for an operator, not for a migration", said)

    def test_the_guard_changes_nothing_it_refuses_over(self):
        first = self.a_request(RequestStatus.SUBMITTED)
        second = self.a_request(RequestStatus.EXECUTING, additional=30)

        with self.assertRaises(RuntimeError):
            self.run_the_guard()

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.status, second.status), (RequestStatus.SUBMITTED, RequestStatus.EXECUTING))
        self.assertEqual(self.model.objects.filter(token_id=self.token.pk).count(), 2)

    def test_a_terminal_pair_is_not_what_the_guard_is_looking_for(self):
        self.a_request(RequestStatus.REJECTED)
        self.a_request(RequestStatus.FAILED, additional=30)
        self.a_request(RequestStatus.EXECUTED, additional=35)

        self.assertIsNone(self.run_the_guard())

    def test_two_share_classes_with_one_each_are_not_a_crowd(self):
        other = ShareToken.objects.get(pk=self.tenant.deployed_token.pk)
        other.pk = None
        other.uuid = None
        other.symbol = "OTH"
        other.contract_address = "0x" + "7" * 40
        other.save()
        self.a_request(RequestStatus.SUBMITTED)
        self.model.objects.create(
            token_id=other.pk,
            company_id=other.company_id,
            additional_shares=40,
            new_authorized_total=int(other.total_supply) + 40,
            purpose="Raise",
            board_resolution_reference="BOARD-40",
            status=RequestStatus.SUBMITTED,
        )

        self.assertIsNone(self.run_the_guard())


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
