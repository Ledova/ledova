import time
from collections import ChainMap
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from importlib import import_module
from queue import Queue
from threading import Barrier, Event
from unittest.mock import patch
from uuid import uuid4

from django.contrib import admin
from django.db import DatabaseError, connection, connections
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from companies.models import Company, CompanyStatus
from companies.services.administration import company_operation
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    admit_company_administrator,
)
from integrations.base_chain.exceptions import BaseChainConnectionError
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.exceptions import RegisterChangeConflict, RegisterUnavailableException
from tokens.models import (
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    RegisterOpeningDecision,
    ShareRegister,
)
from tokens.serializers.register_opening import RegisterOpeningSerializer
from tokens.services import deployment, register_snapshot
from tokens.services.register_events import (
    create_member,
    open_register,
    verify_register,
)
from tokens.services.register_evidence import evidence_snapshot
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening,
    preview_opening_decision,
)
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    FACTORY,
    KEY,
    DeploymentNode,
    admitted_signer,
)
from tokens.tests.evidence_fixtures import staff_user, upload_evidence
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_snapshot import SnapshotNode, block_hash, transfer

ALICE = "0x" + "1" * 40
BOB = "0x" + "2" * 40
CY = "0x" + "3" * 40
POLICIES = {f"evm:{CHAIN_ID}": {"mode": "finalized"}}
SETTINGS = dict(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    WALLET_CHAIN_FINALITY_POLICIES=POLICIES,
)
OPENINGS = "/api/v1/tokens/register-openings/"


def deployed_class():
    tenant = make_tenant("opening")
    administrator = admit_company_administrator(tenant.company)
    with use_migrate():
        Company.objects.filter(pk=tenant.company.pk).update(status=CompanyStatus.ACTIVE)
        tenant.company.refresh_from_db()
    with patch("tokens.tasks.deploy_share_token_task.defer"):
        deployment.start_deployment(tenant.token, principal_id=tenant.user.pk)
    deployment_node = DeploymentNode()
    admitted_signer()
    with (
        patch("tokens.services.deployment.get_base_chain_client", return_value=deployment_node.client),
        patch("tokens.services.share_token_service.get_base_chain_client", return_value=deployment_node.client),
    ):
        deployment.deploy_token(tenant.token)
    target = register_snapshot._target(tenant.token.pk)
    node = SnapshotNode()
    node.target = target
    height = target.deployment_block
    node.finalized = height + 2
    node.blocks = {
        h: {
            "number": h,
            "hash": target.deployment_hash if h == height else block_hash(h),
            "timestamp": 1_789_862_400 + h,
        }
        for h in (height, height + 1, height + 2)
    }
    node.events = [transfer(height + 1, ZERO_ADDRESS, ALICE, 100), transfer(height + 2, ALICE, BOB, 20)]
    node.balances = {ALICE: 80, BOB: 20}
    node.contract.functions.totalSupply.return_value.call.return_value = 100
    node.contract.functions.authorizedShares.return_value.call.return_value = 1000
    owner = tenant.user
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    return tenant, owner, administrator, target, node


def opening_fixture():
    tenant, owner, administrator, target, node = deployed_class()
    evidence = upload_evidence(owner, administrator, RegisterEvidenceKind.AUTHORITY)
    return tenant, owner, administrator, evidence, target, node


def offline_boundary(token):
    return {
        "version": 1,
        "token": str(token.pk),
        "company": str(token.company_id),
        "deployment": str(uuid4()),
        "chain_id": CHAIN_ID,
        "contract_address": token.contract_address or "0x" + "4" * 40,
        "deployment_transaction": "0x" + "ab" * 32,
        "deployment_block": 1,
        "deployment_hash": "0x" + "cd" * 32,
        "block": {"number": 2, "hash": "0x" + "ef" * 32, "timestamp": 1_789_862_402, "date": "2026-09-20"},
        "policy": {"version": 1, "mode": "finalized"},
        "issued_supply": "0",
        "authorized_supply": str(token.total_supply),
        "holdings": [],
        "history": [],
    }


def reading(test, node):
    for module in ("register_openings", "register_snapshot"):
        test.enterContext(patch(f"tokens.services.{module}.get_base_chain_client", return_value=node.client))


def opening_payload(token_id, evidence, appointment, *, members=None, mapping=None, **changes):
    if members is None:
        members = [uuid4(), uuid4()]
    if mapping is None:
        mapping = [
            {"address": ALICE, "member": str(members[0])},
            {"address": BOB, "member": str(members[1])},
        ]
    return {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "token_id": token_id,
        "authority_evidence": evidence.pk,
        "mapping": mapping,
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-OPENING-1",
        "reason": "Establish the register from the attributed deployment boundary",
        **changes,
    }


def prepared(actor, payload):
    return prepare_opening(actor=actor, **payload)[0]


def linked_member(company, address, name):
    from tokens.tests.test_register_imports import live_wallet

    member = create_member(company_id=company.pk, member_id=uuid4())
    live_wallet(company, member, address, name)
    return member


def preview(actor, appointment, proposal, kind, reason=""):
    return preview_opening_decision(
        actor=actor, opening_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=reason
    )[1]


def decide(actor, appointment, proposal, kind, reason="", idempotency_key=None):
    return decide_opening(
        actor=actor,
        opening_id=proposal.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=idempotency_key or uuid4(),
        preview_digest=preview(actor, appointment, proposal, kind, reason)["preview_digest"],
        confirmation=True,
        reason=reason,
    )


def apply_opening(actor, appointment, proposal):
    decide(actor, appointment, proposal, "approve")
    return decide(actor, appointment, proposal, "apply")


def decision_digest(proposal, kind, actor, appointment, reason=""):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_register_opening_decision_digest(%s, %s, %s, %s, %s)",
            [proposal.pk, kind, actor.pk, appointment.pk, reason],
        )
        return cursor.fetchone()[0]


def forge_decision(proposal, kind, actor, appointment, reason="", digest=None, decided_by=None):
    with company_operation(actor, proposal.company_id, f"register_opening_{kind}"), atomic():
        decision = RegisterOpeningDecision.objects.create(
            register_opening=proposal,
            kind=kind,
            decided_by=decided_by or actor,
            appointment=appointment,
            idempotency_key=uuid4(),
            digest=digest or decision_digest(proposal, kind, actor, appointment, reason),
            reason=reason,
            decided_at=timezone.now(),
        )
        decision.refresh_from_db()
    return decision


