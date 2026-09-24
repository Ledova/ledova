import hashlib
import importlib
import json
from datetime import timedelta
from io import StringIO
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, IntegrityError, connections
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from shared.db import atomic, current_alias
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.exceptions import PublicationIntegrityError
from shareholders.models import Publication, PublicationKind, PublicationRecipient
from shareholders.services.publications import (
    FUTURE_RECORD_DATE,
    NO_AUTHORITY,
    NO_INSTRUCTION,
    NO_MEMBERS,
    NO_TITLE,
    REGISTER_NOT_OPENED,
    UNKNOWN_KIND,
    publish_to_members,
    verify_roll,
)
from shareholders.services.roll import roll_digest
from shareholders.tests.fixtures import (
    DAY,
    INSTRUCTION,
    PUBLICATION_BYTES,
    TITLE,
    a_company_with_members,
    a_listed_wallet,
    a_member,
    a_person,
    a_treasury_address,
    an_upload,
    published,
    unused_address,
)
from tokens.constants import STATUTORY_CALENDAR
from tokens.models import RegisterEntryKind, ShareToken
from tokens.services.register_events import record_entry
from whitelist.models import HolderType


class PublishingToMembersTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("publish")

    def rows(self, publication):
        return sorted(
            PublicationRecipient.objects.filter(publication=publication).values_list(
                "member_id", "user_id", "name", "holder_type", "identity_source", "shares"
            )
        )

    def test_a_publication_records_its_instruction_authority_register_head_and_preparer(self):
        publication = published(self.world)

        self.assertEqual(
            (
                publication.company_id,
                publication.token_id,
                publication.kind,
                publication.title,
                publication.record_date,
                publication.instruction,
                publication.authority_document,
                publication.authority_fingerprint,
                publication.prepared_by_id,
            ),
            (
                self.world.company.pk,
                self.world.token.pk,
                PublicationKind.HOLDING_STATEMENT,
                TITLE,
                DAY,
                INSTRUCTION,
                self.world.authority.pk,
                self.world.authority.verified_fingerprint,
                self.world.staff.pk,
            ),
        )
        self.assertEqual(
            (publication.register_sequence, publication.register_head_hash),
            (self.world.register.sequence, self.world.register.head_hash),
        )

    def test_the_stored_bytes_are_private_and_the_digest_is_of_what_was_stored(self):
        publication = published(self.world)

        self.assertTrue(
            publication.file.name.startswith(f"companies/{self.world.company.pk}/publications/{publication.pk}/")
        )
        self.assertTrue(publication.file.name.endswith(".bin"))
        with publication.file.open("rb") as stored:
            self.assertEqual(stored.read(), PUBLICATION_BYTES)
        self.assertEqual(publication.digest, hashlib.sha256(PUBLICATION_BYTES).hexdigest())
        self.assertEqual(publication.mime_type, "application/pdf")
        with self.assertRaises(ValueError):
            publication.file.url

    def test_the_roll_is_one_frozen_row_for_each_member_holding_shares(self):
        publication = published(self.world)
        first, second = self.world.members

        self.assertEqual(publication.member_rows, 2)
        self.assertEqual(
            self.rows(publication),
            sorted(
                [
                    (
                        holder.member.pk,
                        holder.user.pk,
                        holder.user.userprofile.full_name,
                        HolderType.MEMBER.value,
                        "profile",
                        holder.shares,
                    )
                    for holder in (first, second)
                ]
            ),
        )
        self.assertEqual(publication.audience_digest, verify_roll(publication)["audience_digest"])

    def test_the_roll_follows_the_record_date_rather_than_the_latest_entry(self):
        later = a_person("publish-late", "Late Member")[1]
        newcomer = a_member(self.world.company, a_listed_wallet(later))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(newcomer.pk), "shares": "7"}],
            effective_on=DAY + timedelta(days=1),
            recorded_by=self.world.owner,
        )

        on_the_day = published(self.world, record_date=DAY)
        the_day_after = published(self.world, record_date=DAY + timedelta(days=1))

        self.assertEqual(on_the_day.member_rows, 2)
        self.assertEqual(the_day_after.member_rows, 3)
        self.assertNotIn(newcomer.pk, [row[0] for row in self.rows(on_the_day)])
        self.assertIn(newcomer.pk, [row[0] for row in self.rows(the_day_after)])

    def test_a_member_whose_wallets_name_two_people_stays_on_the_roll_with_no_account(self):
        one = a_person("publish-one", "Member One")[1]
        two = a_person("publish-two", "Member Two")[1]
        ambiguous = a_member(self.world.company, a_listed_wallet(one), a_listed_wallet(two))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(ambiguous.pk), "shares": "9"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )

        publication = published(self.world)
        row = PublicationRecipient.objects.get(publication=publication, member_id=ambiguous.pk)

        self.assertEqual(publication.member_rows, 3)
        self.assertEqual(
            (row.user_id, row.holder_type, row.identity_source), (None, HolderType.AMBIGUOUS, "unresolvable")
        )
        self.assertEqual(int(row.shares), 9)

    def test_two_accounts_holding_one_address_leave_the_member_unnamed(self):
        shared_address = unused_address()
        a_listed_wallet(a_person("publish-first", "First Claimant")[1], shared_address)
        a_listed_wallet(a_person("publish-second", "Second Claimant")[1], shared_address)
        contested = a_member(self.world.company, shared_address)
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(contested.pk), "shares": "3"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )

        publication = published(self.world)
        row = PublicationRecipient.objects.get(publication=publication, member_id=contested.pk)

        self.assertEqual((row.user_id, row.holder_type), (None, HolderType.AMBIGUOUS))

    def test_a_treasury_holder_stays_on_the_roll_with_no_account(self):
        treasury = a_member(self.world.company, a_treasury_address("Operator treasury"))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(treasury.pk), "shares": "11"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )

        publication = published(self.world)
        row = PublicationRecipient.objects.get(publication=publication, member_id=treasury.pk)

        self.assertEqual(
            (row.user_id, row.holder_type, row.name, row.identity_source),
            (None, HolderType.TREASURY, "Operator treasury", "treasury_label"),
        )

    def test_a_member_with_no_wallet_at_all_stays_on_the_roll_unidentified(self):
        unknown = a_member(self.world.company)
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(unknown.pk), "shares": "2"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )

        publication = published(self.world)
        row = PublicationRecipient.objects.get(publication=publication, member_id=unknown.pk)

        self.assertEqual((row.user_id, row.holder_type, row.name), (None, HolderType.UNIDENTIFIED, ""))

    def test_publishing_refuses_what_it_cannot_stand_behind(self):
        other = a_company_with_members("publish-other")
        draft = ShareToken.objects.create(
            company=self.world.company, name="Draft class", symbol="DRAFT", total_supply="10"
        )
        for refusal, changes, token in (
            (UNKNOWN_KIND, {"kind": "distribution"}, self.world.token),
            (NO_TITLE, {"title": "  "}, self.world.token),
            (NO_INSTRUCTION, {"instruction": "\t"}, self.world.token),
            (
                FUTURE_RECORD_DATE,
                {"record_date": timezone.localdate(timezone=STATUTORY_CALENDAR) + timedelta(days=1)},
                self.world.token,
            ),
            (NO_AUTHORITY, {"authority_document": uuid4()}, self.world.token),
            (NO_AUTHORITY, {"authority_document": other.authority.pk}, self.world.token),
            (REGISTER_NOT_OPENED, {}, draft),
            (NO_MEMBERS, {"record_date": DAY - timedelta(days=1)}, self.world.token),
        ):
            fields = {
                "kind": PublicationKind.HOLDING_STATEMENT,
                "title": TITLE,
                "record_date": DAY,
                "instruction": INSTRUCTION,
                "authority_document": self.world.authority.pk,
                "upload": an_upload(),
                **changes,
            }
            with self.subTest(refusal=refusal), self.assertRaisesMessage(ValidationError, refusal), atomic():
                publish_to_members(token, self.world.staff, **fields)
        self.assertFalse(Publication.objects.exists())

    def test_a_publication_and_its_roll_cannot_be_rewritten(self):
        publication = published(self.world)
        row = PublicationRecipient.objects.filter(publication=publication).first()

        with self.assertRaisesMessage(DatabaseError, "A publication is frozen once it is made"), atomic():
            Publication.objects.filter(pk=publication.pk).update(title="Rewritten")
        with self.assertRaisesMessage(DatabaseError, "A frozen roll row cannot be changed"), atomic():
            PublicationRecipient.objects.filter(pk=row.pk).update(shares=1)

        self.assertEqual(Publication.objects.get(pk=publication.pk).title, TITLE)
        self.assertEqual(int(PublicationRecipient.objects.get(pk=row.pk).shares), int(row.shares))

    def test_downgrade_refuses_to_discard_publications(self):
        migration = importlib.import_module("shareholders.migrations.0001_publications")
        with atomic(), connections[current_alias()].schema_editor() as editor:
            migration.remove_guards(None, editor)
        publication = published(self.world)

        with self.assertRaisesRegex(RuntimeError, "Retain publications"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)

        self.assertTrue(Publication.objects.filter(pk=publication.pk).exists())

    def test_the_roll_digest_reports_a_roll_that_no_longer_matches_what_was_published(self):
        publication = published(self.world)
        self.assertEqual(verify_roll(publication)["member_rows"], 2)

        PublicationRecipient.objects.filter(publication=publication).first().delete()

        with self.assertRaises(PublicationIntegrityError):
            verify_roll(publication)

    def test_the_digest_covers_the_resolved_account_so_a_changed_identity_changes_it(self):
        rows = [
            {
                "member_id": uuid4(),
                "user_id": None,
                "name": "Unnamed",
                "holder_type": HolderType.AMBIGUOUS.value,
                "identity_source": "unresolvable",
                "shares": 5,
            }
        ]
        named = [{**rows[0], "user_id": 7, "holder_type": HolderType.MEMBER.value, "identity_source": "profile"}]

        self.assertNotEqual(roll_digest(rows), roll_digest(named))

    def insert(self, **columns):
        publication = published(self.world)
        fresh = uuid4()
        row = {
            "uuid": fresh,
            "created_at": timezone.now(),
            "updated_at": timezone.now(),
            "company_id": publication.company_id,
            "company_name": publication.company_name,
            "token_id": publication.token_id,
            "token_name": publication.token_name,
            "token_symbol": publication.token_symbol,
            "kind": publication.kind,
            "title": publication.title,
            "record_date": publication.record_date,
            "instruction": publication.instruction,
            "authority_document": publication.authority_document,
            "authority_fingerprint": publication.authority_fingerprint,
            "mime_type": publication.mime_type,
            "digest": publication.digest,
            "register_sequence": publication.register_sequence,
            "register_head_hash": publication.register_head_hash,
            "member_rows": publication.member_rows,
            "audience_digest": publication.audience_digest,
            "prepared_by_id": publication.prepared_by_id,
            "question": publication.question,
            "resolution_kind": publication.resolution_kind,
            "vote_basis": publication.vote_basis,
            **columns,
        }
        row.setdefault("file", f"companies/{row['company_id']}/publications/{row['uuid']}/{uuid4()}.bin")
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                f"INSERT INTO shareholders_publication ({', '.join(row)}) " f"VALUES ({', '.join(['%s'] * len(row))})",
                list(row.values()),
            )

    def test_a_row_the_guard_admits_is_inserted_so_the_refusals_below_discriminate(self):
        self.insert()

        self.assertEqual(Publication.objects.count(), 2)

    def test_the_database_refuses_a_publication_whose_class_register_or_authority_does_not_hold(self):
        draft = ShareToken.objects.create(
            company=self.world.company, name="Undeployed class", symbol="UND", total_supply="10"
        )
        stranger = a_company_with_members("publish-stranger")
        for columns in (
            {"token_id": draft.pk},
            {"token_id": stranger.token.pk},
            {"company_id": stranger.company.pk},
            {"register_sequence": 99},
            {"register_head_hash": "b" * 64},
            {"authority_document": stranger.authority.pk},
            {"authority_fingerprint": "c" * 64},
            {"file": "companies/elsewhere/publications/x/y.bin"},
        ):
            with (
                self.subTest(columns=columns),
                self.assertRaisesMessage(IntegrityError, "A publication requires a deployed share class"),
                atomic(),
            ):
                self.insert(**columns)

    def test_the_database_refuses_a_roll_row_that_does_not_belong_to_its_publication(self):
        publication = published(self.world)
        stranger = a_company_with_members("roll-stranger")

        with (
            self.assertRaisesMessage(IntegrityError, "A roll row belongs to its publication"),
            atomic(),
        ):
            PublicationRecipient.objects.create(
                publication=publication,
                company=stranger.company,
                member_id=uuid4(),
                user_id=None,
                name="Elsewhere",
                holder_type=HolderType.MEMBER,
                identity_source="profile",
                shares=1,
            )


class PublicationVerifyCommandTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("verify-command")

    def verify(self, **options):
        output = StringIO()
        call_command("publications", "verify", stdout=output, **options)
        return json.loads(output.getvalue())

    def test_the_command_reports_the_roll_it_recomputed(self):
        publication = published(self.world)

        self.assertEqual(self.verify(publication=publication.pk)[str(publication.pk)], verify_roll(publication))

    def test_the_command_names_a_publication_whose_roll_a_schema_owner_changed(self):
        publication = published(self.world)

        with self.assertRaises(CommandError) as refusal, atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                cursor.execute("ALTER TABLE shareholders_publicationrecipient DISABLE TRIGGER USER")
                cursor.execute(
                    "UPDATE shareholders_publicationrecipient SET shares = 1 WHERE publication_id = %s",
                    [publication.pk],
                )
            self.verify()

        self.assertIn(str(publication.pk), str(refusal.exception))
        self.assertEqual(self.verify(publication=publication.pk)[str(publication.pk)], verify_roll(publication))

    def test_the_command_refuses_a_publication_that_does_not_exist(self):
        with self.assertRaises(CommandError):
            self.verify(publication=uuid4())
