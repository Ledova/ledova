from importlib import import_module
from unittest.mock import patch
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import DatabaseError, IntegrityError, connection, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from companies.services.administration import company_operation
from companies.tests.test_document_file_access import ADMIN_STORAGES
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.storage import private_storage
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEvidenceKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterWalletLink,
    RegisterWalletLinkDecision,
)
from tokens.services.register_events import create_member
from tokens.services.register_evidence import evidence_snapshot
from tokens.services.register_openings import (
    decide_link,
    prepare_link,
    preview_link_decision,
)
from tokens.tests.evidence_fixtures import (
    owner_appointment,
    staff_user,
    upload_evidence,
)
from tokens.tests.test_register_events import register_fixture
from users.models import UserAccount, UserProfile
from wallets.models import Wallet
from whitelist.models import WhitelistApproval, WhitelistEntry

LINKS = "/api/v1/tokens/register-links/"
CAROL = Web3.to_checksum_address("0x" + "3c" * 20)
DAVE = Web3.to_checksum_address("0x" + "4d" * 20)
ERIN = Web3.to_checksum_address("0x" + "6e" * 20)
UNKNOWN = {"wallet_proof": None, "holder_type": None, "holder_name": None}


def link_fixture():
    owner, company, _, member, _, _ = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    appointment = owner_appointment(company)
    evidence = upload_evidence(owner, appointment, RegisterEvidenceKind.AUTHORITY)
    return owner, company, member, appointment, evidence


def link_payload(company, evidence, appointment, *, mapping=None, **changes):
    return {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "company_id": company.pk,
        "authority_evidence": evidence.pk,
        "mapping": mapping if mapping is not None else [{"address": CAROL.lower(), "member": str(uuid4())}],
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-LINK-1",
        "reason": "Link a holder's wallet to their member record",
        **changes,
    }


def prepared(actor, payload):
    return prepare_link(actor=actor, **payload)[0]


def preview(actor, appointment, link, kind, reason=""):
    return preview_link_decision(actor=actor, link_id=link.pk, appointment=appointment.pk, kind=kind, reason=reason)[1]


def decide(actor, appointment, link, kind, reason="", idempotency_key=None):
    return decide_link(
        actor=actor,
        link_id=link.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=idempotency_key or uuid4(),
        preview_digest=preview(actor, appointment, link, kind, reason)["preview_digest"],
        confirmation=True,
        reason=reason,
    )


def apply_link(actor, appointment, link):
    decide(actor, appointment, link, "approve")
    return decide(actor, appointment, link, "apply")


def linked(actor, appointment, mapping):
    evidence = upload_evidence(actor, appointment, RegisterEvidenceKind.AUTHORITY)
    payload = link_payload(appointment.company, evidence, appointment, mapping=mapping)
    return apply_link(actor, appointment, prepared(actor, payload))


def decision_digest(link, kind, actor, appointment, reason=""):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT tokens_register_link_decision_digest(%s, %s, %s, %s, %s)",
            [link.pk, kind, actor.pk, appointment.pk, reason],
        )
        return cursor.fetchone()[0]


def forge_decision(link, kind, actor, appointment, reason="", digest=None, decided_by=None):
    with company_operation(actor, link.company_id, f"register_link_{kind}"), atomic():
        decision = RegisterWalletLinkDecision.objects.create(
            register_wallet_link=link,
            kind=kind,
            decided_by=decided_by or actor,
            appointment=appointment,
            idempotency_key=uuid4(),
            digest=digest or decision_digest(link, kind, actor, appointment, reason),
            reason=reason,
            decided_at=timezone.now(),
        )
        decision.refresh_from_db()
    return decision


def forge_outcome(link, actor, decision, **fields):
    with company_operation(actor, link.company_id, f"register_link_{decision.kind}"), atomic():
        RegisterWalletLink.objects.filter(pk=link.pk).update(
            reviewed_by=actor, reviewed_at=decision.decided_at, **fields
        )


def forged_fields(link):
    return {
        field.name: getattr(link, field.name)
        for field in RegisterWalletLink._meta.fields
        if field.name not in ("uuid", "created_at", "updated_at", "file")
    }


def insert_forged(fields, actor, operation="register_link_prepare", scope=None, **changes):
    forged_id = uuid4()
    company_id = fields["company"].pk
    with company_operation(actor, scope or company_id, operation), atomic():
        RegisterWalletLink.objects.create(
            **{
                **fields,
                "uuid": forged_id,
                "file": f"companies/{company_id}/register-links/{forged_id}/{uuid4()}.bin",
                **changes,
            }
        )


