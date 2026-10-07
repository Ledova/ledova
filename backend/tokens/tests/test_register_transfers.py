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
    RegisterCorrection,
    RegisterEntry,
    RegisterMember,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterPosition,
    RegisterTransfer,
    RegisterTransferDecision,
    ShareToken,
)
from tokens.serializers.former_holder import FormerMemberSerializer
from tokens.services.former_holders import (
    member_left_on,
    purge_member_cessations,
    purge_member_particulars,
    retention_cutoff,
)
from tokens.services.register import (
    _certificate_pages,
    _stored_register,
    months_after,
    outputs_due,
)
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction,
    preview_correction_decision,
)
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
from tokens.services.register_transfers import (
    decide_transfer,
    particulars_snapshot,
    prepare_transfer,
    preview_transfer_decision,
    register_members,
)
from tokens.tests.test_register_events import DAY
from tokens.tests.test_register_grants import grant_fixture
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import apply_import, import_payload
from tokens.tests.test_register_imports import prepared as prepare_import


def transfer_fixture():
    owner, company, token, member, appointment, grant = grant_fixture()
    payload = {
        "operation_id": uuid4(),
        "appointment": appointment.pk,
        "token_id": token.pk,
        "from_member": member.pk,
        "to_member": uuid4(),
        "new_member": True,
        "name": "Synthetic Recipient",
        "residential_address": "7 Example Street, Sydney NSW 2000",
        "shares": "25",
        "signed_on": (timezone.now().date() - timedelta(days=4)).isoformat(),
        "lodged_on": (timezone.now().date() - timedelta(days=3)).isoformat(),
        "terms": "Non-paid transfer; both parties signed the retained instrument",
        "approving_director": "Synthetic Independent Director",
        "authority_reference": "SYNTHETIC-TRANSFER-1",
        "reason": "Enter the company-approved non-paid transfer",
        "authority_evidence": grant["authority_evidence"],
        "instrument_evidence": grant["terms_evidence"],
    }
    return owner, company, token, member, appointment, payload


def preview(owner, appointment, proposal, kind="apply", reason=""):
    return preview_transfer_decision(
        actor=owner, transfer_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=reason
    )[1]


def decide(owner, appointment, proposal, kind, **changes):
    return decide_transfer(
        actor=owner,
        transfer_id=proposal.pk,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=uuid4(),
        preview_digest=preview(owner, appointment, proposal, kind)["preview_digest"],
        confirmation=True,
        **changes
    )


