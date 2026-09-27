from drf_spectacular.utils import (
    OpenApiParameter,
    extend_schema,
    extend_schema_view,
)
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response

from assets.filters import AssetFilter
from assets.models import Asset
from assets.serializers import (
    AssetSerializer,
    ExchangeRateResponseSerializer,
)
from assets.services import ExchangeRateService
from shared.views.base import AuthenticatedListViewSet


@extend_schema_view(list=extend_schema(parameters=[OpenApiParameter("chain", str)]))
class AssetViewSet(AuthenticatedListViewSet):
    serializer_class = AssetSerializer
    filterset_class = AssetFilter
    ordering = ["symbol"]
    ordering_fields = ["symbol", "name", "current_price", "asset_type"]

    scoped_model = Asset

    def narrow(self, queryset):
        chain = self.request.query_params.get("chain")
        queryset = queryset.verified().excluding_securities()
        if chain:
            queryset = queryset.filter_by_chain(chain)
        else:
            queryset = queryset.filter_by_supported_chains()
        return queryset

    @extend_schema(responses={200: ExchangeRateResponseSerializer}, parameters=[OpenApiParameter("currency", str)])
    @action(detail=False, methods=["get"], url_path="exchange-rates")
    def exchange_rates(self, request):
        target = request.query_params.get("currency", "AUD")
        rate = ExchangeRateService.get_rate(target_currency=target.upper())

        if rate is None:
            return Response(
                {"detail": f"Exchange rate for USD→{target.upper()} not available"},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "baseCurrency": "USD",
                "targetCurrency": target.upper(),
                "rate": str(rate),
            }
        )
