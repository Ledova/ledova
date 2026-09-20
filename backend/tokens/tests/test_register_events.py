import importlib
import json
from datetime import date
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, connections
from django.test import TestCase
from rest_framework.exceptions import ValidationError

from companies.models import Company
from shared.db import atomic, current_alias
from shared.db.policy_sql import grant_reachable_tables
from tokens.exceptions import RegisterChangeConflict, RegisterIntegrityError
from tokens.models import (
    RegisterEntry,
    RegisterEntryKind,
    RegisterMember,
    RegisterPosition,
    ShareRegister,
    ShareToken,
)
from tokens.services.register_events import (
    create_member,
    open_register,
    record_entry,
    verify_register,
)

DAY = date(2026, 9, 20)


def register_fixture():
    actor = get_user_model().objects.create_user(
        email=f"register-{uuid4()}@example.test", is_staff=True, is_active=True
    )
    company = Company.objects.create(owner=actor, name="Synthetic register company", acn=str(uuid4())[:8])
    token = ShareToken.objects.create(company=company, name="Synthetic shares", symbol="REG", total_supply="1000")
    member = create_member(company_id=company.pk, member_id=uuid4())
    other = create_member(company_id=company.pk, member_id=uuid4())
    entry = open_register(
        token_id=token.pk,
        operation_id=uuid4(),
        changes=[{"member": str(member.pk), "shares": "100"}],
        effective_on=DAY,
        recorded_by=actor,
    )
    return actor, company, token, member, other, entry


