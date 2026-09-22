from rest_framework import serializers

from tokens.models import RegisterInstruction, RegisterInstructionKind


class RegisterInstructionCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    token_id = serializers.UUIDField()
    document_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=RegisterInstructionKind.choices)
    items = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()), allow_empty=False, max_length=10000
    )
    approving_director = serializers.CharField(max_length=255)
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterInstructionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterInstruction
        fields = [
            "uuid",
            "company",
            "token",
            "kind",
            "items",
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
            "created_at",
        ]
        read_only_fields = fields
