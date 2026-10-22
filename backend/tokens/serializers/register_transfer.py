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
    company_event_on = serializers.DateField()
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
    complete_transfer = serializers.BooleanField(required=False, default=False)
    apply_appointment = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if attrs["complete_transfer"] and (attrs["kind"] != "approve" or attrs["reason"]):
            raise serializers.ValidationError("Completion requires approval without a rejection reason.")
        if "apply_appointment" in attrs and not attrs["complete_transfer"]:
            raise serializers.ValidationError("An application appointment requires completion.")
        return attrs


class RegisterTransferDecideSerializer(RegisterTransferDecisionRequestSerializer, RegisterDecideSerializer):
    pass


class RegisterTransferDecisionPreviewSerializer(serializers.Serializer):
    complete_transfer = serializers.BooleanField(default=False)
    apply_appointment = serializers.UUIDField(allow_null=True, default=None)
    company = serializers.UUIDField()
    token = serializers.UUIDField()
    authority_reference = serializers.CharField()
    reason = serializers.CharField()
    authority_evidence = serializers.UUIDField()
    evidence_fingerprint = serializers.CharField()
    instrument_evidence = serializers.UUIDField()
    instrument_fingerprint = serializers.CharField()
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
    company_event_on = serializers.DateField(allow_null=True)
    effective_on = serializers.DateField(allow_null=True)
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
    complete_transfer = serializers.SerializerMethodField()
    approval_appointment = serializers.UUIDField(
        source="completion_approval_appointment_id", read_only=True, allow_null=True
    )

    def get_complete_transfer(self, obj) -> bool:
        return obj.completion_approval_appointment_id is not None

    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterTransferDecision
        fields = [*RegisterDecisionSerializer.Meta.fields, "complete_transfer", "approval_appointment"]
        read_only_fields = fields


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
            "company_event_on",
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
    on_register = serializers.BooleanField(
        required=False, help_text="Whether the person has ever held shares on a company register."
    )

    has_awards = serializers.BooleanField(required=False)


class RegisterAwardRecipientSerializer(serializers.Serializer):
    member = serializers.UUIDField()
    name = serializers.CharField()
    residential_address = serializers.CharField()


class RegisterMembersSerializer(serializers.Serializer):
    members = RegisterMemberSelectionSerializer(many=True)
    award_recipients = RegisterAwardRecipientSerializer(many=True)
