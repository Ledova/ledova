import json
import tempfile
from importlib import import_module
from unittest.mock import patch
from uuid import uuid4

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings

from companies.models import CompanyAppointmentRevocation, CompanyCapability
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import submit_authority_request
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import atomic, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies

OLD = ("companies", "0016_appointee_keyed_appointments")
NEW = ("companies", "0017_company_team_invitations")
APPOINTMENT = "companies_companyappointment"
INVITATION = "companies_companyteaminvitation"
TABLES = (
    APPOINTMENT,
    INVITATION,
    "companies_companyappointmentrevocation",
    "companies_companyauthorityrequest",
    "companies_companyregistrycheck",
)
FUNCTIONS = (
    "companies_guard_initial_appointment",
    "companies_guard_appointment_revocation",
    "companies_current_team_appointment",
    "companies_guard_team_invitation",
    "companies_validate_invited_appointment",
)


class CompanyTeamInvitationMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.owner, self.owner_profile, self.company = authority_fixture("team-migration", "224466880")
            self.invitee, self.invitee_profile, _ = authority_fixture("team-migration-invitee", "335577991")
        self.proposal, created = submit_authority_request(
            requester=self.owner,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
        )
        self.assertTrue(created)
        self.addCleanup(self.latest)

    def migrate(self, target):
        MigrationExecutor(connection).migrate([target])

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def query(self, statement, params=()):
        with connection.cursor() as cursor:
            cursor.execute(statement, params)
            return cursor.fetchall()

    def schema(self):
        return {
            "functions": self.query(
                "SELECT proname, pg_get_functiondef(pg_proc.oid) FROM pg_proc "
                "JOIN pg_namespace ON pg_namespace.oid = pronamespace "
                "WHERE nspname = 'public' AND proname = ANY(%s) ORDER BY proname",
                [list(FUNCTIONS)],
            ),
            "policies": self.query(
                "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check "
                "FROM pg_policies ORDER BY schemaname, tablename, policyname"
            ),
            "tables": self.query(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                "JOIN pg_namespace ON pg_namespace.oid = relnamespace "
                "WHERE nspname = 'public' AND relname = ANY(%s) ORDER BY relname",
                [list(TABLES)],
            ),
            "columns": self.query(
                "SELECT table_name, column_name, is_nullable, data_type, column_default "
                "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY(%s) "
                "ORDER BY table_name, ordinal_position",
                [list(TABLES)],
            ),
            "constraints": self.query(
                "SELECT relname, conname, pg_get_constraintdef(pg_constraint.oid) FROM pg_constraint "
                "JOIN pg_class ON pg_class.oid = conrelid JOIN pg_namespace ON pg_namespace.oid = relnamespace "
                "WHERE nspname = 'public' AND relname = ANY(%s) ORDER BY relname, conname",
                [list(TABLES)],
            ),
            "triggers": self.query(
                "SELECT relname, tgname, tgenabled, pg_get_triggerdef(pg_trigger.oid) FROM pg_trigger "
                "JOIN pg_class ON pg_class.oid = tgrelid JOIN pg_namespace ON pg_namespace.oid = relnamespace "
                "WHERE nspname = 'public' AND relname = ANY(%s) AND NOT tgisinternal ORDER BY relname, tgname",
                [list(TABLES)],
            ),
            "grants": self.query(
                "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
                "WHERE table_schema = 'public' AND table_name = ANY(%s) ORDER BY table_name, grantee, privilege_type",
                [list(TABLES)],
            ),
            "migrations": self.query("SELECT name FROM django_migrations WHERE app = 'companies' ORDER BY name"),
        }

    def records(self):
        records = {}
        for table in TABLES:
            if self.query("SELECT to_regclass(%s)", [table])[0][0] is not None:
                records[table] = [
                    json.loads(row[0])
                    for row in self.query(f"SELECT to_jsonb(retained)::text FROM {table} retained ORDER BY uuid")
                ]
        return records

    def admit(self):
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            return admit_authority_request(
                requester=self.owner,
                request_id=self.proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment

    def issue(self, appointment):
        invitation, code, created = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=appointment.pk,
            idempotency_key=uuid4(),
            capabilities=["prepare"],
            delegatable_capabilities=["approve"],
        )
        self.assertTrue(created)
        return invitation, code

    def test_upgrade_preserves_the_entire_initial_declaration_and_self_revocation_history(self):
        appointment = self.admit()
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        self.migrate(OLD)
        before = self.records()
        old_policies = self.schema()["policies"]
        self.migrate(NEW)
        expected = {**before, INVITATION: []}
        expected[APPOINTMENT] = [{**row, "invitation_id": None} for row in before[APPOINTMENT]]
        self.assertEqual(self.records(), expected)
        upgraded = self.schema()
        self.assertEqual([policy for policy in upgraded["policies"] if policy[1] != INVITATION], old_policies)
        self.assertIn((INVITATION, True, True), upgraded["tables"])
        self.assertEqual(
            [state for table, name, state, _ in upgraded["triggers"] if name == "companies_team_invitation_identity"],
            ["O"],
        )
        self.assertTrue(any(name == "companies_appointment_exact_source" for _, name, _ in upgraded["constraints"]))

    def test_empty_reversal_restores_exact_original_guard_bodies_policies_and_schema_and_can_reapply(self):
        self.migrate(OLD)
        original = self.schema()
        original_records = self.records()
        self.migrate(NEW)
        upgraded = self.schema()
        self.assertNotEqual(upgraded["functions"], original["functions"])
        self.assertEqual(len(upgraded["functions"]), len(FUNCTIONS))
        self.migrate(OLD)
        self.assertEqual(self.schema(), original)
        self.assertEqual(self.records(), original_records)
        self.migrate(NEW)
        self.assertEqual(self.schema(), upgraded)

    def test_reversal_refuses_unaccepted_and_accepted_invitation_history_without_changing_any_record(self):
        appointment = self.admit()
        invitation, code = self.issue(appointment)
        for accepted in (False, True):
            with self.subTest(accepted=accepted):
                if accepted:
                    child = accept_team_invitation(
                        requester=self.invitee,
                        code=code,
                        declaration_version=DECLARATION_VERSION,
                        accept_declaration=True,
                    )
                    self.assertEqual(child.invitation_id, invitation.pk)
                    self.assertIsNone(child.request_id)
                    self.assertIsNone(child.registry_check_id)
                before_schema, before_records = self.schema(), self.records()
                with self.assertRaisesMessage(RuntimeError, "Retain company team invitations and appointments"):
                    self.migrate(OLD)
                self.assertEqual(self.schema(), before_schema)
                self.assertEqual(self.records(), before_records)

    def test_reversal_refuses_retained_revocation_by_another_actor_before_discarding_its_provenance(self):
        appointment = self.admit()
        with atomic(), connection.cursor() as cursor:
            cursor.execute(
                "ALTER TABLE companies_companyappointmentrevocation "
                "DISABLE TRIGGER companies_appointment_revocation_identity"
            )
            CompanyAppointmentRevocation.objects.using(connection.alias).create(
                appointment=appointment, revoked_by=self.invitee
            )
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(
                "ALTER TABLE companies_companyappointmentrevocation "
                "ENABLE TRIGGER companies_appointment_revocation_identity"
            )
        before_schema, before_records = self.schema(), self.records()
        with self.assertRaisesMessage(RuntimeError, "Retain company administrator revocations"):
            self.migrate(OLD)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)

    def test_failed_upgrade_rolls_back_new_tables_fields_functions_policies_and_partial_guard_changes(self):
        self.admit()
        self.migrate(OLD)
        before_schema, before_records = self.schema(), self.records()
        migration = import_module("companies.migrations.0017_company_team_invitations")
        original_replace = migration.replace_once

        def refuse_revocation(body, old, new):
            if old == migration.REVOCATION_PROPOSAL_DECLARATION:
                raise RuntimeError("synthetic failure after initial guard extension")
            return original_replace(body, old, new)

        with (
            patch.object(migration, "replace_once", refuse_revocation),
            self.assertRaisesMessage(RuntimeError, "synthetic failure after initial guard extension"),
        ):
            self.migrate(NEW)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
        self.latest()

    def test_failed_reversal_rolls_back_the_partially_restored_initial_guard_and_keeps_the_upgrade(self):
        self.admit()
        before_schema, before_records = self.schema(), self.records()
        migration = import_module("companies.migrations.0017_company_team_invitations")
        original_replace = migration.replace_once

        def refuse_revocation(body, old, new):
            if old == migration.REVOCATION_AUTHORITY:
                raise RuntimeError("synthetic failure after initial guard restoration")
            return original_replace(body, old, new)

        with (
            patch.object(migration, "replace_once", refuse_revocation),
            self.assertRaisesMessage(RuntimeError, "synthetic failure after initial guard restoration"),
        ):
            self.migrate(OLD)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
