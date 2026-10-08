import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from companies.exceptions import OfferedDocumentException
from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyDocument,
)
from companies.services.administration import company_operation
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import (
    _requester_principal,
    submit_authority_request,
)
from companies.services.company import register_company, transition_company
from companies.services.document_review import prepare_document_review, verify_document
from companies.services.documents import create_document, delete_document
from companies.services.editing import update_company
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import PDF, STORAGES, evidence
from companies.validators import acn_check_digit
from offerings.models import Offering
from offerings.services.offering import attach_documents
from operators.models import Operator
from shared.db import (
    atomic,
    current_alias,
    reset_principal,
    use_app,
    use_migrate,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.models import (
    CapitalIncreaseRequest,
    RegisterEvidenceKind,
    RegisterMember,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.services.creation import create_share_token
from tokens.services.register_openings import prepare_link
from tokens.tests.evidence_fixtures import upload_evidence
from users.models import UserAccount, UserProfile
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet


class CompanyAdministrationTest(StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        self.owner, self.profile = self.account("foundation-owner")
        self.other, self.other_profile = self.account("foundation-other")
        self.company = self.register(self.owner, "12345678")
        self.foreign = self.register(self.other, "98765432")
        self.client.force_authenticate(self.owner)
        self.url = f"/api/v1/companies/{self.company.pk}/"

    def account(self, label):
        with use_migrate():
            actor = get_user_model().objects.create_user(
                email=f"{label}@example.test", password="synthetic-password", is_active=True, is_email_verified=True
            )
            profile = UserProfile.objects.create(user=actor, full_name=label)
            return actor, profile

    def register(self, actor, prefix):
        return register_company(
            actor,
            f"{prefix} Pty Ltd",
            prefix + str(acn_check_digit(prefix)),
            {"first_name": "Company", "last_name": "Contact"},
        )

    def admit(self, **changes):
        proposal, _ = submit_authority_request(
            requester=self.owner,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
            **changes,
        )
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            return admit_authority_request(
                requester=self.owner,
                request_id=proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            ).appointment

    def invite(self, personal, delegatable=None):
        initial = self.admit()
        invitation, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=initial.pk,
            idempotency_key=uuid4(),
            capabilities=personal,
            delegatable_capabilities=delegatable or [],
        )
        return accept_team_invitation(
            requester=self.other,
            code=code,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        )

    def upload(self, actor=None):
        return create_document(
            company_id=self.company.pk,
            actor=actor or self.owner,
            data={
                "document_type": "constitution",
                "name": "Synthetic constitution",
                "file": evidence(),
                "file_size": len(PDF),
                "mime_type": "application/pdf",
            },
        )

    @contextmanager
    def role(self, actor, name):
        with use_operator() if name == "operator" else use_app():
            connection = connections[current_alias()]
            with _requester_principal(actor.pk), atomic():
                with connection.cursor() as cursor:
                    cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES[name]])
                    cursor.execute(f"SET LOCAL ROLE {cursor.fetchone()[0]}")
                yield

    @contextmanager
    def operator_as(self, actor):
        with use_operator(), _requester_principal(actor.pk):
            selected_connection = connections[current_alias()]
            with selected_connection.cursor() as cursor:
                cursor.execute("SELECT quote_ident(current_user), quote_ident(%s)", [settings.RLS_ROLES["operator"]])
                previous_role, operator_role = cursor.fetchone()
                cursor.execute(f"SET ROLE {operator_role}")
            try:
                yield
            finally:
                with selected_connection.cursor() as cursor:
                    cursor.execute(f"SET ROLE {previous_role}")

    def wait_for_database_lock(self, waiter, blocker):
        inspection = connections["default"].copy()
        deadline = monotonic() + 5
        try:
            while monotonic() < deadline:
                with inspection.cursor() as cursor:
                    cursor.execute("SELECT %s = ANY(pg_blocking_pids(%s))", [blocker, waiter])
                    if cursor.fetchone()[0]:
                        return
                sleep(0.01)
            self.fail("The actor command never waited on the held database lock")
        finally:
            inspection.close()

    def test_raw_document_guard_locks_company_before_the_document_row(self):
        self.admit()
        document = self.upload()
        reviewer, _profile = self.account("lock-order-reviewer")
        with use_migrate():
            get_user_model().objects.filter(pk=reviewer.pk).update(is_staff=True, is_superuser=True)
        with self.operator_as(reviewer):
            _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
            verified = verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
        self.assertTrue(verified.is_verified)
        started, worker_pid = Event(), []

        def forge():
            connections.close_all()
            try:
                with self.operator_as(self.owner), company_operation(self.owner, self.company.pk, "edit"), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        worker_pid.append(cursor.fetchone()[0])
                    started.set()
                    CompanyDocument.objects.filter(pk=document.pk).update(is_verified=True)
                return "written"
            except DatabaseError as error:
                return error.__cause__.sqlstate
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with self.operator_as(self.owner), atomic():
                Company.objects.select_for_update().get(pk=self.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                future = pool.submit(forge)
                self.assertTrue(started.wait(5))
                self.wait_for_database_lock(worker_pid[0], blocker)
                try:
                    update_company(self.company, {"name": "Authorised identity change"}, actor=self.owner)
                    effect = "edited"
                except DatabaseError as error:
                    effect = error.__cause__.sqlstate
            self.assertEqual((effect, future.result(timeout=10)), ("edited", "23514"))
        with use_operator():
            self.assertEqual(Company.objects.get(pk=self.company.pk).name, "Authorised identity change")
            self.assertFalse(CompanyDocument.objects.get(pk=document.pk).is_verified)

    def test_raw_document_association_removal_locks_company_before_the_link_row(self):
        self.admit()
        document = self.upload()
        offering = self.retained_offering(document, status="draft")
        started, worker_pid = Event(), []

        def remove():
            connections.close_all()
            try:
                with self.operator_as(self.owner), company_operation(
                    self.owner, self.company.pk, "document_delete"
                ), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        worker_pid.append(cursor.fetchone()[0])
                    started.set()
                    removed, _ = Offering.documents.through.objects.filter(
                        offering_id=offering.pk, companydocument_id=document.pk
                    ).delete()
                return removed
            except DatabaseError as error:
                return error.__cause__.sqlstate
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with self.operator_as(self.owner), atomic():
                Company.objects.select_for_update().get(pk=self.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                future = pool.submit(remove)
                self.assertTrue(started.wait(5))
                self.wait_for_database_lock(worker_pid[0], blocker)
                try:
                    delete_document(document, actor=self.owner)
                    effect = "deleted"
                except DatabaseError as error:
                    effect = error.__cause__.sqlstate
            self.assertEqual((effect, future.result(timeout=10)), ("deleted", 0))
        with use_operator():
            self.assertFalse(CompanyDocument.objects.filter(pk=document.pk).exists())

    def test_draft_attachment_commit_does_not_deadlock_document_deletion(self):
        self.assert_attachment_delete_order(raw=False)

    def test_draft_attachment_commit_does_not_deadlock_raw_document_deletion(self):
        self.assert_attachment_delete_order(raw=True)

    def assert_attachment_delete_order(self, *, raw):
        self.admit()
        document = self.upload()
        offering = self.retained_offering(document, status="draft")
        held, restore, deleting = Event(), Event(), Event()
        attachment_pid, deletion_pid = [], []

        def attach():
            connections.close_all()
            try:
                with self.operator_as(self.owner), atomic():
                    current = Offering.objects.select_for_update().get(pk=offering.pk)
                    current.documents.remove(document)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        attachment_pid.append(cursor.fetchone()[0])
                    held.set()
                    if not restore.wait(10):
                        raise AssertionError("The attachment continuation was not released")
                    attach_documents(current, [document])
                return "attached"
            except DatabaseError as error:
                return error.__cause__.sqlstate
            finally:
                connections.close_all()

        def remove():
            connections.close_all()
            try:
                with self.operator_as(self.owner):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        deletion_pid.append(cursor.fetchone()[0])
                    deleting.set()
                    if raw:
                        with company_operation(self.owner, self.company.pk, "document_delete"), atomic():
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("DELETE FROM companies_companydocument WHERE uuid = %s", [document.pk])
                    else:
                        delete_document(document, actor=self.owner)
                return "deleted"
            except DatabaseError as error:
                return error.__cause__.sqlstate
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            attachment = pool.submit(attach)
            self.assertTrue(held.wait(5))
            deletion = pool.submit(remove)
            self.assertTrue(deleting.wait(5))
            try:
                self.wait_for_database_lock(deletion_pid[0], attachment_pid[0])
            finally:
                restore.set()
            self.assertEqual(
                (attachment.result(timeout=10), deletion.result(timeout=10)),
                ("attached", "23503" if raw else "deleted"),
            )
        with use_operator():
            self.assertEqual(CompanyDocument.objects.filter(pk=document.pk).exists(), raw)

    def test_public_discovery_stops_company_token_policy_recursion_without_private_access(self):
        foreign_document = create_document(
            company_id=self.foreign.pk,
            actor=self.other,
            data={
                "document_type": "constitution",
                "name": "Private foreign file",
                "file": evidence(),
                "file_size": len(PDF),
                "mime_type": "application/pdf",
            },
        )
        private_company = self.register(self.other, "22334455")
        open_company = self.register(self.other, "33445566")
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="active")
            own_draft = ShareToken.objects.create(company=self.company, name="Owned draft class", symbol="OWN")
            ShareToken.objects.create(
                company=self.company,
                name="Owned marketed class",
                symbol="OMP",
                status="deployed",
                contract_address="0x" + "7" * 40,
            )
            marketed = ShareToken.objects.create(
                company=self.foreign,
                name="Marketed historical class",
                symbol="PUB",
                status="deployed",
                contract_address="0x" + "9" * 40,
            )
            ShareToken.objects.create(
                company=private_company,
                name="Draft class",
                symbol="DRA",
                status="draft",
                contract_address="0x" + "8" * 40,
            )
            ShareToken.objects.create(
                company=private_company, name="Empty deployment", symbol="EMP", status="deployed", contract_address=""
            )
            Company.objects.filter(pk=open_company.pk).update(status="active", is_open_to_investors=True)
        with self.role(self.owner, "app"):
            self.assertTrue(ShareToken.objects.filter(pk=own_draft.pk).exists())
            self.assertTrue(ShareToken.objects.filter(pk=marketed.pk).exists())
            self.assertTrue(Company.objects.filter(pk=self.foreign.pk).exists())
            self.assertTrue(Company.objects.filter(pk=open_company.pk).exists())
            self.assertFalse(Company.objects.filter(pk=private_company.pk).exists())
            self.assertFalse(CompanyDocument.objects.filter(pk=foreign_document.pk).exists())
            self.assertFalse(UserProfile.objects.filter(pk=self.other_profile.pk).exists())
        self.assertEqual(self.client.get(f"/api/v1/companies/{self.foreign.pk}/").status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/v1/companies/{self.foreign.pk}/documents/{foreign_document.pk}/file/").status_code,
            404,
        )
        with self.role(self.owner, "app"):
            reset_principal()
            self.assertFalse(Company.objects.exists())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT app_company_discovery_ids()")
                self.assertEqual(cursor.fetchall(), [])

    def test_fresh_registration_and_pending_request_keep_genuine_draft_setup(self):
        proposal, _ = submit_authority_request(
            requester=self.owner,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
        )
        response = self.client.patch(self.url, {"phone": "555"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["administrativeAccess"], {"capabilities": [], "draftSetup": True})
        self.assertTrue(response.json()["isOwner"])
        self.assertIn("documents", response.json())
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.filter(request=proposal).exists())

    def test_revoked_initial_owner_retains_share_class_creation_and_only_owned_business_reads(self):
        initial = self.admit()
        revoke_company_appointment(requester=self.owner, appointment_id=initial.pk)
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="active")
        metadata = self.client.get(self.url)
        self.assertEqual(metadata.status_code, 200, metadata.content)
        self.assertEqual(metadata.json()["administrativeAccess"], {"capabilities": [], "draftSetup": False})
        self.assertEqual(metadata.json()["documents"], [])
        self.assertIsNone(metadata.json()["primaryContact"])
        self.assertIsNone(metadata.json()["email"])
        self.assertEqual(self.client.patch(self.url, {"phone": "Forbidden"}, format="json").status_code, 404)
        payload = {
            "company": str(self.company.pk),
            "name": "Retained owner shares",
            "symbol": "OWN",
            "tokenType": "ordinary",
            "totalSupply": "1000",
        }
        created = self.client.post("/api/v1/tokens/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        token_id = created.json()["uuid"]
        with use_migrate():
            token = ShareToken.objects.get(pk=token_id)
            foreign_token = ShareToken.objects.create(
                company=self.foreign, name="Foreign shares", symbol="FRN", total_supply="1000"
            )
            request = ShareIssuanceRequest.objects.create(
                token=token, recipient_address="0x" + "1" * 40, amount=1, submitted_by=self.owner
            )
            foreign_request = ShareIssuanceRequest.objects.create(
                token=foreign_token, recipient_address="0x" + "2" * 40, amount=1, submitted_by=self.other
            )
        with self.role(self.owner, "app"):
            self.assertEqual(list(ShareToken.objects.values_list("pk", flat=True)), [token.pk])
            self.assertEqual(ShareToken.objects.filter(pk=token.pk).update(name="Retained owner raw metadata"), 1)
            self.assertEqual(ShareToken.objects.filter(pk=foreign_token.pk).update(name="Foreign forbidden"), 0)
            self.assertEqual(list(ShareIssuanceRequest.objects.values_list("pk", flat=True)), [request.pk])
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
            self.assertFalse(CompanyDocument.objects.filter(company=self.company).exists())
            self.assertFalse(ShareToken.objects.filter(pk=foreign_token.pk).exists())
            self.assertFalse(ShareIssuanceRequest.objects.filter(pk=foreign_request.pk).exists())
        listed = self.client.get("/api/v1/tokens/")
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row["uuid"] for row in listed.json()["results"]], [token_id])
        self.assertEqual(self.client.get(f"/api/v1/tokens/{token_id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/v1/tokens/{foreign_token.pk}/").status_code, 404)
        requests = self.client.get("/api/v1/tokens/issuance-requests/")
        self.assertEqual(requests.status_code, 200, requests.content)
        self.assertEqual([row["uuid"] for row in requests.json()["results"]], [str(request.pk)])
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_share_class_creation_service_refuses_foreign_binding_and_server_fields(self):
        payload = {"name": "Owner shares", "symbol": "OWN", "token_type": "ordinary", "total_supply": "1000"}
        for fields in (
            {"company_id": self.foreign.pk},
            {"company": self.foreign},
            {"status": "deployed"},
            {"contract_address": "0x" + "1" * 40},
        ):
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                create_share_token(actor=self.owner, company_id=self.company.pk, data={**payload, **fields})
        with self.assertRaises(PermissionDenied):
            create_share_token(actor=self.other, company_id=self.company.pk, data=payload)
        with use_operator():
            self.assertFalse(ShareToken.objects.exists())

    def test_revoked_owner_retains_private_offering_reads_edits_and_withdrawal(self):
        initial = self.admit()
        document = self.upload()
        offering = self.retained_offering(document, status="draft")
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="active")
            foreign_token = ShareToken.objects.create(company=self.foreign, name="Foreign", symbol="FRN")
            foreign = Offering.objects.create(
                token=foreign_token,
                exemption=offering.exemption,
                price_per_share="1.00",
                minimum_shares=1,
                target_shares=2,
                cap_shares=3,
                opens_at=timezone.now(),
            )
        revoke_company_appointment(requester=self.owner, appointment_id=initial.pk)
        endpoint = "/api/v1/offerings/"
        detail = f"{endpoint}{offering.pk}/"
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual([row["uuid"] for row in self.client.get(endpoint).json()["results"]], [str(offering.pk)])
        self.assertEqual(self.client.get(detail).status_code, 200)
        self.assertEqual(self.client.get(f"{endpoint}{foreign.pk}/").status_code, 404)
        changed = self.client.patch(detail, {"summary": "Owner-only retained draft"}, format="json")
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(changed.json()["summary"], "Owner-only retained draft")
        hidden = self.client.patch(detail, {"documents": [str(document.pk)]}, format="json")
        self.assertEqual(hidden.status_code, 400, hidden.content)
        hidden = self.client.post(f"{detail}documents/", {"documents": [str(document.pk)]}, format="json")
        self.assertEqual(hidden.status_code, 400, hidden.content)
        self.assertEqual(self.client.get(f"{self.url}documents/{document.pk}/file/").status_code, 404)
        with use_migrate():
            Offering.objects.filter(pk=offering.pk).update(status="submitted")
        withdrawn = self.client.post(f"{detail}withdraw/", {"reason": "Owner withdrawal"}, format="json")
        self.assertEqual(withdrawn.status_code, 200, withdrawn.content)
        self.assertEqual(withdrawn.json()["status"], "withdrawn")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.patch(detail, {"summary": "Foreign"}, format="json").status_code, 404)

    def test_revoked_owner_retains_capital_request_scope_without_foreign_admin_access(self):
        initial = self.admit()
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="active", is_open_to_investors=False)
            token = ShareToken.objects.create(
                company=self.company,
                name="Owner",
                symbol="OWN",
                total_supply="1000",
                status="deployed",
                contract_address="0x" + "1" * 40,
            )
            foreign_token = ShareToken.objects.create(
                company=self.foreign,
                name="Foreign",
                symbol="FRN",
                total_supply="1000",
                status="deployed",
                contract_address="0x" + "2" * 40,
            )
            retained = CapitalIncreaseRequest.objects.create(
                token=token,
                additional_shares=100,
                new_authorized_total=1100,
                purpose="Owner",
                board_resolution_reference="OWNER",
            )
            foreign = CapitalIncreaseRequest.objects.create(
                token=foreign_token,
                additional_shares=100,
                new_authorized_total=1100,
                purpose="Foreign",
                board_resolution_reference="FOREIGN",
            )
            retained_values = list(CapitalIncreaseRequest.objects.order_by("pk").values())
        revoke_company_appointment(requester=self.owner, appointment_id=initial.pk)
        endpoint = "/api/v1/tokens/capital-increases/"
        payload = {
            "token": str(token.pk),
            "additionalShares": 100,
            "newAuthorizedTotal": 1100,
            "purpose": "Owner",
            "boardResolutionReference": "OWNER",
        }
        created = self.client.post(endpoint, payload, format="json")
        self.assertEqual(created.status_code, 405, created.content)
        request_id = str(retained.pk)
        with use_migrate():
            ShareToken.objects.filter(pk=token.pk).update(status="paused")
        self.assertEqual([row["uuid"] for row in self.client.get(endpoint).json()["results"]], [request_id])
        self.assertEqual(self.client.post(f"{endpoint}{foreign.pk}/submit/").status_code, 404)
        self.assertEqual(self.client.post(f"{endpoint}{request_id}/submit/").status_code, 404)
        with self.role(self.owner, "app"):
            self.assertEqual(
                [str(value) for value in CapitalIncreaseRequest.objects.values_list("pk", flat=True)], [request_id]
            )
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())
            reset_principal()
            self.assertFalse(CapitalIncreaseRequest.objects.exists())
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f"{endpoint}{request_id}/submit/").status_code, 404)
        self.assertEqual(self.client.post(endpoint, payload, format="json").status_code, 405)
        self.assertEqual([row["uuid"] for row in self.client.get(endpoint).json()["results"]], [str(foreign.pk)])
        with use_migrate():
            self.assertEqual(list(CapitalIncreaseRequest.objects.order_by("pk").values()), retained_values)

    def test_share_class_creation_rechecks_current_owner_and_actor_after_company_lock_wait(self):
        for change in ("owner", "active"):
            with self.subTest(change=change):
                with use_migrate():
                    Company.objects.filter(pk=self.company.pk).update(owner=self.owner)
                    get_user_model().objects.filter(pk=self.owner.pk).update(is_active=True)
                started, worker_pid = Event(), []

                def create():
                    connections.close_all()
                    try:
                        with self.operator_as(self.owner):
                            with connections[current_alias()].cursor() as cursor:
                                cursor.execute("SELECT pg_backend_pid()")
                                worker_pid.append(cursor.fetchone()[0])
                            started.set()
                            create_share_token(
                                actor=self.owner,
                                company_id=self.company.pk,
                                data={"name": "Blocked shares", "symbol": "BLK", "total_supply": "1000"},
                            )
                        return "written"
                    except PermissionDenied:
                        return "refused"
                    finally:
                        connections.close_all()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    with use_migrate(), atomic():
                        Company.objects.select_for_update().get(pk=self.company.pk)
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT pg_backend_pid()")
                            blocker = cursor.fetchone()[0]
                        future = pool.submit(create)
                        self.assertTrue(started.wait(5))
                        self.wait_for_database_lock(worker_pid[0], blocker)
                        if change == "owner":
                            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
                        else:
                            get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
                    self.assertEqual(future.result(timeout=10), "refused")
                with use_operator():
                    self.assertFalse(ShareToken.objects.exists())

    def test_revoked_owner_reads_retained_register_proposal_and_file_without_private_document_access(self):
        initial = self.admit()
        document = self.upload()
        with use_migrate():
            member = RegisterMember.objects.create(company=self.company)
        proposal, _ = prepare_link(
            actor=self.owner,
            operation_id=uuid4(),
            appointment=initial.pk,
            company_id=self.company.pk,
            authority_evidence=upload_evidence(self.owner, initial, RegisterEvidenceKind.AUTHORITY, raw=PDF).pk,
            mapping=[{"member": str(member.pk), "address": "0x" + "4" * 40}],
            authority="director_resolution",
            approving_director="Synthetic retained director",
            authority_reference="RETAINED-LINK",
            reason="Retained owner proposal read",
        )
        revoke_company_appointment(requester=self.owner, appointment_id=initial.pk)
        endpoint = "/api/v1/tokens/register-links/"
        self.assertEqual([row["uuid"] for row in self.client.get(endpoint).json()["results"]], [str(proposal.pk)])
        self.assertEqual(self.client.get(f"{endpoint}{proposal.pk}/").status_code, 200)
        response = self.client.get(f"{endpoint}{proposal.pk}/file/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PDF)
        self.assertEqual(self.client.get(f"{self.url}documents/{document.pk}/file/").status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(endpoint).json()["results"], [])
        self.assertEqual(self.client.get(f"{endpoint}{proposal.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"{endpoint}{proposal.pk}/file/").status_code, 404)

    def test_offering_edits_recheck_owner_and_actor_after_waiting_for_company(self):
        self.admit()
        document = self.upload()
        offering = self.retained_offering(document, status="draft")
        with use_migrate():
            ShareToken.objects.filter(pk=offering.token_id).update(
                status="deployed", contract_address="0x" + "8" * 40, total_supply="1000"
            )
        for change in ("owner", "active"):
            with self.subTest(change=change):
                with use_migrate():
                    Company.objects.filter(pk=self.company.pk).update(owner=self.owner)
                    get_user_model().objects.filter(pk=self.owner.pk).update(is_active=True)
                started, worker_pid = Event(), []

                def act():
                    connections.close_all()
                    client = APIClient()
                    client.force_authenticate(self.owner)
                    try:
                        with use_operator(), connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT pg_backend_pid()")
                            worker_pid.append(cursor.fetchone()[0])
                        started.set()
                        return client.patch(
                            f"/api/v1/offerings/{offering.pk}/",
                            {"summary": "Forbidden stale owner"},
                            format="json",
                        ).status_code
                    finally:
                        connections.close_all()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    with use_migrate(), atomic():
                        Company.objects.select_for_update().get(pk=self.company.pk)
                        with connections[current_alias()].cursor() as cursor:
                            cursor.execute("SELECT pg_backend_pid()")
                            blocker = cursor.fetchone()[0]
                        future = pool.submit(act)
                        self.assertTrue(started.wait(5))
                        self.wait_for_database_lock(worker_pid[0], blocker)
                        if change == "owner":
                            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
                        else:
                            get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
                    self.assertEqual(future.result(timeout=10), 404)
                with use_operator():
                    self.assertEqual(Offering.objects.get(pk=offering.pk).summary, "")
                    self.assertFalse(CapitalIncreaseRequest.objects.exists())

    def test_personal_administrator_reads_class_metadata_without_owner_action_authority(self):
        self.invite(["admin"])
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="active")
            token = ShareToken.objects.create(
                company=self.company, name="Private owner shares", symbol="OWN", total_supply="1000"
            )
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        denied = self.client.post(
            "/api/v1/tokens/",
            {"company": str(self.company.pk), "name": "Forbidden shares", "symbol": "FOR", "totalSupply": "1000"},
            format="json",
        )
        self.assertEqual(denied.status_code, 400)
        detail = self.client.get(f"/api/v1/tokens/{token.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertFalse(detail.json()["isOwner"])
        self.assertEqual(self.client.get("/api/v1/tokens/").json()["results"], [])
        register_classes = self.client.get("/api/v1/tokens/register/")
        self.assertEqual(register_classes.status_code, 200, register_classes.content)
        self.assertEqual([row["uuid"] for row in register_classes.json()["results"]], [str(token.pk)])
        self.assertEqual(self.client.get("/api/v1/tokens/issuance-requests/").json()["results"], [])
        with self.role(self.other, "app"):
            self.assertFalse(ShareToken.objects.filter(pk=token.pk).exists())
            reset_principal()
            self.assertFalse(ShareToken.objects.exists())
            self.assertFalse(ShareIssuanceRequest.objects.exists())
        self.client.force_authenticate(self.owner)
        owned = self.client.get(f"/api/v1/tokens/{token.pk}/")
        self.assertEqual(owned.status_code, 200, owned.content)
        self.assertTrue(owned.json()["isOwner"])

    def test_offering_private_document_references_recheck_administration_after_company_lock_wait(self):
        self.admit()
        original = self.upload()
        replacement = self.upload()
        offering = self.retained_offering(original, status="draft")
        started, worker_pid = Event(), []

        def attach():
            connections.close_all()
            client = APIClient()
            client.force_authenticate(self.owner)
            try:
                with use_operator(), connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    worker_pid.append(cursor.fetchone()[0])
                started.set()
                return client.patch(
                    f"/api/v1/offerings/{offering.pk}/", {"documents": [str(replacement.pk)]}, format="json"
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                Company.objects.select_for_update().get(pk=self.company.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                future = pool.submit(attach)
                self.assertTrue(started.wait(5))
                self.wait_for_database_lock(worker_pid[0], blocker)
                get_user_model().objects.filter(pk=self.owner.pk).update(is_email_verified=False)
            self.assertEqual(future.result(timeout=10), 404)
        with use_operator():
            self.assertEqual(list(offering.documents.values_list("pk", flat=True)), [original.pk])

    def private_documents_after_offering_wait(self, action):
        appointment = self.admit(requested_expires_at=timezone.now() + timedelta(seconds=4))
        original = self.upload()
        replacement = self.upload()
        offering = self.retained_offering(original, status="draft")
        started, worker_pid = Event(), []

        def attach():
            connections.close_all()
            client = APIClient()
            client.force_authenticate(self.owner)
            try:
                with use_operator(), connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    worker_pid.append(cursor.fetchone()[0])
                started.set()
                endpoint = f"/api/v1/offerings/{offering.pk}/"
                payload = {"documents": [str(replacement.pk)]}
                if action == "patch":
                    return client.patch(endpoint, payload, format="json").status_code
                return client.post(f"{endpoint}documents/", payload, format="json").status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                Offering.objects.select_for_update().get(pk=offering.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                future = pool.submit(attach)
                self.assertTrue(started.wait(5))
                self.wait_for_database_lock(worker_pid[0], blocker)
                sleep(max(0, (appointment.expires_at - timezone.now()).total_seconds()) + 0.1)
            self.assertEqual(future.result(timeout=10), 404)
        with use_operator():
            self.assertEqual(list(offering.documents.values_list("pk", flat=True)), [original.pk])

    def test_offering_patch_private_documents_recheck_expiry_after_the_offering_row_wait(self):
        self.private_documents_after_offering_wait("patch")

    def test_offering_attachment_private_documents_recheck_expiry_after_the_offering_row_wait(self):
        self.private_documents_after_offering_wait("attach")

    def test_admitted_owner_metadata_and_private_documents_work(self):
        self.admit()
        response = self.client.patch(self.url, {"phone": "555"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["administrativeAccess"], {"capabilities": ["admin"], "draftSetup": False})
        self.assertEqual(response.json()["email"], self.owner.email)
        document = self.upload()
        file_url = f"{self.url}documents/{document.pk}/file/"
        streamed = self.client.get(file_url)
        self.assertEqual(streamed.status_code, 200)
        self.assertEqual(b"".join(streamed.streaming_content), PDF)
        self.assertEqual(streamed["Cache-Control"], "private, no-store")
        self.assertEqual(self.client.delete(f"{self.url}documents/{document.pk}/").status_code, 204)
        with use_operator():
            self.assertFalse(CompanyDocument.objects.filter(pk=document.pk).exists())

    def test_investor_admin_receives_bounded_contact_and_company_bound_upload_receipt(self):
        self.invite(["admin", "prepare"], ["finance"])
        self.client.force_authenticate(self.other)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["isOwner"])
        self.assertEqual(
            response.json()["administrativeAccess"], {"capabilities": ["admin", "prepare"], "draftSetup": False}
        )
        self.assertEqual(response.json()["email"], self.owner.email)
        with use_operator():
            self.profile.refresh_from_db()
        self.assertEqual(response.json()["primaryContact"], {"fullName": self.profile.full_name})
        uploaded = self.client.post(
            f"{self.url}documents/",
            {
                "document_type": "constitution",
                "name": "New document",
                "file": evidence(),
                "company": str(self.foreign.pk),
            },
            format="multipart",
        )
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        self.assertEqual(uploaded.json()["company"], str(self.company.pk))
        with self.role(self.other, "app"):
            self.assertFalse(UserProfile.objects.filter(pk=self.profile.pk).exists())

    def test_delegatable_admin_and_all_other_personal_capabilities_grant_no_basic_access(self):
        self.invite([value for value in CompanyCapability.values if value != "admin"], ["admin"])
        self.client.force_authenticate(self.other)
        document = self.upload()
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.client.patch(self.url, {"phone": "forbidden"}, format="json").status_code, 404)
        self.assertEqual(self.client.get(f"{self.url}documents/{document.pk}/file/").status_code, 404)
        self.assertEqual(self.client.delete(f"{self.url}documents/{document.pk}/").status_code, 404)

    def test_revoked_root_permanently_closes_owner_draft_and_staff_has_no_bypass(self):
        appointment = self.admit()
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        metadata = self.client.get(self.url)
        self.assertEqual(metadata.status_code, 200)
        self.assertEqual(metadata.json()["administrativeAccess"], {"capabilities": [], "draftSetup": False})
        with self.assertRaises(NotFound):
            update_company(self.company, {"phone": "forbidden"}, actor=self.owner)
        with use_migrate():
            self.owner.is_staff = self.owner.is_superuser = True
            self.owner.save(update_fields=["is_staff", "is_superuser"])
        self.assertEqual(self.client.patch(self.url, {"phone": "forbidden"}, format="json").status_code, 404)
        with self.role(self.owner, "app"):
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())

    def test_foreign_and_missing_company_document_identifiers_have_identical_refusals(self):
        self.admit()
        document = self.upload()
        self.client.force_authenticate(self.other)
        foreign = self.client.get(f"/api/v1/companies/{self.foreign.pk}/documents/{document.pk}/file/")
        missing = self.client.get(f"/api/v1/companies/{self.foreign.pk}/documents/{uuid4()}/file/")
        self.assertEqual((foreign.status_code, foreign.json()), (missing.status_code, missing.json()))
        other = self.client.get(self.url)
        absent = self.client.get(f"/api/v1/companies/{uuid4()}/")
        self.assertEqual((other.status_code, other.json()), (absent.status_code, absent.json()))

    def test_raw_app_crud_and_unbounded_operator_writes_are_refused(self):
        self.admit()
        document = self.upload()
        with self.role(self.owner, "app"):
            self.assertTrue(Company.objects.filter(pk=self.company.pk).exists())
            with self.assertRaises(DatabaseError), atomic():
                Company.objects.filter(pk=self.company.pk).update(phone="forbidden")
        for role, operation in [("operator", ""), ("operator", "edit")]:
            with self.subTest(role=role, operation=operation):
                with self.assertRaises(DatabaseError), self.role(self.other, role):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT set_config('app.company_id', %s, true), "
                            "set_config('app.company_operation', %s, true)",
                            [str(self.company.pk), operation],
                        )
                    Company.objects.filter(pk=self.company.pk).update(phone="forbidden")
        with self.assertRaises(DatabaseError), self.role(self.owner, "app"):
            CompanyDocument.objects.create(company=self.company, document_type="constitution", name="Forged")
        with self.assertRaises(DatabaseError), self.role(self.owner, "operator"):
            CompanyDocument.objects.filter(pk=document.pk).delete()

    def test_operator_edit_cannot_forge_owner_status_review_or_provider_fields(self):
        self.admit()
        for changes in [
            {"owner": self.other},
            {"status": "active"},
            {"registry_status": "failed"},
            {"approved_by": self.owner},
            {"lifecycle_revision": 99},
        ]:
            with self.subTest(changes=changes):
                with self.assertRaises(DatabaseError), self.role(self.owner, "operator"):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(
                            "SELECT set_config('app.company_id', %s, true), "
                            "set_config('app.company_operation', 'edit', true)",
                            [str(self.company.pk)],
                        )
                    Company.objects.filter(pk=self.company.pk).update(**changes)

    def test_failed_new_upload_removes_only_its_new_object(self):
        existing = self.upload()
        before = sorted(path for path in self.root.rglob("*") if path.is_file())
        original = CompanyDocument.save

        def fail_after_storage(document, *args, **kwargs):
            original(document, *args, **kwargs)
            raise RuntimeError("Synthetic failure after persistence")

        with patch.object(CompanyDocument, "save", fail_after_storage), self.assertRaises(RuntimeError):
            self.upload()
        self.assertEqual(sorted(path for path in self.root.rglob("*") if path.is_file()), before)
        with use_operator():
            self.assertEqual(CompanyDocument.objects.filter(company=self.company).count(), 1)
            self.assertTrue(existing.file.storage.exists(existing.file.name))

    def test_personal_six_capability_contract_retains_separate_delegatable_scope(self):
        self.invite(list(CompanyCapability.values), ["admin"])
        self.client.force_authenticate(self.other)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["administrativeAccess"]["capabilities"], sorted(CompanyCapability.values))

    def test_configured_identity_and_live_account_changes_stop_rooted_administration(self):
        self.admit()
        with use_migrate():
            Operator.objects.filter(pk=1).update(issuer_kyc_required=True)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["administrativeAccess"], {"capabilities": [], "draftSetup": False})
        with self.assertRaises(NotFound):
            update_company(self.company, {"phone": "forbidden"}, actor=self.owner)
        with use_migrate():
            Operator.objects.filter(pk=1).update(issuer_kyc_required=False)
            get_user_model().objects.filter(pk=self.owner.pk).update(is_email_verified=False)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["administrativeAccess"], {"capabilities": [], "draftSetup": False})
        self.assertEqual(self.client.patch(self.url, {"phone": "forbidden"}, format="json").status_code, 404)

    def test_retained_root_blocks_a_different_current_owner_without_rebootstrap(self):
        appointment = self.admit()
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
        self.client.force_authenticate(self.other)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["administrativeAccess"], {"capabilities": [], "draftSetup": False})
        self.assertEqual(self.client.patch(self.url, {"phone": "forbidden"}, format="json").status_code, 404)
        with self.role(self.other, "app"):
            self.assertFalse(Company.objects.filter(pk=self.company.pk).exists())

    def test_staff_content_review_and_authorised_identity_edit_preserve_the_original_invalidator(self):
        self.admit()
        document = self.upload()
        reviewer, _profile = self.account("foundation-reviewer")
        with use_migrate():
            get_user_model().objects.filter(pk=reviewer.pk).update(is_staff=True, is_superuser=True)
        with use_operator():
            _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
            verified = verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
        self.assertTrue(verified.is_verified)
        self.assertEqual(verified.verified_by_id, reviewer.pk)
        update_company(self.company, {"name": "Corrected Pty Ltd"}, actor=self.owner)
        with use_operator():
            document.refresh_from_db()
        self.assertFalse(document.is_verified)
        self.assertEqual(document.verified_fingerprint, "")
        self.assertIsNone(document.verified_by_id)
        self.assertIsNone(document.verified_at)

    def test_staff_technical_recovery_does_not_acquire_basic_or_admin_model_authority(self):
        with self.assertRaises(PermissionDenied):
            transition_company(self.company, "submit", actor=self.owner)
        reviewer, _profile = self.account("foundation-api-reviewer")
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="active")
            get_user_model().objects.filter(pk=reviewer.pk).update(is_staff=True)
            reviewer.refresh_from_db()
        self.assertFalse(reviewer.has_perm("companies.change_company"))
        with self.assertRaises(PermissionDenied):
            transition_company(
                self.company, "issue_warning", actor=reviewer, admin_review=True, reason="Technical warning"
            )
        with self.assertRaises(DatabaseError), self.role(reviewer, "operator"):
            with company_operation(reviewer, self.company.pk, "admin_workflow"):
                with atomic():
                    Company.objects.filter(pk=self.company.pk).update(
                        status="warning",
                        lifecycle_revision=1,
                        warning_issued_at=timezone.now(),
                        warning_reason="Forged",
                    )
        self.client.force_authenticate(reviewer)
        self.assertEqual(self.client.post(f"{self.url}status/", {"status": "review"}, format="json").status_code, 400)
        response = self.client.post(
            f"{self.url}status/", {"status": "warning", "reason": "Technical warning"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["company"]["status"], "warning")
        self.assertEqual(response.json()["company"]["email"], self.owner.email)
        self.assertEqual(response.json()["company"]["administrativeAccess"]["capabilities"], [])
        self.assertEqual(self.client.patch(self.url, {"phone": "forbidden"}, format="json").status_code, 404)
        with use_migrate():
            permission = Permission.objects.get(content_type__app_label="companies", codename="change_company")
            reviewer.user_permissions.add(permission)
            reviewer = get_user_model().objects.get(pk=reviewer.pk)
        updated = transition_company(
            self.company, "suspend", actor=reviewer, admin_review=True, reason="Technical recovery"
        )
        self.assertEqual(updated.status, "suspended")
        self.assertEqual(updated.lifecycle_revision, 2)
        self.assertEqual(updated.warning_reason, "Technical warning")
        self.assertEqual(updated.suspension_reason, "Technical recovery")
        self.assertIsNotNone(updated.warning_issued_at)
        self.assertIsNotNone(updated.suspended_at)
        self.assertIsNone(updated.approved_by_id)
        self.assertIsNone(updated.activated_at)

    def test_raw_technical_workflow_requires_current_active_staff_and_bound_provenance(self):
        with self.assertRaises(PermissionDenied):
            transition_company(self.company, "submit", actor=self.owner)
        with self.assertRaises(DatabaseError), self.role(self.owner, "operator"):
            with company_operation(self.owner, self.company.pk, "workflow"):
                with atomic():
                    Company.objects.filter(pk=self.company.pk).update(
                        status="submitted", lifecycle_revision=1, submitted_at=timezone.now(), submitted_by=self.owner
                    )
        reviewer, _profile = self.account("foundation-inactive-reviewer")
        with use_migrate():
            Company.objects.filter(pk__in=[self.company.pk, self.foreign.pk]).update(status="active")
            get_user_model().objects.filter(pk=reviewer.pk).update(is_staff=True, is_active=False)
            permission = Permission.objects.get(content_type__app_label="companies", codename="change_company")
            reviewer.user_permissions.add(permission)
            reviewer.refresh_from_db()
        for actor in (reviewer, self.other, self.owner):
            with self.subTest(actor=actor.pk):
                with self.assertRaises(PermissionDenied):
                    transition_company(self.company, "issue_warning", actor=actor, reason="Forged")
                for operation in ("workflow", "admin_workflow"):
                    with self.subTest(operation=operation):
                        with self.assertRaises(DatabaseError), self.role(actor, "operator"):
                            with company_operation(actor, self.company.pk, operation):
                                with atomic():
                                    Company.objects.filter(pk=self.company.pk).update(
                                        status="warning",
                                        lifecycle_revision=1,
                                        warning_issued_at=timezone.now(),
                                        warning_reason="Forged",
                                    )
        with use_migrate():
            get_user_model().objects.filter(pk=reviewer.pk).update(is_active=True)
            reviewer.refresh_from_db()
        for operation in ("workflow", "admin_workflow"):
            with self.subTest(operation=operation):
                with self.assertRaisesRegex(DatabaseError, "Use the exact actor-bound company command"), self.role(
                    reviewer, "operator"
                ):
                    with company_operation(reviewer, self.foreign.pk, operation):
                        with atomic():
                            Company.objects.filter(pk=self.company.pk).update(
                                status="warning",
                                lifecycle_revision=1,
                                warning_issued_at=timezone.now(),
                                warning_reason="Forged",
                            )
                for changes in ({"approved_by": self.other}, {"officeholder_attested_by": self.other}):
                    with self.subTest(changes=changes):
                        with self.assertRaisesRegex(
                            DatabaseError, "Retain technical company recovery and its current provider safeguards"
                        ), self.role(reviewer, "operator"):
                            with company_operation(reviewer, self.company.pk, operation):
                                with atomic():
                                    Company.objects.filter(pk=self.company.pk).update(**changes)
        with use_operator():
            self.company.refresh_from_db()
        self.assertEqual(self.company.status, "active")
        self.assertEqual(self.company.lifecycle_revision, 0)
        self.assertIsNone(self.company.submitted_by_id)
        self.assertIsNone(self.company.approved_by_id)
        self.assertIsNone(self.company.officeholder_attested_by_id)

    def test_raw_depth_one_verification_or_company_scope_forgery_is_not_an_invalidation(self):
        self.admit()
        document = self.upload()
        for changes in ({"is_verified": True}, {"company_id": self.foreign.pk}, {"name": "Forged metadata"}):
            with self.subTest(changes=changes):
                with self.assertRaises(DatabaseError), self.role(self.owner, "operator"):
                    with company_operation(self.owner, self.company.pk, "edit"):
                        CompanyDocument.objects.filter(pk=document.pk).update(**changes)
        with use_operator():
            document.refresh_from_db()
        self.assertFalse(document.is_verified)
        self.assertEqual(document.company_id, self.company.pk)
        self.assertEqual(document.name, "Synthetic constitution")

    def test_upload_cannot_alias_a_retained_path_or_reference_a_foreign_company_path(self):
        self.admit()
        document = self.upload()
        paths = (document.file.name, document.file.name.replace(str(self.company.pk), str(self.foreign.pk)))
        for retained_path in paths:
            with self.subTest(retained_path=retained_path):
                with self.assertRaises(DatabaseError), self.operator_as(self.owner):
                    create_document(
                        company_id=self.company.pk,
                        actor=self.owner,
                        data={
                            "document_type": "constitution",
                            "name": "Forged file reference",
                            "file": retained_path,
                            "file_size": len(PDF),
                            "mime_type": "application/pdf",
                        },
                    )
        with use_operator():
            self.assertEqual(CompanyDocument.objects.filter(company=self.company).count(), 1)
        with document.file.open("rb") as original:
            self.assertEqual(original.read(), PDF)

    def test_same_owner_companies_do_not_share_an_invited_administrators_private_scope(self):
        shared_owner_company = self.register(self.owner, "11223344")
        shared_owner_document = create_document(
            company_id=shared_owner_company.pk,
            actor=self.owner,
            data={
                "document_type": "constitution",
                "name": "Other retained company",
                "file": evidence(),
                "file_size": len(PDF),
                "mime_type": "application/pdf",
            },
        )
        self.invite(["admin"])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        for method, suffix, data in (
            ("get", "", {}),
            ("patch", "", {"phone": "forbidden"}),
            ("get", f"documents/{shared_owner_document.pk}/file/", {}),
            ("delete", f"documents/{shared_owner_document.pk}/", {}),
        ):
            with self.subTest(method=method, suffix=suffix):
                actual = getattr(self.client, method)(
                    f"/api/v1/companies/{shared_owner_company.pk}/{suffix}", data, format="json"
                )
                absent = getattr(self.client, method)(f"/api/v1/companies/{uuid4()}/{suffix}", data, format="json")
                self.assertEqual((actual.status_code, actual.json()), (absent.status_code, absent.json()))
                self.assertEqual(actual.status_code, 404)
        with self.role(self.other, "app"):
            self.assertFalse(Company.objects.filter(pk=shared_owner_company.pk).exists())
            self.assertFalse(CompanyDocument.objects.filter(pk=shared_owner_document.pk).exists())

    def test_durable_new_upload_refuses_an_enclosing_transaction_before_writing_storage(self):
        document = self.upload()
        before = sorted(path for path in self.root.rglob("*") if path.is_file())
        with self.assertRaisesMessage(
            RuntimeError, "A durable atomic block cannot be nested"
        ), use_operator(), atomic():
            self.upload()
        self.assertEqual(sorted(path for path in self.root.rglob("*") if path.is_file()), before)
        with use_operator():
            self.assertEqual(list(CompanyDocument.objects.values_list("pk", flat=True)), [document.pk])

    def retained_offering(self, document, status="approved"):
        with use_migrate():
            token = ShareToken.objects.create(company=self.company, name="Retained ordinary", symbol="KEEP")
            offering = Offering.objects.create(
                token=token,
                status="draft",
                exemption="s708_8_minimum_amount",
                price_per_share="1.00",
                minimum_shares=1,
                target_shares=2,
                cap_shares=3,
                opens_at=timezone.now(),
            )
            offering.documents.add(document)
            Offering.objects.filter(pk=offering.pk).update(status=status)
            return offering

    def test_retained_published_offering_prevents_service_and_raw_deletion_without_storage_loss(self):
        self.admit()
        document = self.upload()
        self.retained_offering(document)
        with self.assertRaises(OfferedDocumentException):
            delete_document(document, actor=self.owner)
        with self.assertRaises(DatabaseError), self.role(self.owner, "operator"):
            with company_operation(self.owner, self.company.pk, "document_delete"):
                CompanyDocument.objects.filter(pk=document.pk).delete()
        with use_operator():
            self.assertTrue(CompanyDocument.objects.filter(pk=document.pk).exists())
        self.assertTrue(document.file.storage.exists(document.file.name))

    def wait_document_deletion(self, document, offering, change):
        started = Event()

        def delete():
            connections.close_all()
            started.set()
            try:
                with self.role(self.owner, "operator"):
                    with company_operation(self.owner, self.company.pk, "document_delete"):
                        CompanyDocument.objects.filter(pk=document.pk).delete()
                return "deleted"
            except DatabaseError:
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                Offering.objects.select_for_update().get(pk=offering.pk)
                future = pool.submit(delete)
                self.assertTrue(started.wait(5))
                sleep(0.1)
                self.assertFalse(future.done())
                change()
            self.assertEqual(future.result(timeout=10), "refused")
        with use_operator():
            self.assertTrue(CompanyDocument.objects.filter(pk=document.pk).exists())
        self.assertTrue(document.file.storage.exists(document.file.name))

    def test_raw_deletion_rechecks_expiry_after_a_retained_offering_lock_wait(self):
        self.admit(requested_expires_at=timezone.now() + timedelta(seconds=2))
        document = self.upload()
        offering = self.retained_offering(document, status="draft")
        self.wait_document_deletion(document, offering, lambda: sleep(2.1))

    def test_publishing_during_the_offering_lock_wait_preserves_document_attachment_and_storage(self):
        self.admit()
        document = self.upload()
        offering = self.retained_offering(document, status="draft")
        self.wait_document_deletion(
            document, offering, lambda: Offering.objects.filter(pk=offering.pk).update(status="approved")
        )
        with use_operator():
            self.assertTrue(offering.documents.filter(pk=document.pk).exists())

    def test_raw_wallet_change_rechecks_expiry_after_the_wallet_lock_wait(self):
        with use_migrate():
            account = UserAccount.objects.create(user_profile=self.profile, account_number="CORE-WALLET")
            wallet = Wallet.objects.create(
                user_account=account,
                address="0x" + "a" * 40,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
            )
        self.admit(requested_expires_at=timezone.now() + timedelta(seconds=2))
        started = Event()

        def change_wallet():
            connections.close_all()
            started.set()
            try:
                with self.role(self.owner, "operator"):
                    with company_operation(self.owner, self.company.pk, "edit"):
                        Company.objects.filter(pk=self.company.pk).update(operator_wallet=wallet)
                return "written"
            except DatabaseError:
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                Wallet.objects.select_for_update().get(pk=wallet.pk)
                future = pool.submit(change_wallet)
                self.assertTrue(started.wait(5))
                sleep(0.1)
                self.assertFalse(future.done())
                sleep(2.1)
            self.assertEqual(future.result(timeout=10), "refused")
        with use_operator():
            self.assertIsNone(Company.objects.get(pk=self.company.pk).operator_wallet_id)

    def wait_edit(self, change):
        started = Event()

        def edit():
            connections.close_all()
            started.set()
            try:
                update_company(self.company, {"phone": "forbidden"}, actor=self.owner)
                return "written"
            except NotFound:
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_operator(), atomic():
                Company.objects.select_for_update().get(pk=self.company.pk)
                future = pool.submit(edit)
                self.assertTrue(started.wait(5))
                sleep(0.1)
                self.assertFalse(future.done())
                change()
            self.assertEqual(future.result(timeout=10), "refused")
        with use_operator():
            self.assertEqual(Company.objects.get(pk=self.company.pk).phone, "")

    def test_revocation_committed_during_company_lock_wait_stops_the_edit(self):
        appointment = self.admit()
        self.wait_edit(lambda: revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk))

    def test_account_deactivation_committed_during_company_lock_wait_stops_the_edit(self):
        self.admit()

        def deactivate():
            with use_migrate(), atomic():
                get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)

        self.wait_edit(deactivate)

    def test_configured_identity_requirement_committed_during_company_lock_wait_stops_the_edit(self):
        self.admit()

        def require_identity():
            with use_migrate(), atomic():
                Operator.objects.filter(pk=1).update(issuer_kyc_required=True)

        self.wait_edit(require_identity)

    def test_actual_expiry_during_company_lock_wait_cannot_reopen_owner_draft(self):
        self.admit(requested_expires_at=timezone.now() + timedelta(seconds=2))
        self.wait_edit(lambda: sleep(2.1))

    def test_private_file_rechecks_actual_expiry_after_the_document_lock_wait(self):
        self.admit(requested_expires_at=timezone.now() + timedelta(seconds=2))
        document = self.upload()
        started = Event()

        def read():
            from companies.services.documents import document_file

            connections.close_all()
            started.set()
            try:
                with document_file(company_id=self.company.pk, document_id=document.pk, actor=self.owner):
                    return "opened"
            except NotFound:
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_operator(), atomic():
                CompanyDocument.objects.select_for_update().get(pk=document.pk)
                future = pool.submit(read)
                self.assertTrue(started.wait(5))
                sleep(0.1)
                self.assertFalse(future.done())
                sleep(2.1)
            self.assertEqual(future.result(timeout=10), "refused")

    def test_identity_invalidator_rechecks_expiry_after_document_wait_and_rolls_back_the_company_edit(self):
        self.admit(requested_expires_at=timezone.now() + timedelta(seconds=2))
        document = self.upload()
        reviewer, _profile = self.account("foundation-wait-reviewer")
        with use_migrate():
            get_user_model().objects.filter(pk=reviewer.pk).update(is_staff=True, is_superuser=True)
        with use_operator():
            _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
            verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
        started = Event()

        def edit_identity():
            connections.close_all()
            started.set()
            try:
                with self.operator_as(self.owner):
                    update_company(self.company, {"name": "Refused identity change"}, actor=self.owner)
                return "written"
            except (DatabaseError, NotFound):
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_operator(), atomic():
                CompanyDocument.objects.select_for_update().get(pk=document.pk)
                future = pool.submit(edit_identity)
                self.assertTrue(started.wait(5))
                sleep(0.1)
                self.assertFalse(future.done())
                sleep(2.1)
            self.assertEqual(future.result(timeout=10), "refused")
        with use_operator():
            self.assertEqual(Company.objects.get(pk=self.company.pk).name, self.company.name)
            document.refresh_from_db()
        self.assertTrue(document.is_verified)
        self.assertEqual(document.verified_by_id, reviewer.pk)


class ScopedCompanyAdministrationTest(RunsOnTheScopedConnection, CompanyAdministrationTest):
    pass
