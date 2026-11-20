from urllib.parse import urlencode
from uuid import uuid4

from django.conf import settings
from django.contrib.admin.models import ADDITION, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db import DatabaseError, connections
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import Company, CompanyDisposal
from companies.services.company_deletion import KEPT_ON_CHAIN
from shared.db import APP_ALIAS, OPERATOR_ALIAS, atomic, use_migrate, use_operator
from shared.storage import private_storage
from shared.tasks.queue import defer
from shared.tests.core_fixtures import (
    CoreFixtures,
    import_payload,
    populated_register,
    retained_evidence,
)
from tokens.models import (
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterPosition,
    ShareToken,
    TokenDeployment,
)
from users.models import Notification, UserProfile
from users.tasks.notifications import send_push_notification


class CompanyDeletionTest(CoreFixtures, APITransactionTestCase):
    databases = {"default", "app", "operator"}

    def test_admin_deletes_company_with_its_records_and_files_while_others_stay(self):
        retired = self.client.post(
            "/api/v1/tokens/",
            {"company": str(self.company.pk), "name": "Retired setup class", "symbol": "RET", "totalSupply": "1000"},
            format="json",
        )
        self.assertEqual(retired.status_code, 201, retired.content)
        with use_operator():
            retired_token = ShareToken.objects.get(pk=retired.json()["uuid"])
        draft = self.client.post(
            "/api/v1/tokens/register-imports/",
            {
                **import_payload(self.owner, self.appointment, retired_token),
                "members": [],
                "former_members": [],
                "asic_issued_total": "0",
                "asic_member_count": 0,
            },
            format="json",
        )
        self.assertEqual(draft.status_code, 201, draft.content)
        self.decision("/api/v1/tokens/register-imports/", draft.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-imports/", draft.json()["uuid"], "apply")
        removed = self.client.delete(
            f"/api/v1/tokens/{retired_token.pk}/?" + urlencode({"expected_updated_at": retired.json()["updatedAt"]})
        )
        self.assertEqual(removed.status_code, 204, removed.content)
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
        self.assertEqual(member_client.delete(f"/api/v1/companies/{self.company.pk}/").status_code, 404)
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
        stored = document.file.name
        self.assertTrue(private_storage().exists(stored))
        deleted = self.client.delete(f"/api/v1/companies/{self.company.pk}/")
        self.assertEqual(deleted.status_code, 204, deleted.content)
        self.assertEqual(self.client.delete(f"/api/v1/companies/{self.company.pk}/").status_code, 404)
        self.assertFalse(private_storage().exists(stored))
        self.assertEqual({path: path.read_bytes() for path in foreign_files}, foreign_contents)
        with use_migrate():
            receipt = CompanyDisposal.objects.get(company_id=self.company.pk)
            self.assertEqual((receipt.actor_id, receipt.appointment_id), (self.owner.pk, self.appointment.pk))
            self.assertIsNotNone(receipt.database_disposed_at)
            self.assertEqual(receipt.manifest, {})
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(ShareToken.all_objects.filter(company_id=self.company.pk).exists())
            self.assertFalse(Notification.objects.filter(pk=notice.pk).exists())
            self.assertTrue(Notification.objects.filter(pk=foreign_notice.pk).exists())
            self.assertFalse(LogEntry.objects.filter(pk=audit.pk).exists())
            self.assertEqual(
                sum(RegisterPosition.objects.filter(register__token=foreign_token).values_list("shares", flat=True)),
                100,
            )
            self.assertEqual(UserProfile.objects.get(pk=self.foreign_profile.pk).full_name, foreign_profile)
            self.assertTrue(type(self.owner).objects.get(pk=self.owner.pk).is_active)
            with connections["default"].cursor() as cursor:
                cursor.execute("SELECT count(*) FROM procrastinate_jobs WHERE id = %s", [job])
                self.assertEqual(cursor.fetchone()[0], 0)

    def test_only_a_current_admin_through_the_delete_command_removes_a_company(self):
        for alias in (APP_ALIAS, OPERATOR_ALIAS):
            with self.subTest(role=alias), atomic(using=alias):
                with connections[alias].cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES[alias])
                    cursor.execute(
                        "SELECT set_config('app.company_disposal', %s, true), set_config('app.company_id', %s, true), "
                        "set_config('app.company_operation', 'company_delete', true), "
                        "set_config('app.user_id', %s, true)",
                        [str(uuid4()), str(self.company.pk), str(self.foreign.pk)],
                    )
                with self.assertRaises(DatabaseError), atomic(using=alias):
                    with connections[alias].cursor() as cursor:
                        cursor.execute(
                            "INSERT INTO companies_companydisposal (uuid, created_at, updated_at, company_id, "
                            "actor_id, appointment_id, manifest, transaction_id) "
                            "VALUES (%s, now(), now(), %s, %s, %s, '{}', txid_current())",
                            [uuid4(), self.company.pk, self.foreign.pk, self.foreign_appointment.pk],
                        )
                if alias == OPERATOR_ALIAS:
                    with self.assertRaises(DatabaseError), atomic(using=alias):
                        with connections[alias].cursor() as cursor:
                            cursor.execute(
                                "DELETE FROM tokens_registerentry WHERE register_id = %s",
                                [self.token.stored_register.pk],
                            )
        with use_operator():
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
                    "identifier": "synthetic-deletion",
                    "authorized_shares": "100",
                    "issuer_wallet": str(uuid4()),
                    "decimals": 0,
                },
            )
        refused = self.client.delete(f"/api/v1/companies/{self.company.pk}/")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn(KEPT_ON_CHAIN, refused.content.decode())
        with use_migrate():
            self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(CompanyDisposal.objects.exists())
            self.assertTrue(TokenDeployment.objects.filter(pk=journal.pk).exists())
            self.assertTrue(RegisterEntry.objects.filter(register__token=self.token).exists())
