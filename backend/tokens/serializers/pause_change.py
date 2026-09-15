from rest_framework import serializers

from tokens.models import PauseChangeStatus
from tokens.serializers.share_token import ShareTokenDetailSerializer


class PauseSubmissionRequestSerializer(serializers.Serializer):
    submission_id = serializers.UUIDField()


class PauseSubmissionSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    paused = serializers.BooleanField()
    status = serializers.ChoiceField(choices=PauseChangeStatus.choices)
    completed_at = serializers.DateTimeField(allow_null=True)


class PauseSubmissionResponseSerializer(serializers.Serializer):
    message = serializers.CharField()
    token = ShareTokenDetailSerializer()
    submission = PauseSubmissionSerializer()
