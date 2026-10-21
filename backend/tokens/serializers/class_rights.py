from rest_framework import serializers

from companies.serializers.team import StrictTeamSerializer
from tokens.models import ClassRightsRevision


class ClassRightsWriteSerializer(StrictTeamSerializer):
    appointment = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    previous_revision = serializers.IntegerField(min_value=0, max_value=2147483646)
    summary = serializers.CharField(max_length=4000, allow_blank=True, trim_whitespace=False)
    document_reference = serializers.CharField(
        max_length=255, allow_blank=True, trim_whitespace=False, required=False, default=""
    )
    documents = serializers.ListField(child=serializers.UUIDField(), max_length=100, required=False, default=list)


class ClassRightsQuerySerializer(StrictTeamSerializer):
    page = serializers.IntegerField(min_value=1, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, required=False)
    idempotency_key = serializers.UUIDField(required=False)


class ClassRightsFileQuerySerializer(StrictTeamSerializer):
    revision = serializers.UUIDField()
    evidence = serializers.UUIDField()


class ClassRightsDocumentSerializer(serializers.Serializer):
    provided_by = serializers.CharField()
    evidence = serializers.UUIDField()
    company = serializers.UUIDField()
    document_type = serializers.CharField()
    name = serializers.CharField()
    file_size = serializers.IntegerField()
    mime_type = serializers.CharField()
    sha256 = serializers.CharField()


class ClassRightsRevisionSerializer(serializers.ModelSerializer):
    documents = ClassRightsDocumentSerializer(many=True, read_only=True)

    class Meta:
        model = ClassRightsRevision
        fields = [
            "uuid",
            "token",
            "revision",
            "summary",
            "document_reference",
            "documents",
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
