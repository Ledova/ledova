from rest_framework import serializers

from tokens.models import RegisterCorrectionAuthority, RegisterOpening


class RegisterOpeningCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    token_id = serializers.UUIDField()
    document_id = serializers.UUIDField()
    mapping = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()), allow_empty=True, max_length=10000
    )
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterOpeningSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterOpening
        fields = [
            "uuid",
            "company",
            "token",
            "mapping",
            "boundary",
            "authority",
            "approving_director",
            "authority_reference",
            "reason",
            "source_document",
            "evidence_fingerprint",
            "evidence_snapshot",
            "submitted_by",
            "status",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "applied_entry",
            "created_at",
        ]
        read_only_fields = fields
