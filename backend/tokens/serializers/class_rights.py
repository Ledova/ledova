from rest_framework import serializers

from companies.serializers.team import StrictTeamSerializer
from tokens.models import ClassRightsRevision


class ClassRightsWriteSerializer(StrictTeamSerializer):
    appointment = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    previous_revision = serializers.IntegerField(min_value=0, max_value=2147483646)
    summary = serializers.CharField(max_length=4000, allow_blank=True, trim_whitespace=False)
    document_reference = serializers.CharField(max_length=255, allow_blank=True, trim_whitespace=False)


class ClassRightsQuerySerializer(StrictTeamSerializer):
    page = serializers.IntegerField(min_value=1, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, required=False)
    idempotency_key = serializers.UUIDField(required=False)


class ClassRightsRevisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClassRightsRevision
        fields = [
            "uuid",
            "token",
            "revision",
            "summary",
            "document_reference",
            "recorded_by",
            "recorded_by_name",
            "appointment",
            "idempotency_key",
            "created_at",
        ]
        read_only_fields = fields


class ClassRightsPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ClassRightsRevisionSerializer(many=True)
    current = ClassRightsRevisionSerializer(allow_null=True)
    administration_appointment = serializers.UUIDField(allow_null=True)
