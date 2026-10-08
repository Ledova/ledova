from collections import Counter, defaultdict
from datetime import timedelta
from decimal import ROUND_DOWN, Decimal
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from assets.models import Asset
from blockchain.models import SignedAttempt, SigningAccount
from ledova_backend.procrastinate_app import app
from offerings.models import OfferingStatus, SubscriptionStatus
from operators.models import Operator
from shared.constants import BLOCKCHAIN_ETHEREUM
from shared.seeds.demo import DEMO_INVESTOR_EMAIL, DEMO_ISSUER_ADDRESS, DEMO_OWNER_EMAIL
from shared.seeds.synthetic.chain import population
from shared.seeds.synthetic.chain.approvals import TREASURY_UNSUPPORTED
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.deferred import UnexpectedJob, captured
from shared.seeds.synthetic.chain.guard import (
    GET_THE_CHAIN,
    MALFORMED,
    NO_CODE,
    NO_FINALITY,
    NOT_ADMITTED,
    UNREACHABLE,
    WRONG_CHAIN,
    chain_refusal,
    operator_address,
)
from shared.seeds.synthetic.chain.layer import (
    ABSENT,
    PARTIAL,
    PRESENT,
    SKIPPED,
    issuance_state,
    seal,
    seed_issuance,
)
from shared.seeds.synthetic.chain.records import Records
from shared.seeds.synthetic.chain.settlement import (
    BALANCE_METHODS,
    OTHER_SETTLEMENT,
    fund_wallets,
    settlement_refusal,
)
from shared.seeds.synthetic.chain.story import (
    ALLOTTED,
    AWAITING,
    CHAIRS,
    LAPSED,
    REJECTED,
    TESTER_WALLETS,
    build_issuance,
)
from shared.seeds.synthetic.clock import Calendar
from shared.seeds.synthetic.keys import hardhat_keys
from shared.seeds.synthetic.plan import DEFAULT_INVESTORS, MINIMUM_INVESTORS
from tokens.models import ShareToken
from users.models import Notification
from users.tasks.notifications import send_push_notification
from wallets.models import Holding
from wallets.tasks import sync_wallet
from whitelist.models import WhitelistApproval, WhitelistEntry

PASSWORD = "pw-12345678"
LIVE = ("submitted", "under_review", "approved")
COMMITTED = ("allotted", "paid")
RETENTION = timedelta(days=2557)
CHAIN = {
    "BLOCKCHAIN_CHAIN_ID": 31337,
    "BLOCKCHAIN_RPC_URL": "http://127.0.0.1:1",
    "BLOCKCHAIN_OPERATOR_KEY": "0x" + "11" * 32,
    "SHARE_TOKEN_FACTORY_ADDRESS": "0x" + "a1" * 20,
    "STABLECOIN_CONTRACT_ADDRESS": "0x" + "b2" * 20,
    "ATOMIC_SWAP_ADDRESS": "0x" + "c3" * 20,
    "WALLET_CHAIN_FINALITY_POLICIES": {"evm:31337": {"mode": "depth", "depth": 1}},
}
NODE = "web3.providers.rpc.HTTPProvider.make_request"


def node(chain_id=31337, code="0x6080"):
    def answer(provider, method, params):
        result = {"eth_chainId": hex(chain_id), "eth_getCode": code}[method]
        return {"jsonrpc": "2.0", "id": 1, "result": result}

    return answer


def seed(**options):
    output = StringIO()
    call_command("seed_demo", stdout=output, password=PASSWORD, **options)
    return output.getvalue()


