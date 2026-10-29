from rest_framework import mixins, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from shared.views import AuthenticatedGenericViewSet
from shared.views.uploads import UploadProtectedView
from users.models.investor_classification import InvestorClassification
from users.serializers.investor_classification import InvestorClassificationSerializer
from users.services.investor_classification import create_classification


class InvestorClassificationViewSet(
    UploadProtectedView,
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.DestroyModelMixin,
    AuthenticatedGenericViewSet,
):
    upload_field = "evidence_file"
    serializer_class = InvestorClassificationSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    http_method_names = ["get", "post", "delete", "head", "options"]
    lookup_field = "uuid"
    ordering = ["-created_at"]
    ordering_fields = ["created_at"]

    scoped_model = InvestorClassification

    def narrow(self, queryset):
        if self.action == "destroy":
            queryset = queryset.submitted()
        return queryset.select_related("user_account")

    def perform_create(self, serializer):
        serializer.instance = create_classification(actor=self.request.user, validated_data=serializer.validated_data)

    def destroy(self, request, *args, **kwargs):
        self.get_object().withdraw(withdrawn_by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
