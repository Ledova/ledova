import re
from contextlib import ExitStack
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.db.models import Count
from django.test import override_settings
from django.utils import timezone
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.test import APITestCase

from assets.models import AssetSnapshot
from companies.identity import company_identity
from companies.models import Company, CompanyStatus, DocumentType
from companies.services.document_review import verified_document_snapshot
from compliance.models import (
    ComplianceAlert,
    CustomerRiskAssessment,
    TransactionScreening,
)
from documents.models import Document
from shared.seeds.demo import DEMO_INVESTOR_EMAIL, DEMO_OWNER_EMAIL
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.plan import MINIMUM_INVESTORS, WINDOW_DAYS
from shared.seeds.synthetic.story import build_plan
from users.models import (
    DeviceToken,
    InvestorClassification,
    Notification,
    UserAccount,
    UserProfile,
)
from users.models.investor_classification import DECLARATION_TEXT, InvestorCategory
from users.services.eligibility import investor_eligibility
from wallets.models import Transaction, Wallet
from wallets.services.wallets import (
    generate_verification_challenge,
    verify_wallet_signature,
)

User = get_user_model()
PASSWORD = "pw-12345678"
NOW = datetime(2026, 10, 1, 1, 30, tzinfo=dt_timezone.utc)
OUTSIDE_WORLD = (
    "socket.socket.connect",
    "integrations.expo_push.client.ExpoPushClient.send_batch",
    "integrations.sendgrid_email.client.SendGridClient.send_email",
    "companies.services.registry.lookup_company",
    "users.services.identity.get_kyc_provider",
    "integrations.blockchain.factory.BlockchainClientFactory.get_client",
    "web3.providers.rpc.HTTPProvider.make_request",
)


def run(**options):
    output = StringIO()
    options.setdefault("password", PASSWORD)
    options.setdefault("investors", MINIMUM_INVESTORS)
    call_command("seed_demo", stdout=output, **options)
    return output.getvalue()


