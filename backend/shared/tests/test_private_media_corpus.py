from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.test import TransactionTestCase

from documents.models import Document, DocumentType

REAL_BYTES = b"%PDF-1.4 real retained private bytes"
User = get_user_model()


class PrivateMediaCorpusTest(TransactionTestCase):
    def seed(self, label, count=4):
        keys = []
        for index in range(count):
            owner = User.objects.create_user(email=f"{label}-{index}@example.test", password="pw-12345678")
            document = Document.objects.create(
                uploaded_by=owner,
                document_type=DocumentType.PAYSLIP,
                original_filename="payslip.pdf",
                mime_type="application/pdf",
                file=ContentFile(REAL_BYTES, name="payslip.pdf"),
            )
            keys.append(document.file.name)
        return keys

    def test_reconcile_reports_a_clean_corpus(self):
        self.seed("mig-clean", count=2)

        call_command("reconcile_private_media", "--check", verbosity=0)
