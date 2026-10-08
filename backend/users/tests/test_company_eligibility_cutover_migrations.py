from datetime import timedelta
from decimal import Decimal
from unittest import skipUnless
from uuid import uuid4

from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore
from django.core.files.base import ContentFile
from django.db import DatabaseError, connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.recorder import MigrationRecorder
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from offerings.tests.test_company_eligibility_subscription_admission import (
    CompanyEligibilitySubscriptionCases,
)
from shared.db import current_alias, use_migrate, use_operator
from shared.tests.schema import restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.tests.test_company_eligibility_trading_admission import (
    TradingAdmissionCases,
)
from users.models import InvestorClassification, UserProfile
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from users.tests.test_company_eligibility_migrations import EligibilityMigrationChecks
from users.tests.test_company_eligibility_requests import PDF
from whitelist.services.eligibility_invalidation import (
    invalidation_writer_context,
    record_invalidation,
)

OLD = [
    ("users", "0033_company_eligibility_guards"),
    ("offerings", "0009_published_documents_stay"),
    ("tokens", "0081_held_orders_and_retired_statuses"),
    ("whitelist", "0008_classification_refresh_authority"),
]
GRANTS = ("shared", "0015_scoped_grants_queue_prerequisite")
HISTORICAL_GRANTS = ("shared", "0008_scoped_role_table_grants")
RESTORED_EMPTY_TABLES = {
    "tokens_registercapitalincrease",
    "tokens_registercapitalincreasedecision",
    "whitelist_companywalletnomination",
    "whitelist_companywalletinstruction",
    "whitelist_companywalletinstructiondecision",
    "tokens_registercorrectiondecision",
    "tokens_registerdeployment",
    "tokens_registerdeploymentdecision",
    "tokens_registerevidence",
    "tokens_registergrant",
    "tokens_registergrantdecision",
    "tokens_registerimportdecision",
    "tokens_registerinstructiondecision",
    "tokens_registermembercessation",
    "tokens_registeropeningdecision",
    "tokens_registerparticularschange",
    "tokens_registerparticularschangedecision",
    "tokens_registertransfer",
    "tokens_registertransferdecision",
    "tokens_registerwalletlinkdecision",
    "whitelist_whitelisteligibilityinvalidation",
}
ADDED_COLUMNS = {
    "tokens_capitalincreaseexecution": ["source_increase_id"],
    "offerings_subscription": ["eligibility_decision_id"],
    "tokens_tokendeployment": ["source_deployment_id"],
    "tokens_shareissuanceexecution": ["source_instruction_id"],
    "tokens_registerinstruction": [
        "preparing_appointment_id",
        "member_id",
        "nomination_id",
        "wallet_approval_id",
        "request_id",
        "terms_on",
        "terms",
        "acceptance_required",
        "authority_evidence_id",
        "terms_evidence_id",
        "terms_fingerprint",
        "terms_snapshot",
        "terms_file",
        "acceptance_evidence_id",
        "acceptance_fingerprint",
        "acceptance_snapshot",
        "acceptance_file",
        "snapshot",
        "intent",
        "intent_digest",
        "approval_decision_id",
    ],
    "tokens_registermemberparticulars": ["source_grant_id", "source_transfer_id"],
    "tokens_transferorder": [
        "eligibility_decision_id",
        "creation_submission_id",
        "last_modification_action_id",
        "last_modification_eligibility_decision_id",
    ],
    "tokens_ordersubmission": ["eligibility_decision_id"],
    "tokens_orderactionsubmission": ["eligibility_decision_id", "eligibility_admitted_at"],
    "tokens_swaporder": [
        "seller_eligibility_decision_id",
        "seller_eligibility_admitted_at",
        "buyer_eligibility_decision_id",
        "buyer_eligibility_admitted_at",
    ],
    "whitelist_whitelistchange": [
        "source_instruction_id",
        "eligibility_decision_id",
        "eligibility_invalidation_id",
        "invalidation_cause",
        "invalidated_at",
    ],
}
MODULES = getattr(settings, "MIGRATION_MODULES", {})
REAL_MIGRATIONS = connection.vendor == "postgresql" and all(
    MODULES.get(app, f"{app}.migrations") is not None
    for app in ("users", "offerings", "tokens", "whitelist", "shared", "procrastinate")
)


