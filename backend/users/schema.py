from drf_spectacular.extensions import OpenApiSerializerExtension


class UserPreferencesSchema(OpenApiSerializerExtension):
    target_class = "users.serializers.user_preferences.UserPreferencesSerializer"
    match_subclasses = True

    def map_serializer(self, auto_schema, direction):
        schema = auto_schema._map_serializer(self.target, direction, bypass_extensions=True)
        if direction == "response":
            schema["properties"]["user_account"]["nullable"] = True
        return schema
