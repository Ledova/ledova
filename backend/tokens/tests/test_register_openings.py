import importlib
from collections import ChainMap
from datetime import date
from unittest.mock import patch
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    attach_file,
    make_document,
)
from shared.db import atomic, current_alias
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    ShareRegister,
    ShareToken,
)
from tokens.services import deployment, register_snapshot
from tokens.services.register_events import (
    create_member,
    open_register,
    verify_register,
)
from tokens.services.register_openings import (
    decide_opening,
    prepare_opening_review,
    submit_opening,
)
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    FACTORY,
    KEY,
    DeploymentNode,
    admitted_signer,
    deployment_token,
)
from tokens.tests.test_register_corrections import correction_fixture
from tokens.tests.test_register_events import DAY, register_fixture
from tokens.tests.test_register_snapshot import SnapshotNode, block_hash, transfer

ALICE = "0x" + "1" * 40
BOB = "0x" + "2" * 40
POLICIES = {f"evm:{CHAIN_ID}": {"mode": "finalized"}}
SETTINGS = dict(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    WALLET_CHAIN_FINALITY_POLICIES=POLICIES,
)


def opening_fixture():
    tenant = deployment_token("opening")
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
    reviewer = get_user_model().objects.create_user(
        email=f"opening-{uuid4()}@example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registeropening", "view_registeropening"]
        )
    )
    document = attach_file(make_document(tenant.company))
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
    return tenant, owner, reviewer, document, target, node


def opening_payload(document, target, *, operation_id=None, members=None, mapping=None):
    if members is None:
        members = [uuid4(), uuid4()]
    if mapping is None:
        mapping = [
            {"address": ALICE, "member": str(members[0])},
            {"address": BOB, "member": str(members[1])},
        ]
    return {
        "operation_id": operation_id or uuid4(),
        "token_id": target.token_id,
        "document_id": document.pk,
        "mapping": mapping,
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-OPENING-1",
        "reason": "Establish the register from the attributed deployment boundary",
    }