class RegisterTransfersTest(AppointsTeam, TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, self.appointment, self.payload = transfer_fixture()
            self.administrator = self.appointment

    def prepare(self, **changes):
        return prepare_transfer(actor=self.owner, **{**self.payload, **changes})[0]

    def complete(self, proposal):
        decide(self.owner, self.appointment, proposal, "approve")
        return decide(self.owner, self.appointment, proposal, "apply")

    def correct(self, entry, effective_on):
        proposal = prepare_correction(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.appointment.pk,
            corrects_id=entry.pk,
            authority_evidence=self.payload["authority_evidence"],
            effective_on=effective_on,
            authority="director_resolution",
            approving_director="Synthetic Independent Director",
            authority_reference="SYNTHETIC-CORRECTION",
            reason="Compensate the exact entry",
        )[0]
        for kind in ("approve", "apply"):
            digest = preview_correction_decision(
                actor=self.owner, correction_id=proposal.pk, appointment=self.appointment.pk, kind=kind
            )[1]["preview_digest"]
            proposal = decide_correction(
                actor=self.owner,
                correction_id=proposal.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        return proposal.applied_entry

    def test_new_recipient_partial_transfer_has_real_roll_certificate_and_lodgement_deadline(self):
        proposal = self.prepare()
        self.assertEqual(preview(self.owner, self.appointment, proposal, "approve")["unmet_requirements"], [])
        self.assertEqual(prepare_transfer(actor=self.owner, **self.payload), (proposal, False))
        proposal = self.complete(proposal)
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member_id=proposal.to_member)
            self.assertEqual(
                (held.name, held.source_transfer_id, held.source_grant_id), (proposal.name, proposal.pk, None)
            )
            entry = proposal.register_entry
            self.assertEqual(
                (entry.kind, entry.effective_on, entry.recorded_by_id),
                ("transfer", timezone.now().date(), self.owner.pk),
            )
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "100")
            self.assertFalse(RegisterMemberCessation.objects.exists())
            self.assertEqual(holdings_at(self.token.stored_register, DAY), {self.member.pk: 100})
            rows = frozen_rows(self.token, self.token.stored_register, timezone.now().date())
            recipient = next(row for row in rows if row["member_id"] == proposal.to_member)
            self.assertEqual((recipient["shares"], recipient["user_id"]), (25, None))
            pages = _certificate_pages(self.token, entry)
            self.assertEqual([(page["shares"], page["holding"]) for page in pages], [(25, 25), (75, 75)])
            due = next(
                row
                for row in outputs_due(self.company)
                if row["sequence"] == entry.sequence and row["output"] == "certificate"
            )
            self.assertEqual(due["due_on"], months_after(proposal.lodged_on, 1))
            selected = {row["member"]: row for row in register_members(self.token)["members"]}
            self.assertEqual(selected[proposal.to_member]["current_shares"], "25")
        self.assertEqual(prepare_transfer(actor=self.owner, **self.payload), (proposal, False))

    def test_full_exit_return_and_compensations_keep_identity_and_transition_history(self):
        first = self.complete(self.prepare(shares="100"))
        with use_operator():
            with self.assertRaises(RegisterChangeConflict), atomic():
                record_entry(
                    register_id=self.token.stored_register.pk,
                    operation_id=uuid4(),
                    kind="correction",
                    changes=[
                        {"member": effect["member"], "shares": str(-int(effect["shares"]))}
                        for effect in first.register_entry.changes
                    ],
                    effective_on=timezone.now().date(),
                    recorded_by=self.owner,
                    corrects_id=first.register_entry_id,
                )
            ceased = RegisterMemberCessation.objects.get(member=self.member)
            self.assertIsNone(ceased.returned_entry_id)
            frozen = (ceased.pk, ceased.name, ceased.residential_address, ceased.particulars_snapshot, ceased.ceased_on)
            self.assertEqual((ceased.shares_at_cessation, ceased.entry_id), (100, first.register_entry_id))
            selected = next(row for row in register_members(self.token)["members"] if row["member"] == self.member.pk)
            self.assertEqual(
                (selected["current_shares"], selected["last_ceased_on"], selected["entered_on"]),
                ("0", timezone.now().date(), None),
            )
        returning = self.complete(
            self.prepare(
                operation_id=uuid4(),
                from_member=first.to_member,
                to_member=self.member.pk,
                new_member=False,
                name="",
                residential_address="",
                shares="50",
            )
        )
        backdated = retention_cutoff() - timedelta(days=1)
        correction = self.correct(returning.register_entry, backdated)
        with use_operator():
            rows = list(RegisterMemberCessation.objects.filter(member=self.member).order_by("entry__sequence"))
            self.assertEqual(len(rows), 2)
            self.assertEqual(
                (
                    rows[0].pk,
                    rows[0].name,
                    rows[0].residential_address,
                    rows[0].particulars_snapshot,
                    rows[0].ceased_on,
                ),
                frozen,
            )
            self.assertEqual(
                (rows[0].returned_entry_id, rows[0].returned_on), (returning.register_entry_id, timezone.now().date())
            )
            self.assertEqual(
                (rows[1].entry_id, rows[1].ceased_on, rows[1].entry.effective_on),
                (correction.pk, timezone.now().date(), backdated),
            )
            self.assertEqual(member_left_on(self.member.pk), timezone.now().date())
            self.assertEqual((purge_member_particulars(), purge_member_cessations()), (0, 0))
            for write in (
                lambda: rows[1].delete(),
                lambda: RegisterMemberParticulars.objects.filter(member=self.member).delete(),
                lambda: RegisterMemberCessation.objects.filter(pk=rows[0].pk).update(name="Forged"),
            ):
                with self.assertRaises(DatabaseError), atomic():
                    write()
        returned = self.correct(correction, backdated - timedelta(days=1))
        with use_operator():
            second = RegisterMemberCessation.objects.get(entry=correction, member=self.member)
            self.assertEqual((second.returned_entry_id, second.returned_on), (returned.pk, timezone.now().date()))
            history = FormerMemberSerializer(_stored_register(self.token)["former_members"], many=True).data
            row = next(row for row in history if row["source_entry"] == str(correction.pk))
            self.assertEqual(
                (row["source_effective_on"], row["returned_on"]),
                (backdated.isoformat(), timezone.now().date().isoformat()),
            )
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "100")

    def test_foreign_identity_dates_director_terms_and_instrument_fail_without_effect(self):
        for changes in (
            {"shares": "0"},
            {"shares": "101"},
            {"shares": "1.5"},
            {"shares": str(2**256)},
            {"to_member": self.member.pk},
            {"authority": "court_order"},
            {"instrument_evidence": self.payload["authority_evidence"]},
            {"authority_evidence": self.payload["instrument_evidence"]},
            {"approving_director": "  MIA   MEMBER "},
            {"approving_director": "synthetic recipient"},
            {"signed_on": timezone.now().date().isoformat()},
            {"lodged_on": (timezone.now().date() + timedelta(days=1)).isoformat()},
            {"name": ""},
            {"new_member": False},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.prepare(**changes)
        with use_operator():
            stranger = transfer_fixture()
        with self.assertRaises(NotFound):
            self.prepare(token_id=stranger[2].pk)
        with self.assertRaises(ValidationError):
            self.prepare(instrument_evidence=stranger[5]["instrument_evidence"])
        with self.assertRaises(ValidationError):
            self.prepare(from_member=stranger[3].pk)
        with self.assertRaises(ValidationError):
            self.prepare(to_member=stranger[3].pk, new_member=False)
        unicode_recipient = self.complete(self.prepare(name="Straße Example"))
        with self.assertRaises(ValidationError):
            self.prepare(
                operation_id=uuid4(),
                to_member=unicode_recipient.to_member,
                new_member=False,
                name="",
                residential_address="",
                approving_director=" STRASSE   EXAMPLE ",
            )

    def test_changed_retries_stale_identity_head_revoked_approval_and_tampered_instrument_refuse(self):
        proposal = self.prepare()
        for changes in ({"shares": "26"}, {"name": "Other recipient"}, {"lodged_on": self.payload["signed_on"]}):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                self.prepare(**changes)
        with self.assertRaises(ValidationError):
            self.prepare(name="", residential_address="")
        decide(self.owner, self.appointment, proposal, "approve")
        digest = preview(self.owner, self.appointment, proposal)["preview_digest"]
        other = self.complete(self.prepare(operation_id=uuid4(), to_member=uuid4(), name="Other", shares="1"))
        with self.assertRaises(RegisterChangeConflict):
            decide_transfer(
                actor=self.owner,
                transfer_id=proposal.pk,
                appointment=self.appointment.pk,
                kind="apply",
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        with proposal.instrument_file.storage.open(proposal.instrument_file.name, "wb") as stored:
            stored.write(b"changed instrument")
        self.assertIn("evidence_unavailable", preview(self.owner, self.appointment, proposal)["unmet_requirements"])
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        fresh = self.prepare(operation_id=uuid4(), to_member=uuid4(), name="Another")
        decide(approver, approving, fresh, "approve")
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        self.assertIn("approval_lapsed", preview(self.owner, self.appointment, fresh)["unmet_requirements"])
        self.assertEqual(other.status, "applied")

    def test_real_expired_legacy_identity_can_be_purged_and_return_under_the_same_member(self):
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=self.member)
            snapshot = particulars_snapshot(held)
        ceased_on = retention_cutoff() - timedelta(days=1)
        try:
            historical = migrate_to([("tokens", "0096_company_register_transfers")])
            with use_operator():
                entry = record_entry(
                    register_id=self.token.stored_register.pk,
                    operation_id=uuid4(),
                    kind="cessation",
                    changes=[{"member": str(self.member.pk), "shares": "-100"}],
                    effective_on=ceased_on,
                    recorded_by=self.owner,
                )
                row = historical.get_model("tokens", "RegisterMemberCessation").objects.create(
                    company_id=self.company.pk,
                    register_id=self.token.stored_register.pk,
                    member_id=self.member.pk,
                    entry_id=entry.pk,
                    ceased_on=ceased_on,
                    shares_at_cessation=100,
                    name=held.name,
                    residential_address=held.residential_address,
                    identity_source="particulars",
                    particulars_snapshot=snapshot,
                )
                historical.get_model("tokens", "RegisterMemberCessation").objects.filter(pk=row.pk).update(
                    created_at=timezone.make_aware(timezone.datetime.combine(ceased_on, timezone.datetime.min.time()))
                )
        finally:
            restore_every_migration()
        with company_operation(self.owner, self.company.pk, "register_transfer_prepare"), self.assertRaises(
            DatabaseError
        ), atomic():
            RegisterMemberCessation.objects.filter(member=self.member).delete()
        with use_operator():
            self.assertEqual(purge_member_particulars(), 1)
            self.assertEqual(purge_member_cessations(), 1)
            selected = next(row for row in register_members(self.token)["members"] if row["member"] == self.member.pk)
            self.assertEqual((selected["particulars_retained"], selected["name"]), (False, None))
        granted = prepare_grant(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.appointment.pk,
            token_id=self.token.pk,
            member=self.payload["to_member"],
            new_member=True,
            name=self.payload["name"],
            residential_address=self.payload["residential_address"],
            shares="100",
            effective_on=timezone.now().date(),
            terms="Non-paid supported grant",
            authority_reference="SYNTHETIC-DONOR-GRANT",
            reason="Record the actual donor grant",
            authority_evidence=self.payload["authority_evidence"],
            terms_evidence=self.payload["instrument_evidence"],
            acceptance_required=False,
        )[0]
        for kind in ("approve", "apply"):
            digest = preview_grant_decision(
                actor=self.owner, grant_id=granted.pk, appointment=self.appointment.pk, kind=kind
            )[1]["preview_digest"]
            granted = decide_grant(
                actor=self.owner,
                grant_id=granted.pk,
                appointment=self.appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )
        payload = {
            **self.payload,
            "operation_id": uuid4(),
            "from_member": granted.member,
            "to_member": self.member.pk,
            "new_member": False,
            "name": "Returning Recorded Member",
            "residential_address": "8 New Example Street, Sydney NSW 2000",
        }
        returning = prepare_transfer(actor=self.owner, **payload)[0]
        self.assertTrue(returning.new_particulars)
        self.complete(returning)
        self.assertEqual(prepare_transfer(actor=self.owner, **payload), (returning, False))
        with self.assertRaises(ValidationError):
            prepare_transfer(actor=self.owner, **{**payload, "name": "", "residential_address": ""})
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=self.member)
            self.assertEqual((held.name, held.source_transfer_id), ("Returning Recorded Member", returning.pk))
            self.assertFalse(RegisterMemberCessation.objects.filter(member=self.member).exists())
            self.assertEqual(
                RegisterPosition.objects.get(member=self.member, register=self.token.stored_register).entered_on,
                timezone.now().date(),
            )
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "100")

    def test_current_exit_rejects_future_purge_and_another_class_keeps_current_particulars(self):
        self.complete(self.prepare(shares="100"))
        with use_operator():
            with self.assertRaises(DatabaseError), atomic():
                purge_member_particulars(now=timezone.now() + timedelta(days=4000))
            with self.assertRaises(DatabaseError), atomic():
                purge_member_cessations(now=timezone.now() + timedelta(days=4000))
            source = self.token.register_imports.select_related("register_evidence", "asic_evidence").get(
                status="applied"
            )
            other = ShareToken.objects.create(
                company=self.company, name="Other class", symbol="OTHER", total_supply="1000"
            )
        imported = prepare_import(
            self.owner,
            import_payload(
                other, source.register_evidence, source.asic_evidence, self.member, self.appointment, former_members=[]
            ),
        )
        apply_import(self.owner, self.appointment, imported)
        with use_operator():
            self.assertEqual(purge_member_particulars(now=timezone.now() + timedelta(days=4000)), 0)
            self.assertEqual(purge_member_cessations(now=timezone.now() + timedelta(days=4000)), 0)
            self.assertTrue(RegisterMemberParticulars.objects.filter(member=self.member).exists())

    def test_later_particulars_and_older_import_preserve_transfer_source_history(self):
        transfer = self.complete(self.prepare())
        with use_operator():
            recipient = RegisterMember.objects.get(pk=transfer.to_member)
            source = self.token.register_imports.select_related("register_evidence", "asic_evidence").get(
                status="applied"
            )
            other = ShareToken.objects.create(
                company=self.company, name="Other class", symbol="OTHER", total_supply="1000"
            )
        imported = prepare_import(
            self.owner,
            import_payload(
                other,
                source.register_evidence,
                source.asic_evidence,
                recipient,
                self.appointment,
                as_at=DAY.isoformat(),
                former_members=[],
            ),
        )
        apply_import(self.owner, self.appointment, imported)
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member=recipient)
            self.assertEqual((held.name, held.source_transfer_id), (transfer.name, transfer.pk))
        change = prepare_particulars_change(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.appointment.pk,
            member=recipient.pk,
            supporting_evidence=self.payload["instrument_evidence"],
            name="Recipient Renamed",
            residential_address=transfer.residential_address,
            as_at=timezone.now().date(),
            reason="Company records renamed recipient",
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
            held = RegisterMemberParticulars.objects.get(member=recipient)
            self.assertEqual((held.source_transfer_id, held.source_change_id), (None, change.pk))
            self.assertEqual(RegisterTransfer.objects.get(pk=transfer.pk).name, transfer.name)

    def test_failed_application_and_raw_forgery_roll_back_all_effects(self):
        proposal = self.prepare(shares="100")
        decide(self.owner, self.appointment, proposal, "approve")
        with patch.object(RegisterTransfer, "save", side_effect=RuntimeError("write failed")), self.assertRaises(
            RuntimeError
        ):
            decide(self.owner, self.appointment, proposal, "apply")
        with use_operator():
            self.assertFalse(RegisterMember.objects.filter(pk=proposal.to_member).exists())
            self.assertFalse(RegisterMemberParticulars.objects.filter(member_id=proposal.to_member).exists())
            self.assertFalse(RegisterMemberCessation.objects.exists())
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "100")
            for write in (
                lambda: RegisterTransfer.objects.filter(pk=proposal.pk).update(terms="Forged"),
                lambda: RegisterTransferDecision.objects.create(
                    register_transfer=proposal,
                    kind="apply",
                    decided_by=self.owner,
                    appointment=self.appointment,
                    idempotency_key=uuid4(),
                    digest="0" * 64,
                    decided_at=timezone.now(),
                ),
                lambda: RegisterPosition.objects.filter(member=self.member).update(shares=900),
                lambda: RegisterEntry.objects.create(
                    register=self.token.stored_register,
                    operation_id=uuid4(),
                    kind="cessation",
                    changes=[{"member": str(self.member.pk), "shares": "-100"}],
                    effective_on=timezone.now().date(),
                    recorded_by=self.owner,
                ),
                lambda: record_entry(
                    register_id=self.token.stored_register.pk,
                    operation_id=uuid4(),
                    kind="transfer",
                    changes=[
                        {"member": str(self.member.pk), "shares": "-1"},
                        {"member": str(proposal.to_member), "shares": "1"},
                    ],
                    effective_on=timezone.now().date(),
                    recorded_by=self.owner,
                ),
            ):
                with self.assertRaises((DatabaseError, RegisterChangeConflict)), atomic():
                    write()
        self.assertEqual(decide(self.owner, self.appointment, proposal, "apply").status, "applied")

    def test_actual_approval_expiry_at_deferred_check_rolls_back_exit_and_new_identity(self):
        approver, approving = self.appoint(
            [CompanyCapability.APPROVE], expires_at=timezone.now() + timedelta(seconds=10)
        )
        proposal = self.prepare(shares="100")
        decide(approver, approving, proposal, "approve")
        original_save = RegisterTransfer.save

        def expire_after_effect(instance, *args, **kwargs):
            result = original_save(instance, *args, **kwargs)
            if instance.pk == proposal.pk and instance.status == "applied":
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp())),0)+0.05)",
                        [approving.expires_at],
                    )
            return result

        with patch.object(RegisterTransfer, "save", expire_after_effect), self.assertRaises(RegisterChangeConflict):
            decide(self.owner, self.appointment, proposal, "apply")
        with use_operator():
            self.assertFalse(RegisterMember.objects.filter(pk=proposal.to_member).exists())
            self.assertFalse(RegisterMemberCessation.objects.exists())
            self.assertEqual(list(proposal.decisions.values_list("kind", flat=True)), ["approve"])
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        self.assertEqual(self.complete(proposal).status, "applied")

    def test_correction_approval_expiry_after_return_effect_rolls_back_and_healthy_retry_succeeds(self):
        transfer = self.complete(self.prepare(shares="100"))
        proposal = prepare_correction(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=self.appointment.pk,
            corrects_id=transfer.register_entry_id,
            authority_evidence=self.payload["authority_evidence"],
            effective_on=DAY,
            authority="director_resolution",
            approving_director="Synthetic Independent Director",
            authority_reference="SYNTHETIC-EXPIRING-CORRECTION",
            reason="Compensate the exact transfer",
        )[0]
        approver, approving = self.appoint(
            [CompanyCapability.APPROVE], expires_at=timezone.now() + timedelta(seconds=10)
        )

        def decide_current(actor, appointment, kind):
            digest = preview_correction_decision(
                actor=actor, correction_id=proposal.pk, appointment=appointment.pk, kind=kind
            )[1]["preview_digest"]
            return decide_correction(
                actor=actor,
                correction_id=proposal.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=digest,
                confirmation=True,
            )

        decide_current(approver, approving, "approve")
        original_save = RegisterCorrection.save

        def expire_after_effect(instance, *args, **kwargs):
            result = original_save(instance, *args, **kwargs)
            if instance.pk == proposal.pk and instance.status == "applied":
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "SELECT pg_sleep(GREATEST(EXTRACT(EPOCH FROM (%s::timestamptz-clock_timestamp())),0)+0.05)",
                        [approving.expires_at],
                    )
            return result

        with use_operator():
            initial = verify_register(self.token.stored_register.pk)
        with patch.object(RegisterCorrection, "save", expire_after_effect), self.assertRaises(RegisterChangeConflict):
            decide_current(self.owner, self.appointment, "apply")
        with use_operator():
            self.assertEqual(verify_register(self.token.stored_register.pk), initial)
            self.assertFalse(RegisterEntry.objects.filter(corrects_id=transfer.register_entry_id).exists())
            self.assertIsNone(RegisterMemberCessation.objects.get(member=self.member).returned_entry_id)
            self.assertEqual(RegisterMemberCessation.objects.count(), 1)
            self.assertEqual(list(proposal.decisions.values_list("kind", flat=True)), ["approve"])
        decide_current(self.owner, self.appointment, "approve")
        correction = decide_current(self.owner, self.appointment, "apply")
        with use_operator():
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
            self.assertEqual(
                RegisterMemberCessation.objects.get(member=self.member).returned_entry_id, correction.applied_entry_id
            )

    def test_two_distinct_connections_replay_one_transfer_and_changed_receipt_conflicts(self):
        proposal = self.prepare(shares="100")
        decide(self.owner, self.appointment, proposal, "approve")
        request = {
            "actor": self.owner,
            "transfer_id": proposal.pk,
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
                        cursor.execute("SELECT pg_backend_pid(),current_user")
                        reached.put(cursor.fetchone())
                    return decide_transfer(**request).status
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            with use_operator(), atomic():
                Company.objects.select_for_update(no_key=True).get(pk=self.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid(),current_user")
                    blocker, role = cursor.fetchone()
                futures = [pool.submit(apply_once) for _ in range(2)]
                workers = [reached.get(timeout=10) for _ in futures]
                self.assertEqual(len({blocker, *(pid for pid, _ in workers)}), 3)
                self.assertEqual({worker_role for _, worker_role in workers}, {role})
                if settings.RLS_AMBIENT_ALIAS == APP_ALIAS:
                    self.assertEqual(role, settings.RLS_ROLES["operator"])
                deadline = time.monotonic() + 10
                blocked = False
                while time.monotonic() < deadline:
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT bool_and(cardinality(pg_blocking_pids(pid))>0) "
                            "FROM pg_stat_activity WHERE pid=ANY(%s)",
                            [[pid for pid, _ in workers]],
                        )
                        blocked = cursor.fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.02)
                self.assertTrue(blocked)
            self.assertEqual([future.result(timeout=20) for future in futures], ["applied", "applied"])
        with self.assertRaises(RegisterChangeConflict):
            decide_transfer(**{**request, "preview_digest": "0" * 64})
        with use_operator():
            self.assertEqual(RegisterEntry.objects.filter(operation_id=proposal.pk).count(), 1)
            self.assertEqual(RegisterMemberCessation.objects.filter(entry__operation_id=proposal.pk).count(), 1)


