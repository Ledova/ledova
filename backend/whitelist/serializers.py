from rest_framework import serializers

from companies.models import Company
from whitelist.constants import WHITELIST_STATUS_CHOICES
from whitelist.models import (
    WhitelistApproval,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistEntry,
)


class WhitelistApprovalSerializer(serializers.ModelSerializer):
    company = serializers.UUIDField(source="company_id", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    status_display = serializers.SerializerMethodField()

    class Meta:
        model = WhitelistApproval
        fields = [
            "uuid",
            "company",
            "company_name",
            "registry_address",
            "status",
            "status_display",
            "expires_at",
            "last_synced_at",
        ]
        read_only_fields = fields

    def get_status_display(self, obj) -> str:
        return obj.status_display()


class WhitelistEntrySerializer(serializers.ModelSerializer):
    wallet_address = serializers.CharField(read_only=True)
    label = serializers.CharField(read_only=True)
    approvals = WhitelistApprovalSerializer(many=True, read_only=True)

    class Meta:
        model = WhitelistEntry
        fields = [
            "uuid",
            "wallet_address",
            "label",
            "approvals",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "uuid",
            "created_at",
            "updated_at",
        ]


class WhitelistStatusSerializer(serializers.Serializer):
    address = serializers.CharField()
    is_whitelisted = serializers.BooleanField()
    status = serializers.ChoiceField(choices=WHITELIST_STATUS_CHOICES)


class WhitelistRemoveSerializer(serializers.Serializer):
    submission_id = serializers.UUIDField(help_text="Retain this UUID when recovering or retrying the same submission.")
    wallet_address = serializers.CharField(
        max_length=42,
        help_text="Ethereum wallet address (0x...)",
    )
    company = serializers.SlugRelatedField(
        slug_field="uuid",
        queryset=Company.objects.all(),
        help_text="The company whose whitelist registry this change writes.",
    )

    def validate_wallet_address(self, value):
        if not value.startswith("0x"):
            raise serializers.ValidationError("Wallet address must start with '0x'")
        if len(value) != 42:
            raise serializers.ValidationError("Wallet address must be 42 characters (including '0x')")
        try:
            int(value, 16)
        except ValueError:
            raise serializers.ValidationError("Wallet address must contain only hexadecimal characters")
        return value.lower()


class WhitelistAddSerializer(WhitelistRemoveSerializer):
    expires_at = serializers.DateTimeField(
        required=False,
        allow_null=True,
        default=None,
        help_text="When the approval lapses on chain. Omit it or send null for an approval that never expires.",
    )


class WhitelistChangeSerializer(serializers.ModelSerializer):
    submission_id = serializers.UUIDField(source="uuid")
    wallet_address = serializers.CharField(source="address")
    company = serializers.UUIDField(source="company_id")
    tx_hash = serializers.CharField(source="transaction.tx_hash", allow_null=True, default=None)
    approval = WhitelistApprovalSerializer(allow_null=True)
    success = serializers.SerializerMethodField()
    message = serializers.SerializerMethodField()

    class Meta:
        model = WhitelistChange
        fields = [
            "submission_id",
            "wallet_address",
            "company",
            "action",
            "expires_at",
            "status",
            "success",
            "tx_hash",
            "approval",
            "message",
        ]

    def get_success(self, obj) -> bool:
        return obj.status in (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED)

    def get_message(self, obj) -> str:
        return {
            WhitelistChangeStatus.PENDING: "The accepted whitelist change is awaiting recovery.",
            WhitelistChangeStatus.EXECUTING: "The original transaction is unresolved; recover this submission.",
            WhitelistChangeStatus.CONFIRMED: "The original whitelist transaction was confirmed.",
            WhitelistChangeStatus.UNCHANGED: "The address already had the requested approval; nothing was sent.",
            WhitelistChangeStatus.FAILED: "The original attempt failed. Submit a new change to try again.",
        }[obj.status]


class WhitelistBatchAddSerializer(serializers.Serializer):
    entries = WhitelistAddSerializer(many=True, min_length=1, max_length=100)


class WhitelistBatchErrorSerializer(serializers.Serializer):
    wallet_address = serializers.CharField()
    error = serializers.CharField()


class WhitelistBatchResponseSerializer(serializers.Serializer):
    successful = serializers.IntegerField()
    failed = serializers.IntegerField()
    pending = serializers.IntegerField()
    results = WhitelistChangeSerializer(many=True)
    errors = WhitelistBatchErrorSerializer(many=True)


class WhitelistSyncResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    entry = WhitelistEntrySerializer()
    message = serializers.CharField()
