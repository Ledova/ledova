import csv

from django.http import Http404, HttpResponse
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from shared.db.middleware import RunsOnTheOperatorConnection
from shared.utils import csv_cell
from shared.views.principal import SetsThePrincipalOnTheConnection
from shared.views.scope import PolicyQuerysets
from whitelist.filters import WhitelistEntryFilter
from whitelist.models import WhitelistEntry
from whitelist.serializers import (
    WhitelistEntrySerializer,
    WhitelistSyncResponseSerializer,
)
from whitelist.services import whitelist
from whitelist.services.whitelist import unique_wallet_uuid_for


class WhitelistEntryViewSet(
    RunsOnTheOperatorConnection,
    PolicyQuerysets,
    SetsThePrincipalOnTheConnection,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = WhitelistEntrySerializer
    permission_classes = [IsAdminUser]
    filterset_class = WhitelistEntryFilter
    ordering = ["-created_at"]
    ordering_fields = ["created_at"]
    lookup_field = "uuid"

    scoped_model = WhitelistEntry

    def narrow(self, queryset):
        return queryset.prefetch_related("approvals__company")

    @action(detail=False, methods=["get"], url_path="entry/(?P<address>[^/.]+)")
    def by_address(self, request, address=None):
        address = address.lower()

        entries = list(self.get_queryset().filter_by_address(address).select_related("wallet").order_by("uuid")[:2])
        if len(entries) != 1:
            raise Http404(f"No whitelist entry found for {address}")

        serializer = self.get_serializer(entries[0])
        return Response(serializer.data)

    @extend_schema(responses=WhitelistSyncResponseSerializer)
    @action(detail=False, methods=["post"], url_path="sync/(?P<address>[^/.]+)")
    def sync(self, request, address=None):
        wallet_uuid = unique_wallet_uuid_for(address)

        entry = whitelist.sync_entry(address, wallet_uuid=wallet_uuid)

        response_data = {
            "success": True,
            "entry": entry,
            "message": f"Successfully synced {address} with on-chain data",
        }

        return Response(
            WhitelistSyncResponseSerializer(response_data).data,
            status=status.HTTP_200_OK,
        )

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    @action(detail=False, methods=["get"])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset())

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="whitelist-export.csv"'

        writer = csv.writer(response)
        writer.writerow(
            [
                "Wallet Address",
                "Company",
                "Status",
                "Expires At",
                "Created At",
                "Updated At",
            ]
        )

        for entry in queryset:
            for approval in entry.approvals.all() or [None]:
                writer.writerow(
                    [
                        csv_cell(entry.wallet_address),
                        csv_cell(approval.company.name if approval else ""),
                        csv_cell(approval.status_display() if approval else "No approval"),
                        csv_cell(approval.expires_at.isoformat() if approval and approval.expires_at else ""),
                        csv_cell(entry.created_at.isoformat() if entry.created_at else ""),
                        csv_cell(entry.updated_at.isoformat() if entry.updated_at else ""),
                    ]
                )

        return response
