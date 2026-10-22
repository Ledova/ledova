from drf_spectacular.helpers import forced_singular_serializer
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from shared.views import AuthenticatedGenericViewSet
from tokens.models import RegisterPersonRegistration
from tokens.serializers.register_person import (
    RegisterPeopleSerializer,
    RegisterPersonCreateSerializer,
    RegisterPersonRegistrationSerializer,
)
from tokens.services.register_people import add_person, company_people


class RegisterPersonViewSet(AuthenticatedGenericViewSet):
    queryset = RegisterPersonRegistration.objects.none()
    serializer_class = RegisterPersonRegistrationSerializer
    scoped_model = RegisterPersonRegistration
    operator_actions = frozenset({"list", "create"})
    operator_actions_because = (
        "Private company people are read under exact company register authority, and adding one requires current "
        "company preparation authority under the durable actor-bound company command."
    )
    http_method_names = ["get", "post", "head", "options"]

    def narrow(self, queryset):
        return queryset.none()

    @extend_schema(
        parameters=[OpenApiParameter("company", OpenApiTypes.UUID, required=True)],
        responses=forced_singular_serializer(RegisterPeopleSerializer),
    )
    def list(self, request):
        company = serializers.UUIDField().run_validation(request.query_params.get("company"))
        return Response(RegisterPeopleSerializer(company_people(actor=request.user, company_id=company)).data)

    @extend_schema(
        request=RegisterPersonCreateSerializer,
        responses={200: RegisterPersonRegistrationSerializer, 201: RegisterPersonRegistrationSerializer},
    )
    def create(self, request):
        serializer = RegisterPersonCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        person, created = add_person(actor=request.user, **serializer.validated_data)
        return Response(RegisterPersonRegistrationSerializer(person).data, status=201 if created else 200)
