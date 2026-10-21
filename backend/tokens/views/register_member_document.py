from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework.decorators import action
from rest_framework.response import Response

from shared.views import AuthenticatedReadOnlyViewSet, stream_stored_file
from tokens.models import RegisterMemberDocument
from tokens.serializers.register_member_document import (
    RegisterMemberDocumentCreateSerializer,
    RegisterMemberDocumentSerializer,
)
from tokens.services.register_evidence import matching_bytes
from tokens.services.register_member_documents import add_member_document


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter("company", OpenApiTypes.UUID),
            OpenApiParameter("member", OpenApiTypes.UUID),
            OpenApiParameter("token", OpenApiTypes.UUID),
            OpenApiParameter("idempotency_key", OpenApiTypes.UUID),
        ]
    )
)
class RegisterMemberDocumentViewSet(AuthenticatedReadOnlyViewSet):
    queryset = RegisterMemberDocument.objects.none()
    serializer_class = RegisterMemberDocumentSerializer
    scoped_model = RegisterMemberDocument
    operator_actions = frozenset({"list", "retrieve", "create", "file"})
    operator_actions_because = (
        "Private retained shareholder attachments are read only through current exact-company register authority. "
        "Each write uses the actor-bound company command and validates the member, class and immutable evidence."
    )
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.readable_by(self.request.user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        for name in ("company", "member", "token"):
            value = self.request.query_params.get(name)
            if value:
                queryset = queryset.filter(**{f"{name}_id": value})
        key = self.request.query_params.get("idempotency_key")
        if key:
            queryset = queryset.filter(idempotency_key=key)
        return queryset

    @extend_schema(
        request=RegisterMemberDocumentCreateSerializer,
        responses={200: RegisterMemberDocumentSerializer, 201: RegisterMemberDocumentSerializer},
    )
    def create(self, request):
        serializer = RegisterMemberDocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        document, created = add_member_document(actor=request.user, **serializer.validated_data)
        return Response(RegisterMemberDocumentSerializer(document).data, status=201 if created else 200)

    @extend_schema(responses={(200, "*/*"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def file(self, request, uuid=None):
        document = self.get_object()
        evidence = document.evidence
        matching_bytes(evidence.file, document.snapshot["file_size"], document.snapshot["sha256"])
        return stream_stored_file(
            evidence.file, document.snapshot["mime_type"], filename=document.snapshot["name"], as_attachment=True
        )
