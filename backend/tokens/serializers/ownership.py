from rest_framework import serializers

from shared.api.search import SEARCH_MAX_LENGTH


class CompanyOwnershipQuerySerializer(serializers.Serializer):
    company = serializers.UUIDField()


class ClassOwnershipQuerySerializer(serializers.Serializer):
    sequence = serializers.IntegerField(min_value=1)
    search = serializers.CharField(max_length=SEARCH_MAX_LENGTH, required=False, allow_blank=True, default="")


class OwnershipClassSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    symbol = serializers.CharField()
    token_type = serializers.CharField()
    initialized = serializers.BooleanField()
    issued_supply = serializers.CharField(allow_null=True)
    total_holders = serializers.IntegerField(allow_null=True)
    sequence = serializers.IntegerField(allow_null=True)
    recorded_at = serializers.DateTimeField(allow_null=True)


class CompanyOwnershipSummarySerializer(serializers.Serializer):
    company = serializers.UUIDField()
    company_name = serializers.CharField()
    as_at = serializers.DateTimeField()
    complete = serializers.BooleanField()
    issued_supply = serializers.CharField(allow_null=True)
    total_holders = serializers.IntegerField(allow_null=True)
    classes = OwnershipClassSerializer(many=True)


class OwnershipHolderSerializer(serializers.Serializer):
    member = serializers.UUIDField()
    name = serializers.CharField(allow_null=True)
    balance = serializers.CharField()
    percentage = serializers.CharField()


class ClassOwnershipHoldersSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = OwnershipHolderSerializer(many=True)
    token = serializers.UUIDField()
    sequence = serializers.IntegerField()
    issued_supply = serializers.CharField()
    as_at = serializers.DateTimeField()