@override_settings(DEBUG=True)
class IssuancePlanTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command("sync_monitoring_rules", stdout=StringIO())
        with patch(NODE) as cls.rpc:
            cls.output = seed(investors=DEFAULT_INVESTORS)
        cls.found = population.companies()
        cls.firms = population.firms(cls.found)
        cls.candidates = {candidate.key: candidate for candidate in population.candidates(cls.found)}
        cls.now = timezone.now()
        cls.plan = build_issuance(cls.now, cls.firms, list(cls.candidates.values()))
        cls.anchor = Calendar(cls.now).anchor

    def test_the_plan_is_the_same_on_every_build_and_changes_with_the_seed(self):
        again = build_issuance(self.now, self.firms, list(self.candidates.values()))
        other = build_issuance(self.now, self.firms, list(self.candidates.values()), seed=1)

        self.assertEqual(again, self.plan)
        self.assertNotEqual(other.classes, self.plan.classes)

    def test_the_plan_depends_on_the_day_of_the_run_and_not_its_time(self):
        early = build_issuance(self.anchor + timedelta(hours=1), self.firms, list(self.candidates.values()))
        late = build_issuance(self.anchor + timedelta(hours=22), self.firms, list(self.candidates.values()))

        self.assertEqual(early, late)

    def test_every_offering_and_application_status_is_present(self):
        statuses = {item.status for item in self.plan.rounds}
        applications = {application.status for application in self.plan.applications()}

        self.assertEqual(statuses, set(OfferingStatus.values))
        self.assertEqual(applications, set(SubscriptionStatus.values))
        self.assertTrue(any(item.status == "approved" and item.opens_at > self.now for item in self.plan.rounds))
        self.assertTrue(any(item.status == "approved" and item.opens_at <= self.now for item in self.plan.rounds))
        self.assertEqual(
            {application.rail for application in self.plan.applications()}, {"bank_transfer", "stablecoin"}
        )

    def test_one_offering_per_class_is_live_and_offerings_follow_activation(self):
        live = Counter(item.share_class for item in self.plan.rounds if item.status in LIVE)
        activated = {firm.key: firm.activated_at for firm in self.firms}

        self.assertEqual(max(live.values()), 1)
        for item in self.plan.rounds:
            share_class = self.plan.share_class(item.share_class)
            self.assertTrue(share_class.deployed, item.key)
            self.assertGreater(item.created_at, activated[share_class.company], item.key)
            self.assertLess(item.opens_at, item.closes_at, item.key)
            self.assertLessEqual(item.minimum, item.target)
            self.assertLessEqual(item.target, item.cap)

    def test_closed_rounds_allot_within_their_cap_and_one_is_scaled_back_with_refunds(self):
        closed = [item for item in self.plan.rounds if item.status == "closed"]

        self.assertGreaterEqual(len(closed), 3)
        self.assertTrue(any(item.scaled_back for item in closed))
        for item in closed:
            allotted = [application for application in item.applications if application.status == ALLOTTED]
            requested = sum(self._covered(application, item.price) for application in allotted)
            self.assertLessEqual(sum(application.allotted for application in allotted), item.cap, item.key)
            for application in allotted:
                base = self._covered(application, item.price)
                expected = base if requested <= item.cap else base * item.cap // requested
                self.assertEqual(application.allotted, expected, item.key)
                residual = application.received - (Decimal(application.allotted) * item.price).quantize(Decimal("0.01"))
                self.assertEqual(application.refund, residual if residual > 0 else None, item.key)

    @staticmethod
    def _covered(application, price):
        payment = application.payments[0]
        if not payment.final:
            return application.quantity
        return min(application.quantity, int((payment.amount / price).to_integral_value(rounding=ROUND_DOWN)))

    def test_the_open_round_is_close_to_its_cap_without_reaching_it(self):
        (item,) = [item for item in self.plan.rounds if item.status == "approved" and item.opens_at <= self.now]
        committed = sum(application.quantity for application in item.applications if application.status in COMMITTED)

        self.assertLess(committed, item.cap)
        self.assertGreaterEqual(committed, item.cap * 0.8)
        self.assertGreater(len(item.applications), 20)

    def test_every_timeline_runs_forward_inside_its_window_and_after_the_investor_could_apply(self):
        for item in self.plan.rounds:
            for application in item.applications:
                candidate = self.candidates[application.investor]
                moments = [
                    application.created_at,
                    application.submitted_at,
                    application.accepted_at,
                    application.instructed_at,
                    *(payment.at for payment in application.payments),
                    application.closed_at,
                ]
                moments = [moment for moment in moments if moment is not None]
                self.assertEqual(moments, sorted(moments), application)
                self.assertLess(moments[-1], self.anchor, application)
                self.assertGreater(application.created_at, candidate.ready_at, application)
                self.assertGreaterEqual(application.created_at, item.opens_at, application)
                self.assertLess(application.submitted_at or application.created_at, item.closes_at, application)
                wallets = {wallet.address for wallet in candidate.wallets_ready_by(application.created_at)}
                self.assertIn(application.address, wallets, application)

    def test_awaiting_payments_fall_due_after_the_run_and_lapsed_ones_before_it(self):
        for item in self.plan.rounds:
            for application in item.applications:
                if application.instructed_at is None:
                    continue
                due = min(application.instructed_at + timedelta(days=7), item.closes_at)
                if application.status == AWAITING:
                    self.assertGreater(due, self.anchor + timedelta(days=2), application)
                if application.status == REJECTED and application.reason == LAPSED:
                    self.assertLess(due, application.closed_at, application)

    def test_every_deployed_class_has_ten_to_thirty_members(self):
        for share_class in self.plan.classes:
            if not share_class.deployed:
                self.assertEqual(share_class.positions, ())
                continue
            holders = {position.holder for position in share_class.positions}
            for item in self.plan.rounds_of(share_class.key):
                holders |= {application.investor for application in item.applications if application.status == ALLOTTED}
            self.assertGreaterEqual(len(holders), 10, share_class.key)
            self.assertLessEqual(len(holders), 30, share_class.key)

    def test_the_investor_tester_holds_four_classes_in_three_companies_across_three_wallets(self):
        held = defaultdict(set)
        for share_class in self.plan.classes:
            for position in share_class.positions:
                if position.holder == DEMO_INVESTOR_EMAIL:
                    held[share_class.key].add(position.address)
        statuses = set()
        for item in self.plan.rounds:
            for application in item.applications:
                if application.investor != DEMO_INVESTOR_EMAIL:
                    continue
                statuses.add(application.status)
                if application.status == ALLOTTED:
                    held[item.share_class].add(application.address)

        self.assertEqual(len(held), 4)
        self.assertEqual(len({key.split("/")[0] for key in held}), 3)
        self.assertEqual(
            {address for addresses in held.values() for address in addresses}, set(TESTER_WALLETS.values())
        )
        self.assertTrue({"awaiting_payment", "paid", "allotted"} <= statuses)

    def test_former_members_ceased_inside_the_retention_window_and_entries_are_in_the_past(self):
        today = self.anchor.date()
        for share_class in self.plan.classes:
            for member in share_class.former:
                self.assertGreater(member.ceased_on, today - RETENTION)
                self.assertLess(member.ceased_on, today)
            for position in share_class.positions:
                self.assertLess(position.entered_on, today)
                self.assertGreater(position.shares, 0)

    def test_requests_and_raises_cover_every_status_a_queue_shows(self):
        self.assertEqual(
            {request.status for request in self.plan.requests},
            {"submitted", "under_review", "approved", "rejected", "executed"},
        )
        self.assertEqual({item.status for item in self.plan.raises}, {"executed", "submitted", "rejected", "draft"})
        for item in self.plan.raises:
            self.assertEqual(item.new_total, self.plan.share_class(item.share_class).authorised + item.additional)
        in_flight = Counter(item.share_class for item in self.plan.raises if item.status in ("submitted", "executed"))
        self.assertEqual(max(in_flight.values()), 1)

    def test_no_approving_director_shares_a_name_with_anyone_on_the_platform(self):
        names = {candidate.name for candidate in self.candidates.values()}

        self.assertFalse(set(CHAIRS.values()) & names)
        self.assertEqual(set(self.plan.directors.values()), set(CHAIRS.values()))

    def test_holders_and_applicants_are_eligible_investors_for_their_company(self):
        owners = {firm.key: firm.owner for firm in self.firms}
        for share_class in self.plan.classes:
            for position in share_class.positions:
                if position.holder.startswith("treasury:") or position.holder == owners[share_class.company]:
                    continue
                self.assertIn(share_class.company, self.candidates[position.holder].companies, position)
        for item in self.plan.rounds:
            company = self.plan.share_class(item.share_class).company
            for application in item.applications:
                candidate = self.candidates[application.investor]
                self.assertIn(company, candidate.companies, application)
                self.assertFalse(candidate.large_only, application)

    def test_without_a_local_chain_the_seed_says_why_and_writes_nothing_for_it(self):
        self.assertIn("Chain layer skipped: BLOCKCHAIN_CHAIN_ID is 84532", self.output)
        self.assertIn(GET_THE_CHAIN, self.output)
        self.assertFalse(self.rpc.called)
        self.assertEqual(issuance_state(self.found), ABSENT)
        self.assertFalse(WhitelistApproval.objects.exists())
        self.assertEqual(
            set(ShareToken.objects.values_list("symbol", "status")),
            {("ORD", "draft")},
        )


