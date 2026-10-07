from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings

from companies.models import Company, CompanyStatus
from shared.db import (
    APP_ALIAS,
    MIGRATE_ALIAS,
    OPERATOR_ALIAS,
    current_alias,
    use_migrate,
    use_operator,
)
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.models import (
    RegisterDeployment,
    RegisterDeploymentDecision,
    TokenDeployment,
)
from tokens.services import deployment
from tokens.services.register_deployments import (
    decide_deployment,
    prepare_deployment,
    preview_deployment_decision,
)
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    FACTORY,
    KEY,
    legacy_deployment_token,
)
from tokens.tests.evidence_fixtures import owner_appointment

BEFORE = "0097_company_register_transfer_guards"
MODELS = "0098_company_register_deployments"
GUARDS = "0099_company_register_deployment_guards"
SOURCE_TABLES = {"tokens_registerdeployment", "tokens_registerdeploymentdecision"}
LEGACY_RECORDS = (
    ("tokens", "TokenDeployment"),
    ("tokens", "ShareToken"),
    ("blockchain", "OutgoingOperation"),
    ("blockchain", "SignedAttempt"),
    ("blockchain", "SigningAccount"),
    ("blockchain", "BlockchainTransaction"),
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class RegisterDeploymentMigrationTest(TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(restore_every_migration)

    def migrate(self, name):
        with use_migrate():
            return migrate_to([("tokens", name)])

    def schema(self):
        connection = connections[MIGRATE_ALIAS]
        with connection.cursor() as cursor:
            tables = set(connection.introspection.table_names(cursor))
            columns = {
                column.name
                for column in connection.introspection.get_table_description(cursor, "tokens_tokendeployment")
            }
            cursor.execute(
                "SELECT tgdeferrable, tginitdeferred FROM pg_trigger "
                "WHERE tgname = 'tokens_register_deployment_preparation' AND NOT tgisinternal"
            )
            preparation = cursor.fetchall()
        return tables & SOURCE_TABLES, "source_deployment_id" in columns, preparation

    def records(self, apps):
        with use_operator():
            return {
                name: list(apps.get_model(app, name).objects.order_by("pk").values()) for app, name in LEGACY_RECORDS
            }

    def assert_legacy(self, apps, original, *, source_column):
        current = self.records(apps)
        if source_column:
            for journal in current["TokenDeployment"]:
                self.assertIsNone(journal.pop("source_deployment_id"))
        self.assertEqual(current, original)

    def test_empty_models_and_guards_reverse_and_forward_without_retained_history(self):
        with use_operator():
            self.assertFalse(RegisterDeployment.objects.exists())
            self.assertFalse(RegisterDeploymentDecision.objects.exists())
            self.assertFalse(TokenDeployment.objects.exists())
        self.assertEqual(self.schema(), (SOURCE_TABLES, True, [(True, True)]))
        self.migrate(MODELS)
        self.assertEqual(self.schema(), (SOURCE_TABLES, True, []))
        self.migrate(BEFORE)
        self.assertEqual(self.schema(), (set(), False, []))
        models = self.migrate(MODELS)
        self.assertTrue(models.get_model("tokens", "TokenDeployment")._meta.get_field("source_deployment").null)
        self.assertTrue(models.get_model("tokens", "TokenDeployment")._meta.get_field("principal_id").null)
        self.assertEqual(self.schema(), (SOURCE_TABLES, True, []))
        current = self.migrate(GUARDS)
        self.assertEqual(self.schema(), (SOURCE_TABLES, True, [(True, True)]))
        with use_operator():
            self.assertFalse(current.get_model("tokens", "RegisterDeployment").objects.exists())
            self.assertFalse(current.get_model("tokens", "RegisterDeploymentDecision").objects.exists())
            self.assertFalse(current.get_model("tokens", "TokenDeployment").objects.exists())

    def test_legacy_null_sources_principals_intents_and_signed_bytes_survive_both_directions(self):
        with use_operator():
            signed = legacy_deployment_token("retained-signed-deployment", signed=True)
            unsigned = legacy_deployment_token("retained-null-principal", journal=False)
        before = self.migrate(BEFORE)
        with use_operator():
            before.get_model("tokens", "TokenDeployment").objects.create(
                pk=unsigned.token.deployment_id,
                token_id=unsigned.token.pk,
                company_id=unsigned.company.pk,
                principal_id=None,
                intent=deployment._intent(unsigned.token),
            )
        original = self.records(before)
        journals = {record["uuid"]: record for record in original["TokenDeployment"]}
        self.assertEqual(journals[signed.token.deployment_id]["principal_id"], signed.user.pk)
        self.assertIsNone(journals[unsigned.token.deployment_id]["principal_id"])
        self.assertEqual(len(original["SignedAttempt"]), 1)
        self.assertTrue(original["SignedAttempt"][0]["raw_transaction"])
        self.assertEqual(original["OutgoingOperation"][0]["status"], "signed")
        for target, source_column in ((MODELS, True), (GUARDS, True), (MODELS, True), (BEFORE, False), (GUARDS, True)):
            with self.subTest(target=target):
                state = self.migrate(target)
                self.assert_legacy(state, original, source_column=source_column)

    def test_submitted_approved_and_applied_sources_refuse_history_erasing_reversal(self):
        with use_operator():
            tenant = make_tenant("retained-company-deployment")
        with use_migrate():
            Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.ACTIVE)
            tenant.company.refresh_from_db()
        appointment = owner_appointment(tenant.company)
        proposal = prepare_deployment(
            actor=tenant.user, operation_id=uuid4(), appointment=appointment.pk, token=tenant.token.pk
        )
        for phase in ("submitted", "approve", "apply"):
            with self.subTest(phase=phase):
                if phase != "submitted":
                    _, preview = preview_deployment_decision(
                        actor=tenant.user, deployment_id=proposal.pk, appointment=appointment.pk, kind=phase
                    )
                    with patch("tokens.services.register_deployments.queue_deployment"):
                        proposal = decide_deployment(
                            actor=tenant.user,
                            deployment_id=proposal.pk,
                            appointment=appointment.pk,
                            kind=phase,
                            idempotency_key=uuid4(),
                            preview_digest=preview["preview_digest"],
                            confirmation=True,
                        )
                with use_operator():
                    if phase == "apply":
                        tenant.token.refresh_from_db()
                        journal = deployment._admit(tenant.token)
                        self.assertEqual((journal.source_deployment_id, journal.intent), (proposal.pk, proposal.intent))
                    source = RegisterDeployment.objects.values().get(pk=proposal.pk)
                    decisions = list(RegisterDeploymentDecision.objects.order_by("pk").values())
                    self.assertEqual(len(decisions), {"submitted": 0, "approve": 1, "apply": 2}[phase])
                for target in (MODELS, BEFORE):
                    with self.subTest(target=target), self.assertRaisesMessage(
                        DatabaseError, "Cannot remove retained company deployment history"
                    ):
                        self.migrate(target)
                    restore_every_migration()
                    self.assertEqual(self.schema(), (SOURCE_TABLES, True, [(True, True)]))
                    with use_operator():
                        self.assertEqual(RegisterDeployment.objects.values().get(pk=proposal.pk), source)
                        self.assertEqual(list(RegisterDeploymentDecision.objects.order_by("pk").values()), decisions)
                        if phase == "apply":
                            self.assertEqual(
                                TokenDeployment.objects.get(pk=journal.pk).source_deployment_id, proposal.pk
                            )


class ScopedRegisterDeploymentMigrationTest(RunsOnTheScopedConnection, RegisterDeploymentMigrationTest):
    def setUp(self):
        super().setUp()
        self.assertEqual(current_alias(), APP_ALIAS)
        sessions = {}
        for alias in (APP_ALIAS, OPERATOR_ALIAS):
            with connections[alias].cursor() as cursor:
                cursor.execute("SELECT current_user, pg_backend_pid()")
                sessions[alias] = cursor.fetchone()
        self.assertEqual(sessions[APP_ALIAS][0], settings.RLS_ROLES["app"])
        self.assertEqual(sessions[OPERATOR_ALIAS][0], settings.RLS_ROLES["operator"])
        self.assertNotEqual(sessions[APP_ALIAS][1], sessions[OPERATOR_ALIAS][1])
