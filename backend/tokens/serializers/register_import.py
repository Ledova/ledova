from rest_framework import serializers

from tokens.models import (
    RegisterCorrectionAuthority,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterImportDecision,
    RegisterImportDecisionKind,
)

DIGITS = r"^(0|[1-9][0-9]{0,77})$"


class RegisterEvidenceUploadSerializer(serializers.Serializer):
    company_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=RegisterEvidenceKind.choices)
    idempotency_key = serializers.UUIDField()
    file = serializers.FileField()


class RegisterEvidenceSerializer(serializers.ModelSerializer):
    provided_by = serializers.SerializerMethodField()

    class Meta:
        model = RegisterEvidence
        fields = [
            "uuid",
            "company",
            "kind",
            "appointment",
            "idempotency_key",
            "original_filename",
            "file_size",
            "mime_type",
            "sha256",
            "provided_by",
            "created_at",
        ]
        read_only_fields = fields

    def get_provided_by(self, obj) -> str:
        return "company"


class RegisterImportCreateSerializer(serializers.Serializer):
    operation_id = serializers.UUIDField()
    appointment = serializers.UUIDField()
    token_id = serializers.UUIDField()
    register_evidence = serializers.UUIDField()
    asic_evidence = serializers.UUIDField()
    asic_issued_total = serializers.RegexField(regex=DIGITS, max_length=78)
    asic_member_count = serializers.IntegerField(min_value=0)
    as_at = serializers.DateField()
    members = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=10000)
    former_members = serializers.ListField(child=serializers.DictField(), allow_empty=True, max_length=10000)
    authority = serializers.ChoiceField(choices=RegisterCorrectionAuthority.choices)
    approving_director = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authority_reference = serializers.CharField(max_length=255)
    reason = serializers.CharField(max_length=1000)


class RegisterImportDecisionRequestSerializer(serializers.Serializer):
    appointment = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=RegisterImportDecisionKind.choices)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")


class RegisterImportDecideSerializer(RegisterImportDecisionRequestSerializer):
    idempotency_key = serializers.UUIDField()
    preview_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")
    confirmation = serializers.BooleanField()


class RegisterImportPreviewRowSerializer(serializers.Serializer):
    member = serializers.CharField()
    name = serializers.CharField(allow_null=True)
    imported = serializers.CharField(allow_null=True)
    stored = serializers.CharField(allow_null=True)
    entered_on = serializers.DateField(allow_null=True)
    imported_entered_on = serializers.CharField(allow_null=True)
    wallets = serializers.ListField(child=serializers.CharField())
    live_name = serializers.CharField(allow_null=True)
    live_address = serializers.CharField(allow_null=True)


class RegisterImportDecisionPreviewSerializer(serializers.Serializer):
    preview_digest = serializers.CharField()
    unmet_requirements = serializers.ListField(child=serializers.CharField())
    can_decide = serializers.BooleanField()
    opens_register = serializers.BooleanField()
    register_sequence = serializers.IntegerField()
    comparison = RegisterImportPreviewRowSerializer(many=True)
    stated_total = serializers.CharField(allow_null=True)
    stated_member_count = serializers.IntegerField(allow_null=True)
    imported_total = serializers.CharField()
    imported_member_count = serializers.IntegerField()


class RegisterImportDecisionSerializer(serializers.ModelSerializer):
    decided_by_name = serializers.CharField(source="appointment.appointee_profile.full_name", read_only=True)

    class Meta:
        model = RegisterImportDecision
        fields = [
            "uuid",
            "kind",
            "decided_by",
            "decided_by_name",
            "appointment",
            "idempotency_key",
            "digest",
            "reason",
            "decided_at",
        ]
        read_only_fields = fields


class RegisterImportSerializer(serializers.ModelSerializer):
    stage = serializers.SerializerMethodField()
    provided_by = serializers.SerializerMethodField()
    prepared_by_name = serializers.SerializerMethodField()
    decisions = RegisterImportDecisionSerializer(many=True, read_only=True)

    class Meta:
        model = RegisterImport
        fields = [
            "uuid",
            "company",
            "token",
            "as_at",
            "members",
            "former_members",
            "authority",
            "approving_director",
            "authority_reference",
            "reason",
            "source_document",
            "evidence_fingerprint",
            "evidence_snapshot",
            "asic_document",
            "asic_fingerprint",
            "asic_snapshot",
            "register_evidence",
            "asic_evidence",
            "preparing_appointment",
            "prepared_by_name",
            "provided_by",
            "submitted_by",
            "status",
            "stage",
            "asic_issued_total",
            "asic_member_count",
            "register_sequence",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "decisions",
            "created_at",
        ]
        read_only_fields = fields

    def get_stage(self, obj) -> str:
        if obj.status != "submitted":
            return obj.status
        return "approved" if obj.approval_current else "submitted"

    def get_provided_by(self, obj) -> str:
        return "company" if obj.preparing_appointment_id else "staff_verified"

    def get_prepared_by_name(self, obj) -> str | None:
        if obj.preparing_appointment is None:
            return None
        return obj.preparing_appointment.appointee_profile.full_name or ""