@override_settings(DEBUG=True)
class IssuanceRunOnceTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        call_command("sync_monitoring_rules", stdout=StringIO())
        seed(investors=MINIMUM_INVESTORS)
        cls.found = population.companies()

    def test_a_minimum_population_still_plans_applications_from_wallets_verified_in_time(self):
        candidates = {candidate.key: candidate for candidate in population.candidates(self.found)}
        plan = build_issuance(timezone.now(), population.firms(self.found), list(candidates.values()))

        self.assertTrue(plan.applications())
        for application in plan.applications():
            ready = candidates[application.investor].wallets_ready_by(application.created_at)
            self.assertIn(application.address, {wallet.address for wallet in ready}, application)

    def test_a_layer_that_started_is_reported_and_left_alone_without_reading_the_chain(self):
        ShareToken.objects.create(
            company=self.found["demo-robotics"], symbol="PRF", name="Seed Preference Shares", total_supply="300000"
        )

        with patch(NODE) as rpc:
            outcome = seed_issuance(timezone.now())
            output = seed(investors=MINIMUM_INVESTORS)

        self.assertEqual(outcome.state, PARTIAL)
        self.assertIn("stopped part-way through the chain layer", output)
        self.assertFalse(rpc.called)

    def test_a_finished_layer_is_reported_present_and_adds_nothing(self):
        for key, symbol in (("demo-robotics", "PRF"), ("saltbush", "ORD")):
            ShareToken.objects.create(company=self.found[key], symbol=symbol, name="Class", total_supply="1000")

        with patch(NODE) as rpc:
            outcome = seed_issuance(timezone.now())
            output = seed(investors=MINIMUM_INVESTORS)

        self.assertEqual((outcome.state, outcome.plan), (PRESENT, None))
        self.assertIn("Chain layer already present; nothing added.", output)
        self.assertFalse(rpc.called)

    def test_a_no_key_treasury_plan_is_explicitly_skipped_before_any_chain_layer_writes(self):
        treasury = self.plan().treasuries[0]
        retained = WhitelistEntry.objects.create(
            wallet=None,
            address=treasury.address,
            label=treasury.label,
            notes="Retained synthetic no-key treasury history",
        )
        before = (ShareToken.objects.count(), WhitelistEntry.objects.count(), SignedAttempt.objects.count())
        with (
            patch("shared.seeds.synthetic.chain.layer.chain_refusal", return_value=None),
            patch("shared.seeds.synthetic.chain.layer.settlement_refusal", return_value=None),
            patch("shared.seeds.synthetic.chain.layer._apply") as apply,
            patch("shared.seeds.synthetic.chain.layer.captured") as capture,
        ):
            outcome = seed_issuance(timezone.now())
            output = seed(investors=MINIMUM_INVESTORS)
        self.assertTrue(self.plan().treasuries)
        self.assertEqual(
            (outcome.state, outcome.plan, outcome.reason, outcome.counts), (SKIPPED, None, TREASURY_UNSUPPORTED, {})
        )
        self.assertIn(f"Chain layer skipped: {TREASURY_UNSUPPORTED}\n", output)
        self.assertNotIn("Chain layer seeded", output)
        apply.assert_not_called()
        capture.assert_not_called()
        self.assertEqual(
            (ShareToken.objects.count(), WhitelistEntry.objects.count(), SignedAttempt.objects.count()), before
        )
        self.assertEqual(issuance_state(self.found), ABSENT)
        retained.refresh_from_db()
        self.assertEqual(
            (retained.address, retained.label, retained.notes, retained.wallet_id),
            (treasury.address, treasury.label, "Retained synthetic no-key treasury history", None),
        )

    def test_an_operator_settling_otherwise_is_left_alone_before_the_chain_is_touched(self):
        assets = {asset.symbol: asset for asset in Asset.objects.filter(symbol__in=("AUDY", "AUSG", "USDC"))}
        operator = Operator.get()
        operator.receiving_wallet_address = "0x" + "d4" * 20
        operator.issued_stablecoin = assets["AUDY"]
        operator.save()
        operator.supported_settlement_assets.set([assets["AUDY"]])
        self.assertIsNone(settlement_refusal())

        operator.issued_stablecoin = assets["AUSG"]
        operator.receiving_wallet_chain = BLOCKCHAIN_ETHEREUM
        operator.save()
        operator.supported_settlement_assets.add(assets["USDC"])
        with patch("shared.seeds.synthetic.chain.layer.chain_refusal", return_value=None), patch(NODE) as rpc:
            outcome = seed_issuance(timezone.now())
            output = seed(investors=MINIMUM_INVESTORS)

        detail = "settlement assets AUDY, USDC; issued stablecoin AUSG; receiving wallet on ethereum"
        self.assertEqual((outcome.state, outcome.reason), (SKIPPED, OTHER_SETTLEMENT.format(detail=detail)))
        self.assertIn(f"Chain layer skipped: {outcome.reason}\n", output)
        self.assertNotIn(GET_THE_CHAIN, output)
        self.assertFalse(rpc.called)
        self.assertEqual(issuance_state(self.found), ABSENT)
        self.assertEqual(set(operator.supported_settlement_assets.values_list("symbol", flat=True)), {"AUDY", "USDC"})

    @override_settings(**CHAIN)
    def test_a_node_that_cannot_set_a_balance_fails_the_step(self):
        client = Mock()
        client.w3.provider.make_request.return_value = {"jsonrpc": "2.0", "id": 1, "error": {"code": -32601}}

        with patch("shared.seeds.synthetic.chain.settlement.get_base_chain_client", return_value=client):
            with self.assertRaisesMessage(ChainStepFailed, " nor ".join(BALANCE_METHODS)):
                fund_wallets()

        methods = [call.args[0] for call in client.w3.provider.make_request.call_args_list]
        self.assertEqual(methods, list(BALANCE_METHODS))

    def test_every_seeded_base_wallet_gets_its_ether_but_the_operators_own(self):
        key = "0x" + hardhat_keys([0])[0].key.hex()
        client = Mock()
        client.w3.provider.make_request.return_value = {"jsonrpc": "2.0", "id": 1, "result": True}
        ether = Holding.objects.filter(
            wallet__chain="base", wallet__verification_status="VERIFIED", asset__symbol="ETH"
        ).select_related("wallet")
        seeded = {holding.wallet.address.lower(): holding.quantity for holding in ether}

        with (
            override_settings(**{**CHAIN, "BLOCKCHAIN_OPERATOR_KEY": key}),
            patch("shared.seeds.synthetic.chain.settlement.get_base_chain_client", return_value=client),
        ):
            self.assertEqual(operator_address(), DEMO_ISSUER_ADDRESS)
            funded = fund_wallets()

        calls = [call.args for call in client.w3.provider.make_request.call_args_list]
        self.assertIn(DEMO_ISSUER_ADDRESS.lower(), seeded)
        self.assertEqual(funded, len(seeded) - 1)
        self.assertEqual({method for method, _ in calls}, {BALANCE_METHODS[0]})
        self.assertEqual(
            {address.lower(): Decimal(int(wei, 16)) / 10**18 for _, (address, wei) in calls},
            {address: quantity for address, quantity in seeded.items() if address != DEMO_ISSUER_ADDRESS.lower()},
        )

    def plan(self):
        return build_issuance(timezone.now(), population.firms(self.found), population.candidates(self.found))

    def test_a_job_queued_by_the_last_step_runs_before_the_layer_seals_itself(self):
        plan = self.plan()
        founder = get_user_model().objects.get(email=DEMO_OWNER_EMAIL)

        with captured() as deferrals:
            records = Records(plan, self.found, deferrals)
            send_push_notification.defer(user_id=str(founder.pk), title="Balances set", body="Every wallet is funded.")
            seal(plan, records)

        self.assertEqual(issuance_state(self.found), PRESENT)
        self.assertTrue(Notification.objects.filter(user=founder, title="Balances set").exists())

    def test_a_job_the_layer_cannot_run_stops_it_before_it_seals_itself(self):
        plan = self.plan()

        with self.assertRaisesMessage(UnexpectedJob, sync_wallet.name):
            with captured() as deferrals:
                records = Records(plan, self.found, deferrals)
                sync_wallet.defer(wallet_uuid=str(uuid4()), principal_id=None)
                seal(plan, records)

        self.assertEqual(issuance_state(self.found), ABSENT)

    def test_the_summary_says_a_register_is_opened_only_once_an_opening_was_applied(self):
        address = "0x" + "e5" * 20
        ShareToken.objects.filter(company=self.found["demo-robotics"], symbol="ORD").update(
            status="deployed", contract_address=address
        )

        output = seed(investors=MINIMUM_INVESTORS)

        self.assertIn(f"Share class ORD is deployed at {address}", output)
        self.assertNotIn("register opened", output)


