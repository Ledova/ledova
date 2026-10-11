from rest_framework import serializers


class CompanyPackRequestSerializer(serializers.Serializer):
    appointment = serializers.UUIDField()
    instruction = serializers.CharField(max_length=255)
    recipient = serializers.CharField(max_length=255)
