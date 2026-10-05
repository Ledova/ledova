from rest_framework import serializers

from tokens.models import RegisterDecisionKind


class RegisterDecisionRequestSerializer(serializers.Serializer):
    appointment = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=RegisterDecisionKind.choices)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")


class RegisterDecideSerializer(RegisterDecisionRequestSerializer):
    idempotency_key = serializers.UUIDField()
    preview_digest = serializers.RegexField(regex=r"^[0-9a-f]{64}$")
    confirmation = serializers.BooleanField()


class RegisterDecisionSerializer(serializers.ModelSerializer):
    decided_by_name = serializers.CharField(source="appointment.appointee_profile.full_name", read_only=True)

    class Meta:
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


class RegisterDecidedSerializer(serializers.ModelSerializer):
    stage = serializers.SerializerMethodField()
    provided_by = serializers.SerializerMethodField()
    prepared_by_name = serializers.SerializerMethodField()

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
