from rest_framework import serializers


class RegisterInspectionPreviewSerializer(serializers.Serializer):
    token = serializers.UUIDField()
    appointment = serializers.UUIDField()
    register_sequence = serializers.IntegerField(min_value=1)
    source_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")


class RegisterInspectionRequestSerializer(serializers.Serializer):
    appointment = serializers.UUIDField()
    source_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")
    instruction = serializers.CharField(max_length=255)
    requested_on = serializers.DateField()
    recipient = serializers.CharField(max_length=255)
