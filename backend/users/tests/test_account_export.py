from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connections
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase, APITransactionTestCase

from assets.models import Asset
from portfolios.models import Portfolio
from shared.db import APP_ALIAS, configured, use_operator
from shared.models import Country
from shared.tests.scoped import RunsOnTheScopedConnection
from users.models import FinancialProfile, UserAccount, UserPreferences, UserProfile
from wallets.models import Transaction, Wallet
from wallets.services.chain_observations import observe_wallet_chain
from wallets.tests.test_chain_observations import ChainObservationFixture

User = get_user_model()

EXPORT = "/api/user-profiles/export-data/"
WRITES = ("INSERT", "UPDATE", "DELETE")


def statements(captured):
    return [query["sql"].lstrip().split(None, 1)[0].upper() for query in captured.captured_queries]


class AccountExportTest(APITestCase):

    def setUp(self):
        self.user = User.objects.create_user(email="export@example.test", password="pw-12345678")
        self.profile = UserProfile.objects.create(
            user=self.user,
            full_name="Export Owner",
            citizenship_country=Country.objects.create(name="Australia", code="AU"),
        )
        FinancialProfile.objects.create(user_profile=self.profile, occupation="Engineer")
        self.account = UserAccount.objects.create(account_number="EXPORT-ACC", user_profile=self.profile)
        self.portfolio = Portfolio.objects.create(user_account=self.account, name="Main")
        UserPreferences.objects.create(user_profile=self.profile, selected_portfolio=self.portfolio)
        self.wallet = Wallet.objects.create(user_account=self.account, address="0x" + "a" * 40, chain="base")
        self.asset = Asset.objects.create(
            symbol="EXP", name="Export asset", asset_type="tokenized_security", is_active=True
        )
        self.transaction = self.a_transaction("0xexport", transaction_fee=Decimal("0.000000000000000001"))
        self.client.force_authenticate(self.user)

    def a_transaction(self, tx_hash, **fields):
        return Transaction.objects.create(
            tx_hash=tx_hash,
            chain="base",
            from_address=self.wallet.address,
            to_address="0x" + "b" * 40,
            asset=self.asset,
            amount=Decimal("1.5"),
            wallet=self.wallet,
            **fields,
        )

    def exported_transactions(self):
        return {row["txHash"]: row for row in self.client.get(EXPORT).json()["transactions"]}

    def test_export_keeps_client_document_shape(self):
        body = self.client.get(EXPORT).json()

        self.assertEqual(
            set(body),
            {
                "exportedAt",
                "user",
                "profile",
                "preferences",
                "financialProfile",
                "account",
                "wallets",
                "transactions",
                "portfolios",
            },
        )
        self.assertIsInstance(body["exportedAt"], str)
        self.assertEqual(set(body["user"]), {"email", "dateJoined", "isEmailVerified"})
        self.assertEqual(
            set(body["profile"]),
            {
                "fullName",
                "dateOfBirth",
                "phoneCountryCode",
                "phoneNumber",
                "residentialAddress",
                "citizenshipCountry",
                "isIdVerified",
                "createdAt",
            },
        )
        self.assertEqual(body["profile"]["citizenshipCountry"], "Australia")
        self.assertEqual(body["preferences"], {"selectedPortfolio": str(self.portfolio.uuid)})
        self.assertEqual(
            set(body["financialProfile"]),
            {"occupation", "sourceOfFunds", "sourceOfFundsOtherText", "intendedUse", "intendedUseOtherText"},
        )
        self.assertEqual(set(body["account"]), {"uuid", "accountNumber", "accountType", "activationDate", "createdAt"})
        self.assertEqual(body["account"]["uuid"], str(self.account.uuid))
        self.assertEqual(
            set(body["wallets"][0]),
            {"uuid", "name", "chain", "address", "nativeBalance", "marketValue", "isVerified", "createdAt"},
        )
        self.assertEqual(body["wallets"][0]["nativeBalance"], "0")
        self.assertIs(body["wallets"][0]["isVerified"], False)
        self.assertEqual(
            set(body["transactions"][0]),
            {
                "uuid",
                "txHash",
                "chain",
                "status",
                "asset",
                "amount",
                "transactionFee",
                "fromAddress",
                "toAddress",
                "blockTimestamp",
                "blockNumber",
                "blockHash",
                "nonce",
                "importedFromHistory",
                "chainObservation",
                "createdAt",
            },
        )
        self.assertEqual(body["transactions"][0]["asset"], "EXP")
        self.assertEqual(Decimal(body["transactions"][0]["amount"]), Decimal("1.5"))
        self.assertEqual(Decimal(body["transactions"][0]["transactionFee"]), Decimal("1E-18"))
        self.assertEqual(set(body["portfolios"][0]), {"uuid", "name", "isActive", "createdAt"})
        self.assertIsInstance(body["portfolios"][0]["createdAt"], str)

    def test_export_without_profile_returns_empty_sections(self):
        bare = User.objects.create_user(email="bare@example.test", password="pw-12345678")
        self.client.force_authenticate(bare)

        body = self.client.get(EXPORT).json()

        self.assertEqual(body["user"]["email"], "bare@example.test")
        self.assertIsNone(body["profile"])
        self.assertIsNone(body["preferences"])
        self.assertIsNone(body["financialProfile"])
        self.assertIsNone(body["account"])
        self.assertEqual(body["wallets"], [])
        self.assertEqual(body["transactions"], [])
        self.assertEqual(body["portfolios"], [])

    def test_export_without_financial_profile_or_preferences(self):
        FinancialProfile.objects.filter(user_profile=self.profile).delete()
        UserPreferences.objects.filter(user_profile=self.profile).delete()

        body = self.client.get(EXPORT).json()

        self.assertIsNone(body["financialProfile"])
        self.assertIsNone(body["preferences"])
        self.assertEqual(body["account"]["uuid"], str(self.account.uuid))

    def test_every_transaction_is_exported_past_a_thousand(self):
        Transaction.objects.bulk_create(
            Transaction(
                tx_hash=f"0xbulk{index}",
                chain="base",
                from_address=self.wallet.address,
                asset=self.asset,
                amount=Decimal("1"),
                wallet=self.wallet,
                user_account=self.account,
            )
            for index in range(1000)
        )

        exported = self.exported_transactions()

        self.assertEqual(len(exported), 1001)
        self.assertEqual(set(exported), set(Transaction.objects.values_list("tx_hash", flat=True)))

    def test_a_zero_fee_stays_zero_and_only_an_unknown_fee_is_null(self):
        self.a_transaction("0xfree", transaction_fee=Decimal("0"))
        self.a_transaction("0xunknown", transaction_fee=None)

        exported = self.exported_transactions()

        self.assertIsNotNone(exported["0xfree"]["transactionFee"])
        self.assertEqual(Decimal(exported["0xfree"]["transactionFee"]), Decimal("0"))
        self.assertIsNone(exported["0xunknown"]["transactionFee"])
        self.assertEqual(Decimal(exported["0xexport"]["transactionFee"]), Decimal("1E-18"))

    def test_block_nonce_and_history_are_exported_as_recorded(self):
        block_hash = "0x" + "c" * 64
        self.a_transaction("0ximported", block_number=12345, block_hash=block_hash, nonce=7, imported_from_history=True)

        exported = self.exported_transactions()

        self.assertEqual(
            {key: exported["0ximported"][key] for key in ("blockNumber", "blockHash", "nonce", "importedFromHistory")},
            {"blockNumber": 12345, "blockHash": block_hash, "nonce": 7, "importedFromHistory": True},
        )
        self.assertEqual(
            {key: exported["0xexport"][key] for key in ("blockNumber", "blockHash", "nonce", "importedFromHistory")},
            {"blockNumber": None, "blockHash": None, "nonce": None, "importedFromHistory": False},
        )
        self.assertIsNone(exported["0xexport"]["chainObservation"])

    def test_the_export_writes_nothing_while_deletion_on_the_same_capture_does(self):
        connection = connections[configured(APP_ALIAS)]
        with CaptureQueriesContext(connection) as export:
            self.assertEqual(self.client.get(EXPORT).status_code, 200)
        with CaptureQueriesContext(connection) as deletion:
            self.assertEqual(self.client.post("/api/user-profiles/delete-account/").status_code, 200)

        self.assertIn("SELECT", statements(export))
        self.assertEqual([statement for statement in statements(export) if statement in WRITES], [])
        self.assertIn("UPDATE", statements(deletion))


