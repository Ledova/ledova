from importlib import import_module
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, ProgrammingError, connections
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from procrastinate.contrib.django.models import ProcrastinateJob
from rest_framework.test import APIClient, APITransactionTestCase

from companies.services.team import revoke_company_appointment
from compliance.models import MonitoringRule
from documents.models import Document
from documents.tasks.extract import extract_document
from shared.db import (
    APP_ALIAS,
    MIGRATE_ALIAS,
    OPERATOR_ALIAS,
    atomic,
    principal_of,
    reset_principal,
    set_principal,
    use_operator,
)
from shared.tests.core_fixtures import (
    PASSWORD,
    CoreFixtures,
    import_payload,
    pdf_bytes,
    populated_register,
    retained_evidence,
)
from tokens.models import (
    ClassRightsRevision,
    MemberAssociation,
    MemberAssociationRevocation,
    MemberCertificateFulfilment,
    MemberCertificateRequest,
    MemberCertificateWithdrawal,
    MemberInvitation,
    MemberParticularsRequest,
    RegisterAgreement,
    RegisterAllotment,
    RegisterAllotmentDecision,
    RegisterAward,
    RegisterAwardEnd,
    RegisterAwardVesting,
    RegisterAwardVestingReversal,
    RegisterContribution,
    RegisterEvidenceKind,
    RegisterGrant,
    RegisterParticularsChange,
    RegisterPosition,
    ShareToken,
)
from users.models import UserProfile


