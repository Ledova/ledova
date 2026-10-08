from rest_framework import serializers

from whitelist.constants import WHITELIST_STATUS_CHOICES
from whitelist.models import (
    WhitelistApproval,
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


class WhitelistSyncResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    entry = WhitelistEntrySerializer()
    message = serializers.CharField()
