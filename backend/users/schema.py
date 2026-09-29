from drf_spectacular.extensions import OpenApiSerializerExtension


class UserPreferencesSchema(OpenApiSerializerExtension):
    target_class = "users.serializers.user_preferences.UserPreferencesSerializer"
    match_subclasses = True

    def map_serializer(self, auto_schema, direction):
        schema = auto_schema._map_serializer(self.target, direction, bypass_extensions=True)
        if direction == "response":
            schema["properties"]["user_account"]["nullable"] = True
        return schema


class UserProfileSchema(OpenApiSerializerExtension):
    target_class = "users.serializers.user_profile.UserProfileSerializer"

    def map_serializer(self, auto_schema, direction):
        schema = auto_schema._map_serializer(self.target, direction, bypass_extensions=True)
        if direction == "response":
            for name in ("citizenship_country", "residence_country"):
                schema["properties"][name]["nullable"] = True
        return schema
