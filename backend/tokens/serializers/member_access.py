from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from authentication.serializers.fields import NormalizedEmailField
from companies.serializers.team import StrictTeamSerializer
from tokens.models import (
    MemberAssociation,
    MemberCertificateFulfilment,
    MemberCertificateRequest,
    MemberInvitation,
    MemberParticularsRequest,
)
from tokens.serializers.ownership import (
    CompanyOwnershipSummarySerializer,
    OwnershipClassSerializer,
)
from tokens.services.member_access import _query


class MemberInvitationCreateSerializer(StrictTeamSerializer):
    operation_id = serializers.UUIDField()
    company = serializers.UUIDField()
    appointment = serializers.UUIDField()
    member = serializers.UUIDField()
    intended_email = NormalizedEmailField()
    acceptance_deadline = serializers.DateTimeField(required=False, allow_null=True, default=None)


class MemberInvitationAcceptSerializer(StrictTeamSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{43}$", trim_whitespace=False, write_only=True)
    user_account = serializers.UUIDField()
    confirmation = serializers.BooleanField()


class MemberInvitationPreviewRequestSerializer(StrictTeamSerializer):
    code = serializers.RegexField(r"^[A-Za-z0-9_-]{43}$", trim_whitespace=False, write_only=True)


class MemberInvitationSubjectSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()


class MemberInvitationPreviewSerializer(serializers.Serializer):
    company = MemberInvitationSubjectSerializer()
    member = MemberInvitationSubjectSerializer()
    intended_email = serializers.EmailField()
    acceptance_deadline = serializers.DateTimeField()
    status = serializers.ChoiceField(choices=["pending", "accepted"])


class MemberInvitationSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()

    class Meta:
        model = MemberInvitation
        fields = [
            "uuid",
            "company",
            "member",
            "intended_email",
            "issued_by",
            "appointment",
            "acceptance_deadline",
            "status",
            "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=["pending", "expired", "unavailable", "accepted", "revoked"]))
    def get_status(self, obj):
        from django.utils import timezone

        association = getattr(obj, "association", None)
        if association:
            return "accepted" if association.current else "revoked"
        if obj.acceptance_deadline <= timezone.now():
            return "expired"
        return "pending" if _query("tokens_member_invitation_current", obj.pk) else "unavailable"


class MemberInvitationIssuedSerializer(MemberInvitationSerializer):
    code = serializers.CharField(read_only=True, allow_null=True)

    class Meta(MemberInvitationSerializer.Meta):
        fields = [*MemberInvitationSerializer.Meta.fields, "code"]
        read_only_fields = fields


class MemberInvitationEmailSerializer(MemberInvitationSerializer):
    email_delivery = serializers.ChoiceField(choices=["accepted"], read_only=True)

    class Meta(MemberInvitationSerializer.Meta):
        fields = [*MemberInvitationSerializer.Meta.fields, "email_delivery"]
        read_only_fields = fields


class MemberAssociationSerializer(serializers.ModelSerializer):
    class Meta:
        model = MemberAssociation
        fields = [
            "uuid",
            "invitation",
            "company",
            "member",
            "user",
            "user_account",
            "accepted_email",
            "current",
            "created_at",
        ]
        read_only_fields = fields


class MemberAssociationRevokeSerializer(StrictTeamSerializer):
    appointment = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    reason = serializers.CharField(max_length=1000)


class MemberParticularsRequestCreateSerializer(StrictTeamSerializer):
    operation_id = serializers.UUIDField()
    association = serializers.UUIDField()
    name = serializers.CharField(max_length=255)
    residential_address = serializers.CharField(max_length=1000)
    confirmation = serializers.BooleanField()


class MemberParticularsRequestPrepareSerializer(StrictTeamSerializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    supporting_evidence = serializers.UUIDField()
    as_at = serializers.DateField()
    reason = serializers.CharField(max_length=1000)


class MemberParticularsRequestSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    change = serializers.UUIDField(source="change.uuid", read_only=True, allow_null=True, default=None)

    class Meta:
        model = MemberParticularsRequest
        fields = [
            "uuid",
            "association",
            "company",
            "member",
            "requested_by",
            "name",
            "residential_address",
            "status",
            "change",
            "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=["submitted", "prepared", "approved", "applied", "rejected"]))
    def get_status(self, obj):
        change = getattr(obj, "change", None)
        if change is None:
            return "submitted"
        if change.status != "submitted":
            return change.status
        from django.utils import timezone

        return "approved" if _query("tokens_register_particulars_approved", change.pk, timezone.now()) else "prepared"


class MemberCertificateRequestCreateSerializer(StrictTeamSerializer):
    operation_id = serializers.UUIDField()
    association = serializers.UUIDField()
    entry = serializers.UUIDField()


class MemberCertificateWithdrawSerializer(StrictTeamSerializer):
    idempotency_key = serializers.UUIDField()


class MemberCertificateFulfilmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = MemberCertificateFulfilment
        fields = [
            "uuid",
            "produced_by",
            "appointment",
            "instruction",
            "source_digest",
            "digest",
            "file_size",
            "created_at",
        ]
        read_only_fields = fields


class MemberCertificateRequestSerializer(serializers.ModelSerializer):
    fulfilment = MemberCertificateFulfilmentSerializer(read_only=True, allow_null=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = MemberCertificateRequest
        fields = [
            "uuid",
            "association",
            "company",
            "token",
            "member",
            "entry",
            "requested_by",
            "status",
            "fulfilment",
            "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.ChoiceField(choices=["requested", "withdrawn", "fulfilled"]))
    def get_status(self, obj):
        if getattr(obj, "fulfilment", None):
            return "fulfilled"
        return "withdrawn" if getattr(obj, "withdrawal", None) else "requested"


class MemberRecordCompanySerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    acn = serializers.CharField()


class MemberRecordClassSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    name = serializers.CharField()
    symbol = serializers.CharField()
    shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    entered_on = serializers.DateField()
    ceased_on = serializers.DateField(allow_null=True)
    amount_paid = serializers.DecimalField(max_digits=78, decimal_places=2, allow_null=True)


class MemberRecordVestingSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    vested_on = serializers.DateField()


class MemberRecordAwardEndSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    unvested_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    vested_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    company_event_on = serializers.DateField()
    reason = serializers.CharField()
    created_at = serializers.DateTimeField()


class MemberRecordAwardVestingReversalSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    vesting = serializers.UUIDField()
    reversed_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    company_event_on = serializers.DateField()
    reason = serializers.CharField()
    created_at = serializers.DateTimeField()


class MemberRecordAwardSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    token = serializers.UUIDField()
    shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    terms_on = serializers.DateField()
    terms = serializers.CharField()
    schedule = serializers.CharField()
    vested_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    issued_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    available_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    ended_unvested_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    ended_vested_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    unvested_remaining_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    remaining_unissued_shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    vestings = MemberRecordVestingSerializer(many=True)
    ends = MemberRecordAwardEndSerializer(many=True)
    vesting_reversals = MemberRecordAwardVestingReversalSerializer(many=True)


class MemberOwnershipClassSerializer(OwnershipClassSerializer):
    own_shares = serializers.CharField(allow_null=True)


class MemberOwnershipSummarySerializer(CompanyOwnershipSummarySerializer):
    classes = MemberOwnershipClassSerializer(many=True)


class MemberRecordSerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    member = serializers.UUIDField()
    company = MemberRecordCompanySerializer()
    name = serializers.CharField()
    residential_address = serializers.CharField()
    identity_source = serializers.ChoiceField(choices=["company_recorded"])
    classes = MemberRecordClassSerializer(many=True)
    awards = MemberRecordAwardSerializer(many=True)
    ownership = MemberOwnershipSummarySerializer(allow_null=True)


class MemberRecordEntrySerializer(serializers.Serializer):
    uuid = serializers.UUIDField()
    sequence = serializers.IntegerField()
    kind = serializers.CharField()
    effective_on = serializers.DateField()
    company_event_on = serializers.DateField(allow_null=True)
    delta = serializers.DecimalField(max_digits=78, decimal_places=0)
    created_at = serializers.DateTimeField()
    corrects = serializers.UUIDField(allow_null=True)
    corrected_by = serializers.UUIDField(allow_null=True)


class MemberRecordEntriesSerializer(serializers.Serializer):
    entries = MemberRecordEntrySerializer(many=True)
