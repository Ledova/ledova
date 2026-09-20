from rest_framework import serializers

from tokens.models import RegisterCorrection, RegisterCorrectionAuthority


class RegisterCorrectionCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    corrects_id = serializers.UUIDField()
    document_id = serializers.UUIDField()
    effective_on = serializers.DateField()
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterCorrectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterCorrection
        fields = [
            "uuid",
            "company",
            "register",
            "corrects",
            "base_sequence",
            "base_hash",
            "effective_on",
            "changes",
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
