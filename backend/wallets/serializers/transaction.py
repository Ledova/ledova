from rest_framework import serializers

from wallets.models import Transaction
from wallets.serializers.share_class import ShareClassField


class TransactionSerializer(serializers.ModelSerializer):
    asset_symbol = serializers.CharField(source="asset.symbol", read_only=True)
    asset_name = serializers.CharField(source="asset.name", read_only=True)
    share_class = ShareClassField()
    wallet_address = serializers.CharField(source="wallet.address", read_only=True)

    class Meta:
        model = Transaction
        fields = (
            "uuid",
            "tx_hash",
            "chain",
            "from_address",
            "to_address",
            "asset",
            "asset_symbol",
            "asset_name",
            "share_class",
            "amount",
            "market_value",
            "block_timestamp",
            "block_number",
            "status",
            "transaction_fee_estimated",
            "transaction_fee",
            "wallet",
            "wallet_address",
            "created_at",
        )
        read_only_fields = fields
