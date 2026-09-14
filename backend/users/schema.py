from drf_spectacular.extensions import OpenApiSerializerExtension

from assets.serializers.asset import AssetSerializer
from users.serializers.user_preferences import SelectedPortfolioSerializer


class UserPreferencesSchema(OpenApiSerializerExtension):
    target_class = "users.serializers.user_preferences.UserPreferencesSerializer"
    match_subclasses = True

    def map_serializer(self, auto_schema, direction):
        schema = auto_schema._map_serializer(self.target, direction, bypass_extensions=True)
        if direction == "response":
            portfolio = auto_schema.resolve_serializer(SelectedPortfolioSerializer(), direction)
            schema["properties"]["selected_portfolio"] = {"allOf": [portfolio.ref], "nullable": True}
            schema["properties"]["user_account"]["nullable"] = True
            schema["required"] = sorted(set(schema.get("required", [])) | {"selected_portfolio"})
        return schema


class UserProfileSchema(OpenApiSerializerExtension):
    target_class = "users.serializers.user_profile.UserProfileSerializer"

    def map_serializer(self, auto_schema, direction):
        schema = auto_schema._map_serializer(self.target, direction, bypass_extensions=True)
        if direction == "response":
            for name in ("citizenship_country", "residence_country"):
                schema["properties"][name]["nullable"] = True
        return schema


class FavouriteAssetSchema(OpenApiSerializerExtension):
    target_class = "users.serializers.favourite_asset.FavouriteAssetSerializer"

    def map_serializer(self, auto_schema, direction):
        schema = auto_schema._map_serializer(self.target, direction, bypass_extensions=True)
        if direction == "response":
            schema["properties"]["asset"] = auto_schema.resolve_serializer(AssetSerializer(), direction).ref
        return schema