class EligibilityCutoverChecks(EligibilityMigrationChecks):
    def setUp(self):
        self.addCleanup(restore_every_migration)
        super().setUp()

    def migrate(self, targets):
        MigrationExecutor(connection).migrate(targets)

    def historical_apps(self):
        executor = MigrationExecutor(connection)
        applied = [node for node in executor.loader.applied_migrations if node in executor.loader.graph.nodes]
        return executor.loader.project_state(applied).apps

    def catalogue(self):
        result = super().catalogue()
        result["roles"] = self.query(
            "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY(%s) ORDER BY rolname",
            [sorted(set(settings.RLS_ROLES.values()))],
        )
        result["function_access"] = self.query(
            "SELECT oid::regprocedure::text, prosecdef, proconfig, proacl::text FROM pg_proc "
            "WHERE pronamespace = 'public'::regnamespace AND prokind IN ('f', 'p') "
            "ORDER BY oid::regprocedure::text"
        )
        return result

    def records(self, *, legacy=False):
        rows = {}
        for (table,) in self.query(
            "SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace "
            "AND relkind IN ('r', 'p') AND relname <> 'django_migrations' ORDER BY relname"
        ):
            omitted = ADDED_COLUMNS.get(table, []) if legacy else []
            rows[table] = self.query(
                f"SELECT (to_jsonb(retained) - %s::text[])::text FROM {connection.ops.quote_name(table)} retained "
                "ORDER BY (to_jsonb(retained) - %s::text[])::text",
                [omitted, omitted],
            )
        return rows

    def assert_refusal_preserves_schema_and_records(self, targets, error, message, *, sqlstate=None):
        before = self.catalogue(), self.records(), self.private_bytes(self.source.evidence_file)
        ddl = []

        def observe(execute, sql, params, many, context):
            if sql.lstrip().upper().startswith(("ALTER ", "CREATE ", "DROP ")):
                ddl.append(sql)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(observe), self.assertRaisesMessage(error, message) as raised:
            self.migrate(targets)
        if sqlstate is not None:
            self.assertEqual(raised.exception.__cause__.sqlstate, sqlstate)
        self.assertEqual(ddl, [])
        self.assertEqual((self.catalogue(), self.records(), self.private_bytes(self.source.evidence_file)), before)

    def assert_installed_role_boundaries(self):
        app, operator = settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]
        self.assertEqual(
            self.query(
                "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ANY(%s) ORDER BY rolname",
                [[app, operator]],
            ),
            sorted([(app, False, False), (operator, False, True)]),
        )
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            self.assertEqual(
                self.query(
                    "SELECT has_table_privilege(%s, 'whitelist_whitelisteligibilityinvalidation', %s), "
                    "has_table_privilege(%s, 'whitelist_whitelisteligibilityinvalidation', %s)",
                    [app, privilege, operator, privilege],
                ),
                [(False, True)],
            )
        for name in (
            "users_company_eligibility_decision_current",
            "users_company_eligibility_decision_facts_current",
            "users_refuse_retired_classification_review",
        ):
            self.assertEqual(
                self.query(
                    "SELECT prosecdef, proconfig FROM pg_proc WHERE proname = %s "
                    "AND pronamespace = 'public'::regnamespace",
                    [name],
                ),
                [(False, ["search_path=pg_catalog, public"])],
            )


