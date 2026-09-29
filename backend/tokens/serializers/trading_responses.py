from drf_spectacular.utils import PolymorphicProxySerializer, inline_serializer
from rest_framework import serializers

from tokens.models import ApprovalSubmissionOutcome
from tokens.serializers.signing import (
    SettlementContextField,
    SettlementTypedDataSerializer,
)
from tokens.serializers.swap_order import SwapOrderDetailSerializer


class SettlementResponseIdentitySerializer(serializers.Serializer):
    swap_uuid = serializers.UUIDField()
    order_uuid = serializers.UUIDField()
    owner_account_uuid = serializers.UUIDField()
    wallet_uuid = serializers.UUIDField()
    settlement_digest = serializers.CharField()
    user_role = serializers.ChoiceField(choices=("buyer", "seller"))


class SettlementSwapOrderSerializer(SwapOrderDetailSerializer):
    settlement_protocol_version = serializers.ChoiceField(choices=[1], read_only=True)
    settlement_context = SettlementContextField(read_only=True)


class SettlementApprovalOutcomeSerializer(serializers.Serializer):
    tx_hash = serializers.RegexField(r"^0x[0-9a-f]{64}$")
    outcome = serializers.ChoiceField(choices=ApprovalSubmissionOutcome.choices)


class SettlementSwapOrderForSigningSerializer(SettlementResponseIdentitySerializer):
    swap_order = SettlementSwapOrderSerializer()
    typed_data = SettlementTypedDataSerializer()
    has_signed = serializers.BooleanField()
    can_sign = serializers.BooleanField()
    admission_refusal = serializers.CharField(allow_null=True)
    approval_outcome = SettlementApprovalOutcomeSerializer(required=False, allow_null=True)


class SettlementApprovalStatusSerializer(SettlementResponseIdentitySerializer):
    token_address = serializers.CharField()
    token_symbol = serializers.CharField()
    required_amount = serializers.CharField()
    current_allowance = serializers.CharField()
    needs_approval = serializers.BooleanField()
    spender = serializers.CharField()


class SettlementSufficientApprovalSerializer(SettlementResponseIdentitySerializer):
    needs_approval = serializers.ChoiceField(choices=[False])
    message = serializers.CharField()
    current_allowance = serializers.CharField()
    required_amount = serializers.CharField()


class SettlementApprovalTransactionSerializer(SettlementResponseIdentitySerializer):
    needs_approval = serializers.ChoiceField(choices=[True])
    transaction = inline_serializer(
        name="ApprovalTransaction",
        fields={
            "to": serializers.CharField(),
            "from": serializers.CharField(),
            "data": serializers.CharField(),
            "value": serializers.CharField(),
            "gas": serializers.CharField(),
            "gasPrice": serializers.CharField(),
            "nonce": serializers.CharField(),
            "chainId": serializers.CharField(),
        },
    )
    description = serializers.CharField()
    token_address = serializers.CharField()
    token_symbol = serializers.CharField()
    spender = serializers.CharField()
    amount = serializers.CharField()
    unlimited = serializers.ChoiceField(choices=[True])


class SettlementApprovalReceiptSerializer(SettlementResponseIdentitySerializer):
    tx_hash = serializers.CharField()
    block_number = serializers.IntegerField(allow_null=True)
    gas_used = serializers.IntegerField(allow_null=True)


class SettlementApprovalUncertainSerializer(SettlementResponseIdentitySerializer):
    tx_hash = serializers.CharField()
    code = serializers.ChoiceField(choices=("swap_approval_unconfirmed",))
    detail = serializers.CharField()


ApprovalDataResponseSerializer = PolymorphicProxySerializer(
    component_name="ApprovalDataResponse",
    serializers=[SettlementSufficientApprovalSerializer, SettlementApprovalTransactionSerializer],
    resource_type_field_name=None,
)


class OrderBookEntrySerializer(serializers.Serializer):
    price = serializers.CharField()
    quantity = serializers.IntegerField()
    orders = serializers.IntegerField()


class OrderBookSerializer(serializers.Serializer):
    token = serializers.UUIDField()
    buy_orders = OrderBookEntrySerializer(many=True)
    sell_orders = OrderBookEntrySerializer(many=True)
