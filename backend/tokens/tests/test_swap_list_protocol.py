from rest_framework.test import APITransactionTestCase

from feature_flags.models import FeatureFlag
from shared.tests.settlement import save_swap_with_context
from shared.tests.tenants import make_tenant
from tokens.models import SwapOrder

ABSENT = "absent from the response"


class TheSwapListNamesEachSwapsRecordedProtocolTest(APITransactionTestCase):
    def setUp(self):
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        self.owner = make_tenant("list-protocol-owner")
        self.stranger = make_tenant("list-protocol-stranger")
        self.first = self.owner.swap
        self.client.force_authenticate(self.owner.user)

    def add_an_owned_swap(self):
        self.current = save_swap_with_context(
            sell_order=self.owner.order,
            buy_order=self.owner.counter_order,
            share_token=self.owner.deployed_token,
            payment_asset=self.owner.refs.stablecoin,
            seller_address=self.owner.wallet.address,
            buyer_address=self.owner.wallet.address,
            share_amount=10,
            payment_amount=1500,
            nonce=2**40,
            order_hash="0x" + "7c" * 32,
        )

    def listed_versions(self):
        response = self.client.get("/api/v1/trading/swaps/", {"wallet_address": self.owner.wallet.address})
        self.assertEqual(response.status_code, 200)
        return {row["uuid"]: row.get("settlementProtocolVersion", ABSENT) for row in response.json()["results"]}

    def test_owned_current_swaps_show_their_recorded_protocol_and_exact_parties(self):
        self.add_an_owned_swap()

        self.assertEqual(
            dict(SwapOrder.objects.values_list("uuid", "settlement_protocol_version")),
            {self.first.uuid: 1, self.stranger.swap.uuid: 1, self.current.uuid: 1},
        )

        listed = self.listed_versions()

        self.assertEqual(listed, {str(self.first.uuid): 1, str(self.current.uuid): 1})
        self.assertEqual({type(version) for version in listed.values()}, {int})

        response = self.client.get("/api/v1/trading/swaps/", {"wallet_address": self.owner.wallet.address})
        rows = {row["uuid"]: row for row in response.json()["results"]}
        self.assertEqual(
            rows[str(self.current.pk)]["viewerParties"],
            [
                {
                    "userRole": role,
                    "ownerAccountUuid": str(self.owner.account.pk),
                    "walletUuid": str(self.owner.wallet.pk),
                }
                for role in ("seller", "buyer")
            ],
        )
