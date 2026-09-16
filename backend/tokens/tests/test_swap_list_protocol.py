from rest_framework.test import APITransactionTestCase

from feature_flags.models import FeatureFlag
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.settlement import save_swap_with_context
from shared.tests.tenants import make_tenant
from tokens.models import SwapOrder, SwapOrderStatus

BEFORE_SETTLEMENT_PROTOCOLS = [("tokens", "0038_order_action_submissions")]
ABSENT = "absent from the response"


class TheSwapListNamesEachSwapsRecordedProtocolTest(APITransactionTestCase):
    def setUp(self):
        FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
        self.owner = make_tenant("list-protocol-owner")
        self.stranger = make_tenant("list-protocol-stranger")
        self.historical = self.owner.swap
        self.addCleanup(restore_every_migration)
        self.historical_swaps = migrate_to(BEFORE_SETTLEMENT_PROTOCOLS).get_model("tokens", "SwapOrder").objects
        self.client.force_authenticate(self.owner.user)

    def restore_with_a_current_swap(self):
        restore_every_migration()
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

    def test_historical_and_current_swaps_are_listed_with_the_version_each_recorded(self):
        self.restore_with_a_current_swap()

        self.assertEqual(
            dict(SwapOrder.objects.values_list("uuid", "settlement_protocol_version")),
            {self.historical.uuid: 0, self.stranger.swap.uuid: 0, self.current.uuid: 1},
        )

        listed = self.listed_versions()

        self.assertEqual(listed, {str(self.historical.uuid): 0, str(self.current.uuid): 1})
        self.assertEqual({type(version) for version in listed.values()}, {int})

        response = self.client.get("/api/v1/trading/swaps/", {"wallet_address": self.owner.wallet.address})
        rows = {row["uuid"]: row for row in response.json()["results"]}
        self.assertEqual(rows[str(self.historical.pk)]["viewerParties"], [])
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

    def test_a_historical_swap_that_no_longer_awaits_a_signature_leaves_the_list(self):
        self.historical_swaps.filter(pk=self.historical.pk).update(status=SwapOrderStatus.EXPIRED)
        self.restore_with_a_current_swap()

        self.assertEqual(
            SwapOrder.objects.values_list("settlement_protocol_version", "status").get(pk=self.historical.pk),
            (0, SwapOrderStatus.EXPIRED),
        )
        self.assertEqual(self.listed_versions(), {str(self.current.uuid): 1})