class RegisterEventsTest(TestCase):
    def setUp(self):
        self.actor, self.company, self.token, self.member, self.other, self.opening = register_fixture()
        self.register = self.opening.register

    def record(self, kind=RegisterEntryKind.ISSUE, changes=None, **kwargs):
        return record_entry(
            register_id=self.register.pk,
            operation_id=kwargs.pop("operation_id", uuid4()),
            kind=kind,
            changes=changes if changes is not None else [{"member": str(self.member.pk), "shares": "5"}],
            effective_on=kwargs.pop("effective_on", DAY),
            recorded_by=self.actor,
            **kwargs,
        )

    def shares(self, member):
        return int(RegisterPosition.objects.get(register=self.register, member=member).shares)

    def test_opening_stores_walletless_members_and_replays_without_a_chain_client(self):
        result = verify_register(self.register.pk)
        self.assertEqual((result["entries"], result["members"], result["issued_supply"]), (1, 1, "100"))
        self.assertEqual(self.shares(self.member), 100)
        self.assertEqual(self.opening.previous_hash, "0" * 64)
        self.assertEqual(len(result["head_hash"]), 64)
        self.assertNotEqual(result["head_hash"], "0" * 64)

    def test_empty_opening_is_recorded_and_is_distinct_from_an_uninitialized_register(self):
        token = ShareToken.objects.create(company=self.company, name="Empty", symbol="EMPTY", total_supply="1000")
        entry = open_register(
            token_id=token.pk, operation_id=uuid4(), changes=[], effective_on=DAY, recorded_by=self.actor
        )
        result = verify_register(entry.register_id)
        self.assertEqual((result["entries"], result["members"], result["issued_supply"]), (1, 0, "0"))

    def test_issue_transfer_cessation_and_compensation_preserve_one_hash_chain(self):
        issue = self.record()
        transfer = self.record(
            "transfer",
            [{"member": str(self.member.pk), "shares": "-35"}, {"member": str(self.other.pk), "shares": "35"}],
        )
        cessation = self.record("cessation", [{"member": str(self.other.pk), "shares": "-35"}])
        correction = self.record(
            "correction", [{"member": str(self.other.pk), "shares": "35"}], corrects_id=cessation.pk
        )
        self.assertEqual((self.shares(self.member), self.shares(self.other)), (70, 35))
        self.assertEqual(transfer.previous_hash, issue.entry_hash)
        self.assertEqual(correction.previous_hash, cessation.entry_hash)
        self.assertEqual(verify_register(self.register.pk)["issued_supply"], "105")

    def test_retry_returns_original_entry_but_changed_intent_conflicts(self):
        operation = uuid4()
        entry = self.record(operation_id=operation)
        self.assertEqual(self.record(operation_id=operation).pk, entry.pk)
        with self.assertRaises(RegisterChangeConflict):
            self.record(operation_id=operation, changes=[{"member": str(self.member.pk), "shares": "6"}])
        self.assertEqual(self.shares(self.member), 105)
        self.assertEqual(verify_register(self.register.pk)["entries"], 2)

    def test_opening_retry_preserves_original_member_identity_and_state(self):
        repeated = open_register(
            token_id=self.token.pk,
            operation_id=self.opening.operation_id,
            changes=self.opening.changes,
            effective_on=DAY,
            recorded_by=self.actor,
        )
        self.assertEqual(repeated.pk, self.opening.pk)
        self.assertEqual(create_member(company_id=self.company.pk, member_id=self.member.pk).pk, self.member.pk)
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def test_transfer_order_is_canonicalized_for_retry(self):
        changes = [{"member": str(self.member.pk), "shares": "-20"}, {"member": str(self.other.pk), "shares": "20"}]
        operation = uuid4()
        entry = self.record("transfer", changes, operation_id=operation)
        self.assertEqual(self.record("transfer", list(reversed(changes)), operation_id=operation).pk, entry.pk)
        self.assertEqual((self.shares(self.member), self.shares(self.other)), (80, 20))

    def test_bad_economic_shapes_rollback_the_event_and_projection(self):
        invalid = [
            ("issue", [{"member": str(self.member.pk), "shares": "-1"}]),
            ("issue", [{"member": str(self.member.pk), "shares": "0"}]),
            ("issue", [{"member": str(self.member.pk), "shares": str(2**256)}]),
            ("issue", [{"member": str(self.member.pk), "shares": str(2**256 - 1)}]),
            ("issue", []),
            ("issue", [{"member": str(self.member.pk), "shares": "1"}] * 2),
            (
                "transfer",
                [{"member": str(self.member.pk), "shares": "-101"}, {"member": str(self.other.pk), "shares": "101"}],
            ),
            (
                "transfer",
                [{"member": str(self.member.pk), "shares": "-5"}, {"member": str(self.other.pk), "shares": "6"}],
            ),
            ("cessation", [{"member": str(self.member.pk), "shares": "-99"}]),
            ("opening", []),
            ("correction", [{"member": str(self.member.pk), "shares": "-1"}]),
        ]
        for kind, changes in invalid:
            with self.subTest(kind=kind, changes=changes), self.assertRaises(RegisterChangeConflict):
                self.record(kind, changes)
        self.assertEqual((self.shares(self.member), verify_register(self.register.pk)["entries"]), (100, 1))

    def test_fractional_boolean_and_unknown_payload_fields_are_refused(self):
        for value in (True, "1.5", 1.5, "01", "-0"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.record(changes=[{"member": str(self.member.pk), "shares": value}])
        with self.assertRaises(ValidationError):
            self.record(changes=[{"member": str(self.member.pk), "shares": "1", "name": "No immutable personal data"}])

    def test_cross_company_members_and_registers_are_refused(self):
        company = Company.objects.create(owner=self.actor, name="Another company", acn="87654321")
        member = create_member(company_id=company.pk, member_id=uuid4())
        with self.assertRaises(RegisterChangeConflict):
            self.record(changes=[{"member": str(member.pk), "shares": "1"}])
        with self.assertRaises(RegisterChangeConflict):
            create_member(company_id=company.pk, member_id=self.member.pk)
        token = ShareToken.objects.create(company=company, name="Other shares", symbol="OTHER", total_supply="1000")
        with self.assertRaises(IntegrityError), atomic():
            ShareRegister.objects.create(token=token, company=self.company)
        self.assertEqual(verify_register(self.register.pk)["issued_supply"], "100")

    def test_registered_share_class_cannot_move_between_companies_of_the_same_owner(self):
        company = Company.objects.create(owner=self.actor, name="Another company", acn="87654321")
        with self.assertRaises(IntegrityError), atomic():
            ShareToken.objects.filter(pk=self.token.pk).update(company=company)
        self.token.refresh_from_db()
        self.assertEqual(self.token.company_id, self.company.pk)

    def test_compensation_cannot_be_partial_or_repeated_under_another_operation(self):
        issue = self.record()
        with self.assertRaises(RegisterChangeConflict):
            self.record("correction", [{"member": str(self.member.pk), "shares": "-4"}], corrects_id=issue.pk)
        self.record("correction", [{"member": str(self.member.pk), "shares": "-5"}], corrects_id=issue.pk)
        with self.assertRaises(RegisterChangeConflict):
            self.record("correction", [{"member": str(self.member.pk), "shares": "-5"}], corrects_id=issue.pk)
        self.assertEqual(self.shares(self.member), 100)

    def test_a_compensation_can_itself_be_compensated_without_rewriting_history(self):
        issue = self.record()
        inverse = self.record("correction", [{"member": str(self.member.pk), "shares": "-5"}], corrects_id=issue.pk)
        self.record("correction", [{"member": str(self.member.pk), "shares": "5"}], corrects_id=inverse.pk)
        self.assertEqual((self.shares(self.member), verify_register(self.register.pk)["entries"]), (105, 4))

    def test_correction_retries_accept_uuid_strings_and_objects_as_the_same_identity(self):
        original = self.record()
        operation = uuid4()
        changes = [{"member": str(self.member.pk), "shares": "-5"}]
        entry = self.record("correction", changes, operation_id=operation, corrects_id=str(original.pk))
        self.assertEqual(
            self.record("correction", changes, operation_id=operation, corrects_id=str(original.pk)).pk, entry.pk
        )
        self.assertEqual(
            self.record("correction", changes, operation_id=operation, corrects_id=original.pk).pk, entry.pk
        )

    def test_member_retry_accepts_company_and_member_uuid_strings(self):
        self.assertEqual(
            create_member(company_id=str(self.company.pk), member_id=str(self.member.pk)).pk, self.member.pk
        )

    def test_a_returning_member_has_a_new_entry_date(self):
        self.record("cessation", [{"member": str(self.member.pk), "shares": "-100"}])
        self.record(effective_on=date(2026, 9, 21))
        self.assertEqual(RegisterPosition.objects.get(member=self.member).entered_on, date(2026, 9, 21))
        self.assertEqual(verify_register(self.register.pk)["members"], 1)

    def test_outer_rollback_removes_event_projection_and_head_together(self):
        with self.assertRaisesRegex(RuntimeError, "rollback"), atomic():
            self.record()
            self.assertEqual(self.shares(self.member), 105)
            raise RuntimeError("rollback")
        self.assertEqual((self.shares(self.member), verify_register(self.register.pk)["entries"]), (100, 1))

    def test_operator_orm_cannot_rewrite_or_delete_history_or_projected_holdings(self):
        for model in (RegisterMember, RegisterEntry, RegisterPosition, ShareRegister):
            with self.subTest(model=model.__name__), self.assertRaises(IntegrityError), atomic():
                model.objects.update(created_at="2020-01-01T00:00:00Z")
        with self.assertRaises(IntegrityError), atomic():
            RegisterEntry.objects.filter(pk=self.opening.pk)._raw_delete(current_alias())
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def test_raw_sql_cannot_delete_entries(self):
        with self.assertRaises(IntegrityError), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("DELETE FROM tokens_registerentry WHERE uuid = %s", [self.opening.pk])
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def test_raw_insert_cannot_bypass_economic_validation(self):
        with self.assertRaises(IntegrityError), atomic():
            RegisterEntry.objects.create(
                register=self.register,
                operation_id=uuid4(),
                kind="transfer",
                changes=[{"member": str(self.member.pk), "shares": "1"}],
                effective_on=DAY,
                recorded_by=self.actor,
            )
        self.assertEqual(self.shares(self.member), 100)

    def test_verification_detects_event_tampering_if_a_schema_owner_disables_guards(self):
        with self.assertRaisesRegex(RegisterIntegrityError, "event chain"), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute("ALTER TABLE tokens_registerentry DISABLE TRIGGER USER")
                cursor.execute(
                    "UPDATE tokens_registerentry SET effective_on = '2020-01-01' WHERE uuid = %s", [self.opening.pk]
                )
            verify_register(self.register.pk)
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def test_verification_detects_projected_balance_tampering(self):
        with self.assertRaisesRegex(RegisterIntegrityError, "stored holdings"), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute("ALTER TABLE tokens_registerposition DISABLE TRIGGER USER")
                cursor.execute(
                    "UPDATE tokens_registerposition SET shares = 101 WHERE register_id = %s", [self.register.pk]
                )
            verify_register(self.register.pk)
        self.assertEqual(self.shares(self.member), 100)

    def test_reverse_migration_refuses_to_discard_recorded_history(self):
        migration = importlib.import_module("tokens.migrations.0062_register_foundation")
        with self.assertRaisesRegex(RuntimeError, "Retain register history"):
            with connections[current_alias()].schema_editor(atomic=False) as editor:
                migration.remove_guards(apps, editor)
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def test_grants_refuse_a_missing_table_after_its_creation_migration(self):
        with self.assertRaisesRegex(RuntimeError, "tokens_registerposition"), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute("DROP TABLE tokens_registerposition CASCADE")
            with connections[current_alias()].schema_editor(atomic=False) as editor:
                grant_reachable_tables(editor)
        self.assertEqual(verify_register(self.register.pk)["issued_supply"], "100")

    def test_empty_uninitialized_head_cannot_claim_to_be_a_verified_register(self):
        token = ShareToken.objects.create(company=self.company, name="Uninitialized", symbol="NEW", total_supply="1000")
        register = ShareRegister.objects.create(token=token, company=self.company)
        with self.assertRaises(RegisterIntegrityError):
            verify_register(register.pk)

    def test_database_rejects_personal_fields_even_when_the_service_is_bypassed(self):
        with self.assertRaises(IntegrityError), atomic():
            RegisterEntry.objects.create(
                register=self.register,
                operation_id=uuid4(),
                kind="issue",
                changes=[{"member": str(self.member.pk), "shares": "1", "name": "Synthetic person"}],
                effective_on=DAY,
                recorded_by=self.actor,
            )
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)

    def test_synthetic_operator_command_loads_once_and_verifies_without_rpc(self):
        token = ShareToken.objects.create(company=self.company, name="Imported", symbol="IMPORT", total_supply="1000")
        payload = {
            "operation_id": str(uuid4()),
            "effective_on": DAY.isoformat(),
            "holdings": [{"member": str(uuid4()), "shares": "7"}],
        }
        with TemporaryDirectory() as directory:
            path = Path(directory) / "opening.json"
            path.write_text(json.dumps(payload))
            for _ in range(2):
                output = StringIO()
                call_command(
                    "register_foundation",
                    "load-synthetic-opening",
                    token=token.pk,
                    input=path,
                    actor=self.actor.pk,
                    stdout=output,
                )
                self.assertEqual(json.loads(output.getvalue())["issued_supply"], "7")
            output = StringIO()
            call_command("register_foundation", "verify", token=token.pk, stdout=output)
            self.assertEqual(json.loads(output.getvalue())["entries"], 1)

    def test_command_failure_does_not_leave_members_or_an_empty_register(self):
        count = RegisterMember.objects.count()
        payload = {
            "operation_id": str(uuid4()),
            "effective_on": DAY.isoformat(),
            "holdings": [{"member": str(uuid4()), "shares": "-1"}],
        }
        with TemporaryDirectory() as directory:
            path = Path(directory) / "opening.json"
            path.write_text(json.dumps(payload))
            with self.assertRaises(CommandError):
                call_command(
                    "register_foundation",
                    "load-synthetic-opening",
                    token=self.token.pk,
                    input=path,
                    actor=self.actor.pk,
                )
        self.assertEqual(RegisterMember.objects.count(), count)
        self.assertEqual(verify_register(self.register.pk)["entries"], 1)
