from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from assets.choices import VALUE_SOURCE_CHOICES
from assets.serializers import AssetSerializer
from wallets.models import Holding


class HoldingShareClassSerializer(serializers.Serializer):
    uuid = serializers.UUIDField(source="share_class_uuid", read_only=True)
    name = serializers.CharField(source="share_class_name", read_only=True)
    company_name = serializers.CharField(source="share_class_company_name", read_only=True)


class HoldingSerializer(serializers.ModelSerializer):
    wallet_uuid = serializers.CharField(source="wallet.uuid", read_only=True)
    wallet_address = serializers.CharField(source="wallet.address", read_only=True)
    chain = serializers.CharField(source="wallet.chain", read_only=True)
    asset_uuid = serializers.CharField(source="asset.uuid", read_only=True)
    asset_symbol = serializers.CharField(source="asset.symbol", read_only=True)
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    market_value = serializers.DecimalField(max_digits=40, decimal_places=2, read_only=True, allow_null=True)
    value_source = serializers.ChoiceField(choices=VALUE_SOURCE_CHOICES, read_only=True)
    asset = AssetSerializer(read_only=True, required=False)
    share_class = serializers.SerializerMethodField()

    class Meta:
        model = Holding
        fields = (
            "uuid",
            "wallet_uuid",
            "wallet_address",
            "chain",
            "asset_uuid",
            "asset_symbol",
            "asset_name",
            "asset",
            "share_class",
            "quantity",
            "market_value",
            "value_source",
            "last_synced_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    @extend_schema_field(HoldingShareClassSerializer(allow_null=True))
    def get_share_class(self, holding):
        if holding.share_class_uuid is None:
            return None
        return HoldingShareClassSerializer(holding).data
