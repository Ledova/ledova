from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers


class AssetShareClassSerializer(serializers.Serializer):
    uuid = serializers.UUIDField(source="share_class_uuid", read_only=True)
    name = serializers.CharField(source="share_class_name", read_only=True)
    symbol = serializers.CharField(source="share_class_symbol", read_only=True)
    company_name = serializers.CharField(source="share_class_company_name", read_only=True)


@extend_schema_field(AssetShareClassSerializer(allow_null=True))
class ShareClassField(serializers.Field):
    def __init__(self, **kwargs):
        super().__init__(source="*", read_only=True, **kwargs)

    def to_representation(self, row):
        return None if row.share_class_uuid is None else AssetShareClassSerializer(row).data