@override_settings(**SETTINGS)
class RegisterOpeningTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.owner, self.reviewer, self.document, self.target, self.node = opening_fixture()
        self.payload = opening_payload(self.document, self.target)

    def submit(self, **changes):
        return submit_opening(actor=self.owner, **{**self.payload, **changes})

    def review(self, proposal):
        return prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)[1]

    def apply(self, proposal, **changes):
        return decide_opening(
            **{
                "proposal_id": proposal.pk,
                "reviewer": self.reviewer,
                "confirmation": self.review(proposal),
                "decision": "apply",
                "client": self.node.client,
                **changes,
            }
        )

    def test_submission_binds_verified_evidence_mapping_and_retained_copy(self):
        proposal = self.submit()
        self.assertEqual(proposal.status, "submitted")
        self.assertIsNone(proposal.boundary)
        self.assertEqual(
            proposal.mapping,
            [
                {"address": ALICE, "member": self.payload["mapping"][0]["member"]},
                {"address": BOB, "member": self.payload["mapping"][1]["member"]},
            ],
        )
        self.assertNotEqual(proposal.file.name, self.document.file.name)
        with proposal.file.open("rb") as saved, self.document.file.open("rb") as original:
            self.assertEqual(saved.read(), original.read())
        self.assertEqual(self.submit().pk, proposal.pk)
        self.assertFalse(RegisterMember.objects.exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_submission_refuses_foreign_owners_undeployed_classes_and_initialized_registers(self):
        stranger, _, _, _, _, _ = register_fixture()
        with self.assertRaises(NotFound):
            submit_opening(actor=stranger, **self.payload)
        token = self.tenant.token
        token.status = "deploying"
        token.save(update_fields=["status"])
        with self.assertRaises(ValidationError):
            self.submit()
        token.status = "deployed"
        token.save(update_fields=["status"])
        open_register(
            token_id=token.pk,
            operation_id=uuid4(),
            changes=[],
            effective_on=DAY,
            recorded_by=self.reviewer,
        )
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4())

    def test_submission_refuses_ambiguous_mappings_and_foreign_members(self):
        _, foreign_company, _, foreign_member, _, _ = register_fixture()
        with self.assertRaises(ValidationError):
            self.submit(
                mapping=[
                    {"address": ALICE, "member": str(foreign_member.pk)},
                    {"address": BOB, "member": str(uuid4())},
                ]
            )
        member = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        RegisterMemberWallet.objects.create(company=self.tenant.company, member=member, address=ALICE.lower())
        with self.assertRaises(ValidationError):
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
        agreeing = self.submit(
            mapping=[{"address": ALICE, "member": str(member.pk)}, {"address": BOB, "member": str(uuid4())}]
        )
        self.assertEqual(agreeing.status, "submitted")

    def test_submission_requires_resolution_director_or_court_order_and_verified_company_evidence(self):
        with self.assertRaises(ValidationError):
            self.submit(approving_director="")
        with self.assertRaises(ValidationError):
            self.submit(authority="court_order")
        with self.assertRaises(NotFound):
            self.submit(document_id=uuid4())
        CompanyDocument.objects.filter(pk=self.document.pk).update(is_verified=False)
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4())
        _, _, foreign_document, _ = correction_fixture()
        with self.assertRaises(NotFound):
            self.submit(document_id=foreign_document.pk)

    def test_prepare_captures_one_boundary_and_refuses_incomplete_or_stale_mappings(self):
        proposal = self.submit()
        self.review(proposal)
        boundary = RegisterOpening.objects.get(pk=proposal.pk).boundary
        self.assertEqual(boundary["block"]["number"], self.target.deployment_block + 2)
        self.assertEqual(boundary["holdings"], [{"address": ALICE, "shares": "80"}, {"address": BOB, "shares": "20"}])
        self.assertEqual(boundary["policy"]["mode"], "finalized")
        self.node.events.append(transfer(self.target.deployment_block + 2, BOB, ALICE, 5, index=1))
        again = prepare_opening_review(proposal_id=proposal.pk, reviewer=self.reviewer, client=self.node.client)
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).boundary, boundary)
        self.assertTrue(again[1])
        self.node.events.pop()
        for mapping in (
            [{"address": ALICE, "member": str(uuid4())}],
            [
                {"address": ALICE, "member": str(uuid4())},
                {"address": BOB, "member": str(uuid4())},
                {"address": "0x" + "3" * 40, "member": str(uuid4())},
            ],
        ):
            with self.subTest(mapping=mapping):
                stale = self.submit(operation_id=uuid4(), mapping=mapping)
                with self.assertRaises(ValidationError):
                    prepare_opening_review(proposal_id=stale.pk, reviewer=self.reviewer, client=self.node.client)
                self.assertIsNone(RegisterOpening.objects.get(pk=stale.pk).boundary)

    def test_decide_applies_the_opening_with_members_wallets_and_positions_atomically(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        applied = decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            client=self.node.client,
        )
        self.assertEqual(applied.status, "applied")
        entry = applied.applied_entry
        self.assertEqual((entry.kind, entry.sequence, entry.previous_hash), ("opening", 1, "0" * 64))
        self.assertEqual(entry.operation_id, proposal.pk)
        self.assertIsNone(entry.corrects_id)
        self.assertEqual(entry.effective_on, date.fromisoformat(applied.boundary["block"]["date"]))
        self.assertEqual(
            entry.changes,
            sorted(
                [
                    {"member": self.payload["mapping"][0]["member"], "shares": "80"},
                    {"member": self.payload["mapping"][1]["member"], "shares": "20"},
                ],
                key=lambda change: change["member"],
            ),
        )
        self.assertEqual(RegisterMember.objects.count(), 2)
        for link in applied.mapping:
            wallet = RegisterMemberWallet.objects.get(company=self.tenant.company, address=link["address"])
            self.assertEqual(str(wallet.member_id), link["member"])
        result = verify_register(entry.register_id)
        self.assertEqual((result["entries"], result["members"], result["issued_supply"]), (1, 2, "100"))
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            retried = decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        self.assertEqual(retried.applied_entry_id, entry.pk)
        with self.assertRaises(RegisterChangeConflict):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="reject",
                rejection_reason="Too late",
                client=self.node.client,
            )
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4())

    def test_an_empty_boundary_creates_an_explicit_empty_opening(self):
        self.node.events = []
        self.node.balances = {}
        self.node.contract.functions.totalSupply.return_value.call.return_value = 0
        proposal = self.submit(mapping=[])
        confirmation = self.review(proposal)
        applied = decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            client=self.node.client,
        )
        self.assertEqual(applied.applied_entry.changes, [])
        result = verify_register(applied.applied_entry.register_id)
        self.assertEqual((result["entries"], result["members"], result["issued_supply"]), (1, 0, "0"))
        fresh = ShareToken.objects.create(company=self.tenant.company, name="Unopened", symbol="UNO", total_supply="10")
        self.assertFalse(ShareRegister.objects.filter(token=fresh).exists())

    def test_boundary_canonicity_policy_and_evidence_are_rechecked_before_application(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        orphaned = self.node.blocks[self.target.deployment_block + 2]
        orphaned["hash"] = block_hash(19)
        with self.assertRaisesMessage(ValidationError, "no longer canonical"):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        orphaned["hash"] = block_hash(self.target.deployment_block + 2)
        with self.settings(WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 1}}):
            with self.assertRaisesMessage(ValidationError, "finality policy"):
                decide_opening(
                    proposal_id=proposal.pk,
                    reviewer=self.reviewer,
                    confirmation=confirmation,
                    decision="apply",
                    client=self.node.client,
                )
        self.document.delete()
        with self.assertRaises(ValidationError):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        rejected = decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation="",
            decision="reject",
            rejection_reason="Evidence withdrawn",
            client=self.node.client,
        )
        self.assertEqual(rejected.status, "rejected")

    def test_the_boundary_recheck_accepts_provider_mapping_blocks(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        original = self.node.block

        def mapping_block(identifier):
            return ChainMap(original(identifier))

        self.node.client.w3.eth.get_block.side_effect = mapping_block
        applied = decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            client=self.node.client,
        )
        self.assertEqual(applied.status, "applied")

    def test_a_register_initialized_after_preparation_refuses_application(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        open_register(
            token_id=self.tenant.token.pk,
            operation_id=uuid4(),
            changes=[],
            effective_on=DAY,
            recorded_by=self.reviewer,
        )
        with self.assertRaises(ValidationError):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")

    def test_rejection_needs_a_reason_and_leaves_the_register_uninitialized(self):
        proposal = self.submit()
        with self.assertRaises(ValidationError):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation="",
                decision="reject",
                client=self.node.client,
            )
        rejected = decide_opening(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation="",
            decision="reject",
            rejection_reason="Boundary superseded",
            client=self.node.client,
        )
        self.assertEqual((rejected.status, rejected.applied_entry_id), ("rejected", None))
        self.assertFalse(ShareRegister.objects.filter(token=self.tenant.token).exists())
        self.assertEqual(self.submit(operation_id=uuid4()).status, "submitted")

    def test_confirmation_binds_reviewer_evidence_boundary_and_requires_preparation(self):
        proposal = self.submit()
        with self.assertRaisesMessage(ValidationError, "Open a review"):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation="forged",
                decision="apply",
                client=self.node.client,
            )
        confirmation = self.review(proposal)
        other = get_user_model().objects.create_user(email="other-opening@example.test", is_active=True, is_staff=True)
        other.user_permissions.add(Permission.objects.get(codename="change_registeropening"))
        with self.assertRaisesMessage(ValidationError, "another proposal, reviewer, evidence or boundary"):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=other,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        second = self.submit(operation_id=uuid4())
        self.review(second)
        with self.assertRaisesMessage(ValidationError, "another proposal, reviewer, evidence or boundary"):
            decide_opening(
                proposal_id=second.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            with self.assertRaises(ValidationError):
                decide_opening(
                    proposal_id=proposal.pk,
                    reviewer=self.reviewer,
                    confirmation=confirmation,
                    decision="apply",
                    client=self.node.client,
                )
        self.reviewer.is_active = False
        self.reviewer.save(update_fields=["is_active"])
        with self.assertRaises(PermissionDenied):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )

    def test_raw_updates_deletes_and_fabricated_decisions_are_refused(self):
        proposal = self.submit()
        for changes in (
            {"reason": "Rewritten"},
            {"status": "applied", "reviewed_at": timezone.now(), "reviewed_by": self.reviewer},
            {"status": "rejected", "rejection_reason": "forged", "reviewed_at": timezone.now()},
            {"boundary": {"version": 1}},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                RegisterOpening.objects.filter(pk=proposal.pk).update(**changes)
        with self.assertRaises(DatabaseError), atomic():
            proposal.delete()
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        applied = self.apply(proposal)
        with self.assertRaises(DatabaseError), atomic():
            RegisterOpening.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
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
        self.assertEqual(applied.status, "applied")

    def test_disabled_guards_admit_forged_decisions_and_duplicate_wallet_links(self):
        proposal = self.submit()
        forged = {"status": "applied", "reviewed_at": timezone.now(), "reviewed_by": self.reviewer}
        with self.assertRaises(RuntimeError), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("DROP TRIGGER tokens_register_opening_identity ON tokens_registeropening")
            RegisterOpening.objects.filter(pk=proposal.pk).update(**forged)
            self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "applied")
            raise RuntimeError("rollback")
        self.assertEqual(RegisterOpening.objects.get(pk=proposal.pk).status, "submitted")
        member = create_member(company_id=self.tenant.company.pk, member_id=uuid4())
        with self.assertRaises(RuntimeError), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("DROP TRIGGER tokens_register_member_wallet_identity ON tokens_registermemberwallet")
            RegisterMemberWallet.objects.create(company=self.tenant.company, member=member, address=ALICE)
            self.assertTrue(RegisterMemberWallet.objects.filter(address=ALICE).exists())
            raise RuntimeError("rollback")
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_approval_write_failure_rolls_back_members_links_event_and_projection(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        with patch.object(RegisterOpening, "save", side_effect=RuntimeError("write failed")), self.assertRaises(
            RuntimeError
        ):
            decide_opening(
                proposal_id=proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                client=self.node.client,
            )
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, "submitted")
        self.assertFalse(RegisterEntry.objects.filter(operation_id=proposal.pk).exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())
        self.assertFalse(RegisterEntry.objects.exists())

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_admin_reviews_the_boundary_mapping_and_authority_before_applying(self):
        proposal = self.submit()
        self.client.force_login(self.reviewer)
        url = reverse("admin:tokens_registeropening_review", args=[proposal.pk])
        with (
            patch("tokens.services.register_openings.get_base_chain_client", return_value=self.node.client),
            patch("tokens.services.register_snapshot.get_base_chain_client", return_value=self.node.client),
        ):
            response = self.client.get(url)
            self.assertContains(response, "Synthetic Director")
            self.assertContains(response, self.payload["mapping"][0]["member"])
            token = response.context["form"].initial["confirmation"]
            self.assertEqual(self.client.put(url).status_code, 405)
            response = self.client.post(url, {"confirmation": token, "decision": "apply"})
            self.assertContains(response, "explicit authority confirmation")
            response = self.client.post(url, {"confirmation": token, "decision": "apply", "reviewed": True})
            self.assertEqual(response.status_code, 302)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, "applied")
        self.assertEqual(
            self.client.post(
                reverse("admin:tokens_registeropening_change", args=[proposal.pk]), {"reason": "rewrite"}
            ).status_code,
            405,
        )
        model_admin = admin.site._registry[RegisterOpening]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            set(field.name for field in RegisterOpening._meta.fields) - {"file"} <= set(model_admin.readonly_fields)
        )