@skipUnless(REAL_MIGRATIONS, "Real PostgreSQL cutover migration execution is required")
class CompanyEligibilityCutoverUpgradeTest(
    EligibilityCutoverChecks, CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def historical_records(self, apps):
        past = timezone.now() - timedelta(days=30)
        with use_migrate():
            source = apps.get_model("users", "InvestorClassification").objects.create(
                user_account_id=self.other_account.pk,
                category="professional_investor",
                status="verified",
                declaration_accepted=True,
                declaration_text="Synthetic retained pre-cutover declaration",
                declared_basis="Retained private pre-cutover basis",
                submitted_at=past,
                reviewed_by_id=self.technical.pk,
                reviewed_at=past + timedelta(days=1),
                review_notes="Retained historical staff review",
                expires_at=timezone.now() + timedelta(days=90),
                evidence_file=ContentFile(PDF, name="retained-before-cutover.pdf"),
                evidence_file_size=len(PDF),
                evidence_mime_type="application/pdf",
            )
            document = apps.get_model("documents", "Document").objects.create(
                uploaded_by_id=self.other.pk,
                classification_id=source.pk,
                attached_at=past,
                original_filename="retained-supporting.pdf",
                file=ContentFile(PDF, name="retained-supporting.pdf"),
                mime_type="application/pdf",
                note="Retained private migration evidence",
            )
            apps.get_model("offerings", "Subscription").objects.create(
                offering_id=self.offer.pk,
                company_id=self.company.pk,
                user_account_id=self.account.pk,
                wallet_id=self.wallet.pk,
                submitted_by_id=self.participant.pk,
                company_name=self.company.name,
                token_name=self.offer_token.name,
                token_symbol=self.offer_token.symbol,
                currency="AUD",
                quantity=2,
                price_per_share=Decimal("2.50"),
                amount_due=Decimal("5.00"),
                status="paid",
                submitted_at=past,
                accepted_at=past + timedelta(days=1),
                amount_received=Decimal("5.00"),
                payment_confirmed_by_id=self.technical.pk,
                payment_confirmed_at=past + timedelta(days=2),
                payment_notes="Retained historical payment; no company admission inferred",
            )
            apps.get_model("tokens", "TransferOrder").objects.create(
                token_id=self.offer_token.pk,
                wallet_id=self.wallet.pk,
                owner_account_id=self.account.pk,
                wallet_address=self.wallet.address,
                order_type="buy",
                status="held",
                quantity=10,
                price_per_share=Decimal("2.50"),
            )
            apps.get_model("tokens", "OrderSubmission").objects.create(
                submission_id=uuid4(),
                owner_account_id=self.account.pk,
                wallet_id=self.wallet.pk,
                token_id=self.offer_token.pk,
                initiated_by_id=self.participant.pk,
                wallet_address=self.wallet.address,
                order_type="buy",
                quantity=10,
                price_per_share=Decimal("2.50"),
                chain_id=settings.BLOCKCHAIN_CHAIN_ID,
                verifying_contract="0x" + "8e" * 20,
                token_metadata={"retained": "historical pending intent"},
            )
            registry = "0x" + "d" * 40
            entry = apps.get_model("whitelist", "WhitelistEntry").objects.create(
                wallet_id=self.wallet.pk,
                address=self.wallet.address.lower(),
                label="Retained technical wallet",
                notes="Historical technical membership is separate from company eligibility",
            )
            apps.get_model("whitelist", "WhitelistApproval").objects.create(
                entry_id=entry.pk, company_id=self.company.pk, registry_address=registry, status="active"
            )
            apps.get_model("whitelist", "WhitelistChange").objects.create(
                action="remove",
                address=self.wallet.address.lower(),
                chain_id=settings.BLOCKCHAIN_CHAIN_ID,
                registry_address=registry,
                company_id=self.company.pk,
                initiated_by_id=self.technical.pk,
                authority="operator_api",
                requested_wallet_id=self.wallet.pk,
                entry_id=entry.pk,
                intent={
                    "chain_id": settings.BLOCKCHAIN_CHAIN_ID,
                    "sender": "0x" + "e" * 40,
                    "to": registry,
                    "value": "0",
                    "data": "0xe0468dcd" + "0" * 24 + self.wallet.address[2:].lower() + "0" * 64,
                },
            )
            session = SessionStore()
            session["cutover_holder"] = str(self.participant.pk)
            session.save()
        self.query(
            "INSERT INTO procrastinate_jobs (queue_name, task_name, args) VALUES (%s, %s, %s::jsonb) RETURNING id",
            ["cutover-retained", "users.tests.retained_cutover_job", '{"retained": true}'],
        )
        return source.evidence_file, document.file

    def test_upgrade_and_empty_cutover_round_trip_preserve_history_bytes_queue_and_catalogue(self):
        try:
            self.accepted()
            self.migrate(OLD)
            files = (self.source.evidence_file, *self.historical_records(self.historical_apps()))
            recorder = MigrationRecorder(connection)
            self.assertTrue(recorder.migration_qs.filter(app=HISTORICAL_GRANTS[0], name=HISTORICAL_GRANTS[1]).exists())
            recorder.record_unapplied(*GRANTS)
            before_migrations = set(self.query("SELECT app, name FROM django_migrations"))
            before_catalogue = self.catalogue()
            existing_grant_tables = {row[0] for row in before_catalogue["grants"]}
            before_records = self.records(legacy=True)
            before_bytes = self.private_bytes(*files)
            restore_every_migration()
            installed_catalogue = self.catalogue()
            current = self.records(legacy=True)
            self.assertEqual(set(current) - set(before_records), RESTORED_EMPTY_TABLES)
            for table in RESTORED_EMPTY_TABLES:
                self.assertEqual(current.pop(table), [], f"Restored table {table} must contain no retained history.")
            self.assertEqual(current, before_records)
            self.assertEqual(self.private_bytes(*files), before_bytes)
            self.assertEqual(installed_catalogue["roles"], before_catalogue["roles"])
            self.assertEqual(
                [row for row in installed_catalogue["grants"] if row[0] in existing_grant_tables],
                before_catalogue["grants"],
            )
            self.assertTrue(before_migrations <= set(self.query("SELECT app, name FROM django_migrations")))
            self.assertTrue(recorder.migration_qs.filter(app=GRANTS[0], name=GRANTS[1]).exists())
            self.assert_installed_role_boundaries()
            for table, columns in ADDED_COLUMNS.items():
                for column in columns:
                    predicate = f"{column} <> ''" if column == "invalidation_cause" else f"{column} IS NOT NULL"
                    self.assertEqual(self.query(f"SELECT count(*) FROM {table} WHERE {predicate}"), [(0,)])
            self.migrate(OLD)
            old_catalogue = self.catalogue()
            self.assertEqual(self.records(legacy=True), before_records)
            self.assertEqual(self.private_bytes(*files), before_bytes)
            restore_every_migration()
            self.assertEqual(self.catalogue(), installed_catalogue)
            self.assert_installed_role_boundaries()
            self.migrate(OLD)
            self.assertEqual(self.catalogue(), old_catalogue)
            self.assertEqual(self.records(legacy=True), before_records)
            self.assertEqual(self.private_bytes(*files), before_bytes)
            restore_every_migration()
            self.assertEqual(self.catalogue(), installed_catalogue)
        finally:
            restore_every_migration()


@skipUnless(REAL_MIGRATIONS, "Real PostgreSQL cutover migration execution is required")
class CompanyEligibilitySubscriptionCutoverReversalTest(
    EligibilityCutoverChecks, CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_real_submitted_decision_refuses_destructive_subscription_reversal_before_ddl(self):
        try:
            _, decision = self.accepted()
            subscription = self.submitted()
            self.assertEqual(subscription.eligibility_decision_id, decision.pk)
            self.assert_refusal_preserves_schema_and_records(
                [("offerings", "0009_published_documents_stay")],
                RuntimeError,
                "Retain the guarded basis of admitted subscriptions",
            )
            restore_every_migration()
            with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("DELETE FROM offerings_subscription WHERE uuid = %s", [subscription.pk])
            self.assertEqual(raised.exception.__cause__.sqlstate, "23514")
            self.assertEqual(self.subscription_snapshot(subscription)["eligibility_decision_id"], decision.pk)
        finally:
            restore_every_migration()


@skipUnless(REAL_MIGRATIONS, "Real PostgreSQL cutover migration execution is required")
class CompanyEligibilityTradingCutoverReversalTest(
    EligibilityCutoverChecks, TradingAdmissionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_real_signed_order_admission_refuses_destructive_trading_reversal_before_ddl(self):
        try:
            signed = self.signed_order()
            response = self.execute_order(signed)
            self.assertEqual(response.status_code, 201, response.content)
            submission = self.submission(signed)
            self.assertEqual(submission.eligibility_decision_id, self.decision.pk)
            self.migrate([("tokens", "0082_company_eligibility_admission")])
            self.assert_refusal_preserves_schema_and_records(
                [("tokens", "0081_held_orders_and_retired_statuses")],
                RuntimeError,
                "Retain actual trading admission evidence and its guards",
            )
            restore_every_migration()
            self.assertEqual(self.submission(signed).pk, submission.pk)
            self.assertIsNotNone(self.challenge(signed).consumed_at)
            self.chain.send_raw_transaction.assert_not_called()
        finally:
            restore_every_migration()


@skipUnless(REAL_MIGRATIONS, "Real PostgreSQL cutover migration execution is required")
class CompanyEligibilitySourceCutoverReversalTest(
    EligibilityCutoverChecks, CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_two_real_submitted_sources_refuse_one_open_restoration_before_ddl(self):
        try:
            second = self.submit_source()
            self.assertNotEqual(second.pk, self.source.pk)
            self.migrate([("whitelist", "0009_company_eligibility_invalidation")])
            before_bytes = self.private_bytes(self.source.evidence_file, second.evidence_file)
            self.assert_refusal_preserves_schema_and_records(
                [("users", "0034_company_eligibility_consumption")],
                RuntimeError,
                "Retain all private submitted sources",
            )
            self.assertEqual(self.private_bytes(self.source.evidence_file, second.evidence_file), before_bytes)
            restore_every_migration()
            with use_operator():
                self.assertEqual(
                    set(InvestorClassification.objects.filter(user_account=self.account).values_list("pk", "status")),
                    {(self.source.pk, "submitted"), (second.pk, "submitted")},
                )
        finally:
            restore_every_migration()

    def test_real_identity_loss_refuses_sql_reversal_and_retains_original_cause_and_private_bytes(self):
        try:
            self.accepted()
            with use_operator(), _requester_principal(""):
                with invalidation_writer_context():
                    event = record_invalidation(self.account.pk, "identity_loss", cause_fields=["is_id_verified"])
                    UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
            self.migrate([("whitelist", "0009_company_eligibility_invalidation")])
            self.assert_refusal_preserves_schema_and_records(
                [("whitelist", "0008_classification_refresh_authority")],
                DatabaseError,
                "Cannot discard retained eligibility invalidation history",
                sqlstate="P0001",
            )
            restore_every_migration()
            with use_operator():
                event.refresh_from_db()
            self.assertIsNone(event.initiated_by_id)
            self.assertEqual(event.cause_fields, ["is_id_verified"])
            self.assertTrue(event.facts["identity_verified"])
        finally:
            restore_every_migration()


class ScopedCompanyEligibilityCutoverUpgradeTest(RunsOnTheScopedConnection, CompanyEligibilityCutoverUpgradeTest):
    pass


class ScopedCompanyEligibilitySubscriptionCutoverReversalTest(
    RunsOnTheScopedConnection, CompanyEligibilitySubscriptionCutoverReversalTest
):
    pass


class ScopedCompanyEligibilityTradingCutoverReversalTest(
    RunsOnTheScopedConnection, CompanyEligibilityTradingCutoverReversalTest
):
    pass


class ScopedCompanyEligibilitySourceCutoverReversalTest(
    RunsOnTheScopedConnection, CompanyEligibilitySourceCutoverReversalTest
):
    pass
