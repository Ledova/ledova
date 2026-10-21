from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from companies.serializers.team import StrictTeamSerializer
from tokens.class_rights_attributes import (
    RIGHTS_DECIMAL,
    RIGHTS_TYPES,
    validate_class_rights_attributes,
    validate_class_rights_effective_date,
)
from tokens.models import ClassRightsRevision


class ClassRightsDecimalField(serializers.RegexField):
    def __init__(self, **kwargs):
        super().__init__(rf"^{RIGHTS_DECIMAL}$", max_length=25, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid")
        return super().to_internal_value(data)


class ClassRightsVotingSerializer(StrictTeamSerializer):
    type = serializers.ChoiceField(choices=RIGHTS_TYPES["voting"])
    votes_per_share = ClassRightsDecimalField(required=False)
    conditions = serializers.CharField(max_length=2000, allow_blank=True, required=False)


class ClassRightsDividendsSerializer(StrictTeamSerializer):
    type = serializers.ChoiceField(choices=RIGHTS_TYPES["dividends"])
    rate = ClassRightsDecimalField(required=False)
    amount = ClassRightsDecimalField(required=False)
    basis = serializers.CharField(max_length=255, allow_blank=True, required=False)
    currency = serializers.RegexField(r"^[A-Z]{3}$", required=False)
    cumulative = serializers.ChoiceField(choices=["not_recorded", "cumulative", "non_cumulative"], required=False)
    conditions = serializers.CharField(max_length=2000, allow_blank=True, required=False)


class ClassRightsCapitalSerializer(StrictTeamSerializer):
    type = serializers.ChoiceField(choices=RIGHTS_TYPES["capital"])
    multiple = ClassRightsDecimalField(required=False)
    amount = ClassRightsDecimalField(required=False)
    basis = serializers.CharField(max_length=255, allow_blank=True, required=False)
    currency = serializers.RegexField(r"^[A-Z]{3}$", required=False)
    ranking = serializers.CharField(max_length=255, allow_blank=True, required=False)
    participation = serializers.ChoiceField(
        choices=["not_recorded", "non_participating", "participating", "capped"], required=False
    )
    cap = serializers.CharField(max_length=255, allow_blank=True, required=False)
    conditions = serializers.CharField(max_length=2000, allow_blank=True, required=False)


class ClassRightsTransfersSerializer(StrictTeamSerializer):
    type = serializers.ChoiceField(choices=RIGHTS_TYPES["transfers"])
    board_consent = serializers.BooleanField(required=False)
    pre_emption = serializers.BooleanField(required=False)
    conditions = serializers.CharField(max_length=2000, allow_blank=True, required=False)


class ClassRightsConversionSerializer(StrictTeamSerializer):
    type = serializers.ChoiceField(choices=RIGHTS_TYPES["conversion"])
    target_class = serializers.CharField(max_length=255, allow_blank=True, required=False)
    ratio = ClassRightsDecimalField(required=False)
    conditions = serializers.CharField(max_length=2000, allow_blank=True, required=False)


class ClassRightsRedemptionSerializer(StrictTeamSerializer):
    type = serializers.ChoiceField(choices=RIGHTS_TYPES["redemption"])
    trigger = serializers.ChoiceField(choices=["company", "holder", "event", "custom"], required=False)
    conditions = serializers.CharField(max_length=2000, allow_blank=True, required=False)


class ClassRightsAttributesSerializer(StrictTeamSerializer):
    voting = ClassRightsVotingSerializer(required=False)
    dividends = ClassRightsDividendsSerializer(required=False)
    capital = ClassRightsCapitalSerializer(required=False)
    transfers = ClassRightsTransfersSerializer(required=False)
    conversion = ClassRightsConversionSerializer(required=False)
    redemption = ClassRightsRedemptionSerializer(required=False)

    def validate(self, attrs):
        try:
            validate_class_rights_attributes(attrs)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from None
        return attrs


class ClassRightsWriteSerializer(StrictTeamSerializer):
    appointment = serializers.UUIDField()
    idempotency_key = serializers.UUIDField()
    previous_revision = serializers.IntegerField(min_value=0, max_value=2147483646)
    summary = serializers.CharField(max_length=4000, allow_blank=True, trim_whitespace=False)
    document_reference = serializers.CharField(
        max_length=255, allow_blank=True, trim_whitespace=False, required=False, default=""
    )
    documents = serializers.ListField(child=serializers.UUIDField(), max_length=100, required=False, default=list)
    attributes = ClassRightsAttributesSerializer(required=False, default=dict)
    effective_date = serializers.DateField(required=False, allow_null=True, default=None)

    def validate_effective_date(self, value):
        try:
            validate_class_rights_effective_date(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from None
        return value


class ClassRightsQuerySerializer(StrictTeamSerializer):
    page = serializers.IntegerField(min_value=1, required=False)
    page_size = serializers.IntegerField(min_value=1, max_value=100, required=False)
    idempotency_key = serializers.UUIDField(required=False)


class ClassRightsFileQuerySerializer(StrictTeamSerializer):
    revision = serializers.UUIDField()
    evidence = serializers.UUIDField()


class ClassRightsDocumentSerializer(serializers.Serializer):
    provided_by = serializers.CharField()
    evidence = serializers.UUIDField()
    company = serializers.UUIDField()
    document_type = serializers.CharField()
    name = serializers.CharField()
    file_size = serializers.IntegerField()
    mime_type = serializers.CharField()
    sha256 = serializers.CharField()


class ClassRightsRevisionSerializer(serializers.ModelSerializer):
    documents = ClassRightsDocumentSerializer(many=True, read_only=True)
    attributes = ClassRightsAttributesSerializer(read_only=True)

    class Meta:
        model = ClassRightsRevision
        fields = [
            "uuid",
            "token",
            "revision",
            "summary",
            "document_reference",
            "documents",
            "attributes",
            "effective_date",
            "recorded_by",
            "recorded_by_name",
            "appointment",
            "idempotency_key",
            "created_at",
        ]
        read_only_fields = fields


class ClassRightsPageSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    next = serializers.URLField(allow_null=True)
    previous = serializers.URLField(allow_null=True)
    results = ClassRightsRevisionSerializer(many=True)
    current = ClassRightsRevisionSerializer(allow_null=True)
    administration_appointment = serializers.UUIDField(allow_null=True)
