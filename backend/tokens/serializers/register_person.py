from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import RegisterPersonRegistration
from tokens.serializers.register_transfer import RegisterMemberSelectionSerializer


class RegisterPersonCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    company = serializers.UUIDField()
    appointment = serializers.UUIDField()
    member = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    residential_address = serializers.CharField(max_length=REGISTER_IMPORT_ADDRESS_LENGTH)


class RegisterPersonRegistrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RegisterPersonRegistration
        fields = [
            "uuid",
            "company",
            "member",
            "name",
            "residential_address",
            "preparing_appointment",
            "submitted_by",
            "created_at",
        ]
        read_only_fields = fields


class RegisterPeopleSerializer(serializers.Serializer):
    company = serializers.UUIDField()
    members = RegisterMemberSelectionSerializer(many=True)
