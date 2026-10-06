from datetime import timedelta
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from assets.models import Asset
from compliance.models import TransactionScreening
from compliance.services.transaction_monitoring import TransactionMonitoringService
from integrations.kyc.base import NormalizedVerificationResult
from operators.models import Operator
from shared.models import Country
from users.models import UserAccount, UserProfile
from users.services import identity
from wallets.models import Transaction, Wallet

User = get_user_model()
PUSH_TASK = "users.tasks.notifications.send_push_notification"
GREEN = NormalizedVerificationResult(verification_status="completed", review_result="GREEN", is_verified=True)


@override_settings(KYC_PROVIDER="", KYCAID_CRYPTO_MONITORING_ENABLED=False)
class NewCustomerScreeningTest(TestCase):
    @classmethod
    def setUpTestData(cls):
        Operator.get()
        call_command("sync_monitoring_rules", stdout=StringIO())
        cls.ether = Asset.objects.create(symbol="ETH", name="Ether", asset_type="native_crypto", is_verified=True)

    def setUp(self):
        patch(PUSH_TASK).start()
        self.addCleanup(patch.stopall)

    def customer_verified(self, label, days_ago):
        user = User.objects.create_user(email=f"{label}@screening.example.test", password="pw-12345678")
        country, _ = Country.objects.get_or_create(code="AU", defaults={"name": "Australia"})
        profile = UserProfile.objects.create(user=user, citizenship_country=country)
        account = UserAccount.objects.create(account_number=f"ACC-{label.upper()}"[:20], user_profile=profile)
        with patch("django.utils.timezone.now", return_value=timezone.now() - timedelta(days=days_ago)):
            identity.update_status_from_normalized(profile, GREEN)
        return UserAccount.objects.get(pk=account.pk)

    def small_transfer(self, account):
        wallet = Wallet.objects.create(
            user_account=account, address="0x" + "a" * 40, chain="ethereum", verification_status="VERIFIED"
        )
        return Transaction.objects.create(
            tx_hash=f"0x{account.pk.hex}",
            chain="ethereum",
            from_address=wallet.address,
            to_address="0x" + "b" * 40,
            asset=self.ether,
            amount=Decimal("0.01"),
            wallet=wallet,
        )

    def test_an_established_customer_is_not_screened_as_new(self):
        customer = self.customer_verified("established", days_ago=90)
        transfer = self.small_transfer(customer)

        alerts = TransactionMonitoringService.check_transaction(transfer, customer)

        self.assertEqual([alert.triggered_rule for alert in alerts], [])
        self.assertFalse(TransactionScreening.objects.filter(transaction=transfer).exists())

    def test_a_genuinely_new_customer_is_still_screened_and_flagged(self):
        customer = self.customer_verified("newcomer", days_ago=5)
        transfer = self.small_transfer(customer)

        alerts = TransactionMonitoringService.check_transaction(transfer, customer)

        self.assertEqual(sorted(alert.triggered_rule for alert in alerts), ["MON-004", "MON-005"])
        self.assertEqual({alert.alert_data["screening_trigger"] for alert in alerts}, {"new_customer"})
        self.assertEqual(TransactionScreening.objects.get(transaction=transfer).status, "failed")
