from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from offerings.exceptions import SubscriptionRefusedException
from offerings.models import Offering, Subscription
from offerings.models.subscription import SettlementRail, SubscriptionStatus
from offerings.services.payments import build_instruction
from offerings.services.subscription import create_draft
from operators.exceptions import SettlementAssetNotDeployedException
from shared.constants import BLOCKCHAIN_BASE
from users.models import UserAccount
from users.services.eligibility import eligible_investor_companies
from wallets.models import Wallet

SUBSCRIPTION_FIELDS = [
    "uuid",
    "offering_uuid",
    "token_symbol",
    "token_name",
    "company_name",
    "status",
    "status_display",
    "quantity",
    "allotted_quantity",
    "price_per_share",
    "amount_due",
    "amount_received",
    "currency",
    "settlement_rail",
    "settlement_rail_display",
    "reference",
    "payment_due_at",
    "wallet_address",
    "created_at",
]


class SubscriptionListSerializer(serializers.ModelSerializer):

    offering_uuid = serializers.UUIDField(source="offering.uuid", read_only=True)
    token_symbol = serializers.CharField(source="offering.token.symbol", read_only=True)
    token_name = serializers.CharField(source="offering.token.name", read_only=True)
    company_name = serializers.CharField(source="offering.token.company.display_name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    settlement_rail_display = serializers.CharField(source="get_settlement_rail_display", read_only=True)
    wallet_address = serializers.CharField(source="wallet.address", read_only=True)
    currency = serializers.CharField(source="offering.price_currency", read_only=True)

    class Meta:
        model = Subscription
        fields = SUBSCRIPTION_FIELDS
        read_only_fields = fields


class PaymentInstructionSerializer(serializers.Serializer):
    rail = serializers.ChoiceField(choices=SettlementRail.choices)
    rail_display = serializers.CharField()
    reference = serializers.CharField()
    amount_due = serializers.CharField()
    currency = serializers.CharField()
    payment_due_at = serializers.DateTimeField(allow_null=True)
    issued_at = serializers.DateTimeField(allow_null=True)
    payee = serializers.CharField()
    bank_account_name = serializers.CharField(required=False)
    bank_bsb = serializers.CharField(required=False)
    bank_account_number = serializers.CharField(required=False)
    receiving_wallet_address = serializers.CharField(required=False)
    chain = serializers.CharField(required=False)
    asset_symbol = serializers.CharField(required=False)
    contract_address = serializers.CharField(required=False)
    decimals = serializers.IntegerField(required=False)
    settlement_amount = serializers.CharField(required=False)


class SubscriptionDetailSerializer(SubscriptionListSerializer):

    payment_instruction = serializers.SerializerMethodField()
    settlement_asset_symbol = serializers.CharField(source="settlement_asset.symbol", read_only=True, allow_null=True)
    amount_outstanding = serializers.DecimalField(max_digits=18, decimal_places=2, read_only=True)

    class Meta(SubscriptionListSerializer.Meta):
        fields = SUBSCRIPTION_FIELDS + [
            "settlement_asset_symbol",
            "settlement_amount",
            "amount_outstanding",
            "payment_instruction",
            "payment_instruction_issued_at",
            "payment_received_on",
            "payment_reference_seen",
            "payment_tx_hash",
            "payment_notes",
            "refund_amount",
            "refunded_at",
            "refund_reference",
            "submitted_at",
            "accepted_at",
            "allotted_at",
            "closed_at",
            "updated_at",
        ]
        read_only_fields = fields

    @extend_schema_field(PaymentInstructionSerializer(allow_null=True))
    def get_payment_instruction(self, subscription) -> dict | None:
        if subscription.status != SubscriptionStatus.AWAITING_PAYMENT:
            return None
        if not subscription.reference:
            return None
        try:
            return build_instruction(subscription)
        except (SubscriptionRefusedException, SettlementAssetNotDeployedException):
            return None


ISSUER_SUBSCRIPTION_FIELDS = [
    "uuid",
    "status",
    "status_display",
    "investor_name",
    "quantity",
    "allotted_quantity",
    "price_per_share",
    "amount_due",
    "amount_received",
    "settlement_rail_display",
    "reference",
    "payment_due_at",
    "payment_confirmed_at",
    "allotment_state",
    "wallet_address",
    "created_at",
]

NOT_ALLOTTED = "Not allotted"


class IssuerSubscriptionSerializer(serializers.ModelSerializer):

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    settlement_rail_display = serializers.CharField(source="get_settlement_rail_display", read_only=True)
    wallet_address = serializers.CharField(source="wallet.address", read_only=True)
    investor_name = serializers.SerializerMethodField()
    allotment_state = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = ISSUER_SUBSCRIPTION_FIELDS
        read_only_fields = fields

    def get_investor_name(self, subscription) -> str:
        holder = subscription.user_account.user_profile
        return (holder.full_name or "").strip() or holder.user.email

    def get_allotment_state(self, subscription) -> str:
        request = subscription.issuance_request
        return NOT_ALLOTTED if request is None else request.get_status_display()


class SubscriptionCreateSerializer(serializers.ModelSerializer):

    offering = serializers.SlugRelatedField(slug_field="uuid", queryset=Offering.objects.none())
    wallet = serializers.SlugRelatedField(slug_field="uuid", queryset=Wallet.objects.none())

    class Meta:
        model = Subscription
        fields = ["offering", "wallet", "quantity"]

    def get_fields(self):
        fields = super().get_fields()
        user = getattr(self.context.get("request"), "user", None)
        fields["offering"].queryset = Offering.objects.open_now().filter(
            token__company__in=eligible_investor_companies(user)
        )
        fields["wallet"].queryset = Wallet.objects.owned_by(user).verified_evm().filter(chain=BLOCKCHAIN_BASE)
        return fields

    def validate(self, attrs):
        user = getattr(self.context.get("request"), "user", None)
        account = attrs["user_account"] = UserAccount.objects.for_holder(user).investing().first()
        if account is None:
            raise serializers.ValidationError({"user_account": "This user has no investing account."})
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        return create_draft(
            offering=validated_data["offering"],
            user_account=validated_data["user_account"],
            wallet=validated_data["wallet"],
            quantity=validated_data["quantity"],
            submitted_by=getattr(request, "user", None),
        )

    def to_representation(self, instance):
        return SubscriptionDetailSerializer(instance, context=self.context).data


class SubscriptionWithdrawSerializer(serializers.Serializer):

    reason = serializers.CharField(required=False, allow_blank=True)
