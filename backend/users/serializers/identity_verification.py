from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers


class ExtractedApplicantDataSerializer(serializers.Serializer):
    full_name = serializers.CharField(allow_null=True)
    date_of_birth = serializers.CharField(allow_null=True)
    address = serializers.CharField(allow_null=True)
    residence_country = serializers.CharField(allow_null=True, required=False)


@extend_schema_field(ExtractedApplicantDataSerializer)
class ExtractedApplicantDataField(serializers.JSONField):
    pass


@extend_schema_field(serializers.ListField(child=serializers.CharField()))
class RejectionLabelsField(serializers.JSONField):
    pass
