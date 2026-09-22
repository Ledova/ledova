import base64
import hashlib
import hmac
import json
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from itertools import count
from threading import Event, Lock
from unittest.mock import MagicMock, patch

from django.db import connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from assets.models import Asset
from compliance.constants import (
    RULE_TYPE_ADDRESS,
    SCREENING_RESULT_APPROVED,
    SCREENING_RESULT_REJECTED,
    SCREENING_RESULT_REVIEW,
    SCREENING_STATUS_COMPLETED,
    SCREENING_STATUS_FAILED,
    SCREENING_STATUS_PENDING,
)
from compliance.models import ComplianceAlert, MonitoringRule, TransactionScreening
from compliance.services.crypto_screening import CryptoScreeningService
from compliance.services.transaction_monitoring import check_rule
from integrations.kyc.base import KYCProvider
from integrations.kyc.constants import PROVIDER_KYCAID, PROVIDER_SUMSUB
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import an_account
from wallets.models import Transaction, Wallet

TOKEN = "synthetic-kycaid-token"
SCREENING_ON = {"KYCAID_CRYPTO_MONITORING_ENABLED": True, "KYC_PROVIDER": PROVIDER_KYCAID}
_numbers = count()

ProviderWithoutScreening = type(
    "ProviderWithoutScreening",
    (KYCProvider,),
    {name: lambda self, *args, **kwargs: None for name in KYCProvider.__abstractmethods__}
    | {"get_provider_name": lambda self: "unscreened"},
)


def a_wallet(label):
    account = an_account(label)
    profile = account.user_profile
    profile.kyc_provider = PROVIDER_KYCAID
    profile.kycaid_applicant_id = f"{label}-applicant"
    profile.sumsub_applicant_id = f"{label}-applicant"
    profile.save()
    return Wallet.objects.create(
        user_account=account, address="0x" + "a" * 40, chain="ethereum", verification_status="VERIFIED"
    )


def a_transaction(wallet):
    number = next(_numbers)
    return Transaction.objects.create(
        tx_hash=f"0x{number:064x}",
        chain="ethereum",
        from_address=wallet.address,
        to_address="0x" + "b" * 40,
        asset=Asset.objects.get_or_create(symbol="ETH", defaults={"name": "Ether"})[0],
        amount=Decimal("1"),
        market_value=Decimal("12000"),
        wallet=wallet,
    )


def a_screening(wallet, status=SCREENING_STATUS_PENDING):
    transaction = a_transaction(wallet)
    return TransactionScreening.objects.create(
        transaction=transaction,
        user_account=wallet.user_account,
        provider=PROVIDER_KYCAID,
        provider_transaction_id=str(transaction.pk),
        to_address=transaction.to_address,
        status=status,
    )


def a_provider(response=None):
    provider = MagicMock()
    provider.get_provider_name.return_value = PROVIDER_KYCAID
    provider.submit_crypto_transaction.return_value = {} if response is None else response
    return provider


def completed_elsewhere(screening_id):
    TransactionScreening.objects.filter(pk=screening_id).update(
        status=SCREENING_STATUS_COMPLETED, result=SCREENING_RESULT_REJECTED, risk_score=0.9
    )


