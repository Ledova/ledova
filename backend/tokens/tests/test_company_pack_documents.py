import json
from unittest.mock import patch
from uuid import uuid4

from django.core.files.base import ContentFile
from django.test import TestCase, override_settings

from companies.models import CompanyDocument, DocumentType
from companies.services.document_review import prepare_document_review, verify_document
from documents.models import Document
from shared.storage import PrivateMediaStorage, private_storage
from tokens.models import (
    RegisterCorrection,
    RegisterExport,
    RegisterImport,
    RegisterInstruction,
    RegisterOpening,
    RegisterWalletLink,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register_imports import submit_import
from tokens.services.register_openings import submit_opening
from tokens.tests.test_company_pack import (
    ADMIN_STORAGES,
    ISOLATED,
    ProducesPacks,
    authority_terms,
    consume,
    evidence_of,
    files_of,
    investor_records,
    pack_company,
    pack_staff,
    remanifested,
    sha256,
    zipped,
)
from tokens.tests.test_register_events import DAY
from users.models import InvestorClassification

EVIDENCE_MODELS = (RegisterOpening, RegisterImport, RegisterCorrection, RegisterInstruction, RegisterWalletLink)
CEILING = "tokens.services.company_pack_documents.COMPANY_PACK_MAX_STORED_BYTES"
MEMBERS_EVIDENCE = (
    "Verification evidence Ledova holds for members is not in this pack: identity checks, investor classification "
    "claims and their evidence, and payslips. Each person gave it to Ledova to be verified, and it is not a record "
    "of the company. It runs on its own retention clock, and a verification does not carry over to another company "
    "or provider, which verifies members itself."
)


def read(name):
    with private_storage().open(name) as source:
        return source.read()


def rewrite(name, content):
    private_storage().delete(name)
    private_storage().save(name, ContentFile(content))


def evidence_records(company):
    return [record for model in EVIDENCE_MODELS for record in model.objects.filter(company=company)]


def stored_files(company):
    files = {
        f"documents/{document.pk}.pdf": read(document.file.name)
        for document in CompanyDocument.objects.filter(company=company)
        if document.file
    }
    for record in evidence_records(company):
        files[f"documents/evidence/{record.pk}.pdf"] = read(record.file.name)
    return files


def stored_names(company):
    return sorted(
        [document.file.name for document in CompanyDocument.objects.filter(company=company) if document.file]
        + [record.file.name for record in evidence_records(company)]
    )


def verified(fixture, document_type, content):
    document = CompanyDocument.objects.create(
        company=fixture.company,
        document_type=document_type,
        name=content.decode(),
        file_size=len(content),
        mime_type="application/pdf",
    )
    document.file.save(f"{document.uuid}.pdf", ContentFile(content), save=True)
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=fixture.reviewer)
    return verify_document(document_id=document.pk, reviewer=fixture.reviewer, confirmation=confirmation)


def with_opening_and_import(fixture):
    label, company = fixture.label, fixture.company
    unopened = ShareToken.objects.create(
        company=company,
        name=f"Synthetic {label} evidence shares",
        symbol="EVD",
        total_supply="1000",
        status=ShareTokenStatus.DEPLOYED,
        contract_address="0x" + sha256(f"{label} evidence shares".encode())[:40],
    )
    opening = submit_opening(
        actor=company.owner,
        operation_id=uuid4(),
        token_id=unopened.pk,
        document_id=fixture.document.pk,
        mapping=[],
        authority="director_resolution",
        **authority_terms(label, "opening"),
    )
    holder = fixture.members["holder"]
    imported = submit_import(
        actor=company.owner,
        operation_id=uuid4(),
        token_id=fixture.preference.pk,
        document_id=verified(fixture, DocumentType.SHARE_REGISTER, f"Synthetic {label} share register".encode()).pk,
        asic_document_id=verified(fixture, DocumentType.ASIC_EXTRACT, f"Synthetic {label} ASIC extract".encode()).pk,
        as_at=DAY.isoformat(),
        members=[
            {
                "member": str(holder.pk),
                "name": f"Synthetic {label} holder",
                "residential_address": f"2 Synthetic {label} Street, Sydney NSW 2000",
                "shares": "10",
                "entered_on": DAY.isoformat(),
                "amount_paid": None,
            }
        ],
        former_members=[],
        authority="director_resolution",
        **authority_terms(label, "import"),
    )
    return unopened, opening, imported


