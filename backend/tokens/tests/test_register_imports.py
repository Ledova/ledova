import csv
import io
from datetime import date, timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import CompanyDocument, DocumentType
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import DOCUMENT_BYTES, attach_file
from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import (
    ImportedFormerMember,
    RegisterEntryKind,
    RegisterImport,
    RegisterMemberParticulars,
    ShareToken,
)
from tokens.services.former_holders import (
    purge_imported_former_members,
    purge_member_particulars,
)
from tokens.services.register import (
    FORMER_MEMBER_HEADERS,
    PARTICULARS_LABEL,
    REGISTER_HEADERS,
)
from tokens.services.register_events import create_member, record_entry
from tokens.services.register_imports import (
    decide_import,
    prepare_import_review,
    submit_import,
)
from tokens.tests.test_register_events import DAY, register_fixture

RESIDENCE = "12 Register Street, Sydney NSW 2000"


def verified_document(company, reviewer, document_type, name):
    document = attach_file(
        CompanyDocument.objects.create(
            company=company,
            document_type=document_type,
            name=name,
            file_size=len(DOCUMENT_BYTES),
            mime_type="application/pdf",
        )
    )
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    return verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)


def import_fixture():
    owner, company, token, member, other, opening = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    reviewer = get_user_model().objects.create_user(
        email=f"import-{uuid4()}@example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registerimport", "view_registerimport"]
        )
    )
    register_document = verified_document(company, reviewer, DocumentType.SHARE_REGISTER, "Share register")
    asic = verified_document(company, reviewer, DocumentType.ASIC_EXTRACT, "ASIC extract")
    return owner, company, token, member, reviewer, register_document, asic, opening


def import_payload(token, register_document, asic, member, **changes):
    return {
        "operation_id": uuid4(),
        "token_id": token.pk,
        "document_id": register_document.pk,
        "asic_document_id": asic.pk,
        "as_at": DAY.isoformat(),
        "members": [
            {
                "member": str(member.pk),
                "name": "Mia Member",
                "residential_address": RESIDENCE,
                "shares": "100",
                "entered_on": "2019-05-01",
                "amount_paid": "250.00",
            }
        ],
        "former_members": [
            {
                "name": "Fred Former",
                "residential_address": "3 Old Road, Hobart TAS 7000",
                "shares": "40",
                "ceased_on": "2022-03-01",
            }
        ],
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-IMPORT-1",
        "reason": "Import the company's existing register",
        **changes,
    }


