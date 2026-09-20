import json
from copy import deepcopy
from io import StringIO
from unittest.mock import Mock, patch
from uuid import uuid4

from django.core.management import call_command
from django.test import SimpleTestCase, TransactionTestCase, override_settings

from tokens.exceptions import RegisterUnavailableException
from tokens.models import RegisterEntry, ShareRegister, ShareToken
from tokens.services import deployment, register_snapshot
from tokens.services.register_snapshot import ZERO_ADDRESS, RegisterSnapshotTarget
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    DeploymentNode,
    admitted_signer,
    deployment_token,
)

ALICE = "0x" + "1" * 40
BOB = "0x" + "2" * 40
POLICIES = {f"evm:{CHAIN_ID}": {"mode": "finalized"}}


def block_hash(height):
    return "0x" + f"{height:064x}"


def target():
    return RegisterSnapshotTarget(uuid4(), uuid4(), uuid4(), CHAIN_ID, CREATED, block_hash(999), 2, block_hash(2))


def transfer(height, sender, recipient, shares, index=0):
    return {
        "address": CREATED,
        "args": {"from": sender, "to": recipient, "value": shares},
        "blockNumber": height,
        "blockHash": block_hash(height),
        "transactionHash": block_hash(100 + height),
        "logIndex": index,
        "removed": False,
    }


class SnapshotNode:
    def __init__(self):
        self.target = target()
        self.finalized = 4
        self.latest = 6
        self.blocks = {
            height: {"number": height, "hash": block_hash(height), "timestamp": 1_789_862_400 + height}
            for height in range(20)
        }
        self.events = [transfer(2, ZERO_ADDRESS, ALICE, 100), transfer(3, ALICE, BOB, 20)]
        self.balances = {ALICE: 80, BOB: 20}
        self.client = Mock(spec=["assert_expected_chain", "w3", "load_contract", "send_transaction"])
        self.client.assert_expected_chain.return_value = CHAIN_ID
        self.client.w3.eth.get_block.side_effect = self.block
        self.contract = self.client.load_contract.return_value
        self.contract.functions.decimals.return_value.call.return_value = 0
        self.contract.functions.totalSupply.return_value.call.return_value = 100
        self.contract.functions.authorizedShares.return_value.call.return_value = 1000
        for name in ("decimals", "totalSupply", "authorizedShares"):
            getattr(self.contract.functions, name).return_value._encode_transaction_data.return_value = name
        self.contract.events.Transfer.return_value.get_logs.side_effect = lambda **kwargs: deepcopy(self.events)
        self.contract.functions.balanceOf.side_effect = self.balance
        self.client.w3.eth.call.side_effect = self.contract_read
        self.balance_reads = []

    def block(self, identifier):
        height = self.finalized if identifier == "finalized" else self.latest if identifier == "latest" else identifier
        return dict(self.blocks[height])

    def balance(self, address):
        def read(**kwargs):
            self.balance_reads.append((address, kwargs))
            return self.balances[address]

        return Mock(call=Mock(side_effect=read), _encode_transaction_data=Mock(return_value="balance:" + address))

    def contract_read(self, transaction, **kwargs):
        data = transaction["data"]
        if data.startswith("balance:"):
            address = data.removeprefix("balance:")
            self.balance_reads.append((address, kwargs))
            value = self.balances[address]
        else:
            value = getattr(self.contract.functions, data).return_value.call.return_value
        return value.to_bytes(32, "big") if type(value) is int and 0 <= value < 2**256 else value

    def capture(self):
        return register_snapshot.read_snapshot(self.target, client=self.client)


