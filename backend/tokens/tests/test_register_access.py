from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from operators.models import Operator
from shared.db import use_migrate, use_operator
from shared.seeds.synthetic.authority import historical_owner_appointment
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RegisterExport, ShareToken
from tokens.querysets import RegisterProposalQuerySet
from tokens.services.register_corrections import prepare_correction
from tokens.services.register_openings import submit_link
from tokens.tests.test_register_corrections import (
    correction_fixture,
    correction_payload,
)
from tokens.tests.test_register_imports import import_fixture, import_payload, prepared
from tokens.tests.test_register_links import link_fixture, link_payload
from tokens.views.register_correction import RegisterCorrectionViewSet
from tokens.views.register_import import RegisterImportViewSet
from tokens.views.register_instruction import RegisterInstructionViewSet
from tokens.views.register_opening import (
    RegisterOpeningViewSet,
    RegisterWalletLinkViewSet,
)
from tokens.views.register_proposal import RegisterProposalViewSet
from users.models import UserProfile

User = get_user_model()
REGISTER_CLASSES = "/api/v1/tokens/register/"


def person(email, **fields):
    with use_migrate():
        user = User.objects.create_user(
            email=email, password="pw-12345678", is_active=True, is_email_verified=True, **fields
        )
        UserProfile.objects.get_or_create(user=user, defaults={"full_name": email})
    return user


class RegisterAccessByAppointmentTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            (
                self.owner,
                self.company,
                self.token,
                self.member,
                self.administrator,
                register_copy,
                asic,
                _,
            ) = import_fixture()
        self.proposal = self.submit(import_payload(self.token, register_copy, asic, self.member, self.administrator))
        self.other_owner = person(f"other-owner-{uuid4()}@example.test")
        with use_migrate():
            self.other_company = Company.objects.create(
                owner=self.other_owner, name="Other Register Pty Ltd", acn="567856785", status="active"
            )
            self.other_token = ShareToken.objects.create(
                company=self.other_company, name="Other ordinary", symbol="OTH", total_supply="1000"
            )
        with use_migrate():
            UserProfile.objects.get_or_create(user=self.owner, defaults={"full_name": "Register owner"})
        with use_operator():
            self.other_administrator = historical_owner_appointment(self.other_company)

    def submit(self, payload):
        return prepared(self.owner, payload)

    def appoint(self, capabilities, *, delegatable=(), inviter=None, expires_at=None):
        inviter = inviter or self.administrator
        appointee = person(f"appointee-{uuid4()}@example.test")
        _, code, _ = issue_team_invitation(
            requester=inviter.appointee,
            company_id=inviter.company_id,
            inviter_appointment_id=inviter.pk,
            idempotency_key=uuid4(),
            capabilities=list(capabilities),
            delegatable_capabilities=list(delegatable),
            appointment_expires_at=expires_at,
        )
        appointment = accept_team_invitation(
            requester=appointee, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        return appointee, appointment

    def reads(self, user):
        client = APIClient()
        client.force_authenticate(user)
        classes = client.get(REGISTER_CLASSES)
        self.assertEqual(classes.status_code, 200, classes.content)
        return {
            "classes": {row["uuid"] for row in classes.json()["results"]},
            "holders": client.get(f"/api/v1/tokens/{self.token.uuid}/holders/").status_code,
            "waiting": client.get(f"/api/v1/tokens/{self.token.uuid}/register/waiting/").status_code,
            "entries": client.get(f"/api/v1/tokens/{self.token.uuid}/register/entries/").status_code,
            "export": self.export(client, user),
            "imports": {row["uuid"] for row in client.get("/api/v1/tokens/register-imports/").json()["results"]},
            "import": client.get(f"/api/v1/tokens/register-imports/{self.proposal.uuid}/").status_code,
            "evidence": client.get(f"/api/v1/tokens/register-imports/{self.proposal.uuid}/file/").status_code,
        }

    def export(self, client, user):
        with use_operator():
            before = RegisterExport.objects.filter(token=self.token, requested_by_id=user.pk).count()
        status = client.get(f"/api/v1/tokens/{self.token.uuid}/register/export/").status_code
        with use_operator():
            recorded = RegisterExport.objects.filter(token=self.token, requested_by_id=user.pk).count() - before
        return status, recorded

    def assert_reads_the_register(self, user):
        self.assertEqual(
            self.reads(user),
            {
                "classes": {str(self.token.uuid)},
                "holders": 200,
                "waiting": 200,
                "entries": 200,
                "export": (200, 1),
                "imports": {str(self.proposal.uuid)},
                "import": 200,
                "evidence": 200,
            },
        )

    def assert_reads_nothing(self, user, *, classes=frozenset()):
        self.assertEqual(
            self.reads(user),
            {
                "classes": set(classes),
                "holders": 404,
                "waiting": 404,
                "entries": 404,
                "export": (404, 0),
                "imports": set(),
                "import": 404,
                "evidence": 404,
            },
        )

    def test_administration_and_each_register_capability_read_the_whole_register(self):
        for capabilities in (
            [CompanyCapability.ADMIN],
            [CompanyCapability.READ_REGISTER],
            [CompanyCapability.PREPARE],
            [CompanyCapability.APPROVE],
            [CompanyCapability.APPLY],
        ):
            with self.subTest(capabilities=capabilities):
                appointee, _ = self.appoint(capabilities)
                self.assert_reads_the_register(appointee)

    def test_finance_only_delegation_only_and_platform_roles_read_no_register(self):
        finance, _ = self.appoint([CompanyCapability.FINANCE])
        delegation_only, _ = self.appoint([CompanyCapability.FINANCE], delegatable=[CompanyCapability.READ_REGISTER])
        staff = person(f"staff-{uuid4()}@example.test", is_staff=True)
        superuser = person(f"root-{uuid4()}@example.test", is_staff=True, is_superuser=True)
        for label, user in (
            ("finance", finance),
            ("delegation only", delegation_only),
            ("staff", staff),
            ("superuser", superuser),
        ):
            with self.subTest(user=label):
                self.assert_reads_nothing(user)

    def test_another_companys_register_reader_reads_only_its_own_company(self):
        foreign, _ = self.appoint([CompanyCapability.READ_REGISTER], inviter=self.other_administrator)
        self.assert_reads_nothing(foreign, classes={str(self.other_token.uuid)})

    def test_the_company_filter_narrows_the_class_list_to_one_readable_company(self):
        reader, _ = self.appoint([CompanyCapability.READ_REGISTER])
        _, code, _ = issue_team_invitation(
            requester=self.other_administrator.appointee,
            company_id=self.other_company.pk,
            inviter_appointment_id=self.other_administrator.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.READ_REGISTER],
            delegatable_capabilities=[],
        )
        accept_team_invitation(
            requester=reader, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        client = APIClient()
        client.force_authenticate(reader)
        both = client.get(REGISTER_CLASSES).json()["results"]
        self.assertEqual({row["uuid"] for row in both}, {str(self.token.uuid), str(self.other_token.uuid)})
        self.assertEqual(
            {(row["companyUuid"], row["companyName"]) for row in both},
            {(str(self.company.uuid), self.company.name), (str(self.other_company.uuid), self.other_company.name)},
        )
        one = client.get(REGISTER_CLASSES, {"company_uuid": str(self.other_company.uuid)}).json()["results"]
        self.assertEqual([row["uuid"] for row in one], [str(self.other_token.uuid)])

    def test_revocation_ends_register_access_immediately(self):
        reader, appointment = self.appoint([CompanyCapability.READ_REGISTER])
        self.assert_reads_the_register(reader)
        revoke_company_appointment(requester=self.administrator.appointee, appointment_id=appointment.pk)
        self.assert_reads_nothing(reader)

    def test_an_expired_appointment_reads_no_register(self):
        expires_at = timezone.now() + timedelta(days=1)
        reader, _ = self.appoint([CompanyCapability.READ_REGISTER], expires_at=expires_at)
        self.assert_reads_the_register(reader)
        with patch("companies.querysets.company.timezone.now", return_value=expires_at + timedelta(seconds=1)):
            self.assert_reads_nothing(reader)

    def test_a_deactivated_or_unverified_appointee_reads_no_register(self):
        for field in ("is_active", "is_email_verified"):
            with self.subTest(field=field):
                reader, _ = self.appoint([CompanyCapability.READ_REGISTER])
                with use_migrate():
                    User.objects.filter(pk=reader.pk).update(**{field: False})
                reader.refresh_from_db()
                self.assert_reads_nothing(reader)

    def test_the_issuer_identity_requirement_applies_to_register_readers(self):
        reader, _ = self.appoint([CompanyCapability.READ_REGISTER])
        with use_migrate():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.assert_reads_nothing(reader)
        with use_migrate():
            UserProfile.objects.filter(user=reader).update(is_id_verified=True)
        self.assert_reads_the_register(reader)

    def test_the_owner_keeps_reading_the_register_after_its_appointment_is_revoked(self):
        self.assert_reads_the_register(self.owner)
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        self.assert_reads_the_register(self.owner)

    def test_no_capability_named_selects_no_appointment(self):
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.holding_any([]).exists())
            self.assertTrue(CompanyAppointment.objects.holding_any([CompanyCapability.ADMIN]).exists())

    def test_every_register_proposal_view_reads_through_the_shared_register_rule(self):
        for view in (
            RegisterOpeningViewSet,
            RegisterWalletLinkViewSet,
            RegisterImportViewSet,
            RegisterCorrectionViewSet,
            RegisterInstructionViewSet,
        ):
            with self.subTest(view=view.__name__):
                self.assertTrue(issubclass(view, RegisterProposalViewSet))
                self.assertFalse({"narrow", "file", "get_queryset", "get_object"} & set(view.__dict__))
                self.assertIsInstance(view.scoped_model._default_manager.all(), RegisterProposalQuerySet)


class RegisterProposalFamiliesTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            correction_owner, _, self.correction_administrator, issue, evidence = correction_fixture()
            self.correction, _ = prepare_correction(
                actor=correction_owner, **correction_payload(issue, evidence, self.correction_administrator)
            )
            link_owner, link_company, _, _, link_document = link_fixture()
            self.link = submit_link(actor=link_owner, **link_payload(link_company, link_document))
            UserProfile.objects.get_or_create(user=link_owner, defaults={"full_name": link_owner.email})
            self.link_administrator = historical_owner_appointment(link_company)

    def reader(self, administrator):
        appointee = person(f"reader-{uuid4()}@example.test")
        _, code, _ = issue_team_invitation(
            requester=administrator.appointee,
            company_id=administrator.company_id,
            inviter_appointment_id=administrator.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.READ_REGISTER],
            delegatable_capabilities=[],
        )
        accept_team_invitation(
            requester=appointee, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        client = APIClient()
        client.force_authenticate(appointee)
        return client

    def test_correction_and_link_readers_see_only_their_own_companys_proposals_and_evidence(self):
        correction_reader = self.reader(self.correction_administrator)
        link_reader = self.reader(self.link_administrator)
        for kind, proposal, own, foreign in (
            ("register-corrections", self.correction, correction_reader, link_reader),
            ("register-links", self.link, link_reader, correction_reader),
        ):
            with self.subTest(kind=kind):
                listed = own.get(f"/api/v1/tokens/{kind}/").json()["results"]
                self.assertEqual([row["uuid"] for row in listed], [str(proposal.uuid)])
                self.assertEqual(own.get(f"/api/v1/tokens/{kind}/{proposal.uuid}/").status_code, 200)
                self.assertEqual(own.get(f"/api/v1/tokens/{kind}/{proposal.uuid}/file/").status_code, 200)
                self.assertEqual(foreign.get(f"/api/v1/tokens/{kind}/").json()["results"], [])
                self.assertEqual(foreign.get(f"/api/v1/tokens/{kind}/{proposal.uuid}/").status_code, 404)
                self.assertEqual(foreign.get(f"/api/v1/tokens/{kind}/{proposal.uuid}/file/").status_code, 404)


class ScopedRegisterAccessByAppointmentTest(RunsOnTheScopedConnection, RegisterAccessByAppointmentTest):
    def submit(self, payload):
        self.the_principal_the_middleware_would_set(self.owner)
        return super().submit(payload)