class RegisterImportTest(TransactionTestCase):
    def setUp(self):
        (
            self.owner,
            self.company,
            self.token,
            self.member,
            self.reviewer,
            self.register_document,
            self.asic,
            self.opening,
        ) = import_fixture()
        self.payload = import_payload(self.token, self.register_document, self.asic, self.member)

    def submit(self, **changes):
        return submit_import(actor=self.owner, **{**self.payload, **changes})

    def apply(self, proposal, total=100, count=1):
        _, _, confirmation = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        return decide_import(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision="apply",
            asic_issued_total=total,
            asic_member_count=count,
        )

    def export(self):
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(f"/api/v1/tokens/{self.token.uuid}/register/export/")
        self.assertEqual(response.status_code, 200)
        return list(csv.reader(io.StringIO(response.content.decode())))

    def test_submission_binds_both_documents_and_retains_the_register_copy(self):
        proposal = self.submit()
        self.assertEqual((proposal.status, proposal.token_id, proposal.as_at), ("submitted", self.token.pk, DAY))
        self.assertEqual(
            (proposal.evidence_fingerprint, proposal.asic_document, proposal.asic_fingerprint),
            (self.register_document.verified_fingerprint, self.asic.pk, self.asic.verified_fingerprint),
        )
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        self.assertEqual(proposal.members[0]["amount_paid"], "250.00")
        self.assertEqual(self.submit(operation_id=self.payload["operation_id"]).pk, proposal.pk)

    def test_submission_refuses_unusable_rows_documents_and_classes(self):
        row = self.payload["members"][0]
        unopened = ShareToken.objects.create(company=self.company, name="Unopened", symbol="UNO", total_supply="10")
        for changes in (
            {"members": []},
            {"members": [{**row, "member": str(uuid4())}]},
            {"members": [row, row]},
            {"members": [{**row, "shares": "0"}]},
            {"members": [{**row, "entered_on": "2030-01-01"}]},
            {"members": [{**row, "amount_paid": "1.234"}]},
            {"members": [{**row, "name": " "}]},
            {"former_members": [{**self.payload["former_members"][0], "ceased_on": "2030-01-01"}]},
            {"document_id": self.asic.pk},
            {"asic_document_id": self.register_document.pk},
            {"token_id": unopened.pk},
            {"as_at": (timezone.localdate() + timedelta(days=1)).isoformat()},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterImport.objects.exists())

    def test_application_records_particulars_former_members_and_the_asic_figures(self):
        proposal = self.submit()
        _, comparison, _ = prepare_import_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        self.assertEqual(comparison, [{"member": str(self.member.pk), "imported": 100, "stored": 100}])
        applied = self.apply(proposal)
        self.assertEqual(
            (applied.status, applied.asic_issued_total, applied.asic_member_count, applied.register_sequence),
            ("applied", 100, 1, 1),
        )
        particulars = RegisterMemberParticulars.objects.get(member=self.member)
        self.assertEqual((particulars.name, particulars.residential_address), ("Mia Member", RESIDENCE))
        (former,) = ImportedFormerMember.objects.all()
        self.assertEqual(
            (former.name, former.shares_at_cessation, former.ceased_on), ("Fred Former", 40, date(2022, 3, 1))
        )
        repeated = decide_import(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation="",
            decision="apply",
            asic_issued_total=100,
            asic_member_count=1,
        )
        self.assertEqual((repeated.pk, repeated.status), (proposal.pk, "applied"))

    def test_figures_that_differ_from_the_asic_extract_or_changed_holdings_refuse_application(self):
        proposal = self.submit()
        for total, count, message in ((99, 1, "ASIC extract shows 99"), (100, 2, "held by 2 members")):
            with self.subTest(total=total, count=count), self.assertRaisesMessage(ValidationError, message):
                self.apply(proposal, total, count)
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(self.member.pk), "shares": "5"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        with self.assertRaisesMessage(ValidationError, "(import 100, stored 105)"):
            self.apply(proposal)
        self.assertFalse(RegisterMemberParticulars.objects.exists())
        rejected = decide_import(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation="",
            decision="reject",
            rejection_reason="Stale",
        )
        self.assertEqual((rejected.status, rejected.asic_issued_total), ("rejected", None))

    def test_the_register_reads_recorded_particulars_and_imported_dates_while_the_holding_is_unchanged(self):
        self.apply(self.submit())
        rows = self.export()
        member = dict(zip(REGISTER_HEADERS, rows[1]))
        self.assertEqual(
            [
                member[header]
                for header in ("Name", "Residential address", "Identity source", "Date entered", "Amount paid")
            ],
            ["Mia Member", RESIDENCE, PARTICULARS_LABEL, "2019-05-01", "250.00"],
        )
        heading = rows.index(FORMER_MEMBER_HEADERS)
        former = dict(zip(FORMER_MEMBER_HEADERS, rows[heading + 1]))
        self.assertEqual(
            [
                former[header]
                for header in ("Name", "Wallet address", "Shares held on ceasing", "Date ceased", "Identity source")
            ],
            ["Fred Former", "", "40", "2022-03-01", PARTICULARS_LABEL],
        )
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(self.member.pk), "shares": "5"}],
            effective_on=DAY,
            recorded_by=self.owner,
        )
        member = dict(zip(REGISTER_HEADERS, self.export()[1]))
        self.assertEqual(
            [member[header] for header in ("Name", "Shares held", "Date entered", "Amount paid")],
            ["Mia Member", "105", DAY.isoformat(), ""],
        )

    def test_the_database_refuses_forged_imports_rewrites_and_deletion(self):
        proposal = self.submit()
        with self.assertRaises(DatabaseError), atomic():
            RegisterImport.objects.filter(pk=proposal.pk).update(members=[])
        with self.assertRaises(DatabaseError), atomic():
            RegisterImport.objects.filter(pk=proposal.pk).update(
                status="applied",
                reviewed_by=self.reviewer,
                reviewed_at=timezone.now(),
                asic_issued_total=100,
                asic_member_count=1,
                register_sequence=1,
            )
        with self.assertRaises(DatabaseError), atomic():
            proposal.delete()
        forged = {
            field.name: getattr(proposal, field.name)
            for field in RegisterImport._meta.fields
            if field.name not in ("uuid", "created_at", "updated_at", "file")
        }
        for members in (
            [{**proposal.members[0], "member": None}],
            [{**proposal.members[0], "shares": "0"}],
            [{**proposal.members[0], "residential_address": ""}],
        ):
            forged_id = uuid4()
            with self.subTest(members=members), self.assertRaises(DatabaseError), atomic():
                RegisterImport.objects.create(
                    **{
                        **forged,
                        "uuid": forged_id,
                        "members": members,
                        "file": f"companies/{self.company.pk}/register-imports/{forged_id}/{uuid4()}.bin",
                    }
                )
        self.assertEqual(RegisterImport.objects.count(), 1)

    def test_particulars_and_imported_former_members_follow_the_seven_year_clock(self):
        self.apply(self.submit())
        ceased = timezone.make_aware(timezone.datetime(2022, 3, 1))
        self.assertEqual(purge_imported_former_members(now=ceased + timedelta(days=2557)), 0)
        self.assertEqual(purge_imported_former_members(now=ceased + timedelta(days=2559)), 1)
        later = timezone.now() + timedelta(days=4000)
        self.assertEqual(purge_member_particulars(now=later), 0)
        other = create_member(company_id=self.company.pk, member_id=uuid4())
        record_entry(
            register_id=self.opening.register_id,
            operation_id=uuid4(),
            kind=RegisterEntryKind.TRANSFER,
            changes=sorted(
                [{"member": str(self.member.pk), "shares": "-100"}, {"member": str(other.pk), "shares": "100"}],
                key=lambda change: change["member"],
            ),
            effective_on=DAY,
            recorded_by=self.owner,
        )
        left = timezone.make_aware(timezone.datetime.combine(DAY, timezone.datetime.min.time()))
        self.assertEqual(purge_member_particulars(now=left + timedelta(days=2557)), 0)
        self.assertEqual(purge_member_particulars(now=left + timedelta(days=2559)), 1)
        self.assertFalse(RegisterMemberParticulars.objects.exists())


class ScopedRegisterImportTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.owner, _, self.token, self.member, self.reviewer, register_document, asic, _ = import_fixture()
            self.stranger, _, _, _, _, _ = register_fixture()
        self.the_principal_the_middleware_would_set(self.owner)
        self.proposal = submit_import(
            actor=self.owner, **import_payload(self.token, register_document, asic, self.member)
        )

    def test_app_submits_and_reads_but_only_the_operator_reviews_applies_and_writes_particulars(self):
        self.assertEqual(list(RegisterImport.objects.values_list("pk", flat=True)), [self.proposal.pk])
        with self.assertRaises(PermissionDenied):
            prepare_import_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
        with self.assertRaises(DatabaseError), atomic():
            RegisterMemberParticulars.objects.create(
                member=self.member, name="Forged", residential_address="Nowhere", source_import=self.proposal
            )
        with use_operator():
            _, _, confirmation = prepare_import_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
            decide_import(
                proposal_id=self.proposal.pk,
                reviewer=self.reviewer,
                confirmation=confirmation,
                decision="apply",
                asic_issued_total=100,
                asic_member_count=1,
            )
        self.assertEqual((RegisterMemberParticulars.objects.count(), ImportedFormerMember.objects.count()), (1, 1))
        self.the_principal_the_middleware_would_set(self.stranger)
        self.assertEqual(
            (
                RegisterImport.objects.count(),
                RegisterMemberParticulars.objects.count(),
                ImportedFormerMember.objects.count(),
            ),
            (0, 0, 0),
        )