@override_settings(DEBUG=True)
class SyntheticPopulationTest(APITestCase):

    @classmethod
    def setUpTestData(cls):
        call_command("sync_monitoring_rules", stdout=StringIO())
        jobs = ProcrastinateJob.objects.count()
        with ExitStack() as stack:
            cls.outside = {target: stack.enter_context(patch(target)) for target in OUTSIDE_WORLD}
            cls.output = run()
        cls.jobs_queued = ProcrastinateJob.objects.count() - jobs

    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)

    def signin(self, email, password=PASSWORD):
        return self.client.post("/api/signin/", {"email": email, "password": password}, format="json")

    def test_the_plan_is_the_same_on_every_build(self):
        first = build_plan(NOW, MINIMUM_INVESTORS)

        self.assertEqual(first, build_plan(NOW, MINIMUM_INVESTORS))
        self.assertNotEqual(first.people, build_plan(NOW, MINIMUM_INVESTORS, seed=1).people)

    def test_the_plan_depends_on_the_day_of_the_run_and_not_its_time(self):
        morning = build_plan(NOW, MINIMUM_INVESTORS)

        self.assertEqual(build_plan(NOW + timedelta(hours=9), MINIMUM_INVESTORS), morning)
        self.assertTrue(all(person.joined_at < morning.now for person in morning.everyone()))
        self.assertLessEqual(morning.now, NOW)

    def test_a_later_day_seeds_the_same_people_and_keys_shifted_in_time(self):
        today = build_plan(NOW, MINIMUM_INVESTORS)
        later = build_plan(NOW + timedelta(days=100), MINIMUM_INVESTORS)

        def identities(plan):
            return [
                (person.email, person.joined_at - plan.now, [(wallet.address, wallet.key) for wallet in person.wallets])
                for person in plan.everyone()
            ]

        self.assertEqual(identities(later), identities(today))

    def test_nothing_reaches_the_network_a_mailbox_or_the_job_queue(self):
        for target, stub in self.outside.items():
            self.assertFalse(stub.called, target)
        self.assertEqual(mail.outbox, [])
        self.assertEqual(self.jobs_queued, 0)

    def test_every_synthetic_person_signs_in_with_the_printed_password_once_signed_up(self):
        finished = UserProfile.objects.filter(is_signup_completed=True, user__email__endswith="@demo.ledova.test")

        self.assertGreater(finished.count(), MINIMUM_INVESTORS // 2)
        self.assertEqual(self.signin(finished.first().user.email).status_code, 200)

    def test_a_second_run_adds_nothing_and_moves_every_password(self):
        counts = (User.objects.count(), Transaction.objects.count(), Notification.objects.count())

        output = run(password="another-password-1")

        self.assertIn("already present; nothing added", output)
        self.assertIn("make dev-clean", output)
        self.assertEqual((User.objects.count(), Transaction.objects.count(), Notification.objects.count()), counts)
        staff = User.objects.get(email="helena.marsh@demo.ledova.test")
        self.assertTrue(staff.check_password("another-password-1"))
        self.assertEqual(self.signin(DEMO_INVESTOR_EMAIL, "another-password-1").status_code, 200)

    def test_verified_wallets_carry_signatures_over_real_challenges(self):
        verified = Wallet.objects.filter(verification_status="VERIFIED")

        self.assertGreater(verified.count(), MINIMUM_INVESTORS)
        for wallet in verified:
            message = keys.challenge(wallet.address, wallet.verified_at - keys.CHALLENGE_LEAD)
            self.assertTrue(
                verify_wallet_signature(wallet.address, message, wallet.verification_signature, wallet.chain),
                wallet.address,
            )
        self.assertEqual(
            set(verified.values_list("chain", flat=True)),
            {"base", "ethereum", "bitcoin"},
        )

    def test_the_seeded_challenge_differs_from_a_live_one_only_by_its_nonce(self):
        moment = timezone.now()
        nonce = re.compile(r"^Nonce: .*$", re.MULTILINE)

        seeded = keys.challenge("tb1qexample", moment)
        live = generate_verification_challenge("tb1qexample", moment)

        self.assertEqual(nonce.sub("", seeded), nonce.sub("", live))
        self.assertNotEqual(seeded, live)

    def test_the_investor_tester_is_eligible_with_a_full_history(self):
        tester = User.objects.get(email=DEMO_INVESTOR_EMAIL)
        account = UserAccount.objects.get(user_profile__user=tester)

        self.assertTrue(investor_eligibility(tester).is_eligible)
        self.assertGreater(Notification.objects.filter(user=tester, is_archived=False).count(), 25)
        self.assertGreater(Transaction.objects.filter(wallet__user_account=account).count(), 25)
        self.assertEqual(
            set(Wallet.objects.filter(user_account=account).values_list("chain", flat=True)),
            {"base", "ethereum", "bitcoin"},
        )
        claims = InvestorClassification.objects.filter(user_account=account)
        self.assertEqual({claim.status for claim in claims}, {"verified", "rejected", "withdrawn"})
        self.assertTrue(any(claim.is_expired for claim in claims))
        self.assertTrue(Document.objects.filter(uploaded_by=tester, classification__isnull=True).exists())
        self.assertTrue(Document.objects.filter(uploaded_by=tester, classification__isnull=False).exists())
        self.assertTrue(tester.userprofile.phone_number and tester.userprofile.residential_address)
        self.assertLess(tester.date_joined, timezone.now() - timedelta(days=150))

    def test_the_founder_tester_owns_an_active_company_with_its_history(self):
        founder = User.objects.get(email=DEMO_OWNER_EMAIL)

        self.assertEqual(founder.userprofile.review_result, "GREEN")
        titles = set(Notification.objects.filter(user=founder).values_list("title", flat=True))
        self.assertTrue({"Application submitted", "Company activated", "Identity verified"} <= titles)

    def test_classifications_look_like_reviewed_claims(self):
        claims = list(InvestorClassification.objects.select_related("reviewed_by"))

        self.assertEqual(
            {claim.status for claim in claims}, {"submitted", "verified", "rejected", "revoked", "withdrawn"}
        )
        self.assertEqual({claim.category for claim in claims}, set(InvestorCategory.values))
        self.assertTrue(any(claim.is_expired for claim in claims))
        for claim in claims:
            self.assertEqual(claim.declaration_text, DECLARATION_TEXT[InvestorCategory(claim.category)])
            self.assertTrue(claim.evidence_file and claim.evidence_file.storage.exists(claim.evidence_file.name))
            self.assertEqual(claim.company_id is not None, claim.category == InvestorCategory.ASSOCIATED_PERSON)
            if claim.status in ("verified", "rejected", "revoked"):
                self.assertTrue(claim.reviewed_by.is_active and claim.reviewed_by.is_staff)
                self.assertGreaterEqual(claim.reviewed_at, claim.submitted_at)
            if claim.category == InvestorCategory.ACCOUNTANT_CERTIFICATE:
                self.assertTrue(claim.certifier_name and claim.certifier_body and claim.certifier_membership_number)
            if claim.is_live and claim.certificate_issued_at:
                self.assertGreater(claim.certificate_issued_at, (timezone.now() - timedelta(days=731)).date())
        submitted = InvestorClassification.objects.filter(status="submitted").values("user_account")
        self.assertEqual(max(row["n"] for row in submitted.annotate(n=Count("pk"))), 1)

    def test_companies_carry_valid_identifiers_verified_documents_and_registry_checks(self):
        companies = list(Company.objects.all())

        self.assertEqual(
            sorted(company.status for company in companies),
            sorted(["active", "active", "active", "info_required", "submitted"]),
        )
        for company in companies:
            company.full_clean()
            self.assertTrue(company.abn.endswith(company.acn))
            if company.status != CompanyStatus.ACTIVE:
                continue
            self.assertEqual((company.registry_status, company.registry_purpose), ("passed", "activation"))
            self.assertEqual(company.registry_revision, company.lifecycle_revision - 1)
            self.assertEqual(company.registry_identity, company_identity(company))
            self.assertTrue(company.has_officeholder_attestation)
            self.assertEqual(company.operator_wallet.verification_status, "VERIFIED")
            documents = list(company.documents.all())
            self.assertEqual({document.document_type for document in documents}, set(DocumentType.values))
            for document in documents:
                verified_document_snapshot(document)
                self.assertTrue(document.verified_by.has_perm("companies.change_companydocument"))

    def test_every_state_a_queue_shows_is_represented(self):
        statuses = set(UserAccount.objects.values_list("account_status", flat=True))
        results = set(UserProfile.objects.values_list("review_result", flat=True))
        alerts = ComplianceAlert.objects.all()

        self.assertEqual(statuses, {"active", "pending", "suspended", "terminated", "rejected"})
        self.assertTrue({"GREEN", "RED", "YELLOW", ""} <= results)
        self.assertEqual(set(alerts.values_list("status", flat=True)), {"new", "reviewing", "escalated", "closed"})
        self.assertEqual(alerts.filter(smr_required=True, smr_type="ml").count(), 1)
        self.assertFalse(alerts.exclude(status="new").filter(assigned_to__isnull=True).exists())
        self.assertFalse(alerts.filter(assigned_to__is_active=False).exists())
        self.assertTrue(DeviceToken.objects.filter(is_active=True).exists())
        self.assertTrue(DeviceToken.objects.filter(is_active=False).exists())
        self.assertTrue(Notification.objects.filter(is_read=False).exists())
        self.assertTrue(Notification.objects.filter(is_archived=True).exists())

    def test_nothing_is_left_for_a_periodic_job_to_act_on(self):
        now = timezone.now()

        self.assertFalse(Transaction.objects.filter(status="pending").exists())
        self.assertFalse(Transaction.objects.filter(balance_reconciliation_token__isnull=False).exists())
        self.assertFalse(Transaction.objects.filter(created_at__gte=now - timedelta(hours=2)).exists())
        self.assertFalse(
            CustomerRiskAssessment.objects.filter(assessment_status="complete", next_review_date__lte=now).exists()
        )
        self.assertFalse(
            Document.objects.filter(classification__isnull=True, created_at__lte=now - timedelta(days=30)).exists()
        )
        for transaction in Transaction.objects.select_related("wallet"):
            touched = {transaction.from_address.lower(), (transaction.to_address or "").lower()}
            self.assertIn(transaction.wallet.address.lower(), touched)

    def test_alerts_follow_the_transactions_they_flag(self):
        flagged = ComplianceAlert.objects.exclude(transaction=None).select_related("transaction")

        self.assertTrue(flagged.exists())
        for alert in flagged:
            self.assertGreaterEqual(alert.created_at, alert.transaction.created_at)
            self.assertLessEqual(alert.created_at, alert.transaction.monitoring_completed_at)
        for screening in TransactionScreening.objects.select_related("transaction"):
            self.assertGreaterEqual(screening.created_at, screening.transaction.created_at)

    def test_every_priced_asset_has_six_months_of_daily_prices(self):
        for symbol in ("BTC", "ETH", "USDC", "USDT"):
            snapshots = AssetSnapshot.objects.filter(asset__symbol=symbol)
            self.assertEqual(snapshots.filter(data_source="manual").count(), WINDOW_DAYS + 1)
            self.assertEqual(snapshots.values("source_timestamp").distinct().count(), snapshots.count())

    def test_staff_hold_the_permissions_their_queues_need(self):
        compliance = User.objects.get(email="helena.marsh@demo.ledova.test")
        documents = User.objects.get(email="tomas.reyes@demo.ledova.test")

        self.assertTrue(compliance.has_perm("compliance.change_compliancealert"))
        self.assertTrue(compliance.has_perm("users.change_investorclassification"))
        self.assertTrue(documents.has_perm("companies.change_companydocument"))
        self.assertTrue(documents.groups.filter(name="Document operations").exists())
        self.assertFalse(User.objects.get(email="daniel.burke@demo.ledova.test").is_active)


@override_settings(DEBUG=True)
class SyntheticPopulationPartialRunTest(APITestCase):

    def test_a_run_that_stopped_part_way_is_reported_and_left_alone(self):
        User.objects.create_user(email="helena.marsh@demo.ledova.test", password=PASSWORD, is_staff=True)

        output = run()

        self.assertIn("stopped part-way", output)
        self.assertFalse(User.objects.filter(email="daniel.burke@demo.ledova.test").exists())
        self.assertFalse(Company.objects.exclude(acn="999000001").exists())
