from django.conf import settings
from rest_framework import serializers
from web3 import Web3

from integrations.blockchain.bitcoin import is_bitcoin_address_valid
from shared.constants import (
    BLOCKCHAIN_BASE,
    BLOCKCHAIN_BITCOIN,
    BLOCKCHAIN_ETHEREUM,
    SUPPORTED_CHAINS,
)
from users.services.accounts import account_of
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet
from wallets.models.wallet import WalletSigningPreference
from wallets.services.registration import DUPLICATE_WALLET, update_wallet


class WalletSerializer(serializers.ModelSerializer):
    uuid = serializers.CharField(read_only=True)
    user_account = serializers.PrimaryKeyRelatedField(read_only=True)
    chain = serializers.ChoiceField(choices=sorted(SUPPORTED_CHAINS))
    signing_preference = serializers.ChoiceField(
        choices=WalletSigningPreference.choices(),
        allow_null=True,
        required=False,
        help_text="Self-declared signing preference; not custody attestation.",
    )
    wallet_type = serializers.ChoiceField(
        source="signing_preference",
        choices=WalletSigningPreference.choices(),
        allow_null=True,
        required=False,
        help_text="Legacy alias for the self-declared signing preference; not custody attestation.",
    )

    native_balance = serializers.DecimalField(
        source="annotated_native_balance", read_only=True, max_digits=40, decimal_places=18
    )
    native_market_value = serializers.DecimalField(
        source="annotated_native_market_value", read_only=True, max_digits=40, decimal_places=18
    )
    market_value = serializers.DecimalField(
        source="annotated_market_value", read_only=True, max_digits=40, decimal_places=18
    )

    class Meta:
        model = Wallet
        fields = (
            "uuid",
            "user_account",
            "name",
            "address",
            "chain",
            "signing_preference",
            "wallet_type",
            "native_balance",
            "native_market_value",
            "market_value",
            "verification_status",
            "verification_challenge",
            "verification_signature",
            "verified_at",
            "last_synced_at",
            "derivation_path",
            "master_fingerprint",
            "address_index",
            "parent_public_key",
            "parent_chain_code",
            "parent_derivation_path",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "uuid",
            "verification_status",
            "verification_challenge",
            "verification_signature",
            "verified_at",
            "last_synced_at",
            "created_at",
            "updated_at",
        )

    def validate_address(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Wallet address cannot be empty.")

        value = value.strip()

        if len(value) < 25 or len(value) > 70:
            raise serializers.ValidationError("Wallet address length is invalid.")

        return value

    @staticmethod
    def _verified_identity_change_errors(instance, data):
        if not instance or instance.verification_status != WALLET_VERIFICATION_STATUS_VERIFIED:
            return {}

        immutable_changes = {}
        for field in ("address", "chain"):
            if field in data and data[field] != getattr(instance, field):
                immutable_changes[field] = "Verified wallet identity cannot be changed."
        return immutable_changes

    def validate(self, data):
        if (
            "wallet_type" in self.initial_data
            and "signing_preference" in self.initial_data
            and self.initial_data["wallet_type"] != self.initial_data["signing_preference"]
        ):
            raise serializers.ValidationError({"signing_preference": "Conflicting signing preferences were supplied."})
        immutable_changes = self._verified_identity_change_errors(self.instance, data)
        if immutable_changes:
            raise serializers.ValidationError(immutable_changes)

        address = data.get("address", getattr(self.instance, "address", None))
        chain = data.get("chain", getattr(self.instance, "chain", None))
        if self.instance is None:
            user_account = data["user_account"] = account_of(getattr(self.context.get("request"), "user", None))
            if user_account is None:
                raise serializers.ValidationError({"user_account": "This user has no account."})
        else:
            user_account = self.instance.user_account

        if address and chain in (BLOCKCHAIN_ETHEREUM, BLOCKCHAIN_BASE) and not Web3.is_address(address):
            raise serializers.ValidationError({"address": "Enter a valid EVM address."})
        if address and chain == BLOCKCHAIN_BITCOIN and not is_bitcoin_address_valid(address, settings.BITCOIN_NETWORK):
            raise serializers.ValidationError({"address": "Enter an address for the configured Bitcoin test network."})

        if address and chain and user_account:
            duplicate_wallets = Wallet.objects.filter_by_address(address, chain=chain).filter(user_account=user_account)
            if self.instance:
                duplicate_wallets = duplicate_wallets.exclude(pk=self.instance.pk)
            if duplicate_wallets.exists():
                raise serializers.ValidationError({"address": DUPLICATE_WALLET})

        return data

    def update(self, instance, validated_data):
        return update_wallet(instance, validated_data)
