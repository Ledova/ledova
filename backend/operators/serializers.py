from rest_framework import serializers

from assets.models import Asset
from assets.serializers.asset import AssetChainDeploymentSerializer
from operators.models import Operator


class SettlementAssetSerializer(serializers.ModelSerializer):
    chain_deployments = AssetChainDeploymentSerializer(many=True, read_only=True)

    class Meta:
        model = Asset
        fields = ["uuid", "symbol", "name", "chain_deployments"]
        read_only_fields = fields


class OperatorSerializer(serializers.ModelSerializer):

    supported_settlement_assets = SettlementAssetSerializer(many=True, read_only=True)
    issued_stablecoin = SettlementAssetSerializer(read_only=True, allow_null=True)

    class Meta:
        model = Operator
        fields = [
            "name",
            "legal_name",
            "abn",
            "contact_email",
            "website",
            "supported_settlement_assets",
            "issued_stablecoin",
            "investor_kyc_required",
            "issuer_kyc_required",
        ]
        read_only_fields = fields
