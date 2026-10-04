import tempfile
from importlib import import_module
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings

from companies.models import (
    CompanyAppointment,
    CompanyAuthorityRequest,
    CompanyCapability,
)
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
from companies.tests.test_team_invitations import raw_team_appointment
from operators.models import Operator
from shared.db import use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserProfile

OLD = ("companies", "0017_company_team_invitations")
NEW = ("companies", "0018_team_invitation_admission_guards")
MODULE = "companies.migrations.0018_team_invitation_admission_guards"
GUARD = "companies_validate_invited_appointment"


class CompanyTeamInvitationGuardMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.owner, self.owner_profile, self.company = authority_fixture("guard-migration", "224466880")
            self.invitee, self.invitee_profile, _ = authority_fixture("guard-migration-invitee", "335577991")
            UserProfile.objects.filter(pk__in=[self.owner_profile.pk, self.invitee_profile.pk]).update(
                is_id_verified=True
            )
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.proposal, created = submit_authority_request(
            requester=self.owner,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
        )
        self.assertTrue(created)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            self.initial = admit_authority_request(
                requester=self.owner,
                request_id=self.proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment
        self.addCleanup(self.latest)
        self.migrate(OLD)

    def migrate(self, target):
        MigrationExecutor(connection).migrate([target])

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def query(self, statement, parameters=()):
        with connection.cursor() as cursor:
            cursor.execute(statement, parameters)
            return cursor.fetchall()

    def guard_definition(self):
        return self.query("SELECT pg_get_functiondef('companies_validate_invited_appointment'::regproc)")[0][0]

    def state(self):
        functions = {
            (name, arguments): (definition, owner, acl)
            for name, arguments, definition, owner, acl in self.query(
                "SELECT proname, pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid), "
                "pg_get_userbyid(proowner), proacl::text FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid = pronamespace "
                "WHERE n.nspname = 'public' AND prokind = 'f' ORDER BY proname, p.oid"
            )
        }
        schema = {
            "tables": self.query(
                "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
            ),
            "rls": self.query(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                "JOIN pg_namespace n ON n.oid = relnamespace WHERE nspname = 'public' ORDER BY relname"
            ),
            "columns": self.query(
                "SELECT table_name, column_name, is_nullable, data_type, column_default "
                "FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
            ),
            "constraints": self.query(
                "SELECT relname, conname, pg_get_constraintdef(c.oid) FROM pg_constraint c "
                "JOIN pg_class r ON r.oid = conrelid JOIN pg_namespace n ON n.oid = relnamespace "
                "WHERE nspname = 'public' ORDER BY relname, conname"
            ),
            "triggers": self.query(
                "SELECT relname, tgname, tgenabled, pg_get_triggerdef(t.oid) FROM pg_trigger t "
                "JOIN pg_class r ON r.oid = tgrelid JOIN pg_namespace n ON n.oid = relnamespace "
                "WHERE nspname = 'public' AND NOT tgisinternal ORDER BY relname, tgname"
            ),
            "policies": self.query(
                "SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check "
                "FROM pg_policies ORDER BY schemaname, tablename, policyname"
            ),
            "grants": self.query(
                "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
                "WHERE table_schema = 'public' ORDER BY table_name, grantee, privilege_type"
            ),
            "functions": functions,
        }
        records = {
            table: self.query(
                f"SELECT to_jsonb(retained)::text FROM {connection.ops.quote_name(table)} retained "
                "ORDER BY to_jsonb(retained)::text"
            )
            for table, _owner in schema["tables"]
            if table != "django_migrations"
        }
        private = {}
        for proposal in CompanyAuthorityRequest.objects.using(connection.alias).all():
            with proposal.file.open("rb") as retained:
                private[str(proposal.pk)] = retained.read()
        return {
            "schema": schema,
            "records": records,
            "private": private,
            "migrations": self.query("SELECT app, name FROM django_migrations ORDER BY app, name"),
        }

    def assert_only_invited_guard_changed(self, before, after):
        self.assertEqual(after["records"], before["records"])
        self.assertEqual(after["private"], before["private"])
        self.assertEqual(
            {key: value for key, value in after["schema"].items() if key != "functions"},
            {key: value for key, value in before["schema"].items() if key != "functions"},
        )
        old_functions, new_functions = before["schema"]["functions"], after["schema"]["functions"]
        self.assertEqual(set(old_functions), set(new_functions))
        changed = [key for key in old_functions if old_functions[key] != new_functions[key]]
        self.assertEqual([key[0] for key in changed], [GUARD])
        self.assertEqual(old_functions[changed[0]][1:], new_functions[changed[0]][1:])
        self.assertEqual(set(after["migrations"]) - set(before["migrations"]), {NEW})
        self.assertFalse(set(before["migrations"]) - set(after["migrations"]))

    def issue(self, actor=None, source=None, capabilities=("prepare",), delegatable=("approve",)):
        invitation, code, created = issue_team_invitation(
            requester=actor or self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=(source or self.initial).pk,
            idempotency_key=uuid4(),
            capabilities=list(capabilities),
            delegatable_capabilities=list(delegatable),
        )
        self.assertTrue(created)
        return invitation, code

    def old_admissions(self):
        first, first_code = self.issue()
        child_id = raw_team_appointment(
            invitation=first, code=first_code, actor=self.invitee, profile=self.invitee_profile
        )
        with use_operator():
            child = CompanyAppointment.objects.get(pk=child_id)
        own, own_code = self.issue(actor=self.invitee, source=child, capabilities=("approve",), delegatable=())
        own_id = raw_team_appointment(invitation=own, code=own_code, actor=self.invitee, profile=self.invitee_profile)
        overlapping, overlapping_code = self.issue(capabilities=("finance",), delegatable=())
        overlapping_id = raw_team_appointment(
            invitation=overlapping, code=overlapping_code, actor=self.invitee, profile=self.invitee_profile
        )
        revoke_company_appointment(requester=self.invitee, appointment_id=own_id)
        return own_code, own_id, overlapping_code, overlapping_id

    def test_populated_upgrade_retains_old_self_and_overlap_admissions_and_private_evidence(self):
        own_code, own_id, overlapping_code, overlapping_id = self.old_admissions()
        before = self.state()
        self.migrate(NEW)
        upgraded = self.state()
        self.assert_only_invited_guard_changed(before, upgraded)
        for code, identifier in ((own_code, own_id), (overlapping_code, overlapping_id)):
            retained = accept_team_invitation(
                requester=self.invitee,
                code=code,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
            self.assertEqual(retained.pk, identifier)
        self.assertEqual(self.state(), upgraded)
        invitation, code = self.issue(capabilities=("apply",), delegatable=())
        history = self.state()
        with self.assertRaises(DatabaseError):
            raw_team_appointment(invitation=invitation, code=code, actor=self.invitee, profile=self.invitee_profile)
        self.assertEqual(self.state(), history)

    def test_populated_reversal_restores_exact_prior_schema_and_guard_and_can_reapply(self):
        self.old_admissions()
        original = self.state()
        self.migrate(NEW)
        upgraded = self.state()
        self.assert_only_invited_guard_changed(original, upgraded)
        self.migrate(OLD)
        self.assertEqual(self.state(), original)
        self.migrate(NEW)
        self.assertEqual(self.state(), upgraded)

    def test_reversal_without_invited_rows_restores_exact_prior_schema_and_can_reapply(self):
        original = self.state()
        self.migrate(NEW)
        upgraded = self.state()
        self.assert_only_invited_guard_changed(original, upgraded)
        self.migrate(OLD)
        self.assertEqual(self.state(), original)
        self.migrate(NEW)
        self.assertEqual(self.state(), upgraded)

    def test_unexpected_predecessor_clause_refuses_atomically_without_changing_retained_data(self):
        migration = import_module(MODULE)
        original = self.guard_definition()
        replacements = (
            migration.OLD_CLAUSE.replace("invitation.uuid IS NULL", "invitation.uuid IS NOT DISTINCT FROM NULL"),
            migration.OLD_CLAUSE + migration.OLD_CLAUSE,
        )
        for replacement in replacements:
            with self.subTest(replacement=replacement):
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(original.replace(migration.OLD_CLAUSE, replacement))
                    predecessor = self.state()
                    with self.assertRaisesMessage(RuntimeError, "no longer has the exact clause"):
                        self.migrate(NEW)
                    self.assertEqual(self.state(), predecessor)
                finally:
                    with connection.cursor() as cursor:
                        cursor.execute(original)

    def test_failed_upgrade_after_guard_replacement_restores_every_prior_function_record_and_private_byte(self):
        original = self.state()
        migration = import_module(MODULE)
        replace_guard = migration.replace_guard

        def fail_after_replacement(*arguments):
            replace_guard(*arguments)
            raise RuntimeError("synthetic failure after invited guard replacement")

        with patch.object(migration, "replace_guard", fail_after_replacement), self.assertRaisesMessage(
            RuntimeError, "synthetic failure after invited guard replacement"
        ):
            self.migrate(NEW)
        self.assertEqual(self.state(), original)
        self.migrate(NEW)
        self.assert_only_invited_guard_changed(original, self.state())

    def test_failed_reversal_after_guard_replacement_retains_the_entire_upgraded_state(self):
        self.migrate(NEW)
        upgraded = self.state()
        migration = import_module(MODULE)
        replace_guard = migration.replace_guard

        def fail_after_replacement(*arguments):
            replace_guard(*arguments)
            raise RuntimeError("synthetic failure after invited guard restoration")

        with patch.object(migration, "replace_guard", fail_after_replacement), self.assertRaisesMessage(
            RuntimeError, "synthetic failure after invited guard restoration"
        ):
            self.migrate(OLD)
        self.assertEqual(self.state(), upgraded)