@override_settings(RLS_AMBIENT_ALIAS=APP_ALIAS, RLS_ROLE_PER_REQUEST=False)
class ScopedAccessTest(CoreFixtures, APITransactionTestCase):
    databases = {"default", "app", "operator"}

    def sign_in(self, user):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/signin/", {"email": user.email, "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn("access", response.cookies)
        with connections[APP_ALIAS].cursor() as cursor:
            cursor.execute(
                "SELECT session_user, current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
            )
            self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES["app"], settings.RLS_ROLES["app"], False, False))
        self.addCleanup(reset_principal, APP_ALIAS)

    def test_real_app_login_keeps_its_session_and_clears_the_request_principal(self):
        with CaptureQueriesContext(connections[APP_ALIAS]) as queries:
            self.sign_in(self.owner)
        self.assertTrue(any('"users_userprofile"' in item["sql"] for item in queries))
        rule = MonitoringRule.objects.using(OPERATOR_ALIAS).create(
            rule_code="SYNTHETIC-PRIVATE",
            name="Synthetic operator-only rule",
            description="Private operator screening configuration",
            rule_type="threshold",
        )
        privileges = ["SELECT", "INSERT", "UPDATE", "DELETE"]
        privilege_query = (
            "SELECT has_table_privilege(current_user, 'public.compliance_monitoringrule', privilege) "
            "FROM unnest(%s::text[]) AS privilege"
        )

        def assert_monitoring_rules_private():
            with connections[APP_ALIAS].cursor() as cursor:
                cursor.execute(privilege_query, [privileges])
                self.assertEqual(cursor.fetchall(), [(False,)] * 4)
            with self.assertRaises(ProgrammingError) as read:
                MonitoringRule.objects.using(APP_ALIAS).get(pk=rule.pk)
            self.assertEqual(read.exception.__cause__.sqlstate, "42501")
            self.assertEqual(MonitoringRule.objects.using(OPERATOR_ALIAS).get(pk=rule.pk).name, rule.name)

        assert_monitoring_rules_private()
        migration = import_module("shared.migrations.0011_remove_unused_monitoring_rule_grant")
        migration_connection = connections[MIGRATE_ALIAS]
        with migration_connection.cursor() as cursor:
            cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES["app"]])
            quoted_app = cursor.fetchone()[0]
        try:
            with migration_connection.cursor() as cursor:
                cursor.execute(
                    f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.compliance_monitoringrule TO {quoted_app}"
                )
            with connections[APP_ALIAS].cursor() as cursor:
                cursor.execute(privilege_query, [privileges])
                self.assertEqual(cursor.fetchall(), [(True,)] * 4)
            for _ in range(2):
                with migration_connection.schema_editor() as schema_editor:
                    migration.revoke_monitoring_rule_app_access(None, schema_editor)
                assert_monitoring_rules_private()
        finally:
            with migration_connection.cursor() as cursor:
                cursor.execute(f"REVOKE ALL PRIVILEGES ON TABLE public.compliance_monitoringrule FROM {quoted_app}")

        unused_tables = (
            "auth_group",
            "auth_group_permissions",
            "auth_permission",
            "authentication_customuser_groups",
            "authentication_customuser_user_permissions",
            "django_admin_log",
            "django_content_type",
            "offerings_offering_documents",
            "offerings_offering_settlement_assets",
            "procrastinate_periodic_defers",
            "procrastinate_workers",
        )
        unused_privilege_query = (
            "SELECT has_table_privilege(current_user, 'public.' || table_name, privilege) "
            "FROM unnest(%s::text[]) AS tables(table_name) CROSS JOIN unnest(%s::text[]) AS privileges(privilege)"
        )

        def assert_unused_tables_private():
            with connections[APP_ALIAS].cursor() as cursor:
                cursor.execute(unused_privilege_query, [list(unused_tables), privileges])
                self.assertEqual(cursor.fetchall(), [(False,)] * 44)
            with connections[OPERATOR_ALIAS].cursor() as cursor:
                cursor.execute(unused_privilege_query, [list(unused_tables), privileges])
                self.assertEqual(cursor.fetchall(), [(True,)] * 44)
            for table in unused_tables:
                with self.subTest(table=table):
                    query = f"SELECT 1 FROM public.{migration_connection.ops.quote_name(table)} LIMIT 1"
                    with self.assertRaises(ProgrammingError) as read:
                        with connections[APP_ALIAS].cursor() as cursor:
                            cursor.execute(query)
                    self.assertEqual(read.exception.__cause__.sqlstate, "42501")
                    with connections[OPERATOR_ALIAS].cursor() as cursor:
                        cursor.execute(query)

        assert_unused_tables_private()
        unused_migration = import_module("shared.migrations.0012_remove_unused_app_grants")
        tables_sql = ", ".join(f"public.{migration_connection.ops.quote_name(table)}" for table in unused_tables)
        try:
            with migration_connection.cursor() as cursor:
                cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {tables_sql} TO {quoted_app}")
            with connections[APP_ALIAS].cursor() as cursor:
                cursor.execute(unused_privilege_query, [list(unused_tables), privileges])
                self.assertEqual(cursor.fetchall(), [(True,)] * 44)
            for _ in range(2):
                with migration_connection.schema_editor() as schema_editor:
                    unused_migration.revoke_unused_app_access(None, schema_editor)
                assert_unused_tables_private()
        finally:
            with migration_connection.cursor() as cursor:
                cursor.execute(f"REVOKE ALL PRIVILEGES ON TABLE {tables_sql} FROM {quoted_app}")
        response = self.client.get("/api/auth/verify/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["valid"])
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        anonymous = APIClient().get(f"/api/user-profiles/{self.profile.pk}/")
        self.assertEqual(anonymous.status_code, 401, anonymous.content)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

        def upload_before_commit():
            response = self.client.post(
                "/api/v1/documents/",
                {
                    "documentType": "payslip",
                    "file": SimpleUploadedFile("synthetic.pdf", pdf_bytes(), content_type="application/pdf"),
                },
                format="multipart",
            )
            self.assertEqual(response.status_code, 202, response.content)
            document_id = response.json()["uuid"]
            job = ProcrastinateJob.objects.using(APP_ALIAS).get(
                task_name=extract_document.name, args__document_uuid=document_id
            )
            self.assertEqual(job.args, {"document_uuid": document_id, "principal_id": self.owner.pk})
            self.assertEqual(job.queue_name, extract_document.queue)
            self.assertFalse(Document.objects.using(OPERATOR_ALIAS).filter(pk=document_id).exists())
            self.assertFalse(ProcrastinateJob.objects.using(OPERATOR_ALIAS).filter(pk=job.pk).exists())
            return document_id, job.pk

        with self.assertRaisesMessage(RuntimeError, "Roll back the synthetic upload"), atomic(using=APP_ALIAS):
            rolled_back_document, rolled_back_job = upload_before_commit()
            raise RuntimeError("Roll back the synthetic upload")
        self.assertFalse(Document.objects.using(OPERATOR_ALIAS).filter(pk=rolled_back_document).exists())
        self.assertFalse(ProcrastinateJob.objects.using(OPERATOR_ALIAS).filter(pk=rolled_back_job).exists())
        with atomic(using=APP_ALIAS):
            committed_document, committed_job = upload_before_commit()
        self.assertTrue(Document.objects.using(OPERATOR_ALIAS).filter(pk=committed_document).exists())
        self.assertTrue(ProcrastinateJob.objects.using(OPERATOR_ALIAS).filter(pk=committed_job).exists())

        with use_operator():
            self.profile.is_signup_completed = False
            self.profile.save(update_fields=["is_signup_completed"])
        self.sign_in(self.owner)
        resumed = self.client.get("/api/user-profiles/")
        self.assertEqual(resumed.status_code, 200, resumed.content)
        self.assertEqual(resumed.json()["results"][0]["uuid"], str(self.profile.pk))
        self.assertFalse(resumed.json()["results"][0]["isSignupCompleted"])
        self.assertTrue(self.client.get("/api/auth/verify/").json()["valid"])
        rejected = APIClient().post(
            "/api/signin/", {"email": self.owner.email, "password": "wrong-password"}, format="json"
        )
        self.assertEqual(rejected.status_code, 400, rejected.content)
        self.assertNotIn("access", rejected.cookies)
        repeated = APIClient().post(
            "/api/signup/",
            {"email": self.owner.email, "password": "wrong-password", "password_confirm": "wrong-password"},
            format="json",
        )
        self.assertEqual(repeated.status_code, 400, repeated.content)
        self.assertNotIn("access", repeated.cookies)
        with use_operator():
            self.owner.refresh_from_db()
            self.profile.refresh_from_db()
            self.assertTrue(self.owner.check_password(PASSWORD))
            self.assertFalse(self.profile.is_signup_completed)
            self.owner.is_email_verified = False
            self.owner.save(update_fields=["is_email_verified"])
        unverified = APIClient().post("/api/signin/", {"email": self.owner.email, "password": PASSWORD}, format="json")
        self.assertEqual(unverified.status_code, 400, unverified.content)
        self.assertNotIn("access", unverified.cookies)
        self.assertIn("Verify your email", str(unverified.json()))
        with use_operator():
            self.owner.is_active = False
            self.owner.save(update_fields=["is_active"])
            incomplete = get_user_model().objects.create_user(
                email="missing-profile@example.test", password=PASSWORD, is_active=True, is_email_verified=True
            )
        disabled = APIClient().post("/api/signin/", {"email": self.owner.email, "password": PASSWORD}, format="json")
        self.assertEqual(disabled.status_code, 400, disabled.content)
        self.assertNotIn("access", disabled.cookies)
        missing = APIClient().post("/api/signin/", {"email": incomplete.email, "password": PASSWORD}, format="json")
        self.assertEqual(missing.status_code, 400, missing.content)
        self.assertNotIn("access", missing.cookies)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def test_own_profile_edit_and_foreign_api_database_reads_and_writes_are_isolated(self):
        self.sign_in(self.owner)
        response = self.client.patch(
            f"/api/user-profiles/{self.profile.pk}/",
            {"fullName": "Synthetic Updated Member", "residentialAddress": "4 Example Street, Sydney NSW 2000"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        foreign = self.client.patch(
            f"/api/user-profiles/{self.foreign_profile.pk}/", {"fullName": "Forged"}, format="json"
        )
        self.assertEqual(foreign.status_code, 404, foreign.content)
        listed = self.client.get("/api/user-profiles/")
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertIn(str(self.profile.pk), str(listed.json()))
        self.assertNotIn(str(self.foreign_profile.pk), str(listed.json()))
        set_principal(self.owner.pk, APP_ALIAS)
        self.assertEqual(list(UserProfile.objects.using(APP_ALIAS).values_list("pk", flat=True)), [self.profile.pk])
        self.assertEqual(
            UserProfile.objects.using(APP_ALIAS).filter(pk=self.foreign_profile.pk).update(full_name="Forged"), 0
        )
        reset_principal(APP_ALIAS)
        with use_operator():
            self.profile.refresh_from_db()
            self.foreign_profile.refresh_from_db()
        self.assertEqual(self.profile.full_name, "Synthetic Updated Member")
        self.assertEqual(self.foreign_profile.full_name, "Synthetic core-foreign")

    def test_register_import_and_member_reads_bind_the_exact_company_in_api_and_database(self):
        with use_operator():
            token = ShareToken.objects.create(
                company=self.company, name="Imported ordinary", symbol="NEW", total_supply="1000"
            )
        payload = import_payload(self.owner, self.appointment, token)
        foreign_token, foreign_member = populated_register(
            self.foreign, self.foreign_company, self.foreign_appointment, "FOREIGN"
        )
        self.sign_in(self.owner)
        response = self.client.post("/api/v1/tokens/register-imports/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        self.decision("/api/v1/tokens/register-imports/", identifier, "approve")
        self.decision("/api/v1/tokens/register-imports/", identifier, "apply")
        own = self.client.get(f"/api/v1/tokens/{token.pk}/holders/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertIn("Synthetic Member", str(own.json()))
        summary = self.client.get("/api/v1/tokens/ownership/", {"company": str(self.company.pk)})
        self.assertEqual(summary.status_code, 200, summary.content)
        self.assertNotIn(str(foreign_token.pk), str(summary.json()))
        hidden_summary = self.client.get("/api/v1/tokens/ownership/", {"company": str(self.foreign_company.pk)})
        self.assertEqual(hidden_summary.status_code, 404, hidden_summary.content)
        hidden_holders = self.client.get(f"/api/v1/tokens/{foreign_token.pk}/ownership-holders/", {"sequence": 1})
        self.assertEqual(hidden_holders.status_code, 404, hidden_holders.content)
        rights_endpoint = f"/api/v1/tokens/{token.pk}/class-rights/"
        class_document = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.CLASS_RIGHTS)
        rights_payload = {
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
            "previous_revision": 0,
            "summary": "Private synthetic class terms",
            "document_reference": "Synthetic constitution, clause 4",
            "documents": [str(class_document.pk)],
        }
        rights = self.client.post(rights_endpoint, rights_payload, format="json")
        self.assertEqual(rights.status_code, 201, rights.content)
        class_file_endpoint = f"/api/v1/tokens/{token.pk}/class-rights-file/"
        class_file_query = {"revision": rights.json()["uuid"], "evidence": str(class_document.pk)}
        class_file = self.client.get(class_file_endpoint, class_file_query)
        self.assertEqual(class_file.status_code, 200)
        self.assertTrue(b"".join(class_file.streaming_content))
        hidden = self.client.get(f"/api/v1/tokens/{foreign_token.pk}/holders/")
        self.assertEqual(hidden.status_code, 404, hidden.content)
        foreign_rights_endpoint = f"/api/v1/tokens/{foreign_token.pk}/class-rights/"
        self.assertEqual(self.client.get(foreign_rights_endpoint).status_code, 404)
        self.assertEqual(self.client.post(foreign_rights_endpoint, rights_payload, format="json").status_code, 404)
        award = self.award_payload()
        recorded = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        foreign_evidence = retained_evidence(self.foreign, self.foreign_appointment, RegisterEvidenceKind.SUPPORTING)
        foreign_award = {
            **award,
            "operation_id": str(uuid4()),
            "appointment": str(self.foreign_appointment.pk),
            "token_id": str(foreign_token.pk),
            "member": str(uuid4()),
            "name": "Private foreign employee",
            "residential_address": "Private foreign address",
            "agreement_evidence": str(foreign_evidence.pk),
        }
        self.sign_in(self.foreign)
        self.assertEqual(self.client.get(rights_endpoint).status_code, 404)
        self.assertEqual(self.client.get(class_file_endpoint, class_file_query).status_code, 404)
        self.assertEqual(self.client.post(rights_endpoint, rights_payload, format="json").status_code, 404)
        recorded = self.client.post("/api/v1/tokens/register-awards/", foreign_award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        hidden = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/")
        self.assertEqual(hidden.status_code, 404, hidden.content)
        self.sign_in(self.owner)
        selections = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/")
        self.assertEqual(selections.json()["awardRecipients"], [])
        self.assertEqual(
            [
                (row["name"], row["onRegister"])
                for row in selections.json()["members"]
                if row["member"] == award["member"]
            ],
            [(award["name"], False)],
        )
        self.assertNotIn(foreign_award["member"], str(selections.json()))
        with use_operator():
            identity_token = ShareToken.objects.create(
                company=self.company, name="Scoped copied holding", symbol="IDENTITY", total_supply="1000"
            )
        foreign_identity = import_payload(
            self.owner, self.appointment, identity_token, member_id=foreign_award["member"]
        )
        foreign_identity["members"][0].update(
            name=foreign_award["name"], residential_address=foreign_award["residential_address"]
        )
        refused = self.client.post("/api/v1/tokens/register-imports/", foreign_identity, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertNotIn(foreign_award["name"], str(refused.json()))
        self.sign_in(self.foreign)
        duplicated = self.client.post(
            "/api/v1/tokens/register-awards/",
            {**foreign_award, "operation_id": str(uuid4()), "member": award["member"]},
            format="json",
        )
        self.assertEqual(duplicated.status_code, 400, duplicated.content)
        self.assertNotIn(award["name"], str(duplicated.json()))
        self.sign_in(self.owner)
        self.assertNotIn(
            foreign_award["name"], str(self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/").json())
        )
        set_principal(self.owner.pk, APP_ALIAS)
        self.assertEqual(
            RegisterPosition.objects.using(APP_ALIAS).filter(member_id=payload["members"][0]["member"]).count(), 1
        )
        self.assertEqual(RegisterPosition.objects.using(APP_ALIAS).filter(member=foreign_member).count(), 0)
        with self.assertRaises(ProgrammingError), atomic(using=APP_ALIAS):
            list(RegisterAward.objects.using(APP_ALIAS).values("member", "name", "residential_address"))
        with self.assertRaises(ProgrammingError), atomic(using=APP_ALIAS):
            RegisterAward.objects.using(APP_ALIAS).filter(member=foreign_award["member"]).update(name="Forged")
        with self.assertRaises(ProgrammingError), atomic(using=APP_ALIAS):
            list(ClassRightsRevision.objects.using(APP_ALIAS).values("summary"))
        with self.assertRaises(ProgrammingError), atomic(using=APP_ALIAS):
            ClassRightsRevision.objects.using(APP_ALIAS).filter(pk=rights.json()["uuid"]).update(summary="Forged")
        reset_principal(APP_ALIAS)

    def test_foreign_company_cannot_approve_issue_or_write_the_private_grant(self):
        identifier = self.prepare_grant()
        award = self.award_payload()
        recorded = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        vesting = self.vesting_payload(award["operation_id"])
        recorded_vesting = self.client.post("/api/v1/tokens/register-award-vestings/", vesting, format="json")
        self.assertEqual(recorded_vesting.status_code, 201, recorded_vesting.content)
        ending = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "award": award["operation_id"],
            "unvested_shares": "1",
            "vested_shares": "0",
            "company_event_on": timezone.now().date().isoformat(),
            "reason": "Company ending",
            "evidence": vesting["evidence"],
        }
        ended = self.client.post("/api/v1/tokens/register-award-ends/", ending, format="json")
        self.assertEqual(ended.status_code, 201, ended.content)
        reversal = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "vesting": vesting["operation_id"],
            "reversed_shares": "1",
            "company_event_on": timezone.now().date().isoformat(),
            "reason": "Correct vesting",
            "evidence": vesting["evidence"],
        }
        reversed_fact = self.client.post("/api/v1/tokens/register-award-vesting-reversals/", reversal, format="json")
        self.assertEqual(reversed_fact.status_code, 201, reversed_fact.content)
        allotment = self.allotment_payload()
        capital = self.client.post("/api/v1/tokens/register-allotments/", allotment, format="json")
        self.assertEqual(capital.status_code, 201, capital.content)
        capital_detail = f"/api/v1/tokens/register-allotments/{allotment['operation_id']}/"
        reviewed = self.client.post(
            f"{capital_detail}decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.content)
        self.assertEqual(
            reviewed.json()["currentHolders"],
            [{"member": str(self.member.pk), "name": "Synthetic Member", "shares": "100"}],
        )
        for suffix in ("", "file/", "agreement-file/", "receipt-file/"):
            healthy = self.client.get(f"{capital_detail}{suffix}")
            self.assertEqual(healthy.status_code, 200, getattr(healthy, "content", b""))
            healthy.close()
        with use_operator():
            opening_entry = self.token.stored_register.entries.get(kind="opening").pk
        invitation_payload = self.invitation_payload()
        invitation = self.client.post("/api/v1/tokens/member-invitations/", invitation_payload, format="json")
        self.assertEqual(invitation.status_code, 201, invitation.content)
        acceptance = {
            "code": invitation.json()["code"],
            "user_account": str(self.foreign_profile.user_account.pk),
            "confirmation": True,
        }
        wrong_recipient = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {**acceptance, "user_account": str(self.profile.user_account.pk)},
            format="json",
        )
        self.assertEqual(wrong_recipient.status_code, 400, wrong_recipient.content)
        self.sign_in(self.foreign)
        forged_account = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {**acceptance, "user_account": str(self.profile.user_account.pk)},
            format="json",
        )
        self.assertEqual(forged_account.status_code, 404, forged_account.content)
        accepted = self.client.post("/api/v1/tokens/member-invitations/accept/", acceptance, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        association_id = accepted.json()["uuid"]
        own = self.client.get(f"/api/v1/tokens/member-records/{association_id}/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual(own.json()["classes"][0]["shares"], "100")
        self.assertEqual(self.client.get("/api/v1/tokens/member-invitations/").json()["count"], 0)
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/member-invitations/{invitation_payload['operation_id']}/").status_code, 404
        )
        false_certificate = self.client.post(
            "/api/v1/tokens/member-certificate-requests/",
            {
                "operation_id": str(uuid4()),
                "association": association_id,
                "entry": str(opening_entry),
            },
            format="json",
        )
        self.assertEqual(false_certificate.status_code, 400, false_certificate.content)
        no_confirmation = self.client.post(
            "/api/v1/tokens/member-particulars-requests/",
            {
                "operation_id": str(uuid4()),
                "association": association_id,
                "name": "Proposed",
                "residential_address": "Proposed address",
                "confirmation": False,
            },
            format="json",
        )
        self.assertEqual(no_confirmation.status_code, 400, no_confirmation.content)
        pending_request = self.client.post(
            "/api/v1/tokens/member-particulars-requests/",
            {
                "operation_id": str(uuid4()),
                "association": association_id,
                "name": "Proposed Member",
                "residential_address": "Proposed address",
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(pending_request.status_code, 201, pending_request.content)
        with use_operator(), self.assertRaises(IntegrityError), atomic():
            MemberAssociation.objects.filter(pk=association_id).update(member=uuid4())
        set_principal(self.foreign.pk, APP_ALIAS)
        for model in (
            MemberInvitation,
            MemberAssociation,
            MemberAssociationRevocation,
            MemberParticularsRequest,
            MemberCertificateRequest,
            MemberCertificateWithdrawal,
            MemberCertificateFulfilment,
        ):
            with self.assertRaises(ProgrammingError) as read:
                model.objects.using(APP_ALIAS).count()
            self.assertEqual(read.exception.__cause__.sqlstate, "42501")
        reset_principal(APP_ALIAS)
        company_certificate = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/certificate/?sequence=1")
        self.assertEqual(company_certificate.status_code, 404, company_certificate.content)
        company_pack = self.client.post(
            f"/api/v1/companies/{self.company.pk}/pack/",
            {
                "appointment": str(self.foreign_appointment.pk),
                "instruction": "FOREIGN-COMPANY-PACK",
                "recipient": "Foreign recipient",
            },
            format="json",
        )
        self.assertEqual(company_pack.status_code, 404, company_pack.content)
        response = self.client.post(
            f"/api/v1/tokens/register-grants/{identifier}/decision-preview/",
            {"appointment": str(self.foreign_appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(response.status_code, 404, response.content)
        linked = self.client.post("/api/v1/tokens/register-grants/", self.linked_grant_payload(award), format="json")
        self.assertEqual(linked.status_code, 404, linked.content)
        self.assertNotIn(award["agreement_evidence"], str(linked.json()))
        creation = self.client.post("/api/v1/tokens/register-grants/", self.grant_payload(), format="json")
        self.assertEqual(creation.status_code, 404, creation.content)
        for endpoint, payload in (
            ("register-awards", award),
            ("register-award-vestings", vesting),
            ("register-award-ends", ending),
            ("register-award-vesting-reversals", reversal),
        ):
            detail = f"/api/v1/tokens/{endpoint}/{payload['operation_id']}/"
            self.assertEqual(self.client.get(detail).status_code, 404)
            self.assertEqual(self.client.get(f"{detail}file/").status_code, 404)
            rejected = self.client.post(f"/api/v1/tokens/{endpoint}/", payload, format="json")
            self.assertEqual(rejected.status_code, 404, rejected.content)
        set_principal(self.foreign.pk, APP_ALIAS)
        self.assertEqual(RegisterGrant.objects.using(APP_ALIAS).filter(pk=identifier).count(), 0)
        self.assertEqual(RegisterGrant.objects.using(APP_ALIAS).filter(pk=identifier).update(status="applied"), 0)
        for model, payload in (
            (RegisterAward, award),
            (RegisterAwardVesting, vesting),
            (RegisterAwardEnd, ending),
            (RegisterAwardVestingReversal, reversal),
        ):
            with self.assertRaises(ProgrammingError) as read:
                model.objects.using(APP_ALIAS).filter(pk=payload["operation_id"]).count()
            self.assertEqual(read.exception.__cause__.sqlstate, "42501")
            with self.assertRaises(ProgrammingError) as write:
                model.objects.using(APP_ALIAS).filter(pk=payload["operation_id"]).update(
                    company_id=self.foreign_company.pk
                )
            self.assertEqual(write.exception.__cause__.sqlstate, "42501")
        for suffix in ("", "file/", "agreement-file/", "receipt-file/"):
            self.assertEqual(self.client.get(f"{capital_detail}{suffix}").status_code, 404)
        foreign_preview = self.client.post(
            f"{capital_detail}decision-preview/",
            {"appointment": str(self.foreign_appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(foreign_preview.status_code, 404, foreign_preview.content)
        for model in (RegisterAgreement, RegisterContribution, RegisterAllotment, RegisterAllotmentDecision):
            with self.assertRaises(ProgrammingError) as private_read:
                model.objects.using(APP_ALIAS).count()
            self.assertEqual(private_read.exception.__cause__.sqlstate, "42501")
        reset_principal(APP_ALIAS)
        with use_operator():
            self.assertIsNone(RegisterGrant.objects.get(pk=identifier).register_entry_id)
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        self.sign_in(self.owner)
        set_principal(self.owner.pk, APP_ALIAS)
        for model in (RegisterAgreement, RegisterContribution, RegisterAllotment, RegisterAllotmentDecision):
            with self.assertRaises(ProgrammingError) as owner_read:
                model.objects.using(APP_ALIAS).count()
            self.assertEqual(owner_read.exception.__cause__.sqlstate, "42501")
        reset_principal(APP_ALIAS)
        supporting = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        prepared_request = self.client.post(
            f"/api/v1/tokens/member-particulars-requests/{pending_request.json()['uuid']}/prepare/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "supporting_evidence": str(supporting.pk),
                "as_at": timezone.now().date().isoformat(),
                "reason": "Company review of proposed particulars",
            },
            format="json",
        )
        self.assertEqual(prepared_request.status_code, 201, prepared_request.content)
        change_id = prepared_request.json()["uuid"]
        self.decision("/api/v1/tokens/register-particulars-changes/", change_id, "approve")
        set_principal(self.owner.pk, APP_ALIAS)
        self.assertEqual(RegisterParticularsChange.objects.using(APP_ALIAS).filter(pk=change_id).count(), 0)
        reset_principal(APP_ALIAS)
        self.assertEqual(self.client.get(f"/api/v1/tokens/member-records/{association_id}/").status_code, 404)
        revoked_association = self.client.post(
            f"/api/v1/tokens/member-associations/{association_id}/revoke/",
            {"appointment": str(self.appointment.pk), "idempotency_key": str(uuid4()), "reason": "End member access"},
            format="json",
        )
        self.assertEqual(revoked_association.status_code, 200, revoked_association.content)
        lapsed = self.client.post(
            f"/api/v1/tokens/register-particulars-changes/{change_id}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertEqual(lapsed.status_code, 200, lapsed.content)
        self.assertFalse(lapsed.json()["canDecide"])
        self.assertIn("member_request_no_longer_current", lapsed.json()["unmetRequirements"])
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        for suffix in ("", "file/", "agreement-file/", "receipt-file/"):
            self.assertEqual(self.client.get(f"{capital_detail}{suffix}").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/tokens/register-allotments/").json()["count"], 0)
        self.assertEqual(self.client.get("/api/v1/tokens/member-invitations/").json()["count"], 0)
        self.assertEqual(self.client.get("/api/v1/tokens/member-associations/").json()["count"], 0)
        revoked_certificate = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/certificate/?sequence=1")
        self.assertEqual(revoked_certificate.status_code, 404, revoked_certificate.content)
        revoked_pack = self.client.post(
            f"/api/v1/companies/{self.company.pk}/pack/",
            {
                "appointment": str(self.appointment.pk),
                "instruction": "REVOKED-COMPANY-PACK",
                "recipient": "Synthetic recipient",
            },
            format="json",
        )
        self.assertEqual(revoked_pack.status_code, 404, revoked_pack.content)

    def test_employee_issue_matches_holdings_and_retry_cannot_issue_twice(self):
        self.sign_in(self.owner)
        award = self.award_payload()
        endpoint = "/api/v1/tokens/register-awards/"
        recorded = self.client.post(endpoint, award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        replayed = self.client.post(endpoint, award, format="json")
        self.assertEqual(replayed.status_code, 200, replayed.content)
        self.assertEqual(replayed.json()["uuid"], recorded.json()["uuid"])
        changed = self.client.post(endpoint, {**award, "shares": "31"}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        vesting = self.vesting_payload(award["operation_id"])
        vesting_endpoint = "/api/v1/tokens/register-award-vestings/"
        vested = self.client.post(vesting_endpoint, vesting, format="json")
        self.assertEqual(vested.status_code, 201, vested.content)
        self.assertEqual(self.client.post(vesting_endpoint, vesting, format="json").status_code, 200)
        entitlement = self.client.get(f"{endpoint}{award['operation_id']}/").json()
        self.assertEqual(
            (entitlement["vestedShares"], entitlement["issuedShares"], entitlement["availableShares"]),
            ("25", "0", "25"),
        )
        with use_operator():
            self.assertFalse(RegisterPosition.objects.filter(member_id=award["member"]).exists())
            self.assertEqual(int(self.token.stored_register.issued_supply), 100)
        prepared = self.client.post("/api/v1/tokens/register-grants/", self.linked_grant_payload(award), format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        identifier = prepared.json()["uuid"]
        endpoint = "/api/v1/tokens/register-grants/"
        self.decision(endpoint, identifier, "approve")
        first, payload = self.decision(endpoint, identifier, "apply")
        repeated = self.client.post(f"{endpoint}{identifier}/decide/", payload, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(repeated.json()["registerEntry"], first.json()["registerEntry"])
        with use_operator():
            proposal = RegisterGrant.objects.get(pk=identifier)
            register = proposal.register_entry.register
            positions = RegisterPosition.objects.filter(register=register)
            self.assertEqual(int(register.issued_supply), sum(int(position.shares) for position in positions))
            self.assertEqual(int(register.issued_supply), 125)
            self.assertEqual(positions.get(member_id=proposal.member).shares, 25)
            self.assertEqual(register.entries.filter(kind="issue").count(), 1)
            self.assertEqual(RegisterAward.objects.filter(pk=award["operation_id"]).count(), 1)
            self.assertEqual(RegisterAwardVesting.objects.filter(award_id=award["operation_id"]).count(), 1)
        entitlement = self.client.get(f"/api/v1/tokens/register-awards/{award['operation_id']}/").json()
        self.assertEqual(
            (entitlement["vestedShares"], entitlement["issuedShares"], entitlement["availableShares"]),
            ("25", "25", "0"),
        )