def forge_outcome(proposal, actor, decision, **fields):
    with company_operation(actor, proposal.company_id, f"register_opening_{decision.kind}"), atomic():
        RegisterOpening.objects.filter(pk=proposal.pk).update(
            reviewed_by=actor, reviewed_at=decision.decided_at, **fields
        )


def forged_fields(proposal):
    return {
        field.name: getattr(proposal, field.name)
        for field in RegisterOpening._meta.fields
        if field.name not in ("uuid", "created_at", "updated_at", "file")
    }


def insert_forged(fields, actor, operation="register_opening_prepare", scope=None, **changes):
    forged_id = uuid4()
    company_id = fields["company"].pk
    with company_operation(actor, scope or company_id, operation), atomic():
        RegisterOpening.objects.create(
            **{
                **fields,
                "uuid": forged_id,
                "file": f"companies/{company_id}/register-openings/{forged_id}/{uuid4()}.bin",
                **changes,
            }
        )


def rewritten(proposal, **fields):
    with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
        cursor.execute("ALTER TABLE tokens_registeropening DISABLE TRIGGER tokens_register_opening_identity")
        try:
            RegisterOpening.objects.filter(pk=proposal.pk).update(**fields)
        finally:
            cursor.execute("ALTER TABLE tokens_registeropening ENABLE TRIGGER tokens_register_opening_identity")
    with use_operator():
        proposal.refresh_from_db()
    return proposal


def staff_era(proposal, **fields):
    return rewritten(proposal, preparing_appointment=None, authority_evidence=None, source_document=uuid4(), **fields)


