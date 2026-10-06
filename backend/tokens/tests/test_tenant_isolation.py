from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework.test import APITestCase, APITransactionTestCase
from web3 import Web3

from companies.models import Company
from feature_flags.models import FeatureFlag
from shared.db import use_migrate, use_operator
from shared.tests.tenants import an_account, an_eligible_investor, reference_data
from shared.tests.under_the_policies import what_the_policies_admit_to
from tokens.models import ShareToken, SwapOrder, TransferOrder
from tokens.models.choices import (
    ShareTokenStatus,
    ShareTokenType,
    TransferOrderStatus,
    TransferOrderType,
)
from tokens.serializers import TransferOrderCreateSerializer
from tokens.services import token_transfer_service
from tokens.tests.market_fixtures import record_synthetic_admission
from tokens.tests.order_submission_fixtures import SubmissionFixtures
from users.models import UserAccount, UserProfile
from wallets.models import Wallet

User = get_user_model()


class TenantOrderIsolationTest(APITestCase):
    def _make_tenant(self, email, address):
        user = User.objects.create_user(email=email, password="pw-12345678")
        user.is_active = True
        user.is_email_verified = True
        user.save()
        profile = UserProfile.objects.create(user=user)
        account = UserAccount.objects.create(user_profile=profile)
        wallet = Wallet.objects.create(
            user_account=account,
            address=address,
            chain="ethereum",
            signing_preference="software",
            verification_status="VERIFIED",
        )
        return user, account, wallet

    def _make_order(self, wallet, company_owner=None):
        company = Company.objects.create(
            owner=company_owner
            or User.objects.create_user(email=f"owner-{wallet.address}@ex.com", password="pw-12345678"),
            name="Acme Pty Ltd",
            company_type="private",
            acn=str(abs(hash(wallet.address)) % 10**9).zfill(9),
            status="active",
        )
        token = ShareToken.objects.create(
            company=company,
            name="Acme Ordinary",
            symbol="ACME",
            token_type=ShareTokenType.ORDINARY,
            total_supply="1000000",
            status=ShareTokenStatus.DEPLOYED,
            deployment_tx_hash="0x" + "0" * 64,
        )
        return TransferOrder.objects.create(
            token=token,
            order_type=TransferOrderType.SELL,
            status=TransferOrderStatus.OPEN,
            wallet=wallet,
            owner_account=wallet.user_account,
            wallet_address=wallet.address,
            quantity=10,
            price_per_share=Decimal("1.50"),
        )

    def setUp(self):
        FeatureFlag.objects.update_or_create(
            name="trading_enabled",
            defaults={"enabled": True},
        )
        self.alice, self.alice_account, self.alice_wallet = self._make_tenant("alice@ex.com", "0x" + "a" * 40)
        self.bob, self.bob_account, self.bob_wallet = self._make_tenant("bob@ex.com", "0x" + "b" * 40)
        self.alice_order = self._make_order(self.alice_wallet)
        self.bob_order = self._make_order(self.bob_wallet)

    def test_queryset_scoping_excludes_other_tenant(self):
        visible = what_the_policies_admit_to(self.bob, TransferOrder)
        uuids = set(visible.values_list("uuid", flat=True))
        self.assertIn(self.bob_order.uuid, uuids)
        self.assertNotIn(self.alice_order.uuid, uuids)

    def test_registering_another_tenants_address_does_not_grant_order_access(self):
        Wallet.objects.create(
            user_account=self.bob_account,
            address=self.alice_wallet.address,
            chain="ethereum",
            verification_status="VERIFIED",
        )

        visible = what_the_policies_admit_to(self.bob, TransferOrder)
        self.assertNotIn(self.alice_order.uuid, visible.values_list("uuid", flat=True))

    def test_mismatched_account_and_wallet_fail_closed_for_both_tenants(self):
        mismatched = TransferOrder.objects.create(
            token=self.alice_order.token,
            order_type=TransferOrderType.SELL,
            status=TransferOrderStatus.OPEN,
            wallet=self.bob_wallet,
            owner_account=self.alice_account,
            wallet_address=self.bob_wallet.address,
            quantity=1,
            price_per_share=Decimal("1.00"),
        )

        self.assertNotIn(
            mismatched.uuid,
            what_the_policies_admit_to(self.alice, TransferOrder).values_list("uuid", flat=True),
        )
        self.assertNotIn(
            mismatched.uuid,
            what_the_policies_admit_to(self.bob, TransferOrder).values_list("uuid", flat=True),
        )

    def test_querysets_fail_closed_and_scope_privileged_users(self):
        for user in (None, AnonymousUser()):
            with self.subTest(user=user):
                self.assertFalse(what_the_policies_admit_to(user, TransferOrder).exists())

        mismatched = TransferOrder.objects.create(
            token=self.alice_order.token,
            order_type=TransferOrderType.SELL,
            status=TransferOrderStatus.OPEN,
            wallet=self.bob_wallet,
            owner_account=self.alice_account,
            wallet_address=self.bob_wallet.address,
            quantity=1,
            price_per_share=Decimal("1.00"),
        )

        for index, privilege in enumerate(({"is_staff": True}, {"is_superuser": True, "is_staff": True}), start=3):
            actor, _, wallet = self._make_tenant(f"privileged-{index}@ex.com", "0x" + f"{index:x}" * 40)
            for field, value in privilege.items():
                setattr(actor, field, value)
            actor.save(update_fields=list(privilege))
            order = self._make_order(wallet, company_owner=actor)

            with self.subTest(actor=actor.email):
                self.assertEqual(set(what_the_policies_admit_to(actor, TransferOrder)), {order})
                self.assertNotIn(mismatched, what_the_policies_admit_to(actor, TransferOrder))


class TransferOrderOwnershipBindingTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="owner@example.test", password="pw-12345678", is_active=True)
        self.profile = UserProfile.objects.create(user=self.user)
        self.account = UserAccount.objects.create(user_profile=self.profile)
        an_eligible_investor(self.account)
        self.wallet = Wallet.objects.create(
            user_account=self.account,
            address="0x" + "a" * 40,
            chain="ethereum",
            verification_status="VERIFIED",
        )
        self.pending_wallet = Wallet.objects.create(
            user_account=self.account,
            address="0x" + "b" * 40,
            chain="ethereum",
            verification_status="PENDING",
        )
        company = Company.objects.create(
            owner=self.user,
            name="Binding Test Pty Ltd",
            company_type="private",
            acn="123456789",
            status="active",
        )
        self.token = ShareToken.objects.create(
            company=company,
            name="Binding Test Ordinary",
            symbol="BIND",
            token_type=ShareTokenType.ORDINARY,
            total_supply="1000000",
            status=ShareTokenStatus.DEPLOYED,
            contract_address="0x" + "c" * 40,
            deployment_tx_hash="0x" + "0" * 64,
        )

    def _payload(self, wallet=None, address=None):
        wallet = wallet or self.wallet
        return {
            "submission_id": "bda8dace-8f0f-4a24-8bd7-326e9b1c6823",
            "owner_account_uuid": str(wallet.user_account_id),
            "token": str(self.token.uuid),
            "order_type": TransferOrderType.BUY,
            "wallet_uuid": str(wallet.uuid),
            "wallet_address": address or wallet.address,
            "quantity": 2,
            "price_per_share": "1.50",
        }

    def _serializer(self, payload):
        return TransferOrderCreateSerializer(
            data=payload,
            context={"request": SimpleNamespace(user=self.user)},
        )

    def test_exact_verified_wallet_and_account_are_bound(self):
        serializer = self._serializer(self._payload(address=Web3.to_checksum_address(self.wallet.address)))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["wallet"], self.wallet)
        self.assertEqual(serializer.validated_data["owner_account"], self.account)
        self.assertEqual(
            serializer.validated_data["wallet_address"],
            Web3.to_checksum_address(self.wallet.address),
        )

    def test_wallet_uuid_is_required(self):
        payload = self._payload()
        payload.pop("wallet_uuid")
        serializer = self._serializer(payload)
        self.assertFalse(serializer.is_valid())
        self.assertIn("wallet_uuid", serializer.errors)

    def test_pending_wallet_identity_can_be_validated_before_outcome_recovery(self):
        serializer = self._serializer(self._payload(wallet=self.pending_wallet))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["wallet"], self.pending_wallet)

    def test_foreign_wallet_is_rejected(self):
        other_user = User.objects.create_user(email="other@example.test", password="pw-12345678")
        other_profile = UserProfile.objects.create(user=other_user)
        other_account = UserAccount.objects.create(user_profile=other_profile)
        foreign_wallet = Wallet.objects.create(
            user_account=other_account,
            address="0x" + "d" * 40,
            chain="ethereum",
            verification_status="VERIFIED",
        )
        serializer = self._serializer(self._payload(wallet=foreign_wallet))
        self.assertFalse(serializer.is_valid())
        self.assertIn("wallet_uuid", serializer.errors)

    def test_mismatched_address_is_rejected(self):
        serializer = self._serializer(self._payload(address="0x" + "e" * 40))
        self.assertFalse(serializer.is_valid())
        self.assertIn("wallet_address", serializer.errors)

    def test_wallet_chain_eligibility_is_deferred_until_after_outcome_recovery(self):
        bitcoin_wallet = Wallet.objects.create(
            user_account=self.account,
            address="0x" + "f" * 40,
            chain="bitcoin",
            verification_status="VERIFIED",
        )
        serializer = self._serializer(self._payload(wallet=bitcoin_wallet))
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["wallet"], bitcoin_wallet)

    def test_matching_and_order_book_ignore_invalid_ownership_bindings(self):
        incoming = TransferOrder.objects.create(
            token=self.token,
            order_type=TransferOrderType.BUY,
            status=TransferOrderStatus.OPEN,
            wallet=self.wallet,
            owner_account=self.account,
            wallet_address=self.wallet.address,
            quantity=10,
            price_per_share=Decimal("2.00"),
        )
        counter_user = User.objects.create_user(email="counter@example.test", password="pw-12345678")
        counter_profile = UserProfile.objects.create(user=counter_user)
        counter_account = UserAccount.objects.create(user_profile=counter_profile)
        counter_wallet = Wallet.objects.create(
            user_account=self.account,
            address="0x" + "c" * 40,
            chain="ethereum",
            verification_status="VERIFIED",
        )
        valid_candidate = TransferOrder.objects.create(
            token=self.token,
            payment_asset=reference_data().stablecoin,
            order_type=TransferOrderType.SELL,
            status=TransferOrderStatus.OPEN,
            wallet=counter_wallet,
            owner_account=self.account,
            wallet_address=counter_wallet.address,
            quantity=10,
            price_per_share=Decimal("1.20"),
        )

        TransferOrder.objects.create(
            token=self.token,
            order_type=TransferOrderType.SELL,
            status=TransferOrderStatus.OPEN,
            wallet=self.pending_wallet,
            owner_account=counter_account,
            wallet_address=self.pending_wallet.address,
            quantity=10,
            price_per_share=Decimal("1.10"),
        )

        record_synthetic_admission(valid_candidate)
        service = token_transfer_service
        matches = list(service.find_matching_orders(incoming))
        sell_levels = list(TransferOrder.objects.order_book_levels(self.token, TransferOrderType.SELL))

        self.assertEqual(matches, [(valid_candidate, 10)])
        self.assertEqual(len(sell_levels), 1)
        self.assertEqual(sell_levels[0]["price_per_share"], Decimal("1.20"))
        self.assertEqual(
            list(TransferOrder.objects.advertised_liquidity().sell_orders().filter(token=self.token)), [valid_candidate]
        )


