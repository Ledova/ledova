from django.db.models import Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter
from rest_framework.exceptions import ValidationError

SEARCH_MAX_LENGTH = 100
SEARCH_PARAMETER = OpenApiParameter("search", OpenApiTypes.STR, description="Matches every word, ignoring case.")


def every_word(queryset, query, *fields):
    for word in query.split():
        queryset = queryset.filter(Q.create([(f"{field}__icontains", word) for field in fields], connector=Q.OR))
    return queryset


def filtered(filterset_class, request, queryset):
    filterset = filterset_class(request.query_params, queryset=queryset, request=request)
    if not filterset.is_valid():
        raise ValidationError(filterset.errors)
    return filterset.qs
