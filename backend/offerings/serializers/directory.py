from django.urls import reverse
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from companies.models import Company, CompanyDocument
from tokens.serializers import ShareTokenListSerializer

DIRECTORY_COMPANY_FIELDS = ["display_name", "industry", "city", "state"]


class DirectoryCompanySerializer(serializers.ModelSerializer):

    class Meta:
        model = Company
        fields = DIRECTORY_COMPANY_FIELDS
        read_only_fields = fields


class DirectoryOpenOfferingSerializer(serializers.Serializer):

    uuid = serializers.UUIDField(source="open_offering_uuid", read_only=True)
    price_per_share = serializers.DecimalField(
        source="open_offering_price", max_digits=18, decimal_places=2, read_only=True
    )
    price_currency = serializers.CharField(source="open_offering_currency", read_only=True)
    opens_at = serializers.DateTimeField(source="open_offering_opens_at", read_only=True)
    closes_at = serializers.DateTimeField(source="open_offering_closes_at", read_only=True)


class DirectoryOpenOfferingResponseSerializer(DirectoryOpenOfferingSerializer):
    closes_at = serializers.DateTimeField(source="open_offering_closes_at", read_only=True, allow_null=True)


class DirectoryTokenListSerializer(ShareTokenListSerializer):

    company = DirectoryCompanySerializer(read_only=True)
    issued_shares = serializers.IntegerField(read_only=True)
    open_offering = serializers.SerializerMethodField()

    class Meta(ShareTokenListSerializer.Meta):
        fields = ShareTokenListSerializer.Meta.fields + ["issued_shares", "open_offering"]
        read_only_fields = fields

    @extend_schema_field(DirectoryOpenOfferingResponseSerializer(allow_null=True))
    def get_open_offering(self, obj):
        if obj.open_offering_uuid is None:
            return None
        return DirectoryOpenOfferingSerializer(obj).data


class DirectoryDocumentSerializer(serializers.ModelSerializer):

    document_type_display = serializers.CharField(source="get_document_type_display", read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = CompanyDocument
        fields = [
            "uuid",
            "name",
            "document_type",
            "document_type_display",
            "file_size",
            "mime_type",
            "valid_from",
            "valid_until",
            "created_at",
            "file_url",
        ]
        read_only_fields = fields

    def get_file_url(self, obj) -> str:
        url = reverse(
            "directory:tokens-document-file",
            kwargs={"uuid": self.context["token"].uuid, "document_uuid": obj.uuid},
        )
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url
