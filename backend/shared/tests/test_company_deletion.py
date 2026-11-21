import json
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import urlencode
from uuid import uuid4

from django.conf import settings
from django.contrib.admin.models import ADDITION, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import (
    Company,
    CompanyCapability,
    CompanyDisposal,
    CompanyTeamInvitation,
)
from companies.services.company_deletion import EXPIRED, KEPT_ON_CHAIN
from companies.services.team import issue_team_invitation
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
    RegisterAgreement,
    RegisterAllotment,
    RegisterAllotmentDecision,
    RegisterContribution,
    RegisterEntry,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterGrant,
    RegisterMember,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterPosition,
    RegisterTransfer,
    ShareToken,
    TokenDeployment,
)
from tokens.services.class_lifecycle import KEPT_ON_CHAIN as CLASS_ON_CHAIN
from tokens.services.pending_deletion import ACCEPTED, NOT_PENDING
from tokens.services.register_entry_deletion import OPENING_KEPT
from tokens.services.register_events import verify_register
from tokens.services.register_people import PERSON_IN_USE
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
        allotments = "/api/v1/tokens/register-allotments/"
        applied = self.client.delete(f"{allotments}{allotment.json()['uuid']}/")
        self.assertEqual(applied.status_code, 400, applied.content)
        self.assertIn(NOT_PENDING, applied.content.decode())
        pending = self.client.post(allotments, self.allotment_payload(), format="json")
        self.assertEqual(pending.status_code, 201, pending.content)
        self.decision(allotments, pending.json()["uuid"], "approve")
        with use_migrate():
            foreign = RegisterAllotmentDecision.objects.filter(register_allotment_id=allotment.json()["uuid"]).first()
        with atomic(using=OPERATOR_ALIAS):
            with connections[OPERATOR_ALIAS].cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.company_id', %s, true), "
                    "set_config('app.company_operation', 'register_proposal_delete', true), "
                    "set_config('app.user_id', %s, true)",
                    [str(self.company.pk), str(self.owner.pk)],
                )
            with self.assertRaises(DatabaseError), atomic(using=OPERATOR_ALIAS):
                with connections[OPERATOR_ALIAS].cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO companies_companydisposal (uuid, created_at, updated_at, company_id, "
                        "scope, actor_id, appointment_id, manifest, transaction_id) "
                        "VALUES (%s, now(), now(), %s, 'proposal', %s, %s, %s, txid_current())",
                        [
                            uuid4(),
                            self.company.pk,
                            self.owner.pk,
                            self.appointment.pk,
                            json.dumps(
                                {
                                    "tokens_registerallotment": [pending.json()["uuid"]],
                                    "tokens_registerallotmentdecision": [str(foreign.pk)],
                                }
                            ),
                        ],
                    )
        with use_migrate():
            parts = (RegisterAgreement.objects.count(), RegisterContribution.objects.count())
        self.assertEqual(self.client.delete(f"{allotments}{pending.json()['uuid']}/").status_code, 204)
        with use_migrate():
            self.assertFalse(RegisterAllotment.objects.filter(pk=pending.json()["uuid"]).exists())
            self.assertFalse(
                RegisterAllotmentDecision.objects.filter(register_allotment_id=pending.json()["uuid"]).exists()
            )
            self.assertEqual(
                (RegisterAgreement.objects.count(), RegisterContribution.objects.count()), (parts[0] - 1, parts[1] - 1)
            )
            self.assertTrue(RegisterAllotment.objects.filter(pk=allotment.json()["uuid"]).exists())
            investor = RegisterAllotment.objects.get(pk=allotment.json()["uuid"]).member
        transfers = "/api/v1/tokens/register-transfers/"
        evidence = self.grant_payload()
        transfer = self.client.post(
            transfers,
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "token_id": str(self.token.pk),
                "from_member": str(investor),
                "to_member": str(self.member.pk),
                "new_member": False,
                "name": "Synthetic Member",
                "residential_address": "1 Example Street, Sydney NSW 2000",
                "shares": "25",
                "company_event_on": timezone.now().date().isoformat(),
                "signed_on": timezone.now().date().isoformat(),
                "lodged_on": timezone.now().date().isoformat(),
                "terms": "Synthetic signed instrument",
                "approving_director": "Synthetic Independent Director",
                "authority_reference": "SYNTHETIC-DELETED-TRANSFER",
                "reason": "Record the company-approved transfer",
                "authority_evidence": evidence["authority_evidence"],
                "instrument_evidence": evidence["terms_evidence"],
            },
            format="json",
        )
        self.assertEqual(transfer.status_code, 201, transfer.content)
        self.decision(transfers, transfer.json()["uuid"], "approve")
        self.decision(transfers, transfer.json()["uuid"], "apply")
        with use_operator():
            issued = RegisterAllotment.objects.get(pk=allotment.json()["uuid"]).register_entry_id
            granted = RegisterGrant.objects.get(pk=grant.json()["uuid"]).register_entry_id
            moved = RegisterTransfer.objects.get(pk=transfer.json()["uuid"]).register_entry_id
            opening = RegisterEntry.objects.get(register__token=self.token, kind="opening").pk
            self.assertTrue(RegisterMemberCessation.objects.filter(member_id=investor, entry_id=moved).exists())
        entries = f"/api/v1/tokens/{self.token.pk}/register/entries/"
        flags = {row["uuid"]: row["deletable"] for row in self.client.get(entries).json()["results"]}
        self.assertEqual((flags[str(opening)], flags[str(moved)], flags[str(issued)]), (False, True, True))
        with atomic(using=OPERATOR_ALIAS):
            with connections[OPERATOR_ALIAS].cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.company_id', %s, true), "
                    "set_config('app.company_operation', 'register_entry_delete', true), "
                    "set_config('app.user_id', %s, true)",
                    [str(self.company.pk), str(self.owner.pk)],
                )
            with self.assertRaisesMessage(DatabaseError, "lists only that entry"), atomic(using=OPERATOR_ALIAS):
                with connections[OPERATOR_ALIAS].cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO companies_companydisposal (uuid, created_at, updated_at, company_id, "
                        "scope, actor_id, appointment_id, manifest, transaction_id) "
                        "VALUES (%s, now(), now(), %s, 'entry', %s, %s, %s, txid_current())",
                        [
                            uuid4(),
                            self.company.pk,
                            self.owner.pk,
                            self.appointment.pk,
                            json.dumps(
                                {
                                    "tokens_registerentry": [str(granted)],
                                    "tokens_registerallotment": [allotment.json()["uuid"]],
                                    "tokens_shareregister#rechain": [str(self.token.stored_register.pk)],
                                }
                            ),
                        ],
                    )
        dependent = self.client.delete(f"{entries}{issued}/")
        self.assertEqual(dependent.status_code, 400, dependent.content)
        self.assertIn("Delete the transfer of", dependent.content.decode())
        self.assertIn("Synthetic Investor", dependent.content.decode())
        self.assertIn(OPENING_KEPT, self.client.delete(f"{entries}{opening}/").content.decode())
        self.assertEqual(self.client.delete(f"{entries}{granted}/").status_code, 204)
        with use_operator():
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "125")
            self.assertEqual(RegisterEntry.objects.get(pk=moved).sequence, 3)
        self.assertEqual(self.client.delete(f"{entries}{moved}/").status_code, 204)
        self.assertEqual(self.client.delete(f"{entries}{issued}/").status_code, 204)
        with use_operator():
            self.assertEqual(verify_register(self.token.stored_register.pk)["issued_supply"], "100")
            self.assertFalse(RegisterGrant.objects.filter(pk=grant.json()["uuid"]).exists())
            self.assertFalse(RegisterTransfer.objects.filter(pk=transfer.json()["uuid"]).exists())
            self.assertFalse(RegisterMemberCessation.objects.filter(member_id=investor).exists())
            self.assertFalse(RegisterAllotment.objects.filter(pk=allotment.json()["uuid"]).exists())
            self.assertFalse(RegisterPosition.objects.filter(member_id=investor).exists())
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
            self.assertTrue(
                RegisterMemberParticulars.objects.filter(member_id=investor, source_allotment=None).exists()
            )
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
        invitations = "/api/v1/tokens/member-invitations/"
        withdrawn = self.client.post(invitations, self.invitation_payload(), format="json")
        self.assertEqual(withdrawn.status_code, 201, withdrawn.content)
        self.assertEqual(self.client.delete(f"{invitations}{withdrawn.json()['uuid']}/").status_code, 204)
        team_invitation, _, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.appointment.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.APPROVE],
        )
        team = self.client.delete(f"/api/v1/company-authority/invitations/{team_invitation.pk}/")
        self.assertEqual(team.status_code, 204, team.content)
        invitation = self.client.post(invitations, self.invitation_payload(), format="json")
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
        kept = self.client.delete(f"{invitations}{invitation.json()['uuid']}/")
        self.assertEqual(kept.status_code, 400, kept.content)
        self.assertIn(ACCEPTED, kept.content.decode())
        evidence = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        documents = "/api/v1/tokens/register-member-documents/"
        second_token, second_member = populated_register(self.owner, self.company, self.appointment, symbol="TWO")
        attached, shared = [
            self.client.post(
                documents,
                {
                    "company_id": str(self.company.pk),
                    "member": str(member.pk),
                    "token": str(token.pk),
                    "evidence": str(evidence.pk),
                    "category": "share_certificate",
                    "appointment": str(self.appointment.pk),
                    "idempotency_key": str(uuid4()),
                },
                format="json",
            )
            for token, member in ((self.token, self.member), (second_token, second_member))
        ]
        self.assertEqual((attached.status_code, shared.status_code), (201, 201), shared.content)
        self.assertEqual(self.client.delete(f"{documents}{attached.json()['uuid']}/").status_code, 204)
        self.assertTrue(private_storage().exists(evidence.file.name))
        self.assertEqual(self.client.delete(f"{documents}{shared.json()['uuid']}/").status_code, 204)
        self.assertFalse(private_storage().exists(evidence.file.name))
        people = "/api/v1/tokens/register-people/"
        person = str(uuid4())
        added = self.client.post(
            people,
            {
                "operation_id": str(uuid4()),
                "company": str(self.company.pk),
                "appointment": str(self.appointment.pk),
                "member": person,
                "name": "Riley Removed",
                "residential_address": "1 Gone Street, Sydney NSW 2000",
            },
            format="json",
        )
        self.assertEqual(added.status_code, 201, added.content)
        listed = {
            row["member"]: row["deletable"]
            for row in self.client.get(people, {"company": self.company.pk}).json()["members"]
        }
        self.assertEqual((listed[person], listed[str(self.member.pk)]), (True, False))
        held = self.client.delete(f"{people}{self.member.pk}/?company={self.company.pk}")
        self.assertEqual(held.status_code, 400, held.content)
        self.assertIn(PERSON_IN_USE, held.content.decode())
        with atomic(using=OPERATOR_ALIAS):
            with connections[OPERATOR_ALIAS].cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('app.company_id', %s, true), "
                    "set_config('app.company_operation', 'register_person_delete', true), "
                    "set_config('app.user_id', %s, true)",
                    [str(self.company.pk), str(self.owner.pk)],
                )
            with self.assertRaisesMessage(DatabaseError, "Only a deletable record"), atomic(using=OPERATOR_ALIAS):
                with connections[OPERATOR_ALIAS].cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO companies_companydisposal (uuid, created_at, updated_at, company_id, "
                        "scope, actor_id, appointment_id, manifest, transaction_id) "
                        "VALUES (%s, now(), now(), %s, 'person', %s, %s, %s, txid_current())",
                        [
                            uuid4(),
                            self.company.pk,
                            self.owner.pk,
                            self.appointment.pk,
                            json.dumps({"tokens_registermember": [award["member"]]}),
                        ],
                    )
        self.assertEqual(self.client.delete(f"{people}{person}/?company={self.company.pk}").status_code, 204)
        with use_migrate():
            self.assertFalse(RegisterMember.objects.filter(pk=person).exists())
            self.assertTrue(RegisterMember.objects.filter(pk=self.member.pk).exists())
            self.assertFalse(RegisterEvidence.objects.filter(pk=evidence.pk).exists())
            self.assertTrue(RegisterEvidence.objects.filter(pk=document.pk).exists())
            self.assertEqual(
                sorted(CompanyDisposal.objects.filter(company_id=self.company.pk).values_list("scope", flat=True)),
                [
                    "document",
                    "document",
                    "entry",
                    "entry",
                    "entry",
                    "invitation",
                    "invitation",
                    "person",
                    "proposal",
                    "share_class",
                ],
            )
            self.assertFalse(CompanyTeamInvitation.objects.filter(pk=team_invitation.pk).exists())
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
            receipt = CompanyDisposal.objects.get(company_id=self.company.pk, scope="company")
            self.assertEqual((receipt.actor_id, receipt.appointment_id), (self.owner.pk, self.appointment.pk))
            self.assertIsNotNone(receipt.database_disposed_at)
            self.assertEqual(receipt.manifest, {})
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(ShareToken.objects.filter(company_id=self.company.pk).exists())
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
                            "scope, actor_id, appointment_id, manifest, transaction_id) "
                            "VALUES (%s, now(), now(), %s, 'company', %s, %s, '{}', txid_current())",
                            [uuid4(), self.company.pk, self.foreign.pk, self.foreign_appointment.pk],
                        )
                if alias == OPERATOR_ALIAS:
                    with self.assertRaises(DatabaseError), atomic(using=alias):
                        with connections[alias].cursor() as cursor:
                            cursor.execute(
                                "DELETE FROM tokens_registerentry WHERE register_id = %s",
                                [self.token.stored_register.pk],
                            )
        ended = (self.appointment.pk, timezone.now() - timedelta(seconds=1))
        with patch("companies.services.company_deletion.current_appointment", return_value=ended):
            expired = self.client.delete(f"/api/v1/companies/{self.company.pk}/")
        self.assertEqual(expired.status_code, 400, expired.content)
        self.assertIn(EXPIRED, expired.content.decode())
        with patch("tokens.services.class_lifecycle.current_appointment", return_value=ended):
            expired_class = self.client.delete(
                f"/api/v1/tokens/{self.token.pk}/?"
                + urlencode({"expected_updated_at": self.token.updated_at.isoformat()})
            )
        self.assertEqual(expired_class.status_code, 400, expired_class.content)
        self.assertIn(EXPIRED, expired_class.content.decode())
        with use_operator():
            self.assertTrue(RegisterEntry.objects.filter(register__token=self.token).exists())
            self.assertFalse(CompanyDisposal.objects.exists())
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
        offered = self.client.get(f"/api/v1/tokens/{self.token.pk}/").json()
        self.assertEqual((offered["canDelete"], offered["deletionBlockedReason"]), (False, CLASS_ON_CHAIN))
        refused_class = self.client.delete(
            f"/api/v1/tokens/{self.token.pk}/?" + urlencode({"expected_updated_at": self.token.updated_at.isoformat()})
        )
        self.assertEqual(refused_class.status_code, 409, refused_class.content)
        self.assertIn(CLASS_ON_CHAIN, refused_class.content.decode())
        refused = self.client.delete(f"/api/v1/companies/{self.company.pk}/")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn(KEPT_ON_CHAIN, refused.content.decode())
        with use_migrate():
            self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(CompanyDisposal.objects.exists())
            self.assertTrue(TokenDeployment.objects.filter(pk=journal.pk).exists())
            self.assertTrue(RegisterEntry.objects.filter(register__token=self.token).exists())
