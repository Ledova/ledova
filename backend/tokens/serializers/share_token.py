from rest_framework import serializers

from companies.models import Company
from tokens.models import ShareToken
from tokens.services.market_data_service import market_summaries

SHARES_ARE_WHOLE = (
    "A share is a whole unit. The ShareToken contract returns 0 from decimals() and takes no decimals "
    "argument at deployment, so a share class cannot record any other value."
)


class MarketSummaryListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        rows = list(data)
        self.child.market_summaries = market_summaries(rows)
        return super().to_representation(rows)


class ShareTokenListSerializer(serializers.ModelSerializer):

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    token_type_display = serializers.CharField(source="get_token_type_display", read_only=True)
    company_uuid = serializers.UUIDField(source="company.uuid", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    last_price = serializers.SerializerMethodField()
    best_bid = serializers.SerializerMethodField()
    best_ask = serializers.SerializerMethodField()

    class Meta:
        list_serializer_class = MarketSummaryListSerializer
        model = ShareToken
        fields = [
            "uuid",
            "company",
            "company_uuid",
            "company_name",
            "name",
            "symbol",
            "token_type",
            "token_type_display",
            "status",
            "status_display",
            "contract_address",
            "chain",
            "total_supply",
            "decimals",
            "is_transferable",
            "is_divisible",
            "deployed_at",
            "created_at",
            "last_price",
            "best_bid",
            "best_ask",
        ]
        read_only_fields = fields

    def market_summary(self, obj):
        if not hasattr(self, "market_summaries"):
            self.market_summaries = market_summaries([obj])
        return self.market_summaries.get(obj.pk, {"last_price": None, "best_bid": None, "best_ask": None})

    def get_last_price(self, obj) -> str | None:
        return self.market_summary(obj)["last_price"]

    def get_best_bid(self, obj) -> str | None:
        return self.market_summary(obj)["best_bid"]

    def get_best_ask(self, obj) -> str | None:
        return self.market_summary(obj)["best_ask"]


class ShareTokenDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    token_type_display = serializers.CharField(source="get_token_type_display", read_only=True)
    company_uuid = serializers.UUIDField(source="company.uuid", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = ShareToken
        fields = [
            "uuid",
            "company",
            "company_uuid",
            "company_name",
            "name",
            "symbol",
            "token_type",
            "token_type_display",
            "status",
            "status_display",
            "contract_address",
            "chain",
            "total_supply",
            "decimals",
            "is_transferable",
            "is_divisible",
            "deployment_tx_hash",
            "deployed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class ShareTokenCreateSerializer(serializers.ModelSerializer):
    company = serializers.SlugRelatedField(slug_field="uuid", queryset=Company.objects.none(), required=False)

    class Meta:
        model = ShareToken
        fields = [
            "company",
            "name",
            "symbol",
            "token_type",
            "total_supply",
            "decimals",
            "is_transferable",
            "is_divisible",
        ]
        extra_kwargs = {"decimals": {"error_messages": {"max_value": SHARES_ARE_WHOLE}}}

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        fields["company"].queryset = Company.objects.manageable_by_user(getattr(request, "user", None))
        return fields

    def validate_symbol(self, value):
        if not value.isalpha():
            raise serializers.ValidationError("Symbol must contain only letters.")
        if len(value) < 3 or len(value) > 5:
            raise serializers.ValidationError("Symbol must be 3-5 characters.")
        return value.upper()

    def validate_total_supply(self, value):
        try:
            supply = int(value)
            if supply <= 0:
                raise serializers.ValidationError("Total supply must be greater than zero.")
        except (ValueError, TypeError):
            raise serializers.ValidationError("Total supply must be a valid number.")
        return str(supply)

    def to_internal_value(self, data):
        attrs = super().to_internal_value(data)
        if attrs.get("company") is None:
            companies = list(self.fields["company"].queryset[:2])
            if len(companies) != 1:
                raise serializers.ValidationError({"company": "Select the company that issues this token."})
            attrs["company"] = companies[0]
        return attrs


class ShareRegisterHolderSerializer(serializers.Serializer):
    address = serializers.CharField()
    name = serializers.CharField(allow_null=True)
    balance = serializers.CharField()
    percentage = serializers.FloatField()
    source = serializers.CharField()
    holder_type = serializers.CharField()
    entered_on = serializers.DateTimeField(allow_null=True)
    share_class = serializers.CharField()
    identity_source = serializers.CharField()