def staff_era(link):
    with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
        cursor.execute("ALTER TABLE tokens_registerwalletlink DISABLE TRIGGER tokens_register_wallet_link_identity")
        try:
            RegisterWalletLink.objects.filter(pk=link.pk).update(
                preparing_appointment=None, authority_evidence=None, source_document=uuid4()
            )
        finally:
            cursor.execute("ALTER TABLE tokens_registerwalletlink ENABLE TRIGGER tokens_register_wallet_link_identity")
    with use_operator():
        link.refresh_from_db()
    return link


def holder(address, name, *, verified, company=None):
    with use_migrate():
        user = get_user_model().objects.create_user(email=f"holder-{uuid4()}@example.test", password="pw-12345678")
        profile = UserProfile.objects.create(user=user, full_name=name)
        account = UserAccount.objects.create(account_number=str(uuid4())[:20], user_profile=profile)
        wallet = Wallet.objects.create(
            user_account=account,
            address=address,
            chain="base",
            verification_status="VERIFIED" if verified else "PENDING",
        )
        entry = WhitelistEntry.objects.create(wallet=wallet)
        if company is not None:
            WhitelistApproval.objects.create(entry=entry, company=company, registry_address="0x" + "ab" * 20)
    return entry


class RegisterWalletLinkTest(TransactionTestCase):
    def setUp(self):
        self.owner, self.company, self.member, self.appointment, self.evidence = link_fixture()
        self.payload = link_payload(self.company, self.evidence, self.appointment)

    def submit(self, **changes):
        return prepared(self.owner, {**self.payload, **changes})

    def preview(self, link, kind="apply", reason=""):
        return preview(self.owner, self.appointment, link, kind, reason)

    def decide(self, link, kind, reason="", **options):
        return decide(self.owner, self.appointment, link, kind, reason, **options)

    def unmet(self, link, kind="apply"):
        return self.preview(link, kind)["unmet_requirements"]

    def decided(self, link, kind, digest, idempotency_key=None):
        return decide_link(
            actor=self.owner,
            link_id=link.pk,
            appointment=self.appointment.pk,
            kind=kind,
            idempotency_key=idempotency_key or uuid4(),
            preview_digest=digest,
            confirmation=True,
        )

    def test_preparation_keeps_its_own_copy_of_the_authority_upload_and_links_nothing(self):
        link = self.submit()
        self.assertEqual(
            (link.status, link.company_id, link.mapping),
            ("submitted", self.company.pk, [{"address": CAROL, "member": self.payload["mapping"][0]["member"]}]),
        )
        self.assertEqual(
            (
                link.preparing_appointment_id,
                link.authority_evidence_id,
                link.source_document,
                link.evidence_fingerprint,
                link.evidence_snapshot,
            ),
            (self.appointment.pk, self.evidence.pk, None, self.evidence.sha256, evidence_snapshot(self.evidence)),
        )
        self.assertNotEqual(link.file.name, self.evidence.file.name)
        with link.file.open("rb") as kept, self.evidence.file.open("rb") as uploaded:
            self.assertEqual(kept.read(), uploaded.read())
        self.assertFalse(RegisterMemberWallet.objects.exists())
        self.assertFalse(RegisterMember.objects.filter(pk=link.mapping[0]["member"]).exists())

    def test_preparation_refuses_unusable_mappings_foreign_members_linked_addresses_and_authority(self):
        _, _, foreign_member, _, foreign_evidence = link_fixture()
        for mapping in (
            [],
            "not-a-list",
            [{"address": CAROL}],
            [{"address": CAROL, "member": str(uuid4()), "extra": "1"}],
            [{"address": "0x123", "member": str(uuid4())}],
            [{"address": CAROL, "member": "not-a-uuid"}],
            [{"address": CAROL, "member": str(uuid4())}, {"address": CAROL.lower(), "member": str(uuid4())}],
        ):
            with self.subTest(mapping=mapping), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), mapping=mapping)
        with self.assertRaisesMessage(ValidationError, "must belong to this company"):
            self.submit(mapping=[{"address": CAROL, "member": str(foreign_member.pk)}])
        RegisterMemberWallet.objects.create(company=self.company, member=self.member, address=DAVE)
        with self.assertRaisesMessage(ValidationError, "already linked to a member of this company"):
            self.submit(mapping=[{"address": DAVE.lower(), "member": str(self.member.pk)}])
        register_copy = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.SHARE_REGISTER)
        for evidence in (register_copy.pk, foreign_evidence.pk, uuid4()):
            with self.subTest(evidence=evidence):
                with self.assertRaisesMessage(ValidationError, "authority document you uploaded for this company"):
                    self.submit(authority_evidence=evidence)
        for changes in ({"approving_director": ""}, {"authority": "court_order"}, {"reason": " "}):
            with self.subTest(changes=changes), self.assertRaisesMessage(ValidationError, "approving director"):
                self.submit(**changes)
        self.assertFalse(RegisterWalletLink.objects.exists())

    def test_an_identical_preparation_retry_returns_the_link_and_a_changed_or_failed_one_keeps_nothing(self):
        first, created = prepare_link(actor=self.owner, **self.payload)
        self.assertEqual(prepare_link(actor=self.owner, **self.payload), (first, False))
        self.assertTrue(created)
        other = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.AUTHORITY)
        for changes in (
            {"reason": "Changed"},
            {"mapping": [{"address": CAROL, "member": str(uuid4())}]},
            {"authority_evidence": other.pk},
        ):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                prepare_link(actor=self.owner, **{**self.payload, **changes})
        failed = uuid4()
        with patch.object(RegisterWalletLink, "save", side_effect=IntegrityError("duplicate")):
            with self.assertRaises(RegisterChangeConflict):
                self.submit(operation_id=failed)
        self.assertEqual(
            private_storage().listdir(f"companies/{self.company.pk}/register-links/{failed}")[1],
            [],
        )
        self.assertEqual(list(RegisterWalletLink.objects.values_list("pk", flat=True)), [first.pk])

    def test_application_creates_new_members_links_existing_ones_and_skips_a_same_member_link_made_since(self):
        newcomer = str(uuid4())
        link = self.submit(
            mapping=[{"address": CAROL, "member": newcomer}, {"address": DAVE, "member": str(self.member.pk)}]
        )
        self.decide(link, "approve")
        digest = self.preview(link)["preview_digest"]
        RegisterMemberWallet.objects.create(company=self.company, member=self.member, address=DAVE.lower())
        with self.assertRaises(RegisterChangeConflict):
            self.decided(link, "apply", digest)
        self.assertEqual(self.unmet(link), [])
        applied = self.decide(link, "apply")
        self.assertEqual(
            (applied.status, applied.reviewed_by_id, list(applied.decisions.values_list("kind", flat=True))),
            ("applied", self.owner.pk, ["approve", "apply"]),
        )
        self.assertEqual(applied.reviewed_at, applied.decisions.get(kind="apply").decided_at)
        self.assertEqual(RegisterMember.objects.get(pk=newcomer).company_id, self.company.pk)
        self.assertEqual(
            {(wallet.address.lower(), str(wallet.member_id)) for wallet in RegisterMemberWallet.objects.all()},
            {(CAROL.lower(), newcomer), (DAVE.lower(), str(self.member.pk))},
        )
        with self.assertRaisesMessage(ValidationError, "link_decided"):
            self.decide(applied, "reject", "Too late")
        with self.assertRaisesMessage(ValidationError, "already linked"):
            self.submit(operation_id=uuid4(), mapping=[{"address": CAROL, "member": newcomer}])

    def test_an_address_linked_to_another_member_since_preparation_refuses_application_but_not_rejection(self):
        link = self.submit()
        self.decide(link, "approve")
        digest = self.preview(link)["preview_digest"]
        elsewhere = create_member(company_id=self.company.pk, member_id=uuid4())
        RegisterMemberWallet.objects.create(company=self.company, member=elsewhere, address=CAROL)
        with self.assertRaises(RegisterChangeConflict):
            self.decided(link, "apply", digest)
        self.assertEqual(self.unmet(link), ["wallet_linked_elsewhere"])
        with self.assertRaisesMessage(ValidationError, "wallet_linked_elsewhere"):
            self.decide(link, "apply")
        with self.assertRaisesMessage(ValidationError, "reason_required"):
            self.decide(link, "reject")
        rejected = self.decide(link, "reject", "The wallet belongs to another member")
        self.assertEqual(
            (rejected.status, rejected.rejection_reason, rejected.reviewed_at),
            ("rejected", "The wallet belongs to another member", rejected.decisions.get(kind="reject").decided_at),
        )
        self.assertEqual(RegisterMemberWallet.objects.get(address=CAROL).member_id, elsewhere.pk)

    def test_a_failed_application_rolls_back_members_links_and_the_decision(self):
        link = self.submit()
        self.decide(link, "approve")
        digest = self.preview(link)["preview_digest"]
        with patch.object(RegisterWalletLink, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaisesMessage(RuntimeError, "write failed"):
                self.decided(link, "apply", digest)
        link.refresh_from_db()
        self.assertEqual((link.status, list(link.decisions.values_list("kind", flat=True))), ("submitted", ["approve"]))
        self.assertFalse(RegisterMember.objects.filter(pk=link.mapping[0]["member"]).exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_a_staff_era_link_can_only_be_rejected(self):
        link = staff_era(self.submit())
        for kind in ("approve", "apply"):
            with self.subTest(kind=kind):
                self.assertIn("company_provided_evidence_required", self.unmet(link, kind))
                with self.assertRaisesMessage(ValidationError, "company_provided_evidence_required"):
                    self.decide(link, kind)
        rejected = self.decide(link, "reject", "Prepare it again under the company process")
        self.assertEqual((rejected.status, rejected.reviewed_by_id), ("rejected", self.owner.pk))
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_an_identical_decision_retry_returns_the_link_and_a_changed_one_conflicts(self):
        link = self.submit()
        key = uuid4()
        approved = self.decide(link, "approve", idempotency_key=key)
        digest = approved.decisions.get().digest
        self.assertEqual(self.decided(link, "approve", digest, key).pk, link.pk)
        with self.assertRaises(RegisterChangeConflict):
            self.decided(link, "approve", "0" * 64, key)
        with self.assertRaisesMessage(ValidationError, "already_approved"):
            self.decide(link, "approve")
        self.assertEqual(RegisterWalletLinkDecision.objects.filter(register_wallet_link=link).count(), 1)

    def test_the_preview_shows_each_addresses_member_and_its_holders_own_proof_only_where_the_company_listed_it(self):
        holder(CAROL, "Carol Holder", verified=True, company=self.company)
        holder(DAVE, "Dave Holder", verified=False, company=self.company)
        _, elsewhere, _, _, _ = link_fixture()
        holder(ERIN, "Erin Elsewhere", verified=True, company=elsewhere)
        newcomer = str(uuid4())
        link = self.submit(
            mapping=[
                {"address": CAROL, "member": newcomer},
                {"address": DAVE, "member": str(self.member.pk)},
                {"address": ERIN, "member": newcomer},
            ]
        )
        self.assertEqual(
            self.preview(link, "approve")["links"],
            [
                {
                    "address": CAROL,
                    "member": newcomer,
                    "member_exists": False,
                    "wallet_proof": "proven",
                    "holder_type": "member",
                    "holder_name": "Carol Holder",
                },
                {
                    "address": DAVE,
                    "member": str(self.member.pk),
                    "member_exists": True,
                    "wallet_proof": "not_proven",
                    "holder_type": "member",
                    "holder_name": "Dave Holder",
                },
                {"address": ERIN, "member": newcomer, "member_exists": False, **UNKNOWN},
            ],
        )


class RegisterWalletLinkApiTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.member, self.administrator, self.evidence = link_fixture()
        self.client.force_authenticate(self.owner)
        self.payload = link_payload(self.company, self.evidence, self.administrator)

    def test_preparation_reads_lists_and_refuses_rewrites_changed_retries_and_strangers(self):
        created = self.client.post(LINKS, self.payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        row = created.json()
        self.assertEqual(
            (row["status"], row["stage"], row["providedBy"], row["decisions"], row["sourceDocument"]),
            ("submitted", "submitted", "company", [], None),
        )
        self.assertEqual(
            (row["authorityEvidence"], row["preparingAppointment"], row["mappingSummary"]),
            (
                str(self.evidence.pk),
                str(self.administrator.pk),
                [{"address": CAROL, "member": self.payload["mapping"][0]["member"], "memberExists": False}],
            ),
        )
        self.assertNotIn("file", row)
        self.assertEqual(self.client.post(LINKS, self.payload, format="json").status_code, 200)
        for changes, status in (({"reason": "other"}, 409), ({"operation_id": uuid4(), "mapping": []}, 400)):
            with self.subTest(changes=changes):
                self.assertEqual(
                    self.client.post(LINKS, {**self.payload, **changes}, format="json").status_code, status
                )
        detail = f"{LINKS}{row['uuid']}/"
        self.assertEqual(self.client.get(detail).json()["uuid"], row["uuid"])
        self.assertEqual(self.client.get(f"{detail}file/").status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        for query, expected in (
            ({"company": str(self.company.pk)}, [row["uuid"]]),
            ({"company": str(uuid4())}, []),
            ({"status": "submitted"}, [row["uuid"]]),
            ({"status": "applied"}, []),
        ):
            with self.subTest(query=query):
                listed = self.client.get(LINKS, query).json()["results"]
                self.assertEqual([item["uuid"] for item in listed], expected)
        with use_operator():
            stranger = link_fixture()[0]
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.get(LINKS).json()["results"], [])
        self.assertEqual(
            self.client.post(LINKS, {**self.payload, "operation_id": uuid4()}, format="json").status_code, 404
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(LINKS, self.payload, format="json").status_code, 401)

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_admin_keeps_links_as_read_only_history_with_their_evidence(self):
        with use_operator():
            link = prepared(self.owner, self.payload)
            reviewer = staff_user()
        with use_migrate():
            reviewer.is_superuser = True
            reviewer.save(update_fields=["is_superuser"])
        self.client.force_login(reviewer)
        change = reverse("admin:tokens_registerwalletlink_change", args=[link.pk])
        evidence = reverse("admin:tokens_registerwalletlink_evidence", args=[link.pk])
        response = self.client.get(change)
        self.assertContains(response, evidence)
        self.assertNotContains(response, "/review/")
        self.assertEqual(self.client.post(change, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.get(evidence).status_code, 200)
        model_admin = admin.site._registry[RegisterWalletLink]
        self.assertFalse(model_admin.has_delete_permission(None, link))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            {field.name for field in RegisterWalletLink._meta.fields} - {"file"} <= set(model_admin.readonly_fields)
        )


class RegisterWalletLinkMigrationTest(TransactionTestCase):
    GUARD = "tokens_guard_register_wallet_link"
    FUNCTIONS = (
        "tokens_check_register_link_decision",
        "tokens_guard_register_link_decision",
        "tokens_register_link_approved",
        "tokens_register_link_decision_digest",
    )
    PINNED = ["search_path=pg_catalog, public, pg_temp"]
    PREVIOUS = ("tokens", "0091_company_particulars_change_guards")

    def installed(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT proname, prosrc, proconfig FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname",
                [[self.GUARD, *self.FUNCTIONS]],
            )
            return cursor.fetchall()

    def insert_policy(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy "
                "WHERE polname = 'tokens_registerwalletlink_insert'"
            )
            return cursor.fetchone()[0]

    def test_reversal_restores_the_staff_review_guard_and_owner_submissions_then_reapplies(self):
        self.addCleanup(restore_every_migration)
        company_run, closed = self.installed(), self.insert_policy()
        self.assertEqual(
            [(name, config) for name, _, config in company_run],
            [(name, self.PINNED) for name in sorted((self.GUARD, *self.FUNCTIONS))],
        )
        self.assertIn(
            "tokens_registerwalletlinkdecision", {name: source for name, source, _ in company_run}[self.GUARD]
        )
        self.assertNotIn("submitted_by_id", closed)
        migrate_to([("tokens", "0066_issuance_finality_and_boundary_history")])
        migrate_to([self.PREVIOUS])
        original = self.installed()
        self.assertEqual([(name, config) for name, _, config in original], [(self.GUARD, None)])
        self.assertIn("is_active AND is_staff", original[0][1])
        self.assertIn("submitted_by_id", self.insert_policy())
        restore_every_migration()
        self.assertEqual((self.installed(), self.insert_policy()), (company_run, closed))
        migrate_to([self.PREVIOUS])
        self.assertEqual((self.installed(), "submitted_by_id" in self.insert_policy()), (original, True))
        restore_every_migration()
        self.assertEqual((self.installed(), self.insert_policy()), (company_run, closed))

    def test_reversal_refuses_while_a_company_link_or_a_link_decision_exists(self):
        owner, company, _, appointment, evidence = link_fixture()
        link = prepared(owner, link_payload(company, evidence, appointment))
        company_run = self.installed()
        migration = import_module("tokens.migrations.0093_company_register_wallet_link_guards")

        def refused():
            with self.assertRaisesMessage(DatabaseError, "Retain company wallet links"), atomic():
                with connections[current_alias()].schema_editor() as editor:
                    migration.remove_company_links(None, editor)
            self.assertEqual(self.installed(), company_run)

        refused()
        decide(owner, appointment, staff_era(link), "reject", "Submitted for the retired staff review")
        refused()
        original = import_module("tokens.migrations.0067_register_wallet_links")
        with self.assertRaisesRegex(RuntimeError, "Retain wallet link requests"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                original.remove_guards(None, editor)
        self.assertEqual(RegisterWalletLink.objects.get(pk=link.pk).status, "rejected")