@override_settings(WALLET_CHAIN_FINALITY_POLICIES=POLICIES)
class RegisterSnapshotReadTest(SimpleTestCase):
    def setUp(self):
        self.node = SnapshotNode()

    def test_snapshot_reconciles_at_one_finalized_hash_instead_of_the_moving_head(self):
        result = self.node.capture()
        self.assertEqual(result["block"]["number"], 4)
        self.assertEqual(result["block"]["hash"], block_hash(4))
        self.assertEqual((result["issued_supply"], result["authorized_supply"]), ("100", "1000"))
        self.assertEqual(result["holdings"], [{"address": ALICE, "shares": "80"}, {"address": BOB, "shares": "20"}])
        self.assertNotIn("transfers", result)
        self.assertEqual(result["deployment_transaction"], self.node.target.deployment_tx_hash)
        for function in ("decimals", "totalSupply", "authorizedShares"):
            getattr(self.node.contract.functions, function).return_value.call.assert_not_called()
        self.assertEqual(self.node.client.w3.eth.call.call_count, 5)
        for rpc in self.node.client.w3.eth.call.call_args_list:
            self.assertEqual(rpc.kwargs["block_identifier"], {"blockHash": block_hash(4), "requireCanonical": True})
            self.assertFalse(rpc.kwargs["ccip_read_enabled"])
        self.assertEqual({address for address, _ in self.node.balance_reads}, {ALICE, BOB})
        self.node.contract.events.Transfer.return_value.get_logs.assert_called_once_with(from_block=2, to_block=4)

    def test_empty_history_is_only_an_empty_register_when_supply_is_zero(self):
        self.node.events = []
        with self.assertRaisesMessage(RegisterUnavailableException, "supply"):
            self.node.capture()
        self.node.contract.functions.totalSupply.return_value.call.return_value = 0
        result = self.node.capture()
        self.assertEqual((result["holdings"], result["issued_supply"]), ([], "0"))

    def test_a_former_participants_zero_balance_is_checked(self):
        self.node.events[1]["args"]["value"] = 100
        self.node.balances = {ALICE: 0, BOB: 100}
        self.assertEqual(self.node.capture()["holdings"], [{"address": BOB, "shares": "100"}])
        self.assertEqual({address for address, _ in self.node.balance_reads}, {ALICE, BOB})
        self.node.balances[ALICE] = 1
        with self.assertRaisesMessage(RegisterUnavailableException, "participant balance"):
            self.node.capture()

    def test_large_share_quantities_never_pass_through_float(self):
        shares = 2**200 + 13
        self.node.events = [transfer(2, ZERO_ADDRESS, ALICE, shares)]
        self.node.balances = {ALICE: shares}
        for function in ("totalSupply", "authorizedShares"):
            getattr(self.node.contract.functions, function).return_value.call.return_value = shares
        self.assertEqual(self.node.capture()["holdings"][0]["shares"], str(shares))

    def test_burn_and_self_transfer_reconcile_without_counting_zero_address_as_a_holder(self):
        self.node.events += [transfer(4, BOB, BOB, 5), transfer(4, BOB, ZERO_ADDRESS, 5, index=1)]
        self.node.balances[BOB] = 15
        self.node.contract.functions.totalSupply.return_value.call.return_value = 95
        result = self.node.capture()
        self.assertEqual(result["issued_supply"], "95")
        self.assertNotIn(ZERO_ADDRESS, {row["address"] for row in result["holdings"]})

    def test_missing_transfer_is_detected_by_the_pinned_balances(self):
        self.node.events.pop()
        with self.assertRaisesMessage(RegisterUnavailableException, "participant balance"):
            self.node.capture()

    def test_missing_mint_is_detected_before_a_transfer_can_create_negative_holdings(self):
        self.node.events.pop(0)
        with self.assertRaisesMessage(RegisterUnavailableException, "never received"):
            self.node.capture()

    def test_duplicate_event_is_not_silently_deduplicated(self):
        self.node.events.append(deepcopy(self.node.events[0]))
        with self.assertRaisesMessage(RegisterUnavailableException, "repeats"):
            self.node.capture()

    def test_state_neutral_log_gaps_cannot_be_presented_as_a_complete_event_history(self):
        for neutral in (
            [transfer(4, ALICE, ALICE, 10)],
            [transfer(4, ALICE, BOB, 5), transfer(4, BOB, ALICE, 5, index=1)],
        ):
            with self.subTest(neutral=neutral):
                node = SnapshotNode()
                node.events.extend(neutral)
                all_observed = node.capture()
                node.events = node.events[:2]
                omitted = node.capture()
                self.assertEqual(all_observed["holdings"], omitted["holdings"])
                self.assertEqual(all_observed["issued_supply"], omitted["issued_supply"])
                self.assertNotIn("transfers", omitted)
                self.assertEqual(all_observed, omitted)

    def test_wrong_contract_removed_or_out_of_range_log_is_refused(self):
        for field, value in (("address", ALICE), ("removed", True), ("blockNumber", 5), ("blockNumber", 1)):
            with self.subTest(field=field, value=value):
                node = SnapshotNode()
                node.events[0][field] = value
                with self.assertRaisesMessage(RegisterUnavailableException, "range"):
                    node.capture()

    def test_invalid_integer_event_quantities_are_refused(self):
        for value in (True, -1, 1.5, "100", 2**256):
            with self.subTest(value=value):
                self.node.events[0]["args"]["value"] = value
                with self.assertRaises(RegisterUnavailableException):
                    self.node.capture()

    def test_unknown_balance_and_supply_above_authorized_are_refused(self):
        self.node.balances[BOB] = None
        with self.assertRaises(RegisterUnavailableException):
            self.node.capture()
        self.node.balances[BOB] = 20
        self.node.contract.functions.authorizedShares.return_value.call.return_value = 99
        with self.assertRaisesMessage(RegisterUnavailableException, "supply"):
            self.node.capture()

    def test_nonzero_decimals_are_not_presented_as_whole_shares(self):
        self.node.contract.functions.decimals.return_value.call.return_value = 18
        with self.assertRaisesMessage(RegisterUnavailableException, "whole-share"):
            self.node.capture()

    def test_noncanonical_event_block_is_refused_even_when_totals_match(self):
        self.node.events[1]["blockHash"] = block_hash(19)
        with self.assertRaisesMessage(RegisterUnavailableException, "noncanonical"):
            self.node.capture()

    def test_boundary_reorg_during_capture_refuses_the_result(self):
        original = self.node.block
        reads = 0

        def read(identifier):
            nonlocal reads
            result = original(identifier)
            if identifier == 4:
                reads += 1
                if reads == 2:
                    result["hash"] = block_hash(18)
            return result

        self.node.client.w3.eth.get_block.side_effect = read
        with self.assertRaisesMessage(RegisterUnavailableException, "changed during"):
            self.node.capture()

    def test_chain_change_during_capture_refuses_the_result(self):
        self.node.client.assert_expected_chain.side_effect = [CHAIN_ID, CHAIN_ID + 1]
        with self.assertRaisesMessage(RegisterUnavailableException, "changed during"):
            self.node.capture()

    def test_original_chain_and_deployment_block_must_still_match(self):
        self.node.client.assert_expected_chain.return_value = CHAIN_ID + 1
        with self.assertRaisesMessage(RegisterUnavailableException, "original deployment chain"):
            self.node.capture()
        self.node.client.assert_expected_chain.return_value = CHAIN_ID
        self.node.blocks[2]["hash"] = block_hash(18)
        with self.assertRaisesMessage(RegisterUnavailableException, "attribution"):
            self.node.capture()

    def test_unfinalized_deployment_and_missing_policy_are_refused(self):
        self.node.finalized = 1
        with self.assertRaisesMessage(RegisterUnavailableException, "deployment"):
            self.node.capture()
        with self.settings(WALLET_CHAIN_FINALITY_POLICIES={}):
            with self.assertRaisesMessage(RegisterUnavailableException, "approved finality"):
                self.node.capture()

    def test_depth_policy_chooses_the_last_block_with_the_required_confirmations(self):
        with self.settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 3}}):
            self.assertEqual(self.node.capture()["block"]["number"], 4)

    def test_provider_cannot_return_another_height_for_a_requested_block(self):
        self.node.blocks[4]["number"] = 5
        with self.assertRaises(RegisterUnavailableException):
            self.node.capture()


