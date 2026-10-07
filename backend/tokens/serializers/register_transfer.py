from datetime import date

from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import RegisterTransfer, RegisterTransferDecision
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterTransferCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token_id = serializers.UUIDField()
    from_member = serializers.UUIDField()
    to_member = serializers.UUIDField()
    new_member = serializers.BooleanField()
    name = serializers.CharField(max_length=255, allow_blank=True, required=False, default="")
    residential_address = serializers.CharField(
        max_length=REGISTER_IMPORT_ADDRESS_LENGTH, allow_blank=True, required=False, default=""
    )
    shares = serializers.RegexField(regex=r"^[1-9][0-9]{0,77}$")
    signed_on = serializers.DateField()
    lodged_on = serializers.DateField()
    terms = serializers.CharField(max_length=1000)
    authority = serializers.ChoiceField(choices=["director_resolution"], required=False, default="director_resolution")
    approving_director = serializers.CharField(max_length=255)
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)
    authority_evidence = serializers.UUIDField()
    instrument_evidence = serializers.UUIDField()


class RegisterTransferDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterTransferDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterTransferDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    from_member = serializers.UUIDField()
    to_member = serializers.UUIDField()
    new_member = serializers.BooleanField()
    new_particulars = serializers.BooleanField()
    from_name = serializers.CharField()
    from_residential_address = serializers.CharField()
    name = serializers.CharField()
    residential_address = serializers.CharField()
    shares = serializers.CharField()
    signed_on = serializers.DateField()
    lodged_on = serializers.DateField()
    effective_on = serializers.DateField()
    terms = serializers.CharField()
    authority = serializers.CharField()
    approving_director = serializers.CharField()
    register_sequence = serializers.IntegerField()
    issued_supply = serializers.CharField()
    authorised_supply = serializers.CharField()
    after_issued_supply = serializers.CharField()
    from_current_shares = serializers.CharField()
    from_after_shares = serializers.CharField()
    to_current_shares = serializers.CharField()
    to_after_shares = serializers.CharField()


class RegisterTransferDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterTransferDecision


class RegisterTransferSerializer(RegisterDecidedSerializer):
    decisions = RegisterTransferDecisionSerializer(many=True, read_only=True)
    effective_on = serializers.SerializerMethodField()

    class Meta:
        model = RegisterTransfer
        fields = [
            "uuid",
            "company",
            "token",
            "from_member",
            "to_member",
            "new_member",
            "new_particulars",
            "from_name",
            "from_residential_address",
            "from_particulars",
            "name",
            "residential_address",
            "to_particulars",
            "shares",
            "signed_on",
            "lodged_on",
            "effective_on",
            "terms",
            "authority",
            "approving_director",
            "authority_reference",
            "reason",
            "authority_evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
            "instrument_evidence",
            "instrument_fingerprint",
            "instrument_snapshot",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "register_entry",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
        ]
        read_only_fields = fields

    def get_effective_on(self, obj) -> date | None:
        return obj.register_entry.effective_on if obj.register_entry_id else None


class RegisterMemberSelectionSerializer(serializers.Serializer):
    member = serializers.UUIDField()
    name = serializers.CharField(allow_null=True)
    residential_address = serializers.CharField(allow_null=True)
    current_shares = serializers.CharField()
    entered_on = serializers.DateField(allow_null=True)
    last_ceased_on = serializers.DateField(allow_null=True)
    walletless = serializers.BooleanField()
    particulars_retained = serializers.BooleanField()


class RegisterMembersSerializer(serializers.Serializer):
    members = RegisterMemberSelectionSerializer(many=True)
