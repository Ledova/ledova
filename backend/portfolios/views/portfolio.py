from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from portfolios.filters import PortfolioFilter
from portfolios.models.portfolio import Portfolio
from portfolios.serializers.portfolio import (
    PortfolioSerializer,
    PortfolioWalletResponseSerializer,
)
from portfolios.services import PortfolioWalletService
from shared.views.base import AuthenticatedModelViewSet
from users.services.accounts import account_of


class PortfolioViewSet(AuthenticatedModelViewSet):
    serializer_class = PortfolioSerializer
    filterset_class = PortfolioFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at", "name"]

    scoped_model = Portfolio

    def narrow(self, queryset):
        return queryset.active()

    def perform_create(self, serializer):
        user_account = account_of(self.request.user)
        if user_account is None:
            raise ValidationError({"userAccount": "This user has no account."})

        return serializer.save(user_account=user_account)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])

    @extend_schema(responses={200: PortfolioWalletResponseSerializer})
    @action(detail=True, methods=["post"], url_path="add-wallet")
    def add_wallet(self, request, *args, **kwargs):
        portfolio = self.get_object()
        wallet_uuid = request.data.get("wallet_uuid")
        if not wallet_uuid:
            raise ValidationError({"walletUuid": "This field is required."})

        portfolio = PortfolioWalletService.add_wallet_to_portfolio(portfolio=portfolio, wallet_uuid=wallet_uuid)
        serializer = self.get_serializer(portfolio)
        return Response(
            {"success": True, "message": "Wallet added to portfolio successfully", "portfolio": serializer.data},
            status=status.HTTP_200_OK,
        )

    @extend_schema(responses={200: PortfolioWalletResponseSerializer})
    @action(detail=True, methods=["post"], url_path="remove-wallet")
    def remove_wallet(self, request, *args, **kwargs):
        portfolio = self.get_object()
        wallet_uuid = request.data.get("wallet_uuid")
        if not wallet_uuid:
            raise ValidationError({"walletUuid": "This field is required."})

        portfolio = PortfolioWalletService.remove_wallet_from_portfolio(portfolio=portfolio, wallet_uuid=wallet_uuid)
        serializer = self.get_serializer(portfolio)
        return Response(
            {"success": True, "message": "Wallet removed from portfolio successfully", "portfolio": serializer.data},
            status=status.HTTP_200_OK,
        )
