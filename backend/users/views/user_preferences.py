from drf_spectacular.helpers import forced_singular_serializer
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response

from shared.views.base import AuthenticatedModelViewSet
from users.models.user_preferences import UserPreferences
from users.serializers.user_preferences import UserPreferencesSerializer
from users.services import upsert_user_preferences


class UserPreferencesViewSet(AuthenticatedModelViewSet):
    serializer_class = UserPreferencesSerializer
    ordering = ["-created_at"]
    ordering_fields = ["created_at"]

    scoped_model = UserPreferences

    @extend_schema(responses={200: forced_singular_serializer(UserPreferencesSerializer)})
    def list(self, request):
        preferences = self.get_queryset().first()
        if preferences is None:
            return Response(
                {"detail": "User preferences not found. Create them first."}, status=status.HTTP_404_NOT_FOUND
            )
        return Response(self.get_serializer(preferences).data)

    @extend_schema(responses={200: UserPreferencesSerializer})
    def create(self, request):
        serializer = self.get_serializer(data=request.data, partial=self.get_queryset().exists())
        serializer.is_valid(raise_exception=True)

        preferences = upsert_user_preferences(request.user, serializer.validated_data)

        return Response(self.get_serializer(preferences).data, status=status.HTTP_200_OK)