def snapshot_fixture():
    tenant = deployment_token("snapshot")
    deployment_node = DeploymentNode()
    admitted_signer()
    with (
        patch("tokens.services.deployment.get_base_chain_client", return_value=deployment_node.client),
        patch("tokens.services.share_token_service.get_base_chain_client", return_value=deployment_node.client),
    ):
        deployment.deploy_token(tenant.token)
    snapshot_target = register_snapshot._target(tenant.token.pk)
    node = SnapshotNode()
    node.target = snapshot_target
    height = snapshot_target.deployment_block
    node.finalized = height
    node.blocks[height] = {"number": height, "hash": snapshot_target.deployment_hash, "timestamp": 1_789_862_400}
    node.events = []
    node.contract.functions.totalSupply.return_value.call.return_value = 0
    return tenant, snapshot_target, node


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    WALLET_CHAIN_FINALITY_POLICIES=POLICIES,
)
class RegisterSnapshotCommandTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.target, self.node = snapshot_fixture()

    def test_operator_command_reads_attributed_deployment_without_creating_a_register(self):
        output = StringIO()
        with patch("tokens.services.register_snapshot.get_base_chain_client", return_value=self.node.client):
            call_command("register_snapshot", token=self.tenant.token.pk, stdout=output)
        data = json.loads(output.getvalue())
        self.assertEqual(
            (data["token"], data["deployment"]), (str(self.target.token_id), str(self.target.deployment_id))
        )
        self.assertEqual(data["issued_supply"], "0")
        self.assertFalse(ShareRegister.objects.exists())
        self.assertFalse(RegisterEntry.objects.exists())
        self.node.client.send_transaction.assert_not_called()

    def test_unattributed_legacy_token_is_refused_before_provider_io(self):
        token = ShareToken.objects.create(company=self.tenant.company, name="Legacy", symbol="LEG", total_supply="100")
        with self.assertRaisesMessage(RegisterUnavailableException, "attributed deployment"):
            register_snapshot.capture_snapshot(token.pk, client=self.node.client)
        self.node.client.assert_expected_chain.assert_not_called()

    def test_provider_failure_is_actionable_without_leaking_its_exception_text(self):
        self.node.client.w3.eth.get_block.side_effect = RuntimeError("private endpoint response")
        with self.assertRaises(RegisterUnavailableException) as error:
            register_snapshot.capture_snapshot(self.tenant.token.pk, client=self.node.client)
        self.assertNotIn("private endpoint", str(error.exception))
