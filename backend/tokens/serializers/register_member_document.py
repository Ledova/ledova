from rest_framework import serializers

from tokens.models import RegisterMemberDocument, RegisterMemberDocumentCategory


class RegisterMemberDocumentCreateSerializer(serializers.Serializer):
    company_id = serializers.UUIDField()
    member = serializers.UUIDField()
    token = serializers.UUIDField()
    evidence = serializers.UUIDField()
    category = serializers.ChoiceField(choices=RegisterMemberDocumentCategory.choices)
    appointment = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()


class RegisterMemberDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterMemberDocument
        fields = [
            "uuid",
            "company",
            "member",
            "token",
            "source_import",
            "evidence",
            "category",
            "snapshot",
            "appointment",
            "idempotency_key",
            "created_at",
        ]
        read_only_fields = fields
