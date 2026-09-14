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
from whitelist.exceptions import (
    BatchEntriesRequiredException,
    BatchSizeLimitExceededException,
    WhitelistChangeUnresolved,
)
from whitelist.filters import WhitelistEntryFilter
from whitelist.models import WhitelistAction, WhitelistChangeStatus, WhitelistEntry
from whitelist.serializers import (
    WhitelistAddSerializer,
    WhitelistBatchAddSerializer,
    WhitelistBatchResponseSerializer,
    WhitelistChangeSerializer,
    WhitelistEntrySerializer,
    WhitelistRemoveSerializer,
    WhitelistSyncResponseSerializer,
)
from whitelist.services import changes, whitelist
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
    ordering_fields = ["created_at", "status"]
    lookup_field = "uuid"

    scoped_model = WhitelistEntry

    @action(detail=False, methods=["get"], url_path="entry/(?P<address>[^/.]+)")
    def by_address(self, request, address=None):
        address = address.lower()

        entries = list(self.get_queryset().filter_by_address(address).select_related("wallet").order_by("uuid")[:2])
        if len(entries) != 1:
            raise Http404(f"No whitelist entry found for {address}")

        serializer = self.get_serializer(entries[0])
        return Response(serializer.data)

    @extend_schema(
        request=WhitelistAddSerializer,
        responses={200: WhitelistChangeSerializer, 201: WhitelistChangeSerializer, 202: WhitelistChangeSerializer},
    )
    @action(detail=False, methods=["post"])
    def add(self, request):
        serializer = WhitelistAddSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change = changes.submit(
            serializer.validated_data["submission_id"],
            WhitelistAction.ADD,
            serializer.validated_data["wallet_address"],
            request.user,
        )
        response_status = (
            status.HTTP_202_ACCEPTED
            if change.status in (WhitelistChangeStatus.PENDING, WhitelistChangeStatus.EXECUTING)
            else status.HTTP_201_CREATED if change.status == WhitelistChangeStatus.CONFIRMED else status.HTTP_200_OK
        )
        return Response(WhitelistChangeSerializer(change).data, status=response_status)

    @extend_schema(
        request=WhitelistRemoveSerializer, responses={200: WhitelistChangeSerializer, 202: WhitelistChangeSerializer}
    )
    @action(detail=False, methods=["post"])
    def remove(self, request):
        serializer = WhitelistRemoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        change = changes.submit(
            serializer.validated_data["submission_id"],
            WhitelistAction.REMOVE,
            serializer.validated_data["wallet_address"],
            request.user,
        )
        response_status = (
            status.HTTP_202_ACCEPTED
            if change.status in (WhitelistChangeStatus.PENDING, WhitelistChangeStatus.EXECUTING)
            else status.HTTP_200_OK
        )
        return Response(WhitelistChangeSerializer(change).data, status=response_status)

    @extend_schema(responses=WhitelistSyncResponseSerializer)
    @action(detail=False, methods=["post"], url_path="sync/(?P<address>[^/.]+)")
    def sync(self, request, address=None):
        wallet_uuid = unique_wallet_uuid_for(address)

        entry = whitelist.sync_entry(address, wallet_uuid=wallet_uuid)

        response_data = {
            "success": True,
            "entry": WhitelistEntrySerializer(entry).data,
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
                "Status",
                "Is Whitelisted",
                "Created At",
                "Updated At",
            ]
        )

        for entry in queryset:
            writer.writerow(
                [
                    csv_cell(entry.wallet_address),
                    csv_cell(entry.get_status_display()),
                    "Yes" if entry.is_whitelisted else "No",
                    csv_cell(entry.created_at.isoformat() if entry.created_at else ""),
                    csv_cell(entry.updated_at.isoformat() if entry.updated_at else ""),
                ]
            )

        return response

    @extend_schema(request=WhitelistBatchAddSerializer, responses=WhitelistBatchResponseSerializer)
    @action(detail=False, methods=["post"], url_path="batch-add")
    def batch_add(self, request):
        from rest_framework.exceptions import APIException

        entries = request.data.get("entries", [])
        if not isinstance(entries, list) or not entries:
            raise BatchEntriesRequiredException()
        if len(entries) > 100:
            raise BatchSizeLimitExceededException(max_size=100)
        result = {"successful": 0, "failed": 0, "pending": 0, "results": [], "errors": []}
        for data in entries:
            address = data.get("wallet_address", data.get("walletAddress", "")) if isinstance(data, dict) else ""
            serializer = WhitelistAddSerializer(data=data)
            if not serializer.is_valid():
                result["failed"] += 1
                result["errors"].append(
                    {"wallet_address": address, "error": "A valid address and submission UUID are required."}
                )
                continue
            try:
                change = changes.submit(
                    serializer.validated_data["submission_id"],
                    WhitelistAction.ADD,
                    serializer.validated_data["wallet_address"],
                    request.user,
                )
                result["results"].append(change)
                if change.status in (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED):
                    result["successful"] += 1
                elif change.status == WhitelistChangeStatus.FAILED:
                    result["failed"] += 1
                else:
                    result["pending"] += 1
            except WhitelistChangeUnresolved as exc:
                result["pending"] += 1
                result["errors"].append({"wallet_address": address, "error": str(exc.detail)})
            except APIException as exc:
                result["failed"] += 1
                result["errors"].append({"wallet_address": address, "error": str(exc.detail)})
        return Response(WhitelistBatchResponseSerializer(result).data)