class Interrupted(Exception):
    pass


class DeferralCaptureTest(SimpleTestCase):

    def test_a_job_still_queued_when_the_capture_ends_is_an_error_and_not_dropped(self):
        connector = app.connector

        with self.assertRaisesMessage(UnexpectedJob, send_push_notification.name):
            with captured():
                send_push_notification.defer(user_id="1", title="Title", body="Body")

        self.assertIs(app.connector, connector)

    def test_an_error_inside_the_capture_propagates_and_restores_both_connectors(self):
        connector, manager = app.connector, app.job_manager.connector

        with self.assertRaises(Interrupted):
            with captured():
                send_push_notification.defer(user_id="1", title="Title", body="Body")
                self.assertIsNot(app.connector, connector)
                self.assertIsNot(app.job_manager.connector, manager)
                raise Interrupted

        self.assertIs(app.connector, connector)
        self.assertIs(app.job_manager.connector, manager)


class ChainGuardTest(TestCase):

    def test_any_chain_but_the_local_one_is_refused_before_the_network(self):
        with patch(NODE) as rpc:
            refusal = chain_refusal()

        self.assertIn("BLOCKCHAIN_CHAIN_ID is 84532", refusal)
        self.assertFalse(rpc.called)

    @override_settings(**{**CHAIN, "STABLECOIN_CONTRACT_ADDRESS": "", "ATOMIC_SWAP_ADDRESS": ""})
    def test_missing_contract_settings_are_named(self):
        self.assertEqual(chain_refusal(), "STABLECOIN_CONTRACT_ADDRESS, ATOMIC_SWAP_ADDRESS are not set.")

    @override_settings(**{**CHAIN, "ATOMIC_SWAP_ADDRESS": "0x" + "c3" * 19})
    def test_a_malformed_contract_setting_is_named_before_the_network(self):
        with patch(NODE) as rpc:
            self.assertEqual(chain_refusal(), MALFORMED.format(names="ATOMIC_SWAP_ADDRESS"))
        self.assertFalse(rpc.called)

    @override_settings(**{**CHAIN, "WALLET_CHAIN_FINALITY_POLICIES": {}})
    def test_a_chain_without_a_finality_depth_is_refused(self):
        self.assertEqual(chain_refusal(), NO_FINALITY)

    @override_settings(**CHAIN)
    def test_an_operator_signer_that_is_not_admitted_is_refused_before_the_network(self):
        with patch(NODE) as rpc:
            self.assertEqual(chain_refusal(), NOT_ADMITTED.format(local=31337))
        self.assertFalse(rpc.called)

    @override_settings(**CHAIN)
    def test_the_node_must_answer_the_local_chain_with_the_core_contracts(self):
        SigningAccount.objects.create(
            chain_id=31337, address=operator_address().lower(), admission_state="admitted", admission_generation=1
        )
        cases = (
            (patch(NODE, side_effect=ConnectionError("refused")), UNREACHABLE),
            (patch(NODE, node(chain_id=84532)), WRONG_CHAIN.format(chain_id=84532, local=31337)),
            (patch(NODE, node(code="0x")), NO_CODE.format(name="SHARE_TOKEN_FACTORY_ADDRESS")),
            (patch(NODE, node()), None),
        )
        for stub, expected in cases:
            with self.subTest(expected=expected), stub:
                self.assertEqual(chain_refusal(), expected)

    def test_a_skipped_layer_reports_its_reason(self):
        with patch("shared.seeds.synthetic.chain.layer.chain_refusal", return_value="No node answers."):
            outcome = seed_issuance(timezone.now())

        self.assertEqual((outcome.state, outcome.reason), (SKIPPED, f"No node answers. {GET_THE_CHAIN}"))
