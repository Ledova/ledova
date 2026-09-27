from rest_framework import serializers

from portfolios.models.portfolio import Portfolio


class PortfolioSerializer(serializers.ModelSerializer):
    user_account = serializers.PrimaryKeyRelatedField(read_only=True)
    wallet_uuids = serializers.SerializerMethodField()
    wallet_count = serializers.SerializerMethodField()

    def get_wallet_uuids(self, obj) -> list[str]:
        return [str(wallet.uuid) for wallet in obj.account_wallets()]

    def get_wallet_count(self, obj) -> int:
        return obj.account_wallets().count()

    class Meta:
        model = Portfolio
        fields = (
            "uuid",
            "user_account",
            "name",
            "is_active",
            "wallet_uuids",
            "wallet_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "uuid",
            "wallet_uuids",
            "wallet_count",
            "created_at",
            "updated_at",
        )


class PortfolioWalletResponseSerializer(serializers.Serializer):
    success = serializers.BooleanField()
    message = serializers.CharField()
    portfolio = PortfolioSerializer()
