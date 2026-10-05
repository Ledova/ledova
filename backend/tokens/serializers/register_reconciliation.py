from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from tokens.models import RegisterAcknowledgement, RegisterReconciliation
from tokens.services.register_reconciliation import ACKNOWLEDGEABLE


class RegisterAcknowledgeSerializer(serializers.Serializer):
    appointment = serializers.UUIDField()
    discrepancy = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=1000)
    idempotency_key = serializers.UUIDField()


class RegisterAcknowledgementSerializer(serializers.ModelSerializer):
    acknowledged_by_name = serializers.SerializerMethodField()
    acknowledged_at = serializers.DateTimeField(source="created_at", read_only=True)
    provided_by = serializers.SerializerMethodField()

    class Meta:
        model = RegisterAcknowledgement
        fields = ["reason", "acknowledged_by_name", "acknowledged_at", "provided_by"]
        read_only_fields = fields

    def get_acknowledged_by_name(self, obj) -> str | None:
        if obj.appointment is None:
            return None
        return obj.appointment.appointee_profile.full_name or ""

    def get_provided_by(self, obj) -> str:
        return "company" if obj.appointment_id else "staff"


class RegisterDiscrepancySerializer(serializers.Serializer):
    kind = serializers.CharField()
    transaction = serializers.CharField(required=False)
    block = serializers.IntegerField(required=False)
    member = serializers.CharField(required=False)
    address = serializers.CharField(required=False)
    chain = serializers.CharField(required=False)
    expected = serializers.CharField(required=False)
    effect = serializers.CharField(required=False)
    source = serializers.CharField(required=False)
    detail = serializers.CharField(required=False)
    acknowledgeable = serializers.BooleanField()
    acknowledgement = RegisterAcknowledgementSerializer(allow_null=True)


class RegisterReconciliationSerializer(serializers.ModelSerializer):
    latest = serializers.BooleanField(read_only=True)
    discrepancies = serializers.SerializerMethodField()

    class Meta:
        model = RegisterReconciliation
        fields = [
            "uuid",
            "token",
            "status",
            "block_number",
            "block_hash",
            "register_sequence",
            "failure",
            "created_at",
            "latest",
            "discrepancies",
        ]
        read_only_fields = fields

    @extend_schema_field(RegisterDiscrepancySerializer(many=True))
    def get_discrepancies(self, obj):
        acknowledgements = list(obj.acknowledgements.all())
        rows = []
        for row in obj.discrepancies:
            acknowledgement = next((item for item in acknowledgements if item.discrepancy == row), None)
            rows.append(
                {
                    **row,
                    "acknowledgeable": obj.latest and row["kind"] in ACKNOWLEDGEABLE and acknowledgement is None,
                    "acknowledgement": (
                        None if acknowledgement is None else RegisterAcknowledgementSerializer(acknowledgement).data
                    ),
                }
            )
        return rows
