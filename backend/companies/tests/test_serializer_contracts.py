from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from companies.models import Company, CompanyStatus
from companies.serializers import CompanyDetailSerializer
from shared.db import use_migrate

User = get_user_model()

COMPANY_DETAIL_KEYS = {
    "uuid",
    "name",
    "trading_name",
    "display_name",
    "company_type",
    "company_type_display",
    "acn",
    "abn",
    "status",
    "status_display",
    "email",
    "phone",
    "address_line_1",
    "address_line_2",
    "city",
    "state",
    "postcode",
    "country",
    "operator_wallet",
    "submitted_at",
    "review_started_at",
    "approved_at",
    "activated_at",
    "info_requested_at",
    "info_request_reason",
    "additional_info_response",
    "rejection_at",
    "rejection_reason",
    "withdrawn_at",
    "withdrawal_reason",
    "description",
    "industry",
    "founded_year",
    "is_active",
    "is_approved",
    "is_pending_review",
    "can_issue_tokens",
    "is_open_to_investors",
    "primary_contact",
    "documents",
    "created_at",
    "updated_at",
    "is_owner",
    "administrative_access",
    "activation",
}


class SerializerContractTest(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="contract@example.test", password="pw-12345678")
        self.company = Company.objects.create(owner=self.owner, name="Contract Pty Ltd", acn="123456789")

    def test_company_detail_serializer_key_set(self):
        self.assertEqual(set(CompanyDetailSerializer(self.company).data.keys()), COMPANY_DETAIL_KEYS)

    def test_company_detail_serializer_exposes_rejection_outcome(self):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(
                status=CompanyStatus.REJECTED,
                rejection_reason="Insufficient documentation.",
                rejection_at=timezone.now(),
                rejected_by=self.owner,
            )
        self.company.refresh_from_db()

        data = CompanyDetailSerializer(self.company).data

        self.assertEqual(data["rejection_reason"], "Insufficient documentation.")
        self.assertIsNotNone(data["rejection_at"])

    def test_company_detail_serializer_exposes_withdrawal_outcome(self):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(
                status=CompanyStatus.WITHDRAWN, withdrawal_reason="No longer proceeding.", withdrawn_at=timezone.now()
            )
        self.company.refresh_from_db()

        data = CompanyDetailSerializer(self.company).data

        self.assertEqual(data["withdrawal_reason"], "No longer proceeding.")
        self.assertIsNotNone(data["withdrawn_at"])

    def test_all_added_fields_are_read_only(self):
        writable = {name for name, field in CompanyDetailSerializer().fields.items() if not field.read_only}
        self.assertFalse(writable & {"rejection_at", "rejection_reason", "withdrawn_at", "withdrawal_reason"})
