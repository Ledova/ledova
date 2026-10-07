from rest_framework import serializers

from tokens.models import FormerHolder
from tokens.models.choices import IDENTITY_LABELS, IDENTITY_LIVE


class FormerMemberSerializer(serializers.ModelSerializer):

    wallet_address = serializers.CharField(allow_null=True, read_only=True)
    ceased_at_block = serializers.IntegerField(allow_null=True, read_only=True)
    identity_source_display = serializers.SerializerMethodField()
    identity_recorded_at = serializers.DateTimeField(source="created_at", read_only=True)
    member = serializers.SerializerMethodField()
    source_entry = serializers.SerializerMethodField()
    source_entry_sequence = serializers.SerializerMethodField()
    source_entry_kind = serializers.SerializerMethodField()
    corrects = serializers.SerializerMethodField()
    corrected_by = serializers.SerializerMethodField()
    source_effective_on = serializers.DateField(
        source="entry.effective_on", allow_null=True, read_only=True, default=None
    )
    returned_entry = serializers.UUIDField(source="returned_entry_id", allow_null=True, read_only=True, default=None)
    returned_on = serializers.DateField(allow_null=True, read_only=True, default=None)

    class Meta:
        model = FormerHolder
        fields = [
            "uuid",
            "wallet_address",
            "name",
            "residential_address",
            "shares_at_cessation",
            "ceased_on",
            "ceased_at_block",
            "identity_source",
            "identity_source_display",
            "identity_recorded_at",
            "member",
            "source_entry",
            "source_entry_sequence",
            "source_entry_kind",
            "source_effective_on",
            "corrects",
            "corrected_by",
            "returned_entry",
            "returned_on",
        ]
        read_only_fields = fields

    def get_identity_source_display(self, instance) -> str:
        if instance.identity_source == IDENTITY_LIVE:
            return "Profile when the cessation was recorded"
        return IDENTITY_LABELS.get(instance.identity_source, instance.identity_source)

    def get_member(self, instance) -> str | None:
        value = getattr(instance, "member_id", None)
        return str(value) if value else None

    def get_source_entry(self, instance) -> str | None:
        value = getattr(instance, "entry_id", None)
        return str(value) if value else None

    def get_source_entry_sequence(self, instance) -> int | None:
        return instance.entry.sequence if getattr(instance, "entry_id", None) else None

    def get_source_entry_kind(self, instance) -> str | None:
        return instance.entry.kind if getattr(instance, "entry_id", None) else None

    def get_corrects(self, instance) -> str | None:
        value = instance.entry.corrects_id if getattr(instance, "entry_id", None) else None
        return str(value) if value else None

    def get_corrected_by(self, instance) -> str | None:
        value = getattr(instance.entry, "correction", None) if getattr(instance, "entry_id", None) else None
        return str(value.pk) if value else None
