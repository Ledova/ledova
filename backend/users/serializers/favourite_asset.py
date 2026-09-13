from rest_framework import serializers

from assets.models import Asset
from assets.serializers.asset import AssetSerializer
from users.models.favourite_asset import FavouriteAsset
from users.services.accounts import account_of


class FavouriteAssetSerializer(serializers.ModelSerializer):
    asset = serializers.PrimaryKeyRelatedField(queryset=Asset.objects.active().verified().excluding_securities())
    user_account = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = FavouriteAsset
        fields = (
            "uuid",
            "user_account",
            "asset",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "uuid",
            "created_at",
            "updated_at",
        )

    def validate(self, attrs):
        user_account = attrs["user_account"] = account_of(getattr(self.context.get("request"), "user", None))
        if user_account is None:
            raise serializers.ValidationError({"user_account": "This user has no account."})
        asset = attrs.get("asset")

        if asset:
            if FavouriteAsset.objects.filter(user_account=user_account, asset=asset).exists():
                raise serializers.ValidationError({"asset": f"{asset.symbol} is already in your favourites."})

        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["asset"] = AssetSerializer(instance.asset).data
        return data
