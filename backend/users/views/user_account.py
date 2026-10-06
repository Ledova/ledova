from drf_spectacular.helpers import forced_singular_serializer
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status
from rest_framework.response import Response

from shared.db import atomic
from shared.views.base import AuthenticatedGenericViewSet
from users.models import UserAccount
from users.models.user_account import AccountRole
from users.serializers.user_account import UserAccountSerializer
from whitelist.services.eligibility_invalidation import invalidation_writer_context
from whitelist.services.refresh import enqueue_for_account

NO_ACCOUNT = "This user has no account."


class UserAccountViewSet(mixins.ListModelMixin, mixins.UpdateModelMixin, AuthenticatedGenericViewSet):
    serializer_class = UserAccountSerializer
    http_method_names = ["get", "patch", "head", "options"]
    lookup_field = "uuid"

    ordering = ["-activation_date"]
    ordering_fields = ["activation_date", "created_at"]

    scoped_model = UserAccount

    def narrow(self, queryset):
        queryset = queryset.for_holder(self.request.user)
        if getattr(self, "action", None) == "partial_update":
            return queryset.select_for_update()
        return queryset

    @extend_schema(responses={200: forced_singular_serializer(UserAccountSerializer)})
    def list(self, request):
        account = self.get_queryset().first()
        if account is None:
            return Response({"detail": NO_ACCOUNT}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(account).data)

    def perform_update(self, serializer):
        previous_role = serializer.instance.role
        if previous_role in (AccountRole.INVESTOR, AccountRole.BOTH) and serializer.validated_data.get(
            "role", previous_role
        ) not in (
            AccountRole.INVESTOR,
            AccountRole.BOTH,
        ):
            enqueue_for_account(serializer.instance.pk, self.request.user, cause_fields=["role"])
        return serializer.save()

    def partial_update(self, request, *args, **kwargs):
        if "role" in request.data:
            with invalidation_writer_context(request.user):
                return super().partial_update(request, *args, **kwargs)
        with atomic():
            return super().partial_update(request, *args, **kwargs)
