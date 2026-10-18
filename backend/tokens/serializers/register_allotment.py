from datetime import date

from rest_framework import serializers

from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.models import (
    RegisterAgreement,
    RegisterAllotment,
    RegisterAllotmentDecision,
    RegisterContribution,
)
from tokens.serializers.register_decision import (
    RegisterDecidedSerializer,
    RegisterDecideSerializer,
    RegisterDecisionRequestSerializer,
    RegisterDecisionSerializer,
)


class RegisterAllotmentCreateSerializer(serializers.Serializer):
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
    company_event_on = serializers.DateField()
    consideration = serializers.RegexField(regex=r"^(?:0|[1-9][0-9]{0,17})(?:[.][0-9]{1,2})?$")
    currency = serializers.ChoiceField(choices=["AUD"])
    agreement_reference = serializers.CharField(max_length=255)
    agreement_on = serializers.DateField()
    terms = serializers.CharField(max_length=1000)
    agreement_evidence = serializers.UUIDField()
    received_amount = serializers.RegexField(regex=r"^(?:0|[1-9][0-9]{0,17})(?:[.][0-9]{1,2})?$")
    received_on = serializers.DateField()
    receipt_evidence = serializers.UUIDField()
    approving_director = serializers.CharField(max_length=255)
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)
    authority_evidence = serializers.UUIDField()


class RegisterAgreementSerializer(serializers.ModelSerializer):
    recorded_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = RegisterAgreement
        fields = [
            "uuid",
            "reference",
            "agreed_on",
            "terms",
            "evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
            "recorded_by",
            "recorded_at",
        ]
        read_only_fields = fields


class RegisterContributionSerializer(serializers.ModelSerializer):
    recorded_at = serializers.DateTimeField(source="created_at", read_only=True)
    company_recorded = serializers.SerializerMethodField()

    class Meta:
        model = RegisterContribution
        fields = [
            "uuid",
            "amount",
            "currency",
            "received_on",
            "evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
            "recorded_by",
            "recorded_at",
            "company_recorded",
        ]
        read_only_fields = fields

    def get_company_recorded(self, obj) -> bool:
        return True


class RegisterAllotmentDecisionRequestSerializer(RegisterDecisionRequestSerializer):
    pass


class RegisterAllotmentDecideSerializer(RegisterDecideSerializer):
    pass


class RegisterAllotmentDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    member = serializers.UUIDField()
    new_member = serializers.BooleanField()
    name = serializers.CharField()
    residential_address = serializers.CharField()
    shares = serializers.CharField()
    consideration = serializers.CharField()
    currency = serializers.CharField()
    agreement = RegisterAgreementSerializer()
    contribution = RegisterContributionSerializer()
    approving_director = serializers.CharField()
    authority_reference = serializers.CharField()
    reason = serializers.CharField()
    company_event_on = serializers.DateField(allow_null=True)
    effective_on = serializers.DateField(allow_null=True)
    register_sequence = serializers.IntegerField()
    issued_supply = serializers.CharField()
    authorised_supply = serializers.CharField()
    after_issued_supply = serializers.CharField()
    current_shares = serializers.CharField()
    after_shares = serializers.CharField()


class RegisterAllotmentDecisionSerializer(RegisterDecisionSerializer):
    class Meta(RegisterDecisionSerializer.Meta):
        model = RegisterAllotmentDecision


class RegisterAllotmentSerializer(RegisterDecidedSerializer):
    effective_on = serializers.SerializerMethodField()
    agreement = RegisterAgreementSerializer(read_only=True)
    contribution = RegisterContributionSerializer(read_only=True)
    decisions = RegisterAllotmentDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = RegisterAllotment
        fields = [
            "uuid",
            "company",
            "token",
            "member",
            "new_member",
            "name",
            "residential_address",
            "shares",
            "consideration",
            "currency",
            "effective_on",
            "company_event_on",
            "agreement",
            "contribution",
            "approving_director",
            "authority_reference",
            "reason",
            "authority_evidence",
            "evidence_fingerprint",
            "evidence_snapshot",
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
