from rest_framework import serializers

from shared.api.search import SEARCH_MAX_LENGTH


class RegisterCertificateEntriesQuerySerializer(serializers.Serializer):
    search = serializers.CharField(max_length=SEARCH_MAX_LENGTH, required=False, allow_blank=True, default="")
    certificate_status = serializers.ChoiceField(
        choices=[
            "all",
            "can_prepare",
            "reversed",
            "not_requested",
            "requested",
            "withdrawn",
            "fulfilled",
            "not_applicable",
        ],
        required=False,
    )
    association = serializers.UUIDField(required=False)


class RegisterCertificateSelectionSerializer(serializers.Serializer):
    sequence = serializers.IntegerField(min_value=1)


class RegisterCertificatePreviewSerializer(serializers.Serializer):
    token = serializers.UUIDField()
    appointment = serializers.UUIDField()
    entry = serializers.UUIDField()
    sequence = serializers.IntegerField(min_value=1)
    register_sequence = serializers.IntegerField(min_value=1)
    page_count = serializers.IntegerField(min_value=1, max_value=2)
    source_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")


class RegisterCertificateRequestSerializer(RegisterCertificateSelectionSerializer):
    appointment = serializers.UUIDField()
    source_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")
    instruction = serializers.CharField(max_length=255, required=False)


class MemberCertificateFulfilmentPreviewSerializer(RegisterCertificatePreviewSerializer):
    company = serializers.UUIDField()
    member_request = serializers.UUIDField()
    member = serializers.UUIDField()


class MemberCertificateFulfilmentCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    source_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")
    instruction = serializers.CharField(max_length=255)
