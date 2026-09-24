from contextlib import ExitStack, contextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.apps import apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.base import ContentFile
from django.db import models, transaction
from django.db.models.signals import post_delete
from django.test import TransactionTestCase
from django.utils import timezone
from google.auth.credentials import AnonymousCredentials
from storages.backends.gcloud import GoogleCloudStorage
from storages.backends.s3 import S3Storage

from companies.models import Company, CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import attach_file, make_document
from documents.models import Document, DocumentType
from shared.services.orphaned_files import GRACE, sweep_orphaned_files
from shared.storage import private_file_fields
from shared.tests.tenants import an_account
from shareholders.models import Publication, PublicationEvent
from tokens.models import (
    RegisterCorrection,
    RegisterImport,
    RegisterInstruction,
    RegisterOpening,
    RegisterWalletLink,
    ShareIssuanceRequest,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register_corrections import submit_correction
from tokens.services.register_instructions import submit_instruction
from tokens.services.register_openings import submit_link, submit_opening
from tokens.tests.instruction_fixtures import instruction_payload
from tokens.tests.test_register_corrections import (
    correction_fixture,
    correction_payload,
)
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_links import link_fixture, link_payload
from tokens.tests.test_register_openings import opening_payload
from users.models import InvestorClassification

PDF = b"%PDF-1.4 synthetic cloud lifecycle fixture"


def opening_proposal_fixture():
    owner, company, _, _, _, _ = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    reviewer = get_user_model().objects.create_user(
        email=f"opening-cloud-{uuid4()}@example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registeropening", "view_registeropening"]
        )
    )
    document = attach_file(make_document(company))
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
    deployed = ShareToken.objects.create(
        company=company,
        name="Cloud opening",
        symbol="CLOUD",
        total_supply="100",
        status=ShareTokenStatus.DEPLOYED,
    )
    return submit_opening(actor=owner, **opening_payload(document, SimpleNamespace(token_id=deployed.pk))), document


class ObjectStore:
    def __init__(self):
        self.files = {}
        self.modified = {}

    def save(self, name, content):
        self.files[name] = content.read()
        self.modified[name] = timezone.now()
        return name

    def delete(self, name):
        self.files.pop(name, None)
        self.modified.pop(name, None)

    def listdir(self, path):
        prefix = path.rstrip("/") + "/" if path else ""
        directories, files = set(), set()
        for name in self.files:
            if name.startswith(prefix):
                tail = name[len(prefix) :]
                if "/" in tail:
                    directories.add(tail.split("/", 1)[0])
                else:
                    files.add(tail)
        return sorted(directories), sorted(files)


