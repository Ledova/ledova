from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import RegisterAward, RegisterAwardVesting
from tokens.services.register_awards import award_quantities


class RegisterAwardCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token_id = serializers.UUIDField()
    member = serializers.UUIDField()
    new_member = serializers.BooleanField()
    name = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    residential_address = serializers.CharField(
        max_length=REGISTER_IMPORT_ADDRESS_LENGTH, allow_blank=True, required=False, default=""
    )
    shares = serializers.RegexField(regex=r"^[1-9][0-9]{0,77}$")
    terms_on = serializers.DateField()
    terms = serializers.CharField(max_length=1000)
    schedule = serializers.CharField(max_length=1000)
    agreement_evidence = serializers.UUIDField()


class RegisterAwardVestingCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    award = serializers.UUIDField()
    shares = serializers.RegexField(regex=r"^[1-9][0-9]{0,77}$")
    vested_on = serializers.DateField()
    evidence = serializers.UUIDField()


class RegisterAwardSerializer(serializers.ModelSerializer):
    prepared_by_name = serializers.CharField(source="preparing_appointment.appointee_profile.full_name", read_only=True)
    provided_by = serializers.CharField(default="company", read_only=True)
    vested_shares = serializers.CharField(read_only=True)
    issued_shares = serializers.CharField(read_only=True)
    available_shares = serializers.CharField(read_only=True)

    class Meta:
        model = RegisterAward
        fields = [
            "uuid",
            "company",
            "token",
            "member",
            "new_member",
            "name",
            "residential_address",
            "shares",
            "terms_on",
            "terms",
            "schedule",
            "agreement_evidence",
            "agreement_fingerprint",
            "agreement_snapshot",
            "preparing_appointment",
            "prepared_by_name",
            "submitted_by",
            "created_at",
            "provided_by",
            "vested_shares",
            "issued_shares",
            "available_shares",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        return {**super().to_representation(instance), **award_quantities(instance)}


class RegisterAwardVestingSerializer(serializers.ModelSerializer):
    prepared_by_name = serializers.CharField(source="preparing_appointment.appointee_profile.full_name", read_only=True)
    provided_by = serializers.CharField(default="company", read_only=True)

    class Meta:
        model = RegisterAwardVesting
        fields = [
            "uuid",
            "company",
            "award",
            "shares",
            "vested_on",
            "evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
            "preparing_appointment",
            "prepared_by_name",
            "submitted_by",
            "created_at",
            "provided_by",
        ]
        read_only_fields = fields
