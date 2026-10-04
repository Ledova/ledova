import tempfile
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings

from companies.models import CompanyAppointment
from companies.services.authority import (
    DECLARATION_VERSION,
    admit_authority_request,
)
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import atomic, current_alias, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies

OLD = ("companies", "0015_self_declared_company_appointments")
NEW = ("companies", "0016_appointee_keyed_appointments")
TABLE = "companies_companyappointment"
TRIGGER = "companies_initial_appointment_identity"
ONE_PER_COMPANY = "companies_one_initial_appointment_per_company"
READ_TERM = f"SELECT qual FROM pg_policies WHERE tablename = '{TABLE}' AND policyname = '{TABLE}_read'"
GUARD_BODY = "SELECT prosrc FROM pg_proc WHERE proname = 'companies_guard_initial_appointment'"
TRIGGER_STATE = f"SELECT tgenabled FROM pg_trigger WHERE tgname = '{TRIGGER}'"
APPOINTEE_CHECK = "NEW.appointee_id IS DISTINCT FROM proposal.requester_id"


class AppointeeKeyedAppointmentsMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("appointee-migration", "224466880")
            self.other, self.other_profile, _ = authority_fixture("other-appointee-migration", "335577991")
        self.proposal = self.submit()
        self.addCleanup(self.latest)

    def submit(self):
        proposal, created = submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
        )
        self.assertTrue(created)
        return proposal

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def admit(self):
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            admitted = admit_authority_request(
                requester=self.user,
                request_id=self.proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        return admitted.appointment

    def columns(self):
        with connection.cursor() as cursor:
            return {column.name for column in connection.introspection.get_table_description(cursor, TABLE)}

    def installed(self, statement, params=()):
        with connection.cursor() as cursor:
            cursor.execute(statement, params)
            row = cursor.fetchone()
        return row[0] if row else None

    def rekey(self, appointment, appointee, profile):
        with connection.cursor() as cursor:
            cursor.execute(f"ALTER TABLE {TABLE} DISABLE TRIGGER {TRIGGER}")
            cursor.execute(
                f"UPDATE {TABLE} SET appointee_id = %s, appointee_profile_id = %s WHERE uuid = %s",
                [appointee.pk, profile.pk, appointment.pk],
            )
            cursor.execute(f"ALTER TABLE {TABLE} ENABLE TRIGGER {TRIGGER}")

    def test_upgrade_backfills_the_appointee_and_keeps_the_bootstrap_one_per_company(self):
        admitted = self.admit()
        MigrationExecutor(connection).migrate([OLD])
        self.assertFalse({"appointee_id", "appointee_profile_id"} & self.columns())
        self.assertEqual(self.installed(f"SELECT request_id FROM {TABLE}"), self.proposal.pk)
        MigrationExecutor(connection).migrate([NEW])
        with use_operator():
            appointment = CompanyAppointment.objects.get(pk=admitted.pk)
        self.assertEqual((appointment.appointee_id, appointment.appointee_profile_id), (self.user.pk, self.profile.pk))
        self.assertEqual(self.installed(TRIGGER_STATE), "O")
        self.assertIn("appointee_id = ", self.installed(READ_TERM))
        self.assertIn(APPOINTEE_CHECK, self.installed(GUARD_BODY))
        with (
            use_operator(),
            self.assertRaisesMessage(DatabaseError, "Retain immutable company appointments"),
            atomic(),
        ):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(f"UPDATE {TABLE} SET appointee_id = %s WHERE uuid = %s", [self.other.pk, admitted.pk])
        second = self.submit()
        with (
            use_operator(),
            _requester_principal(self.user.pk),
            self.assertRaisesMessage(DatabaseError, ONE_PER_COMPANY),
            atomic(),
        ):
            CompanyAppointment.objects.create(
                company=self.company,
                appointee=self.user,
                appointee_profile=self.profile,
                request=second,
                registry_check_id=admitted.registry_check_id,
                capabilities=second.requested_capabilities,
                delegatable_capabilities=second.delegatable_capabilities,
                expires_at=second.requested_expires_at,
                declaration_version=admitted.declaration_version,
                declaration_text=admitted.declaration_text,
            )
        with use_operator():
            self.assertEqual(list(CompanyAppointment.objects.values_list("pk", flat=True)), [admitted.pk])

    def test_empty_reversal_restores_request_keyed_reads_and_can_be_reapplied(self):
        MigrationExecutor(connection).migrate([OLD])
        self.assertFalse({"appointee_id", "appointee_profile_id"} & self.columns())
        self.assertIn("requester_id = ", self.installed(READ_TERM))
        self.assertNotIn("appointee", self.installed(GUARD_BODY))
        self.assertIsNone(self.installed("SELECT to_regclass(%s)", [ONE_PER_COMPANY]))
        self.latest()
        self.assertLessEqual({"appointee_id", "appointee_profile_id"}, self.columns())
        self.assertIn("appointee_id = ", self.installed(READ_TERM))
        self.assertIn(APPOINTEE_CHECK, self.installed(GUARD_BODY))
        self.assertIsNotNone(self.installed("SELECT to_regclass(%s)", [ONE_PER_COMPANY]))
        appointment = self.admit()
        self.assertEqual((appointment.appointee_id, appointment.appointee_profile_id), (self.user.pk, self.profile.pk))

    def test_reversal_refuses_an_appointment_keyed_on_someone_other_than_its_requester(self):
        admitted = self.admit()
        self.rekey(admitted, self.other, self.other_profile)
        with self.assertRaisesMessage(RuntimeError, "Retain appointments keyed on an appointee"):
            MigrationExecutor(connection).migrate([OLD])
        self.assertIn("appointee_id", self.columns())
        with use_operator():
            appointment = CompanyAppointment.objects.get(pk=admitted.pk)
        self.assertEqual(
            (appointment.appointee_id, appointment.appointee_profile_id), (self.other.pk, self.other_profile.pk)
        )
        self.rekey(admitted, self.user, self.profile)
