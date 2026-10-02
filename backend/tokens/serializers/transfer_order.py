from decimal import Decimal

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from web3 import Web3

from tokens.models import TransferOrder, TransferOrderType
from wallets.models import Wallet


def token_identity(order, field):
    token = getattr(order, "token", None)
    if token is not None:
        return getattr(token, field)
    submission = getattr(order, "submission", None)
    if submission is None:
        return None
    if field == "contract_address":
        return submission.verifying_contract
    return submission.token_metadata.get(field)


class TransferOrderListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="status_label", read_only=True)
    order_type_display = serializers.CharField(source="get_order_type_display", read_only=True)
    token_symbol = serializers.SerializerMethodField()
    token_name = serializers.SerializerMethodField()
    total_value = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    remaining_quantity = serializers.IntegerField(read_only=True)

    def get_token_symbol(self, order) -> str | None:
        return token_identity(order, "symbol")

    def get_token_name(self, order) -> str | None:
        return token_identity(order, "name")

    class Meta:
        model = TransferOrder
        fields = [
            "uuid",
            "token",
            "token_symbol",
            "token_name",
            "order_type",
            "order_type_display",
            "status",
            "status_display",
            "wallet_address",
            "quantity",
            "min_quantity",
            "filled_quantity",
            "remaining_quantity",
            "price_per_share",
            "total_value",
            "created_at",
        ]
        read_only_fields = fields


class TransferOrderDetailSerializer(TransferOrderListSerializer):
    token_contract_address = serializers.SerializerMethodField()
    remaining_value = serializers.DecimalField(max_digits=20, decimal_places=2, read_only=True)
    matched_order_uuid = serializers.UUIDField(source="matched_order_id", read_only=True, allow_null=True)
    can_be_modified = serializers.BooleanField(read_only=True)

    def get_token_contract_address(self, order) -> str | None:
        return token_identity(order, "contract_address")

    class Meta:
        model = TransferOrder
        fields = [
            "uuid",
            "token",
            "token_symbol",
            "token_name",
            "token_contract_address",
            "order_type",
            "order_type_display",
            "status",
            "status_display",
            "wallet_address",
            "quantity",
            "min_quantity",
            "filled_quantity",
            "remaining_quantity",
            "price_per_share",
            "total_value",
            "remaining_value",
            "matched_order_uuid",
            "tx_hash",
            "completed_at",
            "error_message",
            "modification_count",
            "last_modified_at",
            "can_be_modified",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


@extend_schema_field({"oneOf": [{"type": "integer", "minimum": 1}, {"type": "string", "pattern": r"^[1-9][0-9]*$"}]})
class PositiveIntegerInputField(serializers.IntegerField):
    pass


@extend_schema_field(
    {"oneOf": [{"type": "integer", "minimum": 0}, {"type": "string", "pattern": r"^(0|[1-9][0-9]*)$"}]}
)
class NonnegativeIntegerInputField(serializers.IntegerField):
    pass


class TransferOrderCreateSerializer(serializers.Serializer):
    submission_id = serializers.UUIDField()
    owner_account_uuid = serializers.UUIDField()
    token = serializers.UUIDField()
    order_type = serializers.ChoiceField(choices=TransferOrderType.choices)
    wallet_uuid = serializers.UUIDField(write_only=True)
    wallet_address = serializers.CharField(max_length=42)
    quantity = PositiveIntegerInputField(min_value=1)
    min_quantity = NonnegativeIntegerInputField(
        required=False,
        min_value=0,
        default=0,
        help_text="Minimum quantity per fill. 0 means accept any partial fill.",
    )
    price_per_share = serializers.DecimalField(max_digits=18, decimal_places=2, min_value=Decimal("0.01"))

    def validate_wallet_address(self, value):
        if not Web3.is_address(value):
            raise serializers.ValidationError("Invalid Ethereum address format")
        return Web3.to_checksum_address(value)

    def validate(self, data):
        quantity = data.get("quantity", 0)
        min_quantity = data.get("min_quantity", 0)

        if min_quantity > quantity:
            raise serializers.ValidationError({"min_quantity": "Minimum quantity cannot exceed total quantity."})

        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            raise serializers.ValidationError({"wallet_uuid": "An authenticated wallet owner is required."})

        wallet = (
            Wallet.objects.owned_by(request.user)
            .select_related("user_account")
            .filter(uuid=data["wallet_uuid"], user_account_id=data["owner_account_uuid"])
            .first()
        )

        if wallet is None:
            raise serializers.ValidationError({"wallet_uuid": "Select a wallet from your own account."})

        if not Web3.is_address(wallet.address):
            raise serializers.ValidationError({"wallet_uuid": "The selected wallet has an invalid EVM address."})

        canonical_wallet_address = Web3.to_checksum_address(wallet.address)
        if canonical_wallet_address != data["wallet_address"]:
            raise serializers.ValidationError(
                {"wallet_address": "The wallet address does not match the selected wallet."}
            )

        data["wallet"] = wallet
        data["owner_account"] = wallet.user_account
        data["wallet_address"] = canonical_wallet_address

        return data
