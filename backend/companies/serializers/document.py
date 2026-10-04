from django.urls import reverse
from rest_framework import serializers

from companies.models import CompanyDocument
from companies.services.documents import create_document
from shared.uploads import validate_upload


class CompanyDocumentSerializer(serializers.ModelSerializer):

    company = serializers.UUIDField(source="company_id", read_only=True)

    document_type_display = serializers.CharField(
        source="get_document_type_display",
        read_only=True,
    )

    file_url = serializers.SerializerMethodField()

    file = serializers.FileField(write_only=True, required=False)

    external_url = serializers.URLField(write_only=True, required=False)

    file_size = serializers.IntegerField(required=False)
    mime_type = serializers.CharField(required=False)

    class Meta:
        model = CompanyDocument
        fields = [
            "uuid",
            "company",
            "document_type",
            "document_type_display",
            "name",
            "file",
            "external_url",
            "file_url",
            "file_size",
            "mime_type",
            "is_verified",
            "verified_at",
            "created_at",
        ]
        read_only_fields = ["uuid", "company", "is_verified", "verified_at", "created_at"]

    def get_file_url(self, obj) -> str:
        if not obj.file:
            return obj.external_url
        url = reverse(
            "companies:documents-file",
            kwargs={"company_uuid": obj.company_id, "uuid": obj.uuid},
        )
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url

    def validate(self, data):
        file = data.get("file")
        external_url = data.get("external_url")

        if not file and not external_url:
            raise serializers.ValidationError("Either 'file' or 'external_url' must be provided.")

        if file:
            data["file_size"], data["mime_type"] = validate_upload(file)
        elif external_url:
            if not data.get("file_size"):
                raise serializers.ValidationError({"file_size": "This field is required when using external_url."})
            if not data.get("mime_type"):
                raise serializers.ValidationError({"mime_type": "This field is required when using external_url."})

        return data

    def create(self, validated_data):
        company = validated_data.pop("company")
        return create_document(company_id=company.pk, actor=self.context["request"].user, data=validated_data)