class AccountExportEvidenceChecks(ChainObservationFixture):
    def export(self):
        with CaptureQueriesContext(connections[configured(APP_ALIAS)]) as captured:
            response = self.client.get(EXPORT)
        self.assertEqual(response.status_code, 200)
        return {row["txHash"]: row for row in response.json()["transactions"]}, captured

    def another_observed_transfer(self):
        signed = self.signed(nonce=4, value=10**18)
        with patch("wallets.services.submissions.get_blockchain_client", return_value=self.provider(signed)):
            tx_hash = self.submit_direct(signed)["txHash"]
        with use_operator():
            tx_id = Transaction.objects.get(tx_hash=tx_hash).pk
        self.observer.get_transaction_receipt.return_value["transactionHash"] = tx_hash
        self.assertEqual(observe_wallet_chain(tx_id), "recorded")
        return tx_hash

    def test_each_transaction_carries_its_latest_observation_not_its_first(self):
        tx_hash = self.signed_transfer.hash.to_0x_hex()
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        included, _ = self.export()
        self.observer.get_transaction_receipt.return_value = None
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        latest, _ = self.export()

        network = f"evm:{settings.BLOCKCHAIN_CHAIN_ID}"
        policy = {"version": 1, "mode": "finalized"}
        self.assertEqual(
            included[tx_hash]["chainObservation"],
            {"network": network, "result": "included", "finality": "satisfied", "policy": policy},
        )
        self.assertEqual(
            latest[tx_hash]["chainObservation"],
            {"network": network, "result": "unknown", "finality": "unknown", "policy": policy},
        )
        self.assertEqual((latest[tx_hash]["nonce"], latest[tx_hash]["importedFromHistory"]), (3, False))
        self.assertIsNone(latest[self.tenant.transaction.tx_hash]["chainObservation"])

    def test_observations_come_with_the_transactions_however_many_there_are(self):
        self.assertEqual(observe_wallet_chain(self.tx_id), "recorded")
        few, few_queries = self.export()
        self.another_observed_transfer()
        many, many_queries = self.export()

        self.assertEqual(sum(row["chainObservation"] is not None for row in few.values()), 1)
        self.assertEqual(sum(row["chainObservation"] is not None for row in many.values()), 2)
        self.assertEqual(len(many), len(few) + 1)
        self.assertEqual(len(many_queries), len(few_queries))
        self.assertTrue(
            any("wallets_walletchainobservation" in query["sql"] for query in many_queries.captured_queries)
        )


class AccountExportEvidenceTest(AccountExportEvidenceChecks, APITransactionTestCase):
    pass


class ScopedAccountExportEvidenceTest(RunsOnTheScopedConnection, AccountExportEvidenceChecks, APITransactionTestCase):
    pass
