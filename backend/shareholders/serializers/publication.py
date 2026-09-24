from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from shareholders.models import BallotChoice, Publication, ResolutionKind
from shareholders.services.resolutions import UNKNOWN_CHOICE

ELIGIBLE = "eligible"


class BallotSerializer(serializers.Serializer):
    choice = serializers.ChoiceField(choices=BallotChoice.choices, error_messages={"invalid_choice": UNKNOWN_CHOICE})


class PublicationBallotSerializer(serializers.Serializer):
    choice = serializers.ChoiceField(choices=BallotChoice.choices, source="ballot_choice")
    cast_at = serializers.DateTimeField(source="ballot_cast_at")
    staff_entered = serializers.BooleanField(source="ballot_staff_entered")


class PublicationCountSerializer(serializers.Serializer):
    shares = serializers.DecimalField(max_digits=78, decimal_places=0)
    members = serializers.IntegerField()


class PublicationResultSerializer(serializers.Serializer):
    carried = serializers.BooleanField()

    def get_fields(self):
        counted = {name: PublicationCountSerializer() for name in (*BallotChoice.values, ELIGIBLE)}
        return {**counted, **super().get_fields()}


class PublicationPaymentRecordSerializer(serializers.Serializer):
    recorded_paid_on = serializers.DateField(source="payment_paid_on")
    reference = serializers.CharField(source="payment_reference")
    recorded_at = serializers.DateTimeField(source="payment_recorded_at")


class PublicationSerializer(serializers.ModelSerializer):
    shares = serializers.DecimalField(
        source="holding", max_digits=78, decimal_places=0, read_only=True, allow_null=True
    )
    question = serializers.SerializerMethodField()
    resolution_kind = serializers.SerializerMethodField()
    my_ballot = serializers.SerializerMethodField()
    ballot_outstanding = serializers.BooleanField(read_only=True)
    result = PublicationResultSerializer(read_only=True, allow_null=True)
    currency = serializers.SerializerMethodField()
    my_entitlement = serializers.DecimalField(
        source="entitled", max_digits=18, decimal_places=2, read_only=True, allow_null=True
    )
    my_payment_record = serializers.SerializerMethodField()

    class Meta:
        model = Publication
        fields = [
            "uuid",
            "kind",
            "title",
            "company_name",
            "token_name",
            "token_symbol",
            "record_date",
            "shares",
            "created_at",
            "question",
            "resolution_kind",
            "opens_at",
            "closes_at",
            "my_ballot",
            "ballot_outstanding",
            "result",
            "rate_per_share",
            "currency",
            "declared_on",
            "payment_date",
            "my_entitlement",
            "my_payment_record",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_question(self, publication):
        return publication.question or None

    @extend_schema_field(serializers.ChoiceField(choices=ResolutionKind.choices, allow_null=True))
    def get_resolution_kind(self, publication):
        return publication.resolution_kind or None

    @extend_schema_field(PublicationBallotSerializer(allow_null=True))
    def get_my_ballot(self, publication):
        if publication.ballot_choice is None:
            return None
        return PublicationBallotSerializer(publication).data

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_currency(self, publication):
        return publication.currency or None

    @extend_schema_field(PublicationPaymentRecordSerializer(allow_null=True))
    def get_my_payment_record(self, publication):
        if publication.payment_recorded_at is None:
            return None
        return PublicationPaymentRecordSerializer(publication).data
