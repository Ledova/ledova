from rest_framework import status
from rest_framework.response import Response

from shared.db import atomic
from shared.views.base import AuthenticatedModelViewSet
from users.models import UserAccount
from users.serializers.user_account import UserAccountSerializer

NO_ACCOUNT = "This user has no account."


class UserAccountViewSet(AuthenticatedModelViewSet):
    serializer_class = UserAccountSerializer
    http_method_names = ["get", "patch", "head", "options"]

    ordering = ["-activation_date"]
    ordering_fields = ["activation_date", "created_at"]

    scoped_model = UserAccount

    def narrow(self, queryset):
        if getattr(self, "action", None) == "partial_update":
            return queryset.select_for_update()
        return queryset

    def list(self, request):
        account = self.get_queryset().first()
        if account is None:
            return Response({"detail": NO_ACCOUNT}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(account).data)

    def perform_update(self, serializer):
        return serializer.save()

    @atomic()
    def partial_update(self, request, *args, **kwargs):
        return super().partial_update(request, *args, **kwargs)
