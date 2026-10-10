import base64
import hashlib
import hmac
import json
from decimal import Decimal
from itertools import count
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from assets.models import Asset
from compliance.constants import (
    ALERT_TYPE_HIGH_RISK_WALLET,
    ALERT_TYPE_SANCTIONED_ADDRESS,
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
from shared.tests.tenants import an_account
from wallets.models import Transaction, Wallet

TOKEN = "synthetic-kycaid-token"
SCREENING_ON = {"KYCAID_CRYPTO_MONITORING_ENABLED": True, "KYC_PROVIDER": PROVIDER_KYCAID}
DOCUMENTED_REQUEST_ID = "6bff21e17da144418b7643267ba4502930a9"
DOCUMENTED_SUBMISSION = {"data": {"service_request_id": DOCUMENTED_REQUEST_ID}}
QUIET_SIGNALS = {"atm": 0, "dark_market": 0, "gambling": 0, "mixer": 0, "sanctions": 0, "scam": 0, "stolen_coins": 0}
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
        market_value_aud=Decimal("12000"),
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


def service_result(service_request_id, result):
    return {
        "type": "SERVICE_RESULT",
        "service_request_id": service_request_id,
        "service_request_type": "CRYPTO_ADDRESS_CHECK",
        "service_request_status": "success",
        "result": result,
    }


def documented_result(**fields):
    return {
        "signals": QUIET_SIGNALS,
        "updated_at": 1725168579,
        "address": "0x" + "b" * 40,
        "fiat_code_effective": "usd",
        "counterparty": {"address": "0x" + "b" * 40},
        "black_lists_connections": False,
        "has_black_list_flag": False,
        "memo": "",
        "uid": "66d3fbc303614791626230",
        "asset": "ETH",
        "network": "ETH",
        "status": "success",
        "timestamp": "2024-09-01 05:29:39",
        **fields,
    }


def kycaid_callback(client, payload):
    body = json.dumps(payload).encode()
    signature = hmac.new(TOKEN.encode(), base64.b64encode(body), hashlib.sha512).hexdigest()
    return client.post(
        reverse("kycaid-crypto-webhook"),
        data=body,
        content_type="application/json",
        HTTP_X_DATA_INTEGRITY=signature,
    )


@override_settings(KYCAID_API_TOKEN=TOKEN)
class RetriedScreeningProviderTest(APITestCase):
    def test_a_retry_records_the_provider_it_was_sent_to_and_its_result_arrives(self):
        wallet = a_wallet("retried-provider")
        with override_settings(KYC_PROVIDER="", KYCAID_CRYPTO_MONITORING_ENABLED=False):
            screening = CryptoScreeningService().screen_transaction(a_transaction(wallet), wallet.user_account)
        self.assertEqual((screening.provider, screening.status), ("disabled", SCREENING_STATUS_FAILED))

        with override_settings(**SCREENING_ON), patch(
            "compliance.services.crypto_screening.get_kyc_provider",
            return_value=a_provider({"requestId": DOCUMENTED_REQUEST_ID}),
        ):
            CryptoScreeningService().retry_failed_screening(screening)
            screening.refresh_from_db()
            self.assertEqual(
                (screening.provider, screening.status, screening.provider_transaction_id),
                (PROVIDER_KYCAID, SCREENING_STATUS_PENDING, DOCUMENTED_REQUEST_ID),
            )
            payload = service_result(DOCUMENTED_REQUEST_ID, documented_result(risk_score=0.9))
            self.assertEqual(kycaid_callback(self.client, payload).status_code, 200)

        screening.refresh_from_db()
        self.assertEqual((screening.status, screening.result), (SCREENING_STATUS_COMPLETED, SCREENING_RESULT_REJECTED))


@override_settings(KYCAID_API_TOKEN=TOKEN, **SCREENING_ON)
class KycaidDocumentedCallbackTest(APITestCase):
    def setUp(self):
        self.wallet = a_wallet("documented-callback")
        submission = patch("integrations.kycaid.client.KYCAIDService._make_request", return_value=DOCUMENTED_SUBMISSION)
        self.submitted = submission.start()
        self.addCleanup(submission.stop)
        self.screening = CryptoScreeningService().screen_transaction(
            a_transaction(self.wallet), self.wallet.user_account
        )

    def delivered(self, **result):
        response = kycaid_callback(self.client, service_result(DOCUMENTED_REQUEST_ID, documented_result(**result)))
        self.assertEqual(response.status_code, 200)
        self.screening.refresh_from_db()
        return self.screening

    def test_a_screening_records_the_service_request_id_kycaid_answers_with(self):
        self.assertEqual(
            (self.screening.status, self.screening.provider_transaction_id),
            (SCREENING_STATUS_PENDING, DOCUMENTED_REQUEST_ID),
        )
        self.assertEqual(self.submitted.call_args.args, ("POST", "/services/crypto/address-verification"))

    def test_the_documented_result_completes_the_screening_and_raises_a_high_risk_alert(self):
        screening = self.delivered(risk_score=0.75, signals={**QUIET_SIGNALS, "gambling": 1})

        self.assertEqual(
            (screening.status, screening.result, screening.risk_score),
            (SCREENING_STATUS_COMPLETED, SCREENING_RESULT_REJECTED, 0.75),
        )
        alert = ComplianceAlert.objects.get(transaction=screening.transaction)
        self.assertEqual(alert.alert_type, ALERT_TYPE_HIGH_RISK_WALLET)

    def test_only_a_positive_sanctions_share_makes_it_a_sanctions_alert(self):
        screening = self.delivered(risk_score=0.9, signals={**QUIET_SIGNALS, "sanctions": 0.4})

        alert = ComplianceAlert.objects.get(transaction=screening.transaction)
        self.assertEqual(alert.alert_type, ALERT_TYPE_SANCTIONED_ADDRESS)

    def test_the_reference_tables_riskscore_spelling_is_read_too(self):
        screening = self.delivered(riskscore=0.3)

        self.assertEqual(
            (screening.status, screening.result, screening.risk_score),
            (SCREENING_STATUS_COMPLETED, SCREENING_RESULT_REVIEW, 0.3),
        )


@override_settings(KYCAID_API_TOKEN=TOKEN, **SCREENING_ON)
class CryptoWebhookResultTest(APITestCase):
    def setUp(self):
        self.screening = a_screening(a_wallet("crypto-webhook"))

    def deliver(self, payload):
        return kycaid_callback(self.client, payload)

    def result(self, result):
        return service_result(self.screening.provider_transaction_id, result)

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
