from rest_framework import serializers

from tokens.models import RegisterCorrectionAuthority, RegisterImport


class RegisterImportCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    token_id = serializers.UUIDField()
    document_id = serializers.UUIDField()
    asic_document_id = serializers.UUIDField()
    as_at = serializers.DateField()
    members = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=10000)
    former_members = serializers.ListField(child=serializers.DictField(), allow_empty=True, max_length=10000)
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterImportSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterImport
        fields = [
            "uuid",
            "company",
            "token",
            "as_at",
            "members",
            "former_members",
            "authority",
            "approving_director",
            "authority_reference",
            "reason",
            "source_document",
            "evidence_fingerprint",
            "evidence_snapshot",
            "asic_document",
            "asic_fingerprint",
            "submitted_by",
            "status",
            "asic_issued_total",
            "asic_member_count",
            "register_sequence",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "created_at",
        ]
        read_only_fields = fields
