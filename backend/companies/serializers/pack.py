from rest_framework import serializers


class CompanyPackRequestSerializer(serializers.Serializer):
    appointment = serializers.UUIDField()
    instruction = serializers.CharField(max_length=255)
    recipient = serializers.CharField(max_length=255)


class CompanyPackRecordSerializer(serializers.Serializer):
    digest = serializers.CharField()
    prepared_at = serializers.DateTimeField()
    prepared_by_name = serializers.CharField(allow_blank=True)
    instruction = serializers.CharField()
    recipient = serializers.CharField()
    classes = serializers.IntegerField()


class CompanyPacksSerializer(serializers.Serializer):
    packs = CompanyPackRecordSerializer(many=True)
