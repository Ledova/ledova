import json
from io import StringIO
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.admin.models import ADDITION, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, connections
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import Company, CompanyDisposal
from companies.services.company_disposal import (
    complete_company_disposal,
    dispose_company,
    preview_company_disposal,
)
from shared.db import APP_ALIAS, OPERATOR_ALIAS, atomic, use_migrate, use_operator
from shared.storage import private_storage
from shared.tasks.queue import defer
from shared.tests.core_fixtures import (
    CoreFixtures,
    populated_register,
    retained_evidence,
)
from tokens.models import (
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterPosition,
    TokenDeployment,
)
from tokens.services.company_pack_outputs import prepare_company_pack
from users.models import Notification, UserProfile
from users.tasks.notifications import send_push_notification


class CompanyDisposalTest(CoreFixtures, APITransactionTestCase):
    databases = {"default", "app", "operator"}

    def pack(self):
        archive, _ = prepare_company_pack(
            actor=self.owner,
            company_id=self.company.pk,
            appointment=self.appointment.pk,
            instruction="SYNTHETIC-EXIT",
            recipient="Synthetic company representative",
        )
        self.addCleanup(archive.close)
        path = self.root / "company-pack.zip"
        path.write_bytes(archive.read())
        return {"company_id": self.company.pk, "appointment_id": self.appointment.pk, "pack": path}

    def test_reviewed_disposal_preserves_foreign_records_and_retries_failed_file_removal(self):
        foreign_token, _ = populated_register(self.foreign, self.foreign_company, self.foreign_appointment)
        award = self.award_payload()
        promised = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(promised.status_code, 201, promised.content)
        vested = self.client.post(
            "/api/v1/tokens/register-award-vestings/", self.vesting_payload(award["operation_id"]), format="json"
        )
        self.assertEqual(vested.status_code, 201, vested.content)
        grant = self.client.post("/api/v1/tokens/register-grants/", self.linked_grant_payload(award), format="json")
        self.assertEqual(grant.status_code, 201, grant.content)
        self.decision("/api/v1/tokens/register-grants/", grant.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-grants/", grant.json()["uuid"], "apply")
        allotment = self.client.post("/api/v1/tokens/register-allotments/", self.allotment_payload(), format="json")
        self.assertEqual(allotment.status_code, 201, allotment.content)
        self.decision("/api/v1/tokens/register-allotments/", allotment.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-allotments/", allotment.json()["uuid"], "apply")
        document = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.CLASS_RIGHTS)
        rights = self.client.post(
            f"/api/v1/tokens/{self.token.pk}/class-rights/",
            {
                "appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "previous_revision": 0,
                "summary": "One vote per share.",
                "documents": [str(document.pk)],
            },
            format="json",
        )
        self.assertEqual(rights.status_code, 201, rights.content)
        invitation = self.client.post("/api/v1/tokens/member-invitations/", self.invitation_payload(), format="json")
        self.assertEqual(invitation.status_code, 201, invitation.content)
        member_client = APIClient()
        member_client.force_authenticate(self.foreign)
        accepted = member_client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {
                "code": invitation.json()["code"],
                "user_account": str(self.foreign_profile.user_account.pk),
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        with use_operator():
            notice = Notification.objects.create(
                user=self.foreign,
                title="Shares issued",
                body=self.company.name,
                data={"record": accepted.json()["uuid"]},
            )
            foreign_notice = Notification.objects.create(user=self.foreign, title="Unrelated", body="Keep")
            job = defer(
                send_push_notification,
                user_id=str(self.foreign.pk),
                title="Shares issued",
                body=self.company.name,
                data={"record": accepted.json()["uuid"]},
            )
            audit = LogEntry.objects.create(
                user=self.owner,
                content_type=ContentType.objects.get_for_model(Company),
                object_id=str(self.company.pk),
                object_repr=self.company.name,
                action_flag=ADDITION,
            )
            foreign_files = sorted(
                path for path in self.root.rglob("*.bin") if str(self.foreign_company.pk) in str(path)
            )
            foreign_contents = {path: path.read_bytes() for path in foreign_files}
            foreign_profile = UserProfile.objects.get(pk=self.foreign_profile.pk).full_name
        fields = self.pack()
        preview = preview_company_disposal(**fields)
        stored = document.file.name
        storage, delete = private_storage(), private_storage().delete
        save = CompanyDisposal.save

        def fail_after_deletion(instance, *args, **kwargs):
            if "database_disposed_at" in (kwargs.get("update_fields") or []):
                self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
                raise RuntimeError("Synthetic failure after row deletion")
            return save(instance, *args, **kwargs)

        with patch.object(CompanyDisposal, "save", autospec=True, side_effect=fail_after_deletion):
            with self.assertRaises(RuntimeError):
                dispose_company(
                    **fields,
                    digest=preview["digest"],
                    authorisation_reference="EXIT-001",
                    handover_reference="DELIVERED-001",
                    purpose_review_reference="REVIEW-001",
                )
        with use_migrate():
            self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(CompanyDisposal.objects.exists())
        self.assertTrue(storage.exists(stored))

        def remove(name):
            if name == stored:
                raise OSError("Synthetic storage refusal")
            delete(name)

        with patch.object(storage, "delete", side_effect=remove):
            receipt = dispose_company(
                **fields,
                digest=preview["digest"],
                authorisation_reference="EXIT-001",
                handover_reference="DELIVERED-001",
                purpose_review_reference="REVIEW-001",
            )
        self.assertIsNotNone(receipt.database_disposed_at)
        self.assertIsNone(receipt.completed_at)
        self.assertEqual(receipt.pending_files, [stored])
        with use_migrate():
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(Notification.objects.filter(pk=notice.pk).exists())
            self.assertTrue(Notification.objects.filter(pk=foreign_notice.pk).exists())
            self.assertFalse(LogEntry.objects.filter(pk=audit.pk).exists())
            self.assertEqual(
                sum(RegisterPosition.objects.filter(register__token=foreign_token).values_list("shares", flat=True)),
                100,
            )
            self.assertEqual(UserProfile.objects.get(pk=self.foreign_profile.pk).full_name, foreign_profile)
            self.assertTrue(self.owner.is_active)
            self.assertEqual(CompanyDisposal.objects.get(pk=receipt.pk).manifest, {})
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT count(*) FROM procrastinate_jobs WHERE id = %s", [job])
                self.assertEqual(cursor.fetchone()[0], 0)
        with patch.object(storage, "listdir", side_effect=OSError("Synthetic listing failure")):
            with self.assertRaises(OSError):
                complete_company_disposal(receipt.pk)
            status = StringIO()
            call_command("company_disposal", "status", company=self.company.pk, stdout=status)
            self.assertEqual(json.loads(status.getvalue())["receipt"], str(receipt.pk))
        complete = complete_company_disposal(receipt.pk)
        self.assertIsNotNone(complete.completed_at)
        self.assertEqual(complete.pending_files, [])
        self.assertFalse(storage.exists(stored))
        self.assertEqual({path: path.read_bytes() for path in foreign_files}, foreign_contents)
        self.assertIsNotNone(complete_company_disposal(receipt.pk).completed_at)

    def test_runtime_roles_stale_reviews_and_missing_confirmations_cannot_dispose_company(self):
        fields = self.pack()
        preview = preview_company_disposal(**fields)
        with self.assertRaises(CommandError):
            call_command(
                "company_disposal",
                "dispose",
                company=self.company.pk,
                appointment=self.appointment.pk,
                digest=preview["digest"],
                stdout=StringIO(),
            )
        with self.assertRaises(ValueError):
            preview_company_disposal(**{**fields, "appointment_id": self.foreign_appointment.pk})
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(description="Changed after review")
        with self.assertRaises(ValueError):
            dispose_company(
                **fields,
                digest=preview["digest"],
                authorisation_reference="EXIT-002",
                handover_reference="DELIVERED-002",
                purpose_review_reference="REVIEW-002",
            )
        for alias in (APP_ALIAS, OPERATOR_ALIAS):
            with self.subTest(role=alias), atomic(using=alias):
                with connections[alias].cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES[alias])
                    cursor.execute(
                        "SELECT set_config('app.company_disposal', %s, true), "
                        "set_config('app.company_id', %s, true)",
                        [str(uuid4()), str(self.company.pk)],
                    )
                with self.assertRaises(DatabaseError), atomic(using=alias):
                    with connections[alias].cursor() as cursor:
                        cursor.execute("SELECT companies_disposal_allows('companies_company', %s)", [self.company.pk])
                with self.assertRaises(DatabaseError), atomic(using=alias):
                    with connections[alias].cursor() as cursor:
                        cursor.execute("SELECT * FROM companies_companydisposal")
                if alias == OPERATOR_ALIAS:
                    with self.assertRaises(DatabaseError), atomic(using=alias):
                        with connections[alias].cursor() as cursor:
                            cursor.execute(
                                "DELETE FROM tokens_registerentry WHERE register_id = %s",
                                [self.token.stored_register.pk],
                            )
        with use_migrate():
            self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(CompanyDisposal.objects.exists())
        with use_operator():
            RegisterPosition.objects.get(register__token=self.token)
            journal = TokenDeployment.objects.create(
                token_id=self.token.pk,
                company_id=self.company.pk,
                intent={
                    "chain_id": 84532,
                    "sender": "0x" + "11" * 20,
                    "to": "0x" + "22" * 20,
                    "value": "0",
                    "data": "0x1234",
                    "name": "Synthetic class",
                    "symbol": "ORD",
                    "identifier": "synthetic-disposal",
                    "authorized_shares": "100",
                    "issuer_wallet": str(uuid4()),
                    "decimals": 0,
                },
            )
        with self.assertRaisesRegex(ValueError, "Retained execution history"):
            preview_company_disposal(**fields)
        with use_migrate():
            self.assertTrue(TokenDeployment.objects.filter(pk=journal.pk).exists())
            self.assertTrue(RegisterEntry.objects.filter(register__token=self.token).exists())