def outside_the_company(fixture):
    investor_records(fixture)
    claim = InvestorClassification.objects.get(declared_basis=f"Synthetic {fixture.label} allottee basis")
    attached = Document.objects.create(
        uploaded_by=claim.user_account.user_profile.user,
        classification=claim,
        document_type="payslip",
        original_filename=f"Synthetic {fixture.label} attached payslip.pdf",
        mime_type="application/pdf",
    )
    attached.file.save("attached.pdf", ContentFile(f"attached payslip of {fixture.label}".encode()), save=True)
    names = [claim.evidence_file.name for claim in InvestorClassification.objects.exclude(evidence_file="")]
    names += [document.file.name for document in Document.objects.exclude(file="")]
    return {name: read(name) for name in names}


def carried(content, stored):
    blobs = [content, *files_of(content).values()]
    return sorted(name for name, raw in stored.items() if any(raw in blob for blob in blobs))


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackDocumentsTest(ProducesPacks, TestCase):
    def setUp(self):
        self.a = pack_company("pack-a")
        self.unopened, self.opening, self.imported = with_opening_and_import(self.a)
        self.client.force_login(pack_staff("pack-documents-staff"))

    def refused(self, message):
        response = self.produce()

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/html; charset=utf-8"))
        self.assertContains(response, f"{message} Nothing was recorded.")
        self.assertFalse(RegisterExport.objects.exists())

    def test_every_document_and_evidence_copy_is_carried_with_the_bytes_storage_holds(self):
        content = self.pack()

        files = files_of(content)
        stored = stored_files(self.a.company)
        self.assertEqual(len(stored), 9)
        self.assertEqual(sorted(path for path in files if path.startswith("documents/")), sorted(stored))
        self.assertEqual({path: files[path] for path in stored}, stored)
        listed = {row["path"]: row for row in json.loads(files["manifest.json"])["files"]}
        for path, raw in stored.items():
            with self.subTest(path=path):
                self.assertEqual((listed[path]["size"], listed[path]["sha256"]), (len(raw), sha256(raw)))
        result = consume(content, *ISOLATED)
        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertIn(
            "documents: 4 carried, 1 listed only, 5 evidence copies match their records", result.stdout.splitlines()
        )

    def test_each_authority_record_names_the_copy_it_relied_on_by_path_and_digest(self):
        files = files_of(self.pack())

        authority = {
            token.pk: json.loads(files[f"classes/{token.pk}/authority.json"])
            for token in (self.a.ordinary, self.a.preference)
        }
        authority[self.unopened.pk] = json.loads(files[f"classes/{self.unopened.pk}/authority.json"])
        records = {
            "opening": authority[self.unopened.pk]["openings"],
            "import": authority[self.a.preference.pk]["imports"],
            "correction": authority[self.a.ordinary.pk]["corrections"],
            "instruction": authority[self.a.ordinary.pk]["instructions"],
            "link": json.loads(files["wallet_links.json"]),
        }
        expected = {
            "opening": self.opening,
            "import": self.imported,
            "correction": self.a.correction,
            "instruction": self.a.allotment.instruction,
            "link": self.a.link,
        }
        for kind, record in expected.items():
            with self.subTest(kind=kind):
                [listed] = records[kind]
                path = f"documents/evidence/{record.pk}.pdf"
                self.assertEqual(
                    (listed["uuid"], listed["evidence"]["path"], listed["evidence"]["sha256"]),
                    (str(record.pk), path, sha256(files[path])),
                )
                self.assertEqual(files[path], read(record.file.name))
                source = CompanyDocument.objects.get(pk=record.source_document)
                self.assertEqual(files[path], read(source.file.name))
        self.assertEqual(files[f"documents/evidence/{self.a.correction.pk}.pdf"], evidence_of("pack-a"))

    def test_the_documents_file_and_readme_list_every_document_and_leave_members_evidence_out(self):
        files = files_of(self.pack())

        rows = json.loads(files["documents.json"])
        documents = list(CompanyDocument.objects.filter(company=self.a.company).order_by("created_at", "uuid"))
        self.assertEqual(
            rows,
            [
                {
                    "uuid": str(document.pk),
                    "type": document.document_type,
                    "name": document.name,
                    "mime_type": "application/pdf",
                    "valid_from": None,
                    "valid_until": None,
                    "verified": document.is_verified,
                    "verified_at": None if document.verified_at is None else document.verified_at.isoformat(),
                    "uploaded_at": document.created_at.isoformat(),
                    "external_url": document.external_url,
                    "path": f"documents/{document.pk}.pdf" if document.file else None,
                }
                for document in documents
            ],
        )
        asic, resolution, constitution = (
            CompanyDocument.objects.get(company=self.a.company, name=name)
            for name in ("pack-a ASIC extract", "Synthetic pack-a board resolution", "Synthetic pack-a constitution")
        )
        self.assertEqual(
            [(asic.external_url, bool(asic.file)), (constitution.external_url, bool(constitution.file))],
            [("https://docs.example.test/pack-a", True), ("https://docs.example.test/pack-a/constitution", False)],
        )
        readme = files["README.md"].decode()
        for line in (
            f"| `documents/{asic.pk}.pdf` | asic | pack-a ASIC extract | no |",
            f"| `documents/{resolution.pk}.pdf` | other | Synthetic pack-a board resolution | yes |",
            "| not carried: https://docs.example.test/pack-a/constitution | constitution | Synthetic pack-a "
            "constitution | no |",
            "This pack carries 5 evidence copies.",
            MEMBERS_EVIDENCE,
        ):
            with self.subTest(line=line):
                self.assertIn(line, readme)

    def test_a_stored_evidence_copy_that_no_longer_matches_its_digest_refuses_the_pack(self):
        name = self.a.correction.file.name
        original = read(name)
        tampered = bytearray(original)
        tampered[3] ^= 1
        rewrite(name, bytes(tampered))

        self.refused(
            f"The copy Ledova kept of the evidence of register correction {self.a.correction.pk} no longer matches "
            "the SHA-256 recorded when it was submitted, so no pack was produced. Restore the copy that was "
            "submitted before producing a pack."
        )

        rewrite(name, original)
        self.assertEqual(self.produce().status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 3)

    def test_a_file_missing_from_storage_refuses_the_pack(self):
        for label, name, of in (
            ("company document", self.a.document.file.name, f"company document {self.a.document.pk}"),
            ("evidence copy", self.a.link.file.name, f"the evidence of register wallet link {self.a.link.pk}"),
        ):
            with self.subTest(missing=label):
                original = read(name)
                private_storage().delete(name)

                self.refused(
                    f"The stored file of {of} is missing, so no pack was produced. Restore it to private storage, "
                    "then produce the pack again."
                )

                rewrite(name, original)
        self.assertEqual(self.produce().status_code, 200)
        self.assertEqual(RegisterExport.objects.count(), 3)

    def test_the_ceiling_counts_recorded_sizes_and_stored_copies_and_refuses_only_above_it(self):
        documents = [document for document in CompanyDocument.objects.filter(company=self.a.company) if document.file]
        copies = evidence_records(self.a.company)
        total = sum(document.file_size for document in documents)
        total += sum(private_storage().size(record.file.name) for record in copies)
        self.assertNotEqual(sum(document.file.size for document in documents), sum(d.file_size for d in documents))
        self.assertEqual((len(documents), len(copies)), (4, 5))

        with patch(CEILING, total - 1):
            self.refused(
                f"The files this pack would carry come to {total:,} bytes, over the ceiling of {total - 1:,} bytes "
                "for a pack produced while you wait, so no pack was produced. Ask engineering to build background "
                "production, which is built the first time a pack exceeds the ceiling."
            )
        for ceiling, records in ((total, 3), (total + 1, 6)):
            with self.subTest(ceiling=ceiling), patch(CEILING, ceiling):
                self.pack()

                self.assertEqual(RegisterExport.objects.count(), records)

    def test_the_consumer_names_a_tampered_missing_or_unnamed_document(self):
        files = files_of(self.pack())
        document = f"documents/{self.a.document.pk}.pdf"
        copy = f"documents/evidence/{self.a.correction.pk}.pdf"
        authority = f"classes/{self.a.ordinary.pk}/authority.json"

        def flipped(path):
            content = bytearray(files[path])
            content[3] ^= 1
            return bytes(content)

        def without(path):
            return remanifested({name: content for name, content in files.items() if name != path})

        for tampering, tampered, refusal in (
            (
                "a byte flipped in a document",
                {**files, document: flipped(document)},
                f"{document}: SHA-256 does not match the manifest",
            ),
            (
                "a byte flipped in an evidence copy, with the manifest rewritten to match",
                remanifested({**files, copy: flipped(copy)}),
                f"{copy}: its size and SHA-256 are not the evidence {authority} corrections 1 records",
            ),
            ("a document removed with its listing", without(document), f"{document}: not in the manifest"),
            ("an evidence copy removed with its listing", without(copy), f"{copy}: not in the manifest"),
            (
                "a listed file no record names",
                remanifested({**files, "documents/extra.pdf": b"extra"}),
                "documents/extra.pdf: named by no document or authority record",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(zipped(tampered), *ISOLATED)

                self.assertEqual((result.returncode, result.stdout), (1, ""))
                self.assertEqual(result.stderr, f"REFUSED {refusal}\n")
        untouched = consume(zipped(files), *ISOLATED)
        self.assertEqual((untouched.returncode, untouched.stderr), (0, ""))

    def test_no_member_evidence_or_payslip_leaves_and_every_file_read_is_the_companys_own(self):
        outside = outside_the_company(self.a)
        self.assertEqual(
            sorted({name.split("/")[0] for name in outside}) + [len(outside)],
            ["documents", "users", 5],
        )
        self.assertTrue(any(name.startswith("users/supporting-documents/") for name in outside))
        read_names = []

        def reading(method):
            def spy(storage, name, *arguments):
                read_names.append(name)
                return method(storage, name, *arguments)

            return spy

        with (
            patch.object(PrivateMediaStorage, "open", reading(PrivateMediaStorage.open)),
            patch.object(PrivateMediaStorage, "size", reading(PrivateMediaStorage.size)),
        ):
            content = self.pack()

        self.assertEqual(sorted(set(read_names)), stored_names(self.a.company))
        self.assertEqual(len(set(read_names)), 9)
        self.assertEqual([name for name in read_names if not name.startswith(f"companies/{self.a.company.pk}/")], [])
        self.assertEqual(carried(content, outside), [])
        claim = InvestorClassification.objects.get(declared_basis="Synthetic pack-a allottee basis")
        planted = CompanyDocument.objects.create(
            company=self.a.company,
            document_type=DocumentType.OTHER,
            name="Synthetic planted copy",
            file_size=len(outside[claim.evidence_file.name]),
            mime_type="application/pdf",
        )
        planted.file.save("planted.pdf", ContentFile(outside[claim.evidence_file.name]), save=True)

        self.assertEqual(carried(self.pack(), outside), [claim.evidence_file.name])

        planted.delete()
        self.assertEqual(carried(self.pack(), outside), [])

    def test_another_companys_pack_carries_none_of_this_companys_documents(self):
        b = pack_company("pack-b")
        packs = {self.a.label: files_of(self.pack()), b.label: files_of(self.pack(b.company))}

        for ours, theirs in ((self.a, b), (b, self.a)):
            with self.subTest(company=ours.label):
                stored = stored_files(ours.company)
                ids = [str(document.pk) for document in CompanyDocument.objects.filter(company=ours.company)]
                own, other = packs[ours.label], packs[theirs.label]

                self.assertEqual({path: own[path] for path in stored}, stored)
                self.assertEqual([uuid for uuid in ids if uuid not in own["documents.json"].decode()], [])
                self.assertEqual([path for path in stored if path in other], [])
                self.assertEqual([uuid for uuid in ids if uuid in other["documents.json"].decode()], [])
                self.assertEqual(
                    [path for path, raw in stored.items() if any(raw in content for content in other.values())], []
                )