class CloudStorageLifecycleTest(TransactionTestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(email="cloud-lifecycle@example.test", password="fixture")
        self.company = Company.objects.create(owner=self.user, name="Cloud Fixture", acn="123456789")

    @contextmanager
    def cloud_storage(self, backend):
        if backend == "s3":
            storage = S3Storage(bucket_name="synthetic-lifecycle", access_key="fixture", secret_key="fixture")
        else:
            storage = GoogleCloudStorage(bucket_name="synthetic-lifecycle", credentials=AnonymousCredentials())
        objects = ObjectStore()
        fields = [
            (model, field)
            for model in apps.get_models()
            for field in model._meta.get_fields()
            if isinstance(field, models.FileField)
        ]

        def disconnect():
            for model, field in fields:
                post_delete.disconnect(
                    sender=model, dispatch_uid=f"shared.storage.sweep:{model._meta.label}.{field.name}"
                )

        try:
            with ExitStack() as stack:
                for name, value in {
                    "_save": objects.save,
                    "_open": lambda name, mode="rb": ContentFile(objects.files[name], name=name),
                    "delete": objects.delete,
                    "exists": lambda name: name in objects.files,
                    "listdir": objects.listdir,
                    "get_modified_time": lambda name: objects.modified[name],
                }.items():
                    stack.enter_context(patch.object(storage, name, side_effect=value))
                for _, field in fields:
                    stack.enter_context(patch.object(field, "storage", storage))
                disconnect()
                apps.get_app_config("shared").ready()
                try:
                    yield storage, objects
                finally:
                    disconnect()
        finally:
            apps.get_app_config("shared").ready()

    def document(self):
        return Document.objects.create(
            uploaded_by=self.user,
            document_type=DocumentType.PAYSLIP,
            original_filename="payslip.pdf",
            mime_type="application/pdf",
            file=ContentFile(PDF, name="payslip.pdf"),
        )

    def test_discovery_and_startup_receivers_cover_both_cloud_backends(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, _):
                self.assertEqual(
                    {(model, field) for model, field in private_file_fields()},
                    {
                        (Document, "file"),
                        (CompanyDocument, "file"),
                        (InvestorClassification, "evidence_file"),
                        (RegisterCorrection, "file"),
                        (RegisterOpening, "file"),
                        (RegisterWalletLink, "file"),
                        (RegisterImport, "file"),
                        (RegisterInstruction, "file"),
                        (Publication, "file"),
                        (PublicationEvent, "evidence"),
                    },
                )
                connected = {lookup[0] for lookup, *_rest in post_delete.receivers}
                for model in (
                    Document,
                    CompanyDocument,
                    RegisterCorrection,
                    RegisterOpening,
                    RegisterWalletLink,
                    RegisterImport,
                    RegisterInstruction,
                    Publication,
                ):
                    self.assertIn(f"shared.storage.sweep:{model._meta.label}.file", connected)
                self.assertIn("shared.storage.sweep:shareholders.PublicationEvent.evidence", connected)
                self.assertNotIn("shared.storage.sweep:users.InvestorClassification.evidence_file", connected)
                with self.assertRaises(NotImplementedError):
                    storage.path("documents/no-filesystem.pdf")

    def test_retained_opening_copy_survives_source_deletion_and_orphan_sweep(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                proposal, document = opening_proposal_fixture()
                original = objects.files[proposal.file.name]
                document.delete()
                orphan = storage.save("companies/interrupted-opening.bin", ContentFile(PDF))
                for key in objects.files:
                    objects.modified[key] = timezone.now() - GRACE - timedelta(seconds=1)
                result = sweep_orphaned_files(storage=storage)
                self.assertEqual(result["deleted"], 1)
                self.assertNotIn(orphan, objects.files)
                self.assertEqual(objects.files[proposal.file.name], original)
                self.assertTrue(RegisterOpening.objects.filter(pk=proposal.pk).exists())

    def test_retained_instruction_copy_survives_source_deletion_and_orphan_sweep(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                owner, company, _, _, document = link_fixture()
                token = ShareToken.objects.get(company=company)
                request = ShareIssuanceRequest.objects.create(
                    token=token, recipient_address="0x" + "3c" * 20, amount=5, reason="Allotment"
                )
                proposal = submit_instruction(actor=owner, **instruction_payload(token, document, [request]))
                original = objects.files[proposal.file.name]
                document.delete()
                orphan = storage.save("companies/interrupted-instruction.bin", ContentFile(PDF))
                for key in objects.files:
                    objects.modified[key] = timezone.now() - GRACE - timedelta(seconds=1)
                result = sweep_orphaned_files(storage=storage)
                self.assertEqual(result["deleted"], 1)
                self.assertNotIn(orphan, objects.files)
                self.assertEqual(objects.files[proposal.file.name], original)
                self.assertTrue(RegisterInstruction.objects.filter(pk=proposal.pk).exists())

    def test_retained_wallet_link_copy_survives_source_deletion_and_orphan_sweep(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                owner, company, _, _, document = link_fixture()
                proposal = submit_link(actor=owner, **link_payload(company, document))
                original = objects.files[proposal.file.name]
                document.delete()
                orphan = storage.save("companies/interrupted-link.bin", ContentFile(PDF))
                for key in objects.files:
                    objects.modified[key] = timezone.now() - GRACE - timedelta(seconds=1)
                result = sweep_orphaned_files(storage=storage)
                self.assertEqual(result["deleted"], 1)
                self.assertNotIn(orphan, objects.files)
                self.assertEqual(objects.files[proposal.file.name], original)
                self.assertTrue(RegisterWalletLink.objects.filter(pk=proposal.pk).exists())

    def test_retained_correction_copy_survives_source_deletion_and_orphan_sweep(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                owner, reviewer, document, issue = correction_fixture()
                proposal = submit_correction(actor=owner, **correction_payload(document, issue))
                original = objects.files[proposal.file.name]
                document.delete()
                orphan = storage.save("companies/interrupted-correction.bin", ContentFile(PDF))
                for key in objects.files:
                    objects.modified[key] = timezone.now() - GRACE - timedelta(seconds=1)
                result = sweep_orphaned_files(storage=storage)
                self.assertEqual(result["deleted"], 1)
                self.assertNotIn(orphan, objects.files)
                self.assertEqual(objects.files[proposal.file.name], original)
                self.assertTrue(RegisterCorrection.objects.filter(pk=proposal.pk).exists())

    def test_a_live_cloud_object_is_protected_while_an_old_orphan_is_removed(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                document = self.document()
                orphan = storage.save("documents/unreferenced/old.pdf", ContentFile(PDF))

                result = sweep_orphaned_files(moment=timezone.now() + GRACE + timedelta(minutes=1), storage=storage)

                self.assertEqual((result["found"], result["deleted"]), (1, 1))
                self.assertEqual(objects.files[document.file.name], PDF)
                self.assertNotIn(orphan, objects.files)

    def test_a_delete_waits_for_commit_and_a_rolled_back_delete_keeps_the_object(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (_, objects):
                document = self.document()
                name = document.file.name
                pk = document.pk

                with transaction.atomic():
                    document.delete()
                    self.assertIn(name, objects.files)
                    transaction.set_rollback(True)

                document = Document.objects.get(pk=pk)
                self.assertEqual(objects.files[name], PDF)
                with transaction.atomic():
                    document.delete()
                    self.assertIn(name, objects.files)
                self.assertNotIn(name, objects.files)

    def test_company_document_deletion_removes_its_cloud_object(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (_, objects):
                document = CompanyDocument.objects.create(
                    company=self.company,
                    document_type=CompanyDocument._meta.get_field("document_type").choices[0][0],
                    file=ContentFile(PDF, name="constitution.pdf"),
                    file_size=len(PDF),
                )
                name = document.file.name

                document.delete()

                self.assertNotIn(name, objects.files)

    def test_rollback_uploads_keep_the_grace_period_and_are_swept_afterwards(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                with transaction.atomic():
                    document = self.document()
                    name = document.file.name
                    transaction.set_rollback(True)

                self.assertIn(name, objects.files)
                self.assertEqual(sweep_orphaned_files(storage=storage)["deleted"], 0)
                result = sweep_orphaned_files(moment=timezone.now() + GRACE + timedelta(minutes=1), storage=storage)
                self.assertEqual(result["deleted"], 1)
                self.assertNotIn(name, objects.files)

    def test_retained_evidence_is_not_removed_by_row_deletion_or_the_sweep(self):
        for backend in ("s3", "gcs"):
            with self.subTest(backend=backend), self.cloud_storage(backend) as (storage, objects):
                classification = InvestorClassification.objects.create(
                    user_account=an_account("cloud-storage-lifecycle"),
                    category="product_value",
                    declaration_accepted=True,
                    declaration_text="Synthetic declaration",
                    evidence_file=ContentFile(PDF, name="evidence.pdf"),
                    submitted_at=timezone.now(),
                )
                name = classification.evidence_file.name

                classification.delete()
                result = sweep_orphaned_files(moment=timezone.now() + GRACE + timedelta(days=365), storage=storage)

                self.assertEqual(result["deleted"], 0)
                self.assertEqual(objects.files[name], PDF)