@override_settings(**SETTINGS)
class RegisterOpeningTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.owner, self.administrator, self.evidence, self.target, self.node = opening_fixture()
        reading(self, self.node)
        self.payload = opening_payload(self.target.token_id, self.evidence, self.administrator)

    def submit(self, **changes):
        return prepared(self.owner, {**self.payload, **changes})

    def preview(self, proposal, kind="apply", reason=""):
        return preview(self.owner, self.administrator, proposal, kind, reason)

    def decide(self, proposal, kind, reason="", **options):
        return decide(self.owner, self.administrator, proposal, kind, reason, **options)

    def apply(self, proposal):
        return apply_opening(self.owner, self.administrator, proposal)

    def unmet(self, proposal, kind="apply"):
        return self.preview(proposal, kind)["unmet_requirements"]

    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def assert_boundary_refused(self, proposal, boundary, **changes):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaises(DatabaseError), atomic():
                insert_forged(forged_fields(proposal), self.owner, boundary=boundary, **changes)
            raise RuntimeError("rollback")

    def test_preparation_captures_the_boundary_and_keeps_its_own_copy_of_the_upload(self):
        proposal = self.submit()
        boundary = proposal.boundary
        self.assertEqual(proposal.status, "submitted")
        self.assertEqual(boundary["block"]["number"], self.target.deployment_block + 2)
        self.assertEqual(boundary["holdings"], [{"address": ALICE, "shares": "80"}, {"address": BOB, "shares": "20"}])
        self.assertEqual((boundary["policy"]["mode"], len(boundary["history"])), ("finalized", 2))
        self.assertEqual(
            proposal.mapping,
            [
                {"address": ALICE, "member": self.payload["mapping"][0]["member"]},
                {"address": BOB, "member": self.payload["mapping"][1]["member"]},
            ],
        )
        self.assertEqual(
            (
                proposal.preparing_appointment_id,
                proposal.authority_evidence_id,
                proposal.source_document,
                proposal.evidence_fingerprint,
                proposal.evidence_snapshot,
            ),
            (self.administrator.pk, self.evidence.pk, None, self.evidence.sha256, evidence_snapshot(self.evidence)),
        )
        self.assertNotEqual(proposal.file.name, self.evidence.file.name)
        with proposal.file.open("rb") as kept, self.evidence.file.open("rb") as uploaded:
            self.assertEqual(kept.read(), uploaded.read())
        self.assertFalse(RegisterMember.objects.exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())
        self.assertFalse(ShareRegister.objects.filter(token=self.tenant.token).exists())
        self.node.client.w3.eth.get_block.side_effect = RuntimeError("provider offline")
        self.assertEqual(prepare_opening(actor=self.owner, **self.payload), (proposal, False))
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).boundary, boundary)

    def test_preparation_refuses_strangers_undeployed_classes_and_initialised_registers(self):
        stranger, _, _, _, _, _ = register_fixture()
        with self.assertRaisesMessage(NotFound, "Share class not found"):
            prepared(stranger, self.payload)
        token = self.tenant.token
        token.status = "deploying"
        token.save(update_fields=["status"])
        self.node.client.w3.eth.get_block.reset_mock()
        with self.assertRaisesMessage(ValidationError, "requires a deployed share class"):
            self.submit()
        self.node.client.w3.eth.get_block.assert_not_called()
        token.status = "deployed"
        token.save(update_fields=["status"])
        open_register(token_id=token.pk, operation_id=uuid4(), changes=[], effective_on=DAY, recorded_by=self.owner)
        with self.assertRaisesMessage(ValidationError, "already has a stored register"):
            self.submit()
        self.assertFalse(RegisterOpening.objects.exists())

    def test_a_register_opened_while_the_boundary_is_read_refuses_the_preparation(self):
        capture = register_snapshot.capture_snapshot

        def capture_then_open(token_id, client=None):
            boundary = capture(token_id, client=client)
            open_register(token_id=token_id, operation_id=uuid4(), changes=[], effective_on=DAY, recorded_by=self.owner)
            return boundary

        with patch("tokens.services.register_openings.capture_snapshot", side_effect=capture_then_open):
            with self.assertRaisesMessage(ValidationError, "already has a stored register"):
                self.submit()
        self.assertFalse(RegisterOpening.objects.exists())

    def test_preparation_refuses_ambiguous_mappings_foreign_members_and_addresses_linked_elsewhere(self):
        _, _, _, foreign_member, _, _ = register_fixture()
        with self.assertRaisesMessage(ValidationError, "must belong to this company"):
            self.submit(
                mapping=[
                    {"address": ALICE, "member": str(foreign_member.pk)},
                    {"address": BOB, "member": str(uuid4())},
                ]
            )
        member = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        RegisterMemberWallet.objects.create(company=self.tenant.company, member=member, address=ALICE.lower())
        with self.assertRaisesMessage(ValidationError, "already belongs to another member"):
            self.submit()
        for mapping in (
            "not-a-list",
            [{"address": ALICE}],
            [{"address": ALICE, "member": str(uuid4()), "extra": "1"}],
            [{"address": "0x123", "member": str(uuid4())}],
            [{"address": ALICE, "member": "not-a-uuid"}],
            [{"address": ALICE, "member": str(uuid4())}, {"address": ALICE.upper(), "member": str(uuid4())}],
        ):
            with self.subTest(mapping=mapping), self.assertRaises(ValidationError):
                self.submit(mapping=mapping)
        self.assertFalse(RegisterOpening.objects.exists())
        agreeing = self.submit(
            mapping=[{"address": ALICE, "member": str(member.pk)}, {"address": BOB, "member": str(uuid4())}]
        )
        self.assertEqual(agreeing.status, "submitted")

    def test_the_mapping_must_cover_exactly_the_holders_at_the_boundary(self):
        for mapping in (
            [{"address": ALICE, "member": str(uuid4())}],
            [
                {"address": ALICE, "member": str(uuid4())},
                {"address": BOB, "member": str(uuid4())},
                {"address": "0x" + "3" * 40, "member": str(uuid4())},
            ],
        ):
            with self.subTest(mapping=mapping):
                with self.assertRaisesMessage(ValidationError, "cover exactly the wallet addresses holding shares"):
                    self.submit(operation_id=uuid4(), mapping=mapping)
        self.assertFalse(RegisterOpening.objects.exists())

    def test_a_resolution_names_its_director_and_a_court_order_is_distinct(self):
        for changes in (
            {"approving_director": ""},
            {"authority": "court_order"},
            {"authority_reference": " "},
            {"reason": ""},
            {"authority": "ordinary_resolution"},
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(ValidationError, "approving director"):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterOpening.objects.exists())
        proposal = self.submit(authority="court_order", approving_director="", authority_reference="SYNTHETIC-COURT-1")
        self.assertEqual(self.apply(proposal).authority, "court_order")

    def test_application_opens_the_register_from_the_boundary_with_members_wallets_and_positions(self):
        proposal = self.submit()
        changes = sorted(
            [
                {"member": self.payload["mapping"][0]["member"], "shares": "80"},
                {"member": self.payload["mapping"][1]["member"], "shares": "20"},
            ],
            key=lambda change: change["member"],
        )
        effective_on = date.fromisoformat(proposal.boundary["block"]["date"])
        self.assertEqual(
            {key: value for key, value in self.preview(proposal, "approve").items() if key != "preview_digest"},
            {"unmet_requirements": [], "can_decide": True, "changes": changes, "effective_on": effective_on},
        )
        applied = self.apply(proposal)
        entry = applied.applied_entry
        self.assertEqual(
            (entry.kind, entry.sequence, entry.previous_hash, entry.operation_id, entry.corrects_id),
            ("opening", 1, "0" * 64, proposal.pk, None),
        )
        self.assertEqual(
            (entry.effective_on, entry.changes, entry.recorded_by_id), (effective_on, changes, self.owner.pk)
        )
        self.assertEqual(
            (applied.status, applied.reviewed_by_id, list(applied.decisions.values_list("kind", flat=True))),
            ("applied", self.owner.pk, ["approve", "apply"]),
        )
        self.assertEqual(applied.reviewed_at, applied.decisions.get(kind="apply").decided_at)
        self.assertEqual(RegisterMember.objects.count(), 2)
        for link in applied.mapping:
            wallet = RegisterMemberWallet.objects.get(company=self.tenant.company, address=link["address"])
            self.assertEqual(str(wallet.member_id), link["member"])
        result = verify_register(entry.register_id)
        self.assertEqual((result["entries"], result["members"], result["issued_supply"]), (1, 2, "100"))
        with self.assertRaisesMessage(ValidationError, "already has a stored register"):
            self.submit(operation_id=uuid4())
        with self.assertRaisesMessage(ValidationError, "opening_decided"):
            self.decide(proposal, "reject", "Too late")

    def test_an_empty_boundary_creates_an_explicit_empty_opening(self):
        self.node.events = []
        self.node.balances = {}
        self.node.contract.functions.totalSupply.return_value.call.return_value = 0
        applied = self.apply(self.submit(mapping=[]))
        self.assertEqual(applied.applied_entry.changes, [])
        result = verify_register(applied.applied_entry.register_id)
        self.assertEqual((result["entries"], result["members"], result["issued_supply"]), (1, 0, "0"))

    def test_a_changed_boundary_keeps_the_opening_from_approval_and_application(self):
        proposal = self.submit()
        boundary = proposal.boundary
        orphaned = self.node.blocks[boundary["block"]["number"]]
        orphaned["hash"] = block_hash(19)
        self.assertEqual(self.unmet(proposal, "approve"), ["boundary_changed"])
        with self.assertRaisesMessage(ValidationError, "boundary_changed"):
            self.decide(proposal, "approve")
        orphaned["hash"] = boundary["block"]["hash"]
        self.node.client.assert_expected_chain.return_value = CHAIN_ID + 1
        self.assertEqual(self.unmet(proposal, "approve"), ["boundary_changed"])
        self.node.client.assert_expected_chain.return_value = CHAIN_ID
        self.decide(proposal, "approve")
        with self.settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 1}}):
            self.assertEqual(self.unmet(proposal), ["boundary_changed"])
        self.node.finalized = boundary["block"]["number"] - 1
        self.assertEqual(self.unmet(proposal), ["boundary_changed"])
        with self.assertRaisesMessage(ValidationError, "boundary_changed"):
            self.decide(proposal, "apply")
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterEntry.objects.exists())
        rejected = self.decide(proposal, "reject", "The boundary is no longer canonical")
        self.assertEqual((rejected.status, rejected.applied_entry_id), ("rejected", None))

    def test_a_depth_boundary_the_current_head_no_longer_covers_has_changed(self):
        with self.settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 1}}):
            self.node.latest = self.target.deployment_block + 2
            proposal = self.submit()
            self.assertEqual(
                (proposal.boundary["block"]["number"], proposal.boundary["policy"]["mode"]),
                (self.node.latest, "depth"),
            )
            self.assertEqual(self.unmet(proposal, "approve"), [])
            self.node.latest = proposal.boundary["block"]["number"] - 2
            self.assertEqual(self.unmet(proposal, "approve"), ["boundary_changed"])

    def test_the_boundary_recheck_accepts_provider_mapping_blocks(self):
        proposal = self.submit()
        original = self.node.block
        self.node.client.w3.eth.get_block.side_effect = lambda identifier: ChainMap(original(identifier))
        self.assertEqual(self.apply(proposal).status, "applied")

    def test_an_unreadable_chain_refuses_preparation_approval_and_application_as_unavailable(self):
        proposal = self.submit()
        self.node.client.w3.eth.get_block.side_effect = RuntimeError("private endpoint response")
        for kind in ("approve", "apply"):
            with self.subTest(kind=kind), self.assertRaises(RegisterUnavailableException) as refused:
                self.preview(proposal, kind)
            self.assertNotIn("private endpoint", str(refused.exception))
        with self.assertRaises(RegisterUnavailableException):
            decide_opening(
                actor=self.owner,
                opening_id=proposal.pk,
                appointment=self.administrator.pk,
                kind="approve",
                idempotency_key=uuid4(),
                preview_digest="0" * 64,
                confirmation=True,
            )
        with self.assertRaises(RegisterUnavailableException):
            self.submit(operation_id=uuid4())
        self.assertFalse(RegisterOpeningDecision.objects.exists())
        self.assertEqual(RegisterOpening.objects.count(), 1)
        rejected = self.decide(proposal, "reject", "The chain cannot be read")
        self.assertEqual(rejected.status, "rejected")

    def test_a_provider_that_cannot_be_built_refuses_as_unavailable_without_its_detail(self):
        proposal = self.submit()
        failure = BaseChainConnectionError("private endpoint connection details")
        for module in ("register_openings", "register_snapshot"):
            self.enterContext(patch(f"tokens.services.{module}.get_base_chain_client", side_effect=failure))
        for attempt in (lambda: self.preview(proposal, "approve"), lambda: self.submit(operation_id=uuid4())):
            with self.assertRaises(RegisterUnavailableException) as refused:
                attempt()
            self.assertNotIn("private endpoint", str(refused.exception))
        self.assertEqual(self.decide(proposal, "reject", "The chain cannot be reached").status, "rejected")

    def test_an_identical_decision_retry_needs_no_provider(self):
        proposal = self.submit()
        get_block = self.node.client.w3.eth.get_block
        approval, application = uuid4(), uuid4()
        approved = self.decide(proposal, "approve", idempotency_key=approval)
        retry = {
            "actor": self.owner,
            "opening_id": proposal.pk,
            "appointment": self.administrator.pk,
            "kind": "approve",
            "idempotency_key": approval,
            "preview_digest": approved.decisions.get(kind="approve").digest,
            "confirmation": True,
        }
        get_block.side_effect = RuntimeError("provider offline")
        self.assertEqual(decide_opening(**retry).status, "submitted")
        with self.assertRaises(RegisterChangeConflict):
            decide_opening(**{**retry, "preview_digest": "0" * 64})
        get_block.side_effect = self.node.block
        applied = self.decide(proposal, "apply", idempotency_key=application)
        get_block.side_effect = RuntimeError("provider offline")
        retried = decide_opening(
            **{
                **retry,
                "kind": "apply",
                "idempotency_key": application,
                "preview_digest": applied.decisions.get(kind="apply").digest,
            }
        )
        self.assertEqual(retried.applied_entry_id, applied.applied_entry_id)
        self.assertEqual(RegisterOpeningDecision.objects.filter(register_opening=proposal).count(), 2)

    def test_a_register_initialised_after_preparation_refuses_approval_and_application(self):
        approved = self.submit()
        waiting = self.submit(operation_id=uuid4())
        self.decide(approved, "approve")
        open_register(
            token_id=self.tenant.token.pk, operation_id=uuid4(), changes=[], effective_on=DAY, recorded_by=self.owner
        )
        self.assertEqual(self.unmet(approved), ["register_initialized"])
        self.assertEqual(self.unmet(waiting, "approve"), ["register_initialized"])
        with self.assertRaisesMessage(ValidationError, "register_initialized"):
            self.decide(approved, "apply")
        self.assertEqual(RegisterOpening.objects.get(pk=approved.pk).status, "submitted")
        self.assertEqual(self.decide(approved, "reject", "Opened another way").status, "rejected")

    def test_an_address_linked_to_another_member_after_preparation_refuses_application(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        first, second = proposal.mapping
        same = create_member(company_id=self.tenant.company.pk, member_id=first["member"])
        RegisterMemberWallet.objects.create(company=self.tenant.company, member=same, address=first["address"])
        self.assertEqual(self.unmet(proposal), [])
        other = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        RegisterMemberWallet.objects.create(
            company=self.tenant.company, member=other, address=second["address"].lower()
        )
        self.assertEqual(self.unmet(proposal), ["wallet_linked_elsewhere"])
        with self.assertRaisesMessage(ValidationError, "wallet_linked_elsewhere"):
            self.decide(proposal, "apply")
        self.assertFalse(RegisterEntry.objects.exists())

    def test_rejection_needs_a_reason_and_leaves_the_register_uninitialised(self):
        proposal = self.submit()
        with self.assertRaisesMessage(ValidationError, "reason_required"):
            self.decide(proposal, "reject")
        rejected = self.decide(proposal, "reject", "Boundary superseded")
        self.assertEqual(
            (rejected.status, rejected.rejection_reason, rejected.applied_entry_id),
            ("rejected", "Boundary superseded", None),
        )
        self.assertEqual(rejected.reviewed_at, rejected.decisions.get(kind="reject").decided_at)
        self.assertFalse(ShareRegister.objects.filter(token=self.tenant.token).exists())
        self.assertEqual(self.submit(operation_id=uuid4()).status, "submitted")

    def test_an_identical_decision_retry_returns_the_opening_and_a_changed_one_conflicts(self):
        proposal = self.submit()
        key = uuid4()
        approved = self.decide(proposal, "approve", idempotency_key=key)
        retry = {
            "actor": self.owner,
            "opening_id": proposal.pk,
            "appointment": self.administrator.pk,
            "kind": "approve",
            "idempotency_key": key,
            "preview_digest": approved.decisions.get().digest,
            "confirmation": True,
        }
        self.assertEqual(decide_opening(**retry).pk, proposal.pk)
        for changes in ({"kind": "reject", "reason": "Changed"}, {"preview_digest": "0" * 64}):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                decide_opening(**{**retry, **changes})
        self.assertEqual(RegisterOpeningDecision.objects.filter(register_opening=proposal).count(), 1)
        with self.assertRaisesMessage(ValidationError, "already_approved"):
            self.decide(proposal, "approve")
        with self.assertRaisesMessage(ValidationError, "Confirm the exact register opening decision"):
            decide_opening(**{**retry, "idempotency_key": uuid4(), "confirmation": False})
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_a_failed_application_rolls_back_members_links_the_entry_and_the_decision(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        digest = self.preview(proposal)["preview_digest"]
        with patch.object(RegisterOpening, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                decide_opening(
                    actor=self.owner,
                    opening_id=proposal.pk,
                    appointment=self.administrator.pk,
                    kind="apply",
                    idempotency_key=uuid4(),
                    preview_digest=digest,
                    confirmation=True,
                )
        proposal.refresh_from_db()
        self.assertEqual((proposal.status, proposal.decisions.count()), ("submitted", 1))
        self.assertFalse(RegisterEntry.objects.exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())
        self.assertFalse(RegisterMember.objects.exists())
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_preparation_waits_for_an_application_that_holds_the_company(self):
        proposal = self.submit()
        self.decide(proposal, "approve")
        digest = self.preview(proposal)["preview_digest"]
        held = Event()
        release = Event()
        pids = Queue()
        errors = []

        def apply_worker():
            try:
                conn = connections["default"]
                with conn.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(("apply", cursor.fetchone()[0]))

                def pause_company(execute, sql, params, many, context):
                    result = execute(sql, params, many, context)
                    if 'FROM "companies_company"' in sql and "FOR UPDATE" in sql:
                        held.set()
                        if not release.wait(timeout=10):
                            raise RuntimeError("Test synchronization timed out")
                    return result

                with conn.execute_wrapper(pause_company):
                    decide_opening(
                        actor=self.owner,
                        opening_id=proposal.pk,
                        appointment=self.administrator.pk,
                        kind="apply",
                        idempotency_key=uuid4(),
                        preview_digest=digest,
                        confirmation=True,
                    )
                return "applied"
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
                return type(exc).__name__
            finally:
                connections.close_all()

        def prepare_worker():
            try:
                if not held.wait(timeout=10):
                    raise RuntimeError("Test synchronization timed out")
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.put(("prepare", cursor.fetchone()[0]))
                prepare_opening(actor=self.owner, **{**self.payload, "operation_id": proposal.pk})
                return "prepared"
            except Exception as exc:
                errors.append((type(exc).__name__, str(exc)))
                return type(exc).__name__
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            apply_future = pool.submit(apply_worker)
            prepare_future = pool.submit(prepare_worker)
            workers = dict(pids.get(timeout=10) for _ in range(2))
            deadline = time.monotonic() + 8
            blocked = False
            while time.monotonic() < deadline:
                with connections["default"].cursor() as cursor:
                    cursor.execute("SELECT pg_blocking_pids(%s)", [workers["prepare"]])
                    blocked = workers["apply"] in (cursor.fetchone()[0] or [])
                if blocked:
                    break
                time.sleep(0.02)
            release.set()
            outcomes = [apply_future.result(timeout=15), prepare_future.result(timeout=15)]
        self.assertTrue(blocked, "The test did not overlap preparation with the held company row")
        self.assertFalse(errors, f"Concurrent outcomes {outcomes}: {errors}")
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "applied")

    def test_case_insensitive_wallet_links_admit_one_identity_concurrently(self):
        members = [create_member(company_id=self.tenant.company.pk, member_id=uuid4()) for _ in range(2)]
        address = Web3.to_checksum_address("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
        variants = [address, address.lower()]
        self.assertNotEqual(*variants)
        start = Barrier(2)

        def insert(index):
            try:
                with atomic():
                    start.wait(timeout=10)
                    RegisterMemberWallet.objects.create(
                        company_id=self.tenant.company.pk, member_id=members[index].pk, address=variants[index]
                    )
                    return "committed"
            except DatabaseError:
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(insert, index) for index in range(2)]
            outcomes = {future.result(timeout=20) for future in futures}
        self.assertEqual(outcomes, {"committed", "refused"})
        self.assertEqual(
            RegisterMemberWallet.objects.filter(company=self.tenant.company, address__iexact=address).count(), 1
        )

    def test_the_database_refuses_forged_openings_rewrites_and_deletion(self):
        proposal = self.submit()
        with company_operation(self.owner, self.tenant.company.pk, "register_opening_apply"):
            for write in (
                lambda: RegisterOpening.objects.filter(pk=proposal.pk).update(reason="Rewritten"),
                lambda: RegisterOpening.objects.filter(pk=proposal.pk).update(mapping=[]),
                lambda: RegisterOpening.objects.filter(pk=proposal.pk).update(boundary=None),
                lambda: RegisterOpening.objects.filter(pk=proposal.pk).update(file="elsewhere"),
                lambda: RegisterOpening.objects.filter(pk=proposal.pk).update(preparing_appointment=None),
                lambda: RegisterOpening.objects.filter(pk=proposal.pk).update(
                    status="applied", reviewed_by=self.owner, reviewed_at=timezone.now()
                ),
                proposal.delete,
            ):
                with self.assertRaises(DatabaseError), atomic():
                    write()
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        forged = forged_fields(proposal)
        register_copy = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.SHARE_REGISTER)
        folder = f"companies/{self.tenant.company.pk}/register-openings/{uuid4()}"
        for changes in (
            {"status": "applied"},
            {"rejection_reason": "Forged"},
            {"boundary": None},
            {"evidence_fingerprint": "0" * 64},
            {"evidence_snapshot": {**proposal.evidence_snapshot, "name": "forged.pdf"}},
            {
                "authority_evidence": register_copy,
                "evidence_fingerprint": register_copy.sha256,
                "evidence_snapshot": evidence_snapshot(register_copy),
            },
            {"authority_evidence": None},
            {"preparing_appointment": None},
            {"submitted_by": staff_user()},
            {"authority": "court_order"},
            {"file": f"{folder}/{uuid4()}.bin"},
        ):
            with self.subTest(changes=changes):
                self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner, **changes))
        self.assert_refused(
            "register_opening_exact_provenance",
            lambda: insert_forged(forged, self.owner, source_document=uuid4()),
        )
        self.assert_refused(
            "bind this share class and its mapped holders exactly",
            lambda: insert_forged(forged, self.owner, mapping=proposal.mapping[:1]),
        )
        for operation in ("register_opening_approve", "register_import_prepare"):
            with self.subTest(operation=operation):
                self.assert_refused(
                    "exact current intent", lambda: insert_forged(forged, self.owner, operation=operation)
                )
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged, self.owner)
            raise RuntimeError("rollback")
        self.apply(proposal)
        self.assert_refused("exact current intent", lambda: insert_forged(forged, self.owner))
        with company_operation(self.owner, self.tenant.company.pk, "register_opening_apply"):
            with self.assertRaises(DatabaseError), atomic():
                RegisterOpening.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
        self.assertEqual(RegisterOpening.objects.count(), 1)

    def test_the_database_refuses_a_preparation_whose_boundary_is_not_its_exact_canonical_capture(self):
        proposal = self.submit()
        boundary = proposal.boundary
        entry = boundary["history"][0]
        deployment_anchor = {"block": boundary["deployment_block"], "block_hash": boundary["deployment_hash"]}
        refusals = [
            {**boundary, "token": str(uuid4())},
            {**boundary, "company": str(uuid4())},
            {key: value for key, value in boundary.items() if key != "history"},
            {**boundary, "history": {}},
            {**boundary, "history": [{key: value for key, value in entry.items() if key != "transaction"}]},
            {**boundary, "history": [{**entry, "transaction": "0xnope"}]},
            {**boundary, "history": [{**entry, "block": boundary["block"]["number"] + 1}]},
            {**boundary, "history": [entry, {**entry, "block_hash": "0x" + "ee" * 32}]},
            {**boundary, "history": [entry, entry]},
            {**boundary, "history": [{**item, "block_hash": "0x" + "ee" * 32} for item in boundary["history"]]},
            {
                **boundary,
                "history": [*boundary["history"], {**entry, **deployment_anchor, "block_hash": "0x" + "dd" * 32}],
            },
        ]
        for key in ("deployment", "deployment_transaction", "deployment_block", "deployment_hash", "contract_address"):
            refusals += [{**boundary, key: value} for value in (None, {}, [], True, "invalid")]
            refusals.append({name: value for name, value in boundary.items() if name != key})
        refusals += [
            {**boundary, **change}
            for change in (
                {"version": "1"},
                {"chain_id": str(boundary["chain_id"])},
                {"issued_supply": 100},
                {"authorized_supply": 1000},
                {"block": {**boundary["block"], "number": str(boundary["block"]["number"])}},
                {"block": {**boundary["block"], "timestamp": None}},
                {"block": {**boundary["block"], "date": "2026-02-31"}},
                {"policy": {"mode": "finalized"}},
                {"policy": {"version": 1, "mode": "depth", "depth": None}},
                {"policy": {"version": 1, "mode": "depth", "depth": "1"}},
                {"policy": {"version": 1, "mode": "depth", "depth": 0}},
            )
        ]
        for value in (None, 80, True, {}, [], "", "-1", "0", "1.5"):
            malformed = deepcopy(boundary)
            malformed["holdings"][0]["shares"] = value
            if value is None:
                malformed["issued_supply"] = "20"
            refusals.append(malformed)
        for refused in refusals:
            with self.subTest(boundary=refused):
                self.assert_boundary_refused(proposal, refused)
        anchored = {**boundary, "history": [*boundary["history"], {**entry, **deployment_anchor}]}
        with self.assertRaises(RuntimeError), atomic():
            insert_forged(forged_fields(proposal), self.owner, boundary=anchored)
            raise RuntimeError("rollback")

    def test_the_database_requires_explicit_holdings_even_for_an_empty_boundary(self):
        self.node.events = []
        self.node.balances = {}
        self.node.contract.functions.totalSupply.return_value.call.return_value = 0
        proposal = self.submit(mapping=[])
        boundary = proposal.boundary
        self.assertEqual((boundary["holdings"], boundary["issued_supply"]), ([], "0"))
        self.assert_boundary_refused(proposal, {key: value for key, value in boundary.items() if key != "holdings"})
        for value in (None, {}, "", 0):
            with self.subTest(holdings=value):
                self.assert_boundary_refused(proposal, {**boundary, "holdings": value})

    def test_a_mapping_value_that_is_not_a_json_string_is_refused_at_insert(self):
        proposal = self.submit()
        first, second = proposal.mapping
        forged = forged_fields(proposal)
        for item in ({"address": first["address"], "member": None}, {"address": None, "member": first["member"]}):
            with self.subTest(item=item), self.assertRaises(DatabaseError), atomic():
                insert_forged(forged, self.owner, mapping=[item, second])
        self.assertEqual(RegisterOpening.objects.count(), 1)

    def test_disabled_guards_admit_forged_decisions_and_duplicate_wallet_links(self):
        proposal = self.submit()
        forged = {"status": "applied", "reviewed_at": timezone.now(), "reviewed_by": self.owner}
        with self.assertRaises(RuntimeError), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("DROP TRIGGER tokens_register_opening_identity ON tokens_registeropening")
            RegisterOpening.objects.filter(pk=proposal.pk).update(**forged)
            self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "applied")
            raise RuntimeError("rollback")
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        first = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        second = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        address = Web3.to_checksum_address("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
        with self.assertRaises(RuntimeError), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("DROP TRIGGER tokens_register_member_wallet_identity ON tokens_registermemberwallet")
            cursor.execute("DROP INDEX tokens_registermemberwallet_company_address_ci")
            RegisterMemberWallet.objects.create(company=self.tenant.company, member=first, address=address)
            RegisterMemberWallet.objects.create(company=self.tenant.company, member=second, address=address.lower())
            self.assertEqual(RegisterMemberWallet.objects.filter(address__iexact=address).count(), 2)
            raise RuntimeError("rollback")
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_the_wallet_links_an_opening_records_are_immutable(self):
        self.apply(self.submit())
        _, _, _, stranger_member, _, _ = register_fixture()
        link = RegisterMemberWallet.objects.get(address=ALICE)
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberWallet.objects.filter(pk=link.pk).update(member=stranger_member)
        with self.assertRaises(DatabaseError), atomic():
            link.delete()
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberWallet.objects.create(company=self.tenant.company, member=stranger_member, address=ALICE)
        member = RegisterMember.objects.get(pk=self.payload["mapping"][0]["member"])
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberWallet.objects.create(company=self.tenant.company, member=member, address="not-an-address")

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_admin_keeps_openings_as_read_only_history_with_their_evidence(self):
        proposal = self.submit()
        reviewer = staff_user()
        with use_migrate():
            reviewer.is_superuser = True
            reviewer.save(update_fields=["is_superuser"])
        self.client.force_login(reviewer)
        change = reverse("admin:tokens_registeropening_change", args=[proposal.pk])
        evidence = reverse("admin:tokens_registeropening_evidence", args=[proposal.pk])
        response = self.client.get(change)
        self.assertContains(response, evidence)
        self.assertNotContains(response, "/review/")
        self.assertEqual(self.client.post(change, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.get(evidence).status_code, 200)
        model_admin = admin.site._registry[RegisterOpening]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            {field.name for field in RegisterOpening._meta.fields} - {"file"} <= set(model_admin.readonly_fields)
        )
        proposal.refresh_from_db()
        self.assertEqual((proposal.status, proposal.reason), ("submitted", self.payload["reason"]))


@override_settings(**SETTINGS)
class RegisterOpeningApiTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.tenant, self.owner, self.administrator, self.evidence, self.target, self.node = opening_fixture()
        reading(self, self.node)
        self.client.force_authenticate(self.owner)
        self.payload = opening_payload(self.target.token_id, self.evidence, self.administrator)

    def test_the_boundary_summary_names_existing_members_and_says_which_members_exist(self):
        height = self.target.deployment_block
        self.node.events = [
            transfer(height + 1, ZERO_ADDRESS, ALICE, 100),
            transfer(height + 2, ALICE, BOB, 20),
            transfer(height + 2, ALICE, CY, 5, index=1),
        ]
        self.node.balances = {ALICE: 75, BOB: 20, CY: 5}
        newcomer = str(uuid4())
        with use_operator(), use_migrate():
            named = linked_member(self.tenant.company, ALICE, "Live Alice")
            quiet = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        mapping = [
            {"address": ALICE, "member": str(named.pk)},
            {"address": BOB, "member": str(quiet.pk)},
            {"address": CY, "member": newcomer},
        ]
        created = self.client.post(OPENINGS, {**self.payload, "mapping": mapping}, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(
            created.json()["boundarySummary"]["holdings"],
            [
                {
                    "address": ALICE,
                    "shares": "75",
                    "member": str(named.pk),
                    "memberName": "Live Alice",
                    "memberExists": True,
                },
                {"address": BOB, "shares": "20", "member": str(quiet.pk), "memberName": None, "memberExists": True},
                {"address": CY, "shares": "5", "member": newcomer, "memberName": None, "memberExists": False},
            ],
        )

    def test_the_boundary_summary_admits_no_member_of_another_company(self):
        with use_operator():
            _, _, _, foreign, _, _ = register_fixture()
        opening = RegisterOpening(
            company=self.tenant.company,
            token=self.tenant.token,
            mapping=[{"address": ALICE, "member": str(foreign.pk)}],
            boundary={
                "block": {"number": 2, "hash": "0x" + "ef" * 32, "date": "2026-09-20"},
                "holdings": [{"address": ALICE, "shares": "80"}],
            },
        )
        with use_operator():
            summary = RegisterOpeningSerializer().get_boundary_summary(opening)
        self.assertEqual(
            summary["holdings"],
            [
                {
                    "address": ALICE,
                    "shares": "80",
                    "member": str(foreign.pk),
                    "member_name": None,
                    "member_exists": False,
                }
            ],
        )

    def test_the_list_reads_member_identities_only_for_openings_that_map_an_existing_member(self):
        def prepare(members=None):
            with use_operator():
                evidence = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY)
            payload = opening_payload(self.target.token_id, evidence, self.administrator, members=members)
            self.assertEqual(self.client.post(OPENINGS, payload, format="json").status_code, 201)

        def listed():
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get(OPENINGS, {"token": str(self.tenant.token.pk)})
            self.assertEqual(response.status_code, 200)
            return len(response.json()["results"]), len(queries)

        prepare()
        prepare()
        self.assertEqual(listed(), (2, 10))
        with use_operator(), use_migrate():
            members = [
                linked_member(self.tenant.company, address, name) for address, name in ((ALICE, "A"), (BOB, "B"))
            ]
        prepare([member.pk for member in members])
        self.assertEqual(listed(), (3, 18))

    def test_preparation_reads_lists_and_refuses_rewrites_changed_retries_and_strangers(self):
        created = self.client.post(OPENINGS, self.payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        row = created.json()
        self.assertEqual(
            (row["status"], row["stage"], row["providedBy"], row["preparedByName"], row["decisions"]),
            ("submitted", "submitted", "company", "opening owner", []),
        )
        self.assertEqual(
            (row["authorityEvidence"], row["preparingAppointment"], row["sourceDocument"]),
            (str(self.evidence.pk), str(self.administrator.pk), None),
        )
        boundary = row["boundary"]["block"]
        self.assertEqual(
            row["boundarySummary"],
            {
                "blockNumber": boundary["number"],
                "blockHash": boundary["hash"],
                "date": boundary["date"],
                "holdings": [
                    {
                        "address": ALICE,
                        "shares": "80",
                        "member": self.payload["mapping"][0]["member"],
                        "memberName": None,
                        "memberExists": False,
                    },
                    {
                        "address": BOB,
                        "shares": "20",
                        "member": self.payload["mapping"][1]["member"],
                        "memberName": None,
                        "memberExists": False,
                    },
                ],
            },
        )
        self.assertNotIn("file", row)
        self.assertEqual(self.client.post(OPENINGS, self.payload, format="json").status_code, 200)
        self.assertEqual(
            self.client.post(OPENINGS, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        detail = f"{OPENINGS}{row['uuid']}/"
        self.assertEqual(self.client.get(detail).json()["uuid"], row["uuid"])
        self.assertEqual(self.client.get(f"{detail}file/").status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        for query, expected in (
            ({"company": str(self.tenant.company.pk)}, [row["uuid"]]),
            ({"company": str(uuid4())}, []),
            ({"token": str(self.tenant.token.pk)}, [row["uuid"]]),
            ({"token": str(uuid4())}, []),
            ({"status": "submitted"}, [row["uuid"]]),
            ({"status": "applied"}, []),
        ):
            with self.subTest(query=query):
                listed = self.client.get(OPENINGS, query).json()["results"]
                self.assertEqual([item["uuid"] for item in listed], expected)
        with use_operator():
            stranger, _, _, _, _, _ = register_fixture()
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.get(OPENINGS).json()["results"], [])
        self.assertEqual(
            self.client.post(OPENINGS, {**self.payload, "operation_id": uuid4()}, format="json").status_code, 404
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(OPENINGS, self.payload, format="json").status_code, 401)


class RegisterOpeningMigrationTest(TransactionTestCase):
    GUARDS = ("tokens_guard_register_opening", "tokens_guard_register_opening_history")
    FUNCTIONS = (
        "tokens_register_opening_approved",
        "tokens_register_opening_decision_digest",
        "tokens_guard_register_opening_decision",
        "tokens_check_register_opening_decision",
    )
    PINNED = ["search_path=pg_catalog, public, pg_temp"]

    def installed(self, names=GUARDS):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, prosrc FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname", [list(names)]
            )
            return cursor.fetchall()

    def configured(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, proconfig FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname",
                [list(self.GUARDS + self.FUNCTIONS)],
            )
            return cursor.fetchall()

    def insert_policy(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy "
                "WHERE polname = 'tokens_registeropening_insert'"
            )
            return cursor.fetchone()[0]

    def test_upgrade_preserves_register_history_without_fabricated_openings(self):
        self.addCleanup(restore_every_migration)
        migrate_to([("tokens", "0064_reviewed_register_corrections")])
        _, _, _, _, _, opening = register_fixture()
        original_hash = opening.entry_hash
        restore_every_migration()
        self.assertEqual(RegisterEntry.objects.get(pk=opening.pk).entry_hash, original_hash)
        self.assertFalse(RegisterOpening.objects.exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_reversal_restores_the_staff_review_guards_and_owner_submissions_then_reapplies(self):
        self.addCleanup(restore_every_migration)
        previous = ("tokens", "0087_company_discrepancy_acknowledgements")
        company_run, closed, pinned = self.installed(), self.insert_policy(), self.configured()
        self.assertEqual(pinned, [(name, self.PINNED) for name in sorted(self.GUARDS + self.FUNCTIONS)])
        self.assertIn("tokens_registeropeningdecision", dict(company_run)["tokens_guard_register_opening"])
        self.assertNotIn("TG_OP <> 'UPDATE'", dict(company_run)["tokens_guard_register_opening_history"])
        self.assertNotIn("submitted_by_id", closed)
        self.assertEqual(len(self.installed(self.FUNCTIONS)), 4)
        migrate_to([("tokens", "0064_reviewed_register_corrections")])
        migrate_to([previous])
        earlier = self.installed()
        self.assertEqual(self.configured(), [(name, None) for name in sorted(self.GUARDS)])
        self.assertIn("Only operator review may decide", dict(earlier)["tokens_guard_register_opening"])
        self.assertIn("TG_OP <> 'UPDATE'", dict(earlier)["tokens_guard_register_opening_history"])
        self.assertIn("submitted_by_id", self.insert_policy())
        restore_every_migration()
        self.assertEqual((self.installed(), self.insert_policy(), self.configured()), (company_run, closed, pinned))
        migrate_to([previous])
        self.assertEqual(
            (self.installed(), self.configured()), (earlier, [(name, None) for name in sorted(self.GUARDS)])
        )
        self.assertIn("submitted_by_id", self.insert_policy())
        self.assertEqual(self.installed(self.FUNCTIONS), [])
        restore_every_migration()
        self.assertEqual((self.installed(), self.insert_policy(), self.configured()), (company_run, closed, pinned))

    @override_settings(**SETTINGS)
    def test_reversal_refuses_while_a_company_opening_exists(self):
        tenant, owner, administrator, evidence, target, node = opening_fixture()
        reading(self, node)
        prepared(owner, opening_payload(target.token_id, evidence, administrator))
        company_run = self.installed()
        migration = import_module("tokens.migrations.0089_company_register_opening_guards")
        with self.assertRaisesMessage(DatabaseError, "Retain company register openings"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_company_openings(None, editor)
        self.assertEqual(self.installed(), company_run)
        original = import_module("tokens.migrations.0065_register_opening")
        with self.assertRaisesRegex(RuntimeError, "Retain opening"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                original.remove_guards(None, editor)
        self.assertTrue(RegisterOpening.objects.filter(token=tenant.token).exists())

    @override_settings(**SETTINGS)
    def test_reversal_refuses_while_a_company_decision_on_a_staff_era_opening_exists(self):
        tenant, owner, administrator, evidence, target, node = opening_fixture()
        reading(self, node)
        proposal = staff_era(prepared(owner, opening_payload(target.token_id, evidence, administrator)))
        decide(owner, administrator, proposal, "reject", reason="Submitted for the retired staff review")
        company_run = self.installed()
        migration = import_module("tokens.migrations.0089_company_register_opening_guards")
        with self.assertRaisesMessage(DatabaseError, "Retain company register openings"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_company_openings(None, editor)
        self.assertEqual(self.installed(), company_run)

    def test_the_original_reversal_still_refuses_to_discard_wallet_links(self):
        _, company, _, member, _, _ = register_fixture()
        RegisterMemberWallet.objects.create(company=company, member=member, address=ALICE)
        migration = import_module("tokens.migrations.0065_register_opening")
        with self.assertRaisesRegex(RuntimeError, "Retain register wallet links"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterMemberWallet.objects.filter(address=ALICE).exists())
