import time
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from queue import Queue
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import Company, CompanyCapability
from companies.services.administration import company_operation
from companies.services.team import revoke_company_appointment
from shared.db import APP_ALIAS, atomic, current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shareholders.services.roll import frozen_rows, holdings_at
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterGrant,
    RegisterGrantDecision,
    RegisterImport,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareRegister,
    ShareToken,
)
from tokens.models.register_evidence import RegisterEvidenceKind
from tokens.services.register import _certificate_pages, _stored_register
from tokens.services.register_events import record_entry, verify_register
from tokens.services.register_grants import (
    decide_grant,
    prepare_grant,
    preview_grant_decision,
)
from tokens.services.register_particulars import (
    decide_particulars_change,
    prepare_particulars_change,
    preview_particulars_decision,
)
from tokens.tests.evidence_fixtures import upload_evidence
from tokens.tests.test_register_events import DAY
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import (
    RESIDENCE,
    apply_import,
    import_fixture,
    import_payload,
)
from tokens.tests.test_register_imports import prepared as prepare_import

GRANTS = "/api/v1/tokens/register-grants/"


def grant_fixture():
    owner, company, token, member, appointment, register_copy, asic, _ = import_fixture()
    imported = prepare_import(owner, import_payload(token, register_copy, asic, member, appointment))
    apply_import(owner, appointment, imported)
    authority = upload_evidence(owner, appointment, RegisterEvidenceKind.AUTHORITY)
    terms = upload_evidence(owner, appointment, RegisterEvidenceKind.SUPPORTING)
    acceptance = upload_evidence(owner, appointment, RegisterEvidenceKind.SUPPORTING)
    payload = {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "token_id": token.pk,
        "member": uuid4(),
        "new_member": True,
        "name": "Synthetic Employee",
        "residential_address": "4 Example Street, Sydney NSW 2000",
        "shares": "25",
        "effective_on": DAY.isoformat(),
        "terms": "Non-paid employee grant without payment; signed acceptance required",
        "authority_reference": "SYNTHETIC-GRANT-1",
        "reason": "Record the company-approved employee grant",
        "authority_evidence": authority.pk,
        "terms_evidence": terms.pk,
        "acceptance_required": True,
        "acceptance_evidence": acceptance.pk,
    }
    return owner, company, token, member, appointment, payload


def preview(owner, appointment, proposal, kind="apply", reason=""):
    return preview_grant_decision(
        actor=owner, grant_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=reason
    )[1]


def decide(owner, appointment, proposal, kind, **changes):
    return decide_grant(
        actor=owner,
        grant_id=proposal.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=uuid4(),
        preview_digest=preview(owner, appointment, proposal, kind)["preview_digest"],
        confirmation=True,
        **changes
    )