class RegisterTransferMigrationTest(TransactionTestCase):
    def test_empty_reverse_preserves_history_and_retained_transfer_refuses_discard(self):
        with use_operator():
            owner, _, token, member, appointment, payload = transfer_fixture()
            before = verify_register(token.stored_register.pk)
            held = RegisterMemberParticulars.objects.get(member=member)
            source = held.source_import_id
        try:
            historical = migrate_to([("tokens", "0095_company_register_grant_guards")])
            old = historical.get_model("tokens", "RegisterMemberParticulars").objects.get(pk=held.pk)
            self.assertEqual(old.source_import_id, source)
        finally:
            restore_every_migration()
        with use_operator():
            self.assertEqual(verify_register(token.stored_register.pk), before)
        proposal = prepare_transfer(actor=owner, **payload)[0]
        try:
            with self.assertRaisesMessage(RuntimeError, "Retain company register transfers"):
                migrate_to([("tokens", "0095_company_register_grant_guards")])
        finally:
            restore_every_migration()
        with use_operator():
            self.assertEqual(RegisterTransfer.objects.get(pk=proposal.pk).status, "submitted")


class ScopedRegisterTransfersTest(RunsOnTheScopedConnection, RegisterTransfersTest):
    def test_app_reads_only_own_transfers_and_cannot_write_effect_or_decisions(self):
        proposal = self.prepare()
        self.the_principal_the_middleware_would_set(self.owner)
        self.assertEqual(list(RegisterTransfer.objects.values_list("uuid", flat=True)), [proposal.pk])
        for write in (
            lambda: RegisterTransfer.objects.filter(pk=proposal.pk).update(terms="Forged"),
            lambda: list(RegisterTransferDecision.objects.all()),
            proposal.delete,
        ):
            with self.assertRaises(DatabaseError), atomic():
                write()
        self.no_principal_is_set()
        self.assertFalse(RegisterTransfer.objects.exists())
        self.assertEqual(self.complete(proposal).status, "applied")