@override_settings(**SCREENING_ON)
class ScreeningResultTest(TestCase):
    def setUp(self):
        self.wallet = a_wallet("screening-result")
        self.provider = a_provider()
        provider = patch("compliance.services.crypto_screening.get_kyc_provider", return_value=self.provider)
        provider.start()
        self.addCleanup(provider.stop)

    def screen(self, response):
        self.provider.submit_crypto_transaction.return_value = response
        screening = CryptoScreeningService().screen_transaction(a_transaction(self.wallet), self.wallet.user_account)
        screening.refresh_from_db()
        return screening

    def test_a_response_without_a_valid_risk_score_stays_pending_with_its_raw_response(self):
        for response in (
            {"status": "accepted"},
            {"riskScore": None},
            {"riskScore": "0.1"},
            {"riskScore": True},
            {"riskScore": -0.1},
        ):
            with self.subTest(response=response):
                screening = self.screen(response)
                self.assertEqual(
                    (screening.status, screening.result, screening.raw_response),
                    (SCREENING_STATUS_PENDING, None, response),
                )

    def test_a_response_that_is_not_an_object_fails_with_its_raw_response(self):
        screening = self.screen(["accepted"])
        self.assertEqual(
            (screening.status, screening.result, screening.raw_response, screening.error_message),
            (SCREENING_STATUS_FAILED, None, ["accepted"], "Provider response is not a JSON object"),
        )

    def test_a_valid_score_still_decides_the_result(self):
        for score, result, alerts in (
            (0, SCREENING_RESULT_APPROVED, 0),
            (0.3, SCREENING_RESULT_REVIEW, 1),
            (0.7, SCREENING_RESULT_REJECTED, 1),
        ):
            with self.subTest(score=score):
                screening = self.screen({"riskScore": score})
                self.assertEqual((screening.status, screening.result), (SCREENING_STATUS_COMPLETED, result))
                self.assertEqual(ComplianceAlert.objects.filter(transaction=screening.transaction).count(), alerts)

    def test_a_provider_error_after_the_result_arrived_leaves_the_result(self):
        def completes_then_fails(**kwargs):
            completed_elsewhere(TransactionScreening.objects.get(provider_transaction_id=kwargs["transaction_id"]).pk)
            raise ConnectionError("provider timed out")

        self.provider.submit_crypto_transaction.side_effect = completes_then_fails
        screening = self.screen(None)
        self.assertEqual(
            (screening.status, screening.result, screening.error_message, screening.retry_count),
            (SCREENING_STATUS_COMPLETED, SCREENING_RESULT_REJECTED, None, 0),
        )

    def test_a_retry_from_a_stale_copy_leaves_a_completed_result(self):
        stale = a_screening(self.wallet, status=SCREENING_STATUS_FAILED)
        completed_elsewhere(stale.pk)
        returned = CryptoScreeningService().retry_failed_screening(stale)
        self.provider.submit_crypto_transaction.assert_not_called()
        stale.refresh_from_db()
        self.assertEqual((returned.status, stale.status), (SCREENING_STATUS_COMPLETED, SCREENING_STATUS_COMPLETED))
        self.assertEqual(stale.result, SCREENING_RESULT_REJECTED)


@override_settings(KYCAID_CRYPTO_MONITORING_ENABLED=True, KYC_PROVIDER=PROVIDER_SUMSUB)
class ProviderWithoutScreeningTest(TestCase):
    def test_a_provider_that_cannot_screen_fails_and_raises_the_monitoring_flag(self):
        wallet = a_wallet("unscreened")
        wallet.user_account.user_profile.kyc_provider = PROVIDER_SUMSUB
        wallet.user_account.user_profile.save()
        transaction = a_transaction(wallet)
        rule = MonitoringRule.objects.create(
            rule_code="MON-004", name="High-Risk Wallet", description="d", rule_type=RULE_TYPE_ADDRESS
        )
        with patch("integrations.sumsub.client.SumSubService", ProviderWithoutScreening):
            triggered, details = check_rule(rule, transaction, wallet.user_account)
        screening = TransactionScreening.objects.get(transaction=transaction)
        self.assertEqual(
            (screening.provider, screening.status, screening.result),
            ("unscreened", SCREENING_STATUS_FAILED, None),
        )
        self.assertTrue(triggered)
        self.assertEqual(
            (details["reason"], details["error"]),
            ("Crypto screening failed - address safety unverified", "unscreened does not support crypto screening"),
        )