class RegisterGrantsTest(AppointsTeam, TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, self.appointment, self.payload = grant_fixture()
            self.administrator = self.appointment

    def prepare(self, **changes):
        return prepare_grant(actor=self.owner, **{**self.payload, **changes})[0]

    def decide(self, proposal, kind):
        return decide(self.owner, self.appointment, proposal, kind)

    def test_new_and_existing_walletless_grants_supply_real_roll_and_certificate_inputs(self):
        proposal = self.prepare()
        self.assertEqual(preview(self.owner, self.appointment, proposal, "approve")["unmet_requirements"], [])
        self.decide(proposal, "approve")
        self.assertEqual(preview(self.owner, self.appointment, proposal)["after_issued_supply"], "125")
        self.decide(proposal, "apply")
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member_id=proposal.member)
            self.assertEqual(
                (held.name, held.source_grant_id, held.source_import_id, held.source_change_id),
                (proposal.name, proposal.pk, None, None),
            )
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "125")
            roll = frozen_rows(self.token, self.token.stored_register, DAY)
            employee = next(row for row in roll if row["member_id"] == proposal.member)
            self.assertEqual((employee["shares"], employee["name"], employee["user_id"]), (25, proposal.name, None))
            self.assertEqual(holdings_at(self.token.stored_register, DAY - timedelta(days=1)), {})
            grant = RegisterGrant.objects.get(pk=proposal.pk)
            page = _certificate_pages(self.token, grant.register_entry)[0]
            self.assertEqual((page["name"], page["shares"], page["holding"]), (proposal.name, 25, 25))
            row = next(row for row in _stored_register(self.token)["rows"] if row["member"] == str(proposal.member))
            self.assertIsNone(row["amount_paid"])
        existing = self.prepare(
            operation_id=uuid4(), member=self.member.pk, new_member=False, name="", residential_address="", shares="5"
        )
        self.assertEqual(existing.name, "Mia Member")
        self.decide(existing, "approve")
        self.decide(existing, "apply")
        with use_operator():
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 105)
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "130")
            self.assertEqual(
                RegisterMemberParticulars.objects.get(member=self.member).source_import_id,
                self.token.register_imports.get(status="applied").pk,
            )

    def test_required_terms_acceptance_evidence_foreign_references_and_identity_refuse(self):
        for changes in (
            {"acceptance_evidence": None},
            {"acceptance_required": False},
            {"terms_evidence": self.payload["authority_evidence"]},
            {"authority_evidence": self.payload["terms_evidence"]},
            {"new_member": False},
            {"member": self.member.pk},
            {"shares": "0"},
            {"shares": "1.5"},
            {"shares": str(2**256)},
            {"shares": "901"},
            {"effective_on": (DAY - timedelta(days=1)).isoformat()},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.prepare(**changes)
        with use_operator():
            stranger = grant_fixture()
        with self.assertRaises(NotFound):
            self.prepare(token_id=stranger[2].pk)
        with self.assertRaises(ValidationError):
            self.prepare(authority_evidence=stranger[5]["authority_evidence"])
        with use_operator():
            self.assertEqual(RegisterGrant.objects.count(), 0)
            self.assertEqual(RegisterEntry.objects.filter(register=self.token.stored_register).count(), 1)

    def test_delegated_capabilities_and_revoked_approval_cannot_authorise_an_application(self):
        preparer, preparing = self.appoint([CompanyCapability.PREPARE])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        proposal = self.prepare()
        self.assertIn("appointment_capability_required", preview(preparer, preparing, proposal)["unmet_requirements"])
        decide(approver, approving, proposal, "approve")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        self.assertIn("approval_lapsed", preview(self.owner, self.appointment, proposal)["unmet_requirements"])
        with self.assertRaises(ValidationError):
            self.decide(proposal, "apply")
        self.decide(proposal, "approve")
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_preparation_replays_exactly_and_new_member_identity_cannot_be_removed_on_retry(self):
        proposal = self.prepare()
        self.assertEqual(prepare_grant(actor=self.owner, **self.payload), (proposal, False))
        for changes in (
            {"shares": "26"},
            {"acceptance_required": False, "acceptance_evidence": None},
            {"terms": "Changed terms"},
        ):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                self.prepare(**changes)
        with self.assertRaises(ValidationError):
            self.prepare(name="", residential_address="")
        self.decide(proposal, "approve")
        self.decide(proposal, "apply")
        self.assertEqual(prepare_grant(actor=self.owner, **self.payload), (proposal, False))
        separate = self.prepare(operation_id=uuid4(), member=uuid4(), name="Mia Member", residential_address=RESIDENCE)
        self.assertNotEqual(separate.member, self.member.pk)

    def test_revoked_approval_tampered_terms_and_stale_register_or_identity_block_new_effects(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        digest = preview(self.owner, self.appointment, proposal)["preview_digest"]
        other = self.prepare(operation_id=uuid4(), member=uuid4(), name="Other Employee", shares="10")
        self.decide(other, "approve")
        self.decide(other, "apply")
        with self.assertRaises(RegisterChangeConflict):
            decide_grant(
                actor=self.owner,
                grant_id=proposal.pk,
                appointment=self.appointment.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with proposal.terms_file.storage.open(proposal.terms_file.name, "wb") as stored:
            stored.write(b"changed terms")
        self.assertIn("evidence_unavailable", preview(self.owner, self.appointment, proposal)["unmet_requirements"])
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        with self.assertRaises(NotFound):
            self.decide(proposal, "apply")
        with use_operator():
            self.assertFalse(RegisterMember.objects.filter(pk=proposal.member).exists())
            self.assertEqual(RegisterGrant.objects.get(pk=proposal.pk).status, "submitted")

    def test_approval_or_applier_expiring_after_the_effect_rolls_back_at_commit(self):
        original_save = RegisterGrant.save
        for capability in (CompanyCapability.APPROVE, CompanyCapability.APPLY):
            with self.subTest(capability=capability):
                proposal = self.prepare(operation_id=uuid4(), member=uuid4())
                person, expiring = self.appoint([capability], expires_at=timezone.now() + timedelta(seconds=10))
                if capability == CompanyCapability.APPROVE:
                    decide(person, expiring, proposal, "approve")
                    applier, applying = self.owner, self.appointment
                else:
                    self.decide(proposal, "approve")
                    applier, applying = person, expiring
                with use_operator():
                    before = verify_register(self.token.stored_register.pk)

                def expire_after_effect(instance, *args, **kwargs):
                    result = original_save(instance, *args, **kwargs)
                    if instance.pk == proposal.pk and instance.status == "applied":
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute(
                                "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM "
                                "%s::timestamptz - clock_timestamp())) + 0.05)",
                                [expiring.expires_at],
                            )
                            cursor.execute("SELECT clock_timestamp() >= %s::timestamptz", [expiring.expires_at])
                            self.assertTrue(cursor.fetchone()[0])
                    return result

                with patch.object(RegisterGrant, "save", expire_after_effect), self.assertRaises(
                    RegisterChangeConflict
                ):
                    decide(applier, applying, proposal, "apply")
                with use_operator():
                    pending = RegisterGrant.objects.get(pk=proposal.pk)
                    self.assertEqual(
                        (pending.status, pending.register_entry_id, pending.reviewed_by_id, pending.reviewed_at),
                        ("submitted", None, None, None),
                    )
                    self.assertFalse(RegisterMember.objects.filter(pk=proposal.member).exists())
                    self.assertFalse(RegisterMemberParticulars.objects.filter(member_id=proposal.member).exists())
                    self.assertFalse(RegisterEntry.objects.filter(operation_id=proposal.pk).exists())
                    self.assertFalse(RegisterPosition.objects.filter(member_id=proposal.member).exists())
                    self.assertEqual(list(pending.decisions.values_list("kind", flat=True)), ["approve"])
                    self.assertEqual(verify_register(self.token.stored_register.pk), before)
                if capability == CompanyCapability.APPROVE:
                    self.decide(proposal, "approve")
                self.assertEqual(self.decide(proposal, "apply").status, "applied")
                with use_operator():
                    self.assertEqual(RegisterEntry.objects.filter(operation_id=proposal.pk).count(), 1)
                    self.assertEqual(
                        RegisterGrantDecision.objects.filter(register_grant=proposal, kind="apply").count(), 1
                    )

    def test_failed_application_rolls_back_member_particulars_decision_entry_and_supply(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        with patch.object(RegisterGrant, "save", side_effect=RuntimeError("write failed")), self.assertRaises(
            RuntimeError
        ):
            self.decide(proposal, "apply")
        with use_operator():
            self.assertFalse(RegisterMember.objects.filter(pk=proposal.member).exists())
            self.assertFalse(RegisterMemberParticulars.objects.filter(member_id=proposal.member).exists())
            self.assertEqual(ShareRegister.objects.get(token=self.token).issued_supply, 100)
            self.assertEqual(list(proposal.decisions.values_list("kind", flat=True)), ["approve"])
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_raw_sql_and_orm_cannot_forge_decisions_effects_or_projection(self):
        proposal = self.prepare()
        for write in (
            lambda: RegisterGrant.objects.filter(pk=proposal.pk).update(terms="Forged"),
            lambda: RegisterGrant.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_by=self.owner, reviewed_at=timezone.now()
            ),
            lambda: RegisterGrantDecision.objects.create(
                register_grant=proposal,
                kind="apply",
                decided_by=self.owner,
                appointment=self.appointment,
                idempotency_key=uuid4(),
                digest="0" * 64,
                decided_at=timezone.now(),
            ),
            lambda: RegisterPosition.objects.filter(register=self.token.stored_register).update(shares=900),
            lambda: record_entry(
                register_id=self.token.stored_register.pk,
                operation_id=proposal.pk,
                kind="issue",
                changes=[{"member": str(self.member.pk), "shares": "25"}],
                effective_on=DAY,
                recorded_by=self.owner,
            ),
        ):
            with use_operator(), self.subTest(write=write), self.assertRaises(
                (DatabaseError, RegisterChangeConflict)
            ), atomic():
                write()
        with use_operator(), self.assertRaises(DatabaseError), atomic(), connections[
            current_alias()
        ].cursor() as cursor:
            cursor.execute(
                "INSERT INTO tokens_registerentry (uuid, created_at, updated_at, register_id, operation_id, "
                "sequence, kind, effective_on, changes, recorded_by_id, previous_hash, entry_hash) "
                "VALUES (%s, now(), now(), %s, %s, 0, 'issue', %s, %s::jsonb, %s, '', '')",
                [
                    uuid4(),
                    self.token.stored_register.pk,
                    uuid4(),
                    DAY,
                    '[{"member":"' + str(self.member.pk) + '","shares":"1"}]',
                    self.owner.pk,
                ],
            )
        self.decide(proposal, "approve")
        with company_operation(self.owner, self.company.pk, "register_grant_apply"), self.assertRaises(
            DatabaseError
        ), atomic():
            RegisterGrantDecision.objects.create(
                register_grant=proposal,
                kind="apply",
                decided_by=self.owner,
                appointment=self.appointment,
                idempotency_key=uuid4(),
                digest=preview(self.owner, self.appointment, proposal)["preview_digest"],
                decided_at=timezone.now(),
            )
        with use_operator():
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "100")

    def test_legacy_deployment_uncertainty_blocks_preparation_and_application_at_the_database(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        with use_operator():
            self.token.refresh_from_db()
        fields = {"deployment_tx_hash": "0x" + "a" * 64, "deployed_at": timezone.now(), "chain": "base"}
        for field, value in fields.items():
            previous = getattr(self.token, field)
            with self.subTest(field=field):
                try:
                    with use_operator():
                        ShareToken.objects.filter(pk=self.token.pk).update(**{field: value})
                    self.assertIn(
                        "imported_non_tokenised_register_required",
                        preview(self.owner, self.appointment, proposal)["unmet_requirements"],
                    )
                    with self.assertRaises(ValidationError):
                        self.prepare(operation_id=uuid4())
                    with self.assertRaises(ValidationError):
                        self.decide(proposal, "apply")
                    digest = preview(self.owner, self.appointment, proposal)["preview_digest"]
                    with company_operation(
                        self.owner, self.company.pk, "register_grant_apply"
                    ), self.assertRaisesMessage(DatabaseError, "exact current company authority and effect"), atomic():
                        RegisterGrantDecision.objects.create(
                            register_grant=proposal,
                            kind="apply",
                            decided_by=self.owner,
                            appointment=self.appointment,
                            idempotency_key=uuid4(),
                            digest=digest,
                            decided_at=timezone.now(),
                        )
                finally:
                    with use_operator():
                        ShareToken.objects.filter(pk=self.token.pk).update(**{field: previous})
        self.assertEqual(self.decide(proposal, "apply").status, "applied")

    def test_an_older_import_into_another_class_preserves_grant_sourced_member_identity(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        self.decide(proposal, "apply")
        with use_operator():
            member = RegisterMember.objects.get(pk=proposal.member)
            source = RegisterImport.objects.select_related("register_evidence", "asic_evidence").get(
                token=self.token, status="applied"
            )
            other = ShareToken.objects.create(
                company=self.company, name="Second class", symbol="SECOND", total_supply="1000"
            )
        payload = import_payload(
            other,
            source.register_evidence,
            source.asic_evidence,
            member,
            self.appointment,
            as_at=(DAY - timedelta(days=1)).isoformat(),
            former_members=[],
            members=[
                {
                    "member": str(member.pk),
                    "name": "Earlier Employee Name",
                    "residential_address": "Earlier company address",
                    "shares": "100",
                    "entered_on": (DAY - timedelta(days=2)).isoformat(),
                    "amount_paid": None,
                }
            ],
        )
        imported = prepare_import(self.owner, payload)
        self.assertEqual(apply_import(self.owner, self.appointment, imported).status, "applied")
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=member)
            self.assertEqual((held.name, held.as_at, held.source_grant_id), (proposal.name, DAY, proposal.pk))
            self.assertEqual(verify_register(other.stored_register.pk)["issued_supply"], "100")

    def test_a_real_later_particulars_change_keeps_new_member_grant_history(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        self.decide(proposal, "apply")
        change = prepare_particulars_change(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.appointment.pk,
            member=proposal.member,
            supporting_evidence=self.payload["terms_evidence"],
            name="Employee Renamed",
            residential_address=proposal.residential_address,
            as_at=DAY,
            reason="Company records changed name",
        )[0]
        for kind in ("approve", "apply"):
            digest = preview_particulars_decision(
                actor=self.owner, change_id=change.pk, appointment=self.appointment.pk, kind=kind
            )[1]["preview_digest"]
            decide_particulars_change(
                actor=self.owner,
                change_id=change.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member_id=proposal.member)
            self.assertEqual(
                (held.source_change_id, held.source_grant_id, held.name), (change.pk, None, "Employee Renamed")
            )
            self.assertEqual(RegisterGrant.objects.get(pk=proposal.pk).name, "Synthetic Employee")

    def test_separate_connections_replay_an_identical_application_once_and_changed_retry_conflicts(self):
        proposal = self.prepare()
        self.decide(proposal, "approve")
        request = {
            "actor": self.owner,
            "grant_id": proposal.pk,
            "appointment": self.appointment.pk,
            "kind": "apply",
            "idempotency_key": uuid4(),
            "preview_digest": preview(self.owner, self.appointment, proposal)["preview_digest"],
            "confirmation": True,
        }
        reached = Queue()

        def apply_once():
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        reached.put(cursor.fetchone())
                    return decide_grant(**request).status
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                Company.objects.select_for_update(no_key=True).get(pk=self.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid(), current_user")
                    blocker, expected_role = cursor.fetchone()
                futures = [pool.submit(apply_once) for _ in range(2)]
                workers = [reached.get(timeout=10) for _ in futures]
                self.assertEqual(len({blocker, *(pid for pid, _ in workers)}), 3)
                self.assertEqual({role for _, role in workers}, {expected_role})
                if settings.RLS_AMBIENT_ALIAS == APP_ALIAS:
                    self.assertEqual(expected_role, settings.RLS_ROLES["operator"])
                deadline = time.monotonic() + 10
                blocked = False
                while time.monotonic() < deadline:
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT bool_and(cardinality(pg_blocking_pids(pid)) > 0) "
                            "FROM pg_stat_activity WHERE pid = ANY(%s)",
                            [[pid for pid, _ in workers]],
                        )
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked)
            self.assertEqual([future.result(timeout=20) for future in futures], ["applied", "applied"])
        with self.assertRaises(RegisterChangeConflict):
            decide_grant(**{**request, "preview_digest": "0" * 64})
        with use_operator():
            self.assertEqual(RegisterEntry.objects.filter(operation_id=proposal.pk).count(), 1)
            self.assertEqual(RegisterGrantDecision.objects.filter(register_grant=proposal, kind="apply").count(), 1)
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "125")


class RegisterGrantMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_imported_identity_and_projection_and_refuses_to_discard_a_grant(self):
        with use_operator():
            owner, _, token, member, appointment, payload = grant_fixture()
            before = verify_register(token.stored_register.pk)
            held = RegisterMemberParticulars.objects.get(member=member)
            particulars = (held.pk, held.name, held.residential_address, held.source_import_id)
        try:
            historical = migrate_to([("tokens", "0093_company_register_wallet_link_guards")])
            old = historical.get_model("tokens", "RegisterMemberParticulars").objects.get(pk=held.pk)
            self.assertEqual((old.pk, old.name, old.residential_address, old.source_import_id), particulars)
        finally:
            restore_every_migration()
        with use_operator():
            self.assertEqual(verify_register(token.stored_register.pk), before)
            held.refresh_from_db()
            self.assertIsNone(held.source_grant_id)
        proposal = prepare_grant(actor=owner, **payload)[0]
        decide(owner, appointment, proposal, "approve")
        decide(owner, appointment, proposal, "apply")
        try:
            with self.assertRaisesMessage(RuntimeError, "Retain company register grants"):
                migrate_to([("tokens", "0093_company_register_wallet_link_guards")])
        finally:
            restore_every_migration()
        with use_operator():
            self.assertEqual(RegisterGrant.objects.get(pk=proposal.pk).status, "applied")
            self.assertEqual(verify_register(token.stored_register.pk)["issued_supply"], "125")


class ScopedRegisterGrantsTest(RunsOnTheScopedConnection, RegisterGrantsTest):
    def test_app_reads_only_its_company_grants_and_cannot_write_grants_or_decisions(self):
        proposal = self.prepare()
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(list(RegisterGrant.objects.values_list("uuid", flat=True)), [proposal.pk])
        for write in (
            lambda: RegisterGrant.objects.filter(pk=proposal.pk).update(terms="Forged"),
            lambda: list(RegisterGrantDecision.objects.all()),
            proposal.delete,
        ):
            with self.subTest(write=write), self.assertRaises(DatabaseError), atomic():
                write()
        self.no_principal_is_set()
        self.assertFalse(RegisterGrant.objects.exists())
        self.decide(proposal, "approve")
        self.assertEqual(self.decide(proposal, "apply").status, "applied")
