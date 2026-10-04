import json
import tempfile
from datetime import timedelta
from importlib import import_module
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyDocument,
    CompanyLegacyOwnerSource,
)
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import (
    submit_authority_request,
    withdraw_authority_request,
)
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests import test_team_invitation_migration as invitation_migration
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    PDF,
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import atomic, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserProfile

OLD = ("companies", "0018_team_invitation_admission_guards")
NEW = ("companies", "0019_legacy_owner_appointments")
PROVENANCE = "companies.0019_legacy_owner_appointments"
SOURCE = "companies_companylegacyownersource"
APPOINTMENT = "companies_companyappointment"
TABLES = (
    "authentication_customuser",
    "users_userprofile",
    "operators_operator",
    "companies_company",
    "companies_companydocument",
    "companies_companyauthorityrequest",
    "companies_companyauthorityrequestwithdrawal",
    "companies_companyregistrycheck",
    "companies_companyteaminvitation",
    APPOINTMENT,
    "companies_companyappointmentrevocation",
    SOURCE,
)
FUNCTIONS = (
    "companies_guard_initial_appointment",
    "companies_guard_appointment_revocation",
    "companies_current_team_appointment",
    "companies_guard_team_invitation",
    "companies_validate_invited_appointment",
    "companies_guard_legacy_owner_source",
)