@override_settings(KYCAID_API_TOKEN=TOKEN, **SCREENING_ON)
class CryptoWebhookResultTest(APITestCase):
    def setUp(self):
        self.screening = a_screening(a_wallet("crypto-webhook"))

    def deliver(self, payload):
        body = json.dumps(payload).encode()
        signature = hmac.new(TOKEN.encode(), base64.b64encode(body), hashlib.sha512).hexdigest()
        return self.client.post(
            reverse("kycaid-crypto-webhook"),
            data=body,
            content_type="application/json",
            HTTP_X_DATA_INTEGRITY=signature,
        )

    def result(self, result):
        return {"request_id": self.screening.provider_transaction_id, "result": result}

    def test_a_payload_that_is_not_an_object_is_rejected(self):
        for payload in ([self.result({"risk_score": 0})], "approved"):
            with self.subTest(payload=payload):
                self.assertEqual(self.deliver(payload).status_code, 400)
                self.screening.refresh_from_db()
                self.assertEqual(self.screening.status, SCREENING_STATUS_PENDING)

    def test_a_result_without_a_risk_score_leaves_the_screening_unresolved(self):
        for result in ({}, {"risk_score": None}, "approved"):
            with self.subTest(result=result):
                payload = self.result(result)
                self.assertEqual(self.deliver(payload).status_code, 200)
                self.screening.refresh_from_db()
                self.assertEqual((self.screening.status, self.screening.result), (SCREENING_STATUS_PENDING, None))
                self.assertEqual(self.screening.raw_response["raw"], payload)

    def test_a_late_result_never_overwrites_a_completed_one(self):
        self.assertEqual(self.deliver(self.result({"risk_score": 0.9})).status_code, 200)
        self.assertEqual(self.deliver(self.result({"risk_score": 0})).status_code, 200)
        self.screening.refresh_from_db()
        self.assertEqual((self.screening.result, self.screening.risk_score), (SCREENING_RESULT_REJECTED, 0.9))
        self.assertEqual(ComplianceAlert.objects.filter(transaction=self.screening.transaction).count(), 1)


@override_settings(**SCREENING_ON)
class ScopedScreeningLockTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.wallet = a_wallet("screening-lock")
        self.provider = a_provider()
        provider = patch("compliance.services.crypto_screening.get_kyc_provider", return_value=self.provider)
        provider.start()
        self.addCleanup(provider.stop)

    def first_caller_waits_for_a_second(self, name):
        original = getattr(CryptoScreeningService, name)
        arrivals = []
        guard = Lock()
        second = Event()

        def contended(service, *args, **kwargs):
            with guard:
                arrivals.append(name)
                first = len(arrivals) == 1
            if first:
                second.wait(timeout=2)
            else:
                second.set()
            return original(service, *args, **kwargs)

        return patch.object(CryptoScreeningService, name, contended)

    def concurrently(self, action, *arguments):
        def run(argument):
            try:
                with use_operator():
                    return action(argument)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(arguments)) as pool:
            return list(pool.map(run, arguments))

    def test_concurrent_results_complete_a_screening_once(self):
        with use_operator():
            screening_id = a_screening(self.wallet).pk

        def deliver(score):
            screening = TransactionScreening.objects.get(pk=screening_id)
            CryptoScreeningService().process_webhook_result(screening, {"riskScore": score, "signals": [], "raw": {}})

        with self.first_caller_waits_for_a_second("_create_alert"):
            self.concurrently(deliver, 0.9, 0.7)
        with use_operator():
            self.assertEqual(TransactionScreening.objects.get(pk=screening_id).status, SCREENING_STATUS_COMPLETED)
            self.assertEqual(ComplianceAlert.objects.filter(user_account=self.wallet.user_account).count(), 1)

    def test_concurrent_retries_submit_once(self):
        with use_operator():
            screening_id = a_screening(self.wallet, status=SCREENING_STATUS_FAILED).pk

        def retry(_):
            return CryptoScreeningService().retry_failed_screening(TransactionScreening.objects.get(pk=screening_id))

        with self.first_caller_waits_for_a_second("_blocker"):
            self.concurrently(retry, 1, 2)
        self.assertEqual(self.provider.submit_crypto_transaction.call_count, 1)
        with use_operator():
            self.assertEqual(TransactionScreening.objects.get(pk=screening_id).status, SCREENING_STATUS_PENDING)
