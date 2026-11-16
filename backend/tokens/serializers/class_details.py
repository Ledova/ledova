from rest_framework import serializers

from companies.serializers.team import StrictTeamSerializer
from tokens.models import ClassDetailsRevision
from tokens.models.choices import ShareTokenType


class ClassDetailsSnapshotSerializer(serializers.Serializer):
    name = serializers.CharField()
    symbol = serializers.CharField()
    token_type = serializers.ChoiceField(choices=ShareTokenType.choices)


class ClassDetailsHistoryQuerySerializer(StrictTeamSerializer):
    page = serializers.IntegerField(min_value=1, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, required=False)


class ClassDetailsRevisionSerializer(serializers.ModelSerializer):
    before = ClassDetailsSnapshotSerializer(read_only=True)
    after = ClassDetailsSnapshotSerializer(read_only=True)

    class Meta:
        model = ClassDetailsRevision
        fields = [
            "uuid",
            "token",
            "revision",
            "before",
            "after",
            "recorded_by_name",
            "created_at",
        ]
        read_only_fields = fields


class ClassDetailsHistorySerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ClassDetailsRevisionSerializer(many=True)