class CurrentTransferOrderOwnershipBindingTest(SubmissionFixtures, APITransactionTestCase):
    def test_service_persists_genuine_admission_wallet_and_account_snapshot(self):
        signed = self.signed_body(self.body(quantity=2, price_per_share="1.50"))
        with use_operator():
            swaps_before = SwapOrder.objects.count()
        with patch.object(
            token_transfer_service, "create_order_and_match", wraps=token_transfer_service.create_order_and_match
        ) as create_order:
            response = self.create(signed)
        self.assertEqual(response.status_code, 201, response.content)
        create_order.assert_called_once()
        submission = self.submission()
        with use_operator():
            order = TransferOrder.objects.get(pk=submission.order_id)
            self.assertEqual(SwapOrder.objects.count(), swaps_before)
        self.assertEqual(order.wallet_id, self.wallet.pk)
        self.assertEqual(order.owner_account_id, self.tenant.account.pk)
        self.assertEqual(order.wallet_address, Web3.to_checksum_address(self.wallet.address))
        self.assertEqual(order.creation_submission_id, submission.pk)
        self.assertEqual(order.eligibility_decision_id, self.eligibility_decision.pk)
        self.assertEqual(submission.eligibility_decision_id, self.eligibility_decision.pk)
        self.assertIsNone(submission.initial_swap_id)
        self.assertEqual(create_order.call_args.kwargs["admission"].decision.pk, self.eligibility_decision.pk)
        self.assertEqual(create_order.call_args.kwargs["submission"].pk, submission.pk)

    def test_execution_refuses_a_wallet_changed_after_challenge_issuance_without_spending(self):
        with use_migrate():
            other_account = an_account("binding-moved-to")
        with use_operator():
            swaps_before = SwapOrder.objects.count()
        changes = (
            ({"verification_status": "PENDING"}, "Select a verified EVM wallet from your own account."),
            ({"user_account": other_account}, "Select a wallet from your own account."),
        )
        for fields, detail in changes:
            with self.subTest(fields=list(fields)):
                self.submission_id = uuid4()
                signed = self.signed_body(self.body(quantity=2, price_per_share="1.50"))
                with use_migrate():
                    Wallet.objects.filter(pk=self.wallet.pk).update(**fields)
                try:
                    with patch.object(
                        token_transfer_service,
                        "create_order_and_match",
                        wraps=token_transfer_service.create_order_and_match,
                    ) as create_order:
                        refused = self.create(signed)
                    self.assertEqual(refused.status_code, 400, refused.content)
                    self.assertEqual(
                        refused.json(), {"walletUuid": detail if "verification_status" in fields else [detail]}
                    )
                    create_order.assert_not_called()
                    self.assert_pending_and_unspent(signed)
                    with use_operator():
                        self.assertEqual(SwapOrder.objects.count(), swaps_before)
                finally:
                    with use_migrate():
                        Wallet.objects.filter(pk=self.wallet.pk).update(
                            verification_status="VERIFIED", user_account=self.tenant.account
                        )
        self.assertEqual(self.create(signed).status_code, 201)
