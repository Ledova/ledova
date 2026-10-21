from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import (
    RegisterAward,
    RegisterAwardEnd,
    RegisterAwardVesting,
    RegisterAwardVestingReversal,
    RegisterMemberParticulars,
)
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
    ended_unvested_shares = serializers.CharField(read_only=True)
    ended_vested_shares = serializers.CharField(read_only=True)
    unvested_remaining_shares = serializers.CharField(read_only=True)
    remaining_unissued_shares = serializers.CharField(read_only=True)
    recipient_name = serializers.CharField(read_only=True)
    recipient_residential_address = serializers.CharField(read_only=True)

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
            "ended_unvested_shares",
            "ended_vested_shares",
            "unvested_remaining_shares",
            "remaining_unissued_shares",
            "recipient_name",
            "recipient_residential_address",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        held = RegisterMemberParticulars.objects.filter(
            member_id=instance.member, member__company_id=instance.company_id
        ).first()
        return {
            **super().to_representation(instance),
            **award_quantities(instance),
            "recipient_name": held.name if held else instance.name,
            "recipient_residential_address": held.residential_address if held else instance.residential_address,
        }


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


class RegisterAwardEndCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    award = serializers.UUIDField()
    unvested_shares = serializers.RegexField(regex=r"^(0|[1-9][0-9]{0,77})$")
    vested_shares = serializers.RegexField(regex=r"^(0|[1-9][0-9]{0,77})$")
    company_event_on = serializers.DateField()
    reason = serializers.CharField(max_length=1000)
    evidence = serializers.UUIDField()


class RegisterAwardVestingReversalCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    vesting = serializers.UUIDField()
    reversed_shares = serializers.RegexField(regex=r"^[1-9][0-9]{0,77}$")
    company_event_on = serializers.DateField()
    reason = serializers.CharField(max_length=1000)
    evidence = serializers.UUIDField()


class RegisterAwardEndSerializer(serializers.ModelSerializer):
    prepared_by_name = serializers.CharField(source="preparing_appointment.appointee_profile.full_name", read_only=True)
    provided_by = serializers.CharField(default="company", read_only=True)

    class Meta:
        model = RegisterAwardEnd
        fields = [
            "uuid",
            "company",
            "award",
            "unvested_shares",
            "vested_shares",
            "company_event_on",
            "reason",
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


class RegisterAwardVestingReversalSerializer(serializers.ModelSerializer):
    prepared_by_name = serializers.CharField(source="preparing_appointment.appointee_profile.full_name", read_only=True)
    provided_by = serializers.CharField(default="company", read_only=True)

    class Meta:
        model = RegisterAwardVestingReversal
        fields = [
            "uuid",
            "company",
            "award",
            "vesting",
            "reversed_shares",
            "company_event_on",
            "reason",
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