@override_settings(**SETTINGS)
class RegisterOpeningApiTest(APITransactionTestCase):
    def setUp(self):
        self.tenant, self.owner, self.reviewer, self.document, self.target, self.node = opening_fixture()
        self.client.force_authenticate(self.owner)
        self.payload = opening_payload(self.document, self.target)
        self.url = reverse("tokens:register-openings-list")

    def test_external_issuer_submission_and_private_read_contract(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual(row["status"], "submitted")
        self.assertNotIn("file", row)
        detail = reverse("tokens:register-openings-detail", args=[row["uuid"]])
        self.assertEqual(self.client.get(detail).status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        stranger, _, _, _, _, _ = register_fixture()
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.get(self.url).json()["results"], [])
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "operation_id": uuid4()}, format="json").status_code, 404
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 401)


class RegisterOpeningMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_register_history_without_fabricated_openings(self):
        try:
            migrate_to([("tokens", "0064_reviewed_register_corrections")])
            actor, company, token, member, other, opening = register_fixture()
            original_hash = opening.entry_hash
            restore_every_migration()
            self.assertEqual(RegisterEntry.objects.get(pk=opening.pk).entry_hash, original_hash)
            self.assertFalse(RegisterOpening.objects.exists())
            self.assertFalse(RegisterMemberWallet.objects.exists())
        finally:
            restore_every_migration()

    def test_downgrade_refuses_to_discard_wallet_links(self):
        _, company, _, member, _, _ = register_fixture()
        RegisterMemberWallet.objects.create(company=company, member=member, address=ALICE)
        migration = importlib.import_module("tokens.migrations.0065_register_opening")
        with self.assertRaisesRegex(RuntimeError, "Retain register wallet links"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterMemberWallet.objects.filter(address=ALICE).exists())

    @override_settings(**SETTINGS)
    def test_downgrade_refuses_to_discard_opening_proposals(self):
        tenant, owner, reviewer, document, target, node = opening_fixture()
        submit_opening(actor=owner, **opening_payload(document, target))
        migration = importlib.import_module("tokens.migrations.0065_register_opening")
        with self.assertRaisesRegex(RuntimeError, "Retain opening"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterOpening.objects.filter(token=tenant.token).exists())
