from datetime import date
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone

from documents.models import Document, DocumentExtraction, DocumentRead
from operators.models import Operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant, snapshot
from tokens.models import RegisterEntry, RegisterMember, RegisterPosition, ShareRegister
from tokens.services.register_events import (
    create_member,
    open_register,
    verify_register,
)

BEFORE = [("operators", "0001_initial")]
AFTER = [("operators", "0002_remove_operator_deployment_mode")]
RETAINED_MODELS = (
    Document,
    DocumentExtraction,
    DocumentRead,
    RegisterMember,
    ShareRegister,
    RegisterEntry,
    RegisterPosition,
)


class ProductModeMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)

    def retained_rows(self):
        return {model._meta.label: list(model.objects.order_by("pk").values()) for model in RETAINED_MODELS}

    def private_bytes(self, *files):
        contents = {}
        for file in files:
            with file.storage.open(file.name, "rb") as stream:
                contents[file.name] = stream.read()
        return contents

    def columns(self):
        with connection.cursor() as cursor:
            return {
                field.name for field in connection.introspection.get_table_description(cursor, "operators_operator")
            }

    def preserves_existing_data(self, mode):
        historical = migrate_to(BEFORE).get_model("operators", "Operator")
        loader = MigrationExecutor(connection).loader
        applied_nodes = [node for node in loader.applied_migrations if node in loader.graph.nodes]
        applied = loader.project_state(applied_nodes).apps
        tenant = make_tenant(
            f"mode-{mode}",
            with_swap=False,
            classification_model=applied.get_model("users", "InvestorClassification"),
            order_model=applied.get_model("tokens", "TransferOrder"),
            subscription_model=applied.get_model("offerings", "Subscription"),
        )
        operator = historical.objects.create(
            name="Synthetic platform",
            legal_name="Synthetic Platform Pty Ltd",
            abn="00000000000",
            contact_email="platform@migration.example.test",
            website="https://platform.example.test",
            deployment_mode=mode,
            bank_account_name="Synthetic bank account",
            bank_bsb="000000",
            bank_account_number="123456789",
            payment_reference_prefix="MIG",
            receiving_wallet_address="0x" + "3" * 40,
            receiving_wallet_chain="ethereum",
            issued_stablecoin_id=tenant.refs.stablecoin.pk,
            investor_kyc_required=False,
            issuer_kyc_required=True,
        )
        operator.supported_settlement_assets.add(tenant.refs.stablecoin.pk)
        supporting = Document.objects.create(
            uploaded_by=tenant.user,
            classification_id=tenant.investor_classification.pk,
            attached_at=timezone.now(),
            original_filename="retained.pdf",
            file=ContentFile(b"Synthetic private supporting evidence", name="retained.pdf"),
            mime_type="application/pdf",
            note="Retained supporting evidence",
        )
        DocumentExtraction.objects.create(
            document=supporting,
            status="succeeded",
            raw_output="Synthetic private extraction",
            parsed_json={"gross_pay": "1234.00"},
            confidence=0.75,
            warnings=["Synthetic evidence"],
            model_name="synthetic",
            duration_ms=321,
            started_at=timezone.now(),
            finished_at=timezone.now(),
        )
        DocumentRead.objects.create(
            actor_id=tenant.user.pk,
            document_uuid=supporting.pk,
            classification_uuid=tenant.investor_classification.pk,
            kind="extraction",
        )
        Document.objects.create(
            uploaded_by=tenant.user,
            classification_id=tenant.investor_classification.pk,
            attached_at=timezone.now(),
            purged_at=timezone.now(),
        )
        member = create_member(company_id=tenant.company.pk, member_id=uuid4())
        opening = open_register(
            token_id=tenant.token.pk,
            operation_id=uuid4(),
            changes=[{"member": str(member.pk), "shares": "100"}],
            effective_on=date(2026, 10, 3),
            recorded_by=tenant.user,
        )
        fields = [field.attname for field in historical._meta.concrete_fields if field.name != "deployment_mode"]
        settings_before = historical.objects.values(*fields).get(pk=operator.pk)
        rows_before = self.retained_rows()
        tenant_before = snapshot(tenant)
        files = (
            supporting.file,
            tenant.document.file,
            tenant.company_document.file,
            tenant.investor_classification.evidence_file,
        )
        bytes_before = self.private_bytes(*files)

        migrated = migrate_to(AFTER).get_model("operators", "Operator")
        self.assertNotIn("deployment_mode", self.columns())
        self.assertNotIn("deployment_mode", {field.name for field in migrated._meta.fields})
        self.assertEqual(migrated.objects.values(*fields).get(pk=operator.pk), settings_before)
        self.assertEqual(
            list(Operator.get().supported_settlement_assets.values_list("pk", flat=True)), [tenant.refs.stablecoin.pk]
        )
        self.assertEqual(self.retained_rows(), rows_before)
        self.assertEqual(snapshot(tenant), tenant_before)
        self.assertEqual(self.private_bytes(*files), bytes_before)
        verify_register(opening.register_id)

        reversed_model = migrate_to(BEFORE).get_model("operators", "Operator")
        self.assertEqual(reversed_model.objects.get(pk=operator.pk).deployment_mode, "registry")
        self.assertEqual(reversed_model.objects.values(*fields).get(pk=operator.pk), settings_before)
        migrate_to(AFTER)
        self.assertEqual(self.retained_rows(), rows_before)
        self.assertEqual(snapshot(tenant), tenant_before)
        self.assertEqual(self.private_bytes(*files), bytes_before)

    def test_registry_upgrade_preserves_settings_evidence_payments_and_register_history(self):
        self.preserves_existing_data("registry")

    def test_single_issuer_upgrade_preserves_settings_evidence_payments_and_register_history(self):
        self.preserves_existing_data("single_issuer")