class CompanyLegacyOwnerMigrationTest(StubUploadDependencies, TransactionTestCase):
    query = invitation_migration.CompanyTeamInvitationMigrationTest.query

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        self.addCleanup(self.latest)
        with use_operator():
            self.owner, self.profile, self.company = authority_fixture("legacy-upgrade", "114477880")
            self.other, self.other_profile, self.other_company = authority_fixture("legacy-other", "225588991")
            UserProfile.objects.filter(pk__in=[self.profile.pk, self.other_profile.pk]).update(is_id_verified=True)
            self.document = CompanyDocument.objects.create(
                company=self.company,
                document_type="constitution",
                name="Retained synthetic constitution",
                file=evidence(),
                file_size=len(PDF),
                mime_type="application/pdf",
                notes="Private retained evidence",
            )
        self.pending = self.submit(self.owner, self.company)
        withdrawn = self.submit(self.owner, self.company)
        self.withdrawn = withdraw_authority_request(requester=self.owner, request_id=withdrawn.pk)

    def migrate(self, target):
        MigrationExecutor(connection).migrate([target])

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def submit(self, actor, company, **changes):
        request, created = submit_authority_request(
            requester=actor,
            company_id=company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=sorted(CompanyCapability.values),
            **changes,
        )
        self.assertTrue(created)
        return request

    def admit(self, actor, company, proposal=None):
        proposal = proposal or self.submit(actor, company)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            return admit_authority_request(
                requester=actor,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment

    def schema(self):
        snapshot = invitation_migration.CompanyTeamInvitationMigrationTest.schema(self)
        snapshot["functions"] = self.query(
            "SELECT proname, pg_get_functiondef(pg_proc.oid) FROM pg_proc "
            "JOIN pg_namespace ON pg_namespace.oid = pronamespace "
            "WHERE nspname = 'public' AND proname = ANY(%s) ORDER BY proname",
            [list(FUNCTIONS)],
        )
        for key, statement in {
            "tables": "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
            "JOIN pg_namespace ON pg_namespace.oid = relnamespace "
            "WHERE nspname = 'public' AND relname = ANY(%s) ORDER BY relname",
            "columns": "SELECT table_name, column_name, is_nullable, data_type, column_default "
            "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY(%s) "
            "ORDER BY table_name, ordinal_position",
            "constraints": "SELECT relname, conname, pg_get_constraintdef(pg_constraint.oid) FROM pg_constraint "
            "JOIN pg_class ON pg_class.oid = conrelid JOIN pg_namespace ON pg_namespace.oid = relnamespace "
            "WHERE nspname = 'public' AND relname = ANY(%s) ORDER BY relname, conname",
            "triggers": "SELECT relname, tgname, tgenabled, pg_get_triggerdef(pg_trigger.oid) FROM pg_trigger "
            "JOIN pg_class ON pg_class.oid = tgrelid JOIN pg_namespace ON pg_namespace.oid = relnamespace "
            "WHERE nspname = 'public' AND relname = ANY(%s) AND NOT tgisinternal ORDER BY relname, tgname",
            "grants": "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
            "WHERE table_schema = 'public' AND table_name = ANY(%s) ORDER BY table_name, grantee, privilege_type",
            "indexes": "SELECT tablename, indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND tablename = ANY(%s) ORDER BY tablename, indexname",
        }.items():
            snapshot[key] = self.query(statement, [list(TABLES)])
        return snapshot

    def records(self):
        retained = {}
        for table in TABLES:
            if self.query("SELECT to_regclass(%s)", [table])[0][0] is not None:
                retained[table] = [
                    json.loads(row[0])
                    for row in self.query(
                        f"SELECT to_jsonb(record)::text FROM {table} record ORDER BY to_jsonb(record)::text"
                    )
                ]
        return retained

    def assert_private_bytes_retained(self):
        for record in (self.pending, self.withdrawn, self.document):
            with record.file.open("rb") as stored:
                self.assertEqual(stored.read(), PDF)

    def assert_existing_records_retained(self, before):
        after = self.records()
        for table, records in before.items():
            if table == SOURCE:
                continue
            expected = [{**row, "legacy_owner_id": None} for row in records] if table == APPOINTMENT else records
            if table == APPOINTMENT:
                after[table] = [row for row in after[table] if row["legacy_owner_id"] is None]
            self.assertEqual(after[table], expected, table)
        self.assert_private_bytes_retained()

    def set_expiry(self, appointment, expiry):
        with atomic(), connection.cursor() as cursor:
            cursor.execute(f"ALTER TABLE {APPOINTMENT} DISABLE TRIGGER companies_initial_appointment_identity")
            cursor.execute(f"UPDATE {APPOINTMENT} SET expires_at = %s WHERE uuid = %s", [expiry, appointment.pk])
            cursor.execute(f"ALTER TABLE {APPOINTMENT} ENABLE TRIGGER companies_initial_appointment_identity")

    def test_populated_upgrade_preserves_real_owners_profiles_evidence_actors_and_pending_history(self):
        with use_operator():
            shared_company = Company.objects.create(owner=self.owner, name="Same owner Pty Ltd", acn="336699002")
            UserProfile.objects.filter(pk=self.other_profile.pk).update(full_name="", is_id_verified=False)
            get_user_model().objects.filter(pk=self.other.pk).update(is_active=False, is_email_verified=False)
            Company.objects.filter(pk=self.other_company.pk).update(status="suspended", suspended_at=timezone.now())
        self.migrate(OLD)
        before = self.records()
        invited_guard = self.query("SELECT pg_get_functiondef('companies_validate_invited_appointment'::regproc)")
        earliest = timezone.now()
        with patch("companies.services.registry.lookup_company", side_effect=AssertionError("migration called ABR")):
            self.migrate(NEW)
        latest = timezone.now()
        self.assertEqual(
            self.query("SELECT pg_get_functiondef('companies_validate_invited_appointment'::regproc)"), invited_guard
        )
        self.assert_existing_records_retained(before)
        with use_operator():
            sources = CompanyLegacyOwnerSource.objects.in_bulk(field_name="company_id")
            self.assertEqual(set(sources), {self.company.pk, self.other_company.pk, shared_company.pk})
            for company, owner, profile in (
                (self.company, self.owner, self.profile),
                (self.other_company, self.other, self.other_profile),
                (shared_company, self.owner, self.profile),
            ):
                source = sources[company.pk]
                self.assertEqual(
                    (source.owner_id, source.owner_profile_id, source.provenance), (owner.pk, profile.pk, PROVENANCE)
                )
                self.assertLessEqual(earliest, source.created_at)
                self.assertLessEqual(source.created_at, latest)
                appointment = CompanyAppointment.objects.get(legacy_owner=source)
                self.assertEqual(
                    (appointment.company_id, appointment.appointee_id, appointment.appointee_profile_id),
                    (company.pk, owner.pk, profile.pk),
                )
                self.assertEqual(appointment.capabilities, ["admin"])
                self.assertEqual(appointment.delegatable_capabilities, sorted(CompanyCapability.values))
                self.assertEqual(
                    (
                        appointment.request_id,
                        appointment.invitation_id,
                        appointment.registry_check_id,
                        appointment.expires_at,
                        appointment.declaration_version,
                        appointment.declaration_text,
                    ),
                    (None,) * 6,
                )
                self.assertLessEqual(earliest, appointment.created_at)
                self.assertLessEqual(appointment.created_at, latest)
        self.assertIn((SOURCE, True, True), self.schema()["tables"])
        self.assertEqual(
            self.query("SELECT tgenabled FROM pg_trigger WHERE tgname = 'companies_initial_appointment_identity'"),
            [("O",)],
        )

    def test_any_existing_request_root_excludes_seeding_even_expired_revoked_or_changed_owner(self):
        initial = self.admit(self.owner, self.company, self.pending)
        with use_operator():
            expired_company = Company.objects.create(owner=self.owner, name="Expired root Pty Ltd", acn="447700113")
            revoked_company = Company.objects.create(owner=self.owner, name="Revoked root Pty Ltd", acn="558811224")
        expired = self.admit(self.owner, expired_company)
        revoked = self.admit(self.owner, revoked_company)
        self.set_expiry(expired, timezone.now() - timedelta(days=1))
        revoke_company_appointment(requester=self.owner, appointment_id=revoked.pk)
        invitation, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=initial.pk,
            idempotency_key=uuid4(),
            capabilities=["prepare"],
        )
        child = accept_team_invitation(
            requester=self.other, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
        self.migrate(OLD)
        before = self.records()
        self.migrate(NEW)
        self.assert_existing_records_retained(before)
        with use_operator():
            self.assertEqual(
                list(CompanyLegacyOwnerSource.objects.values_list("company_id", flat=True)), [self.other_company.pk]
            )
            self.assertEqual(CompanyAppointment.objects.get(pk=child.pk).invitation_id, invitation.pk)
            self.assertEqual(CompanyAppointment.objects.filter(request__isnull=False).count(), 3)

    def test_missing_actual_owner_profile_aborts_the_entire_upgrade_before_any_seed_insert(self):
        self.migrate(OLD)
        with use_operator():
            owner = get_user_model().objects.create_user(email="legacy-no-profile@example.test", password="pw-12345678")
            Company.objects.create(owner=owner, name="Missing real profile Pty Ltd", acn="669922335")
        before_schema, before_records = self.schema(), self.records()
        inserted = []

        def observe(execute, sql, params, many, context):
            if sql.lstrip().upper().startswith("INSERT INTO") and SOURCE in sql:
                inserted.append(sql)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(observe), self.assertRaises(RuntimeError):
            self.migrate(NEW)
        self.assertEqual(inserted, [])
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
        with use_operator():
            UserProfile.objects.create(user=owner, full_name="Actual supplied profile")

    def test_failure_after_a_source_insert_rolls_back_rows_schema_and_trigger_state(self):
        self.assert_failed_upgrade_rolls_back(f"INSERT INTO {SOURCE}")

    def test_failure_after_disabling_the_appointment_guard_rolls_back_every_change(self):
        self.assert_failed_upgrade_rolls_back("DISABLE TRIGGER companies_initial_appointment_identity")

    def assert_failed_upgrade_rolls_back(self, anchor):
        self.migrate(OLD)
        before_schema, before_records = self.schema(), self.records()
        intercepted = []

        def fail_after_effect(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if anchor in sql.replace('"', ""):
                intercepted.append(sql)
                raise RuntimeError("synthetic interrupted legacy upgrade")
            return result

        with connection.execute_wrapper(fail_after_effect), self.assertRaisesMessage(
            RuntimeError, "synthetic interrupted legacy upgrade"
        ):
            self.migrate(NEW)
        self.assertEqual(len(intercepted), 1)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
        self.assert_private_bytes_retained()

    def test_empty_reversal_restores_exact_0018_guards_policies_grants_constraints_indexes_and_records(self):
        self.admit(self.owner, self.company, self.pending)
        self.admit(self.other, self.other_company)
        self.migrate(OLD)
        old_schema, old_records = self.schema(), self.records()
        invited_guard = next(
            row for row in old_schema["functions"] if row[0] == "companies_validate_invited_appointment"
        )
        guard_migration = import_module("companies.migrations.0018_team_invitation_admission_guards")
        self.assertEqual(invited_guard[1].count(guard_migration.NEW_CLAUSE), 1)
        self.migrate(NEW)
        new_schema, new_records = self.schema(), self.records()
        self.assertEqual(
            next(row for row in new_schema["functions"] if row[0] == "companies_validate_invited_appointment"),
            invited_guard,
        )
        with use_operator():
            self.assertFalse(CompanyLegacyOwnerSource.objects.exists())
        self.migrate(OLD)
        self.assertEqual(self.schema(), old_schema)
        self.assertEqual(self.records(), old_records)
        self.migrate(NEW)
        self.assertEqual(self.schema(), new_schema)
        self.assertEqual(self.records(), new_records)

    def test_populated_reverse_refuses_before_changing_any_schema_or_private_record(self):
        self.migrate(OLD)
        self.migrate(NEW)
        self.assert_populated_reverse_refused()

    def test_retained_source_alone_also_refuses_reverse_without_discarding_provenance(self):
        self.migrate(OLD)
        self.migrate(NEW)
        with atomic(), connection.cursor() as cursor:
            cursor.execute(f"ALTER TABLE {APPOINTMENT} DISABLE TRIGGER companies_initial_appointment_identity")
            cursor.execute(f"DELETE FROM {APPOINTMENT} WHERE legacy_owner_id IS NOT NULL")
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(f"ALTER TABLE {APPOINTMENT} ENABLE TRIGGER companies_initial_appointment_identity")
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())
            self.assertTrue(CompanyLegacyOwnerSource.objects.exists())
        self.assert_populated_reverse_refused()

    def assert_populated_reverse_refused(self):
        before_schema, before_records = self.schema(), self.records()
        with self.assertRaises(RuntimeError):
            self.migrate(OLD)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
        self.assert_private_bytes_retained()
