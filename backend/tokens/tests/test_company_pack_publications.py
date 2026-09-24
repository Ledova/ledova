import json
import re
from datetime import timezone as utc_zone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.base import ContentFile
from django.db.models.expressions import RawSQL
from django.test import TestCase, override_settings
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from shared.db import use_operator
from shared.storage import private_storage
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from shareholders.constants import READ_AS_COMPANY, READ_AS_MEMBER, READ_AS_STAFF
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationRead,
    PublicationRecipient,
)
from shareholders.services.distributions import withdraw_payment
from shareholders.services.publications import record_publication_read
from shareholders.services.resolutions import (
    cast_ballot,
    close_resolution,
    enter_ballot,
)
from shareholders.tests.fixtures import (
    DAY,
    PASSWORD,
    QUESTION,
    a_distribution,
    a_listed_wallet,
    a_member,
    a_payment,
    a_resolution,
    a_share_class,
    an_upload,
    as_the_schema_owner,
    published,
    roll_row,
    the_chain_is_rewritten,
    voting_has_closed,
)
from tokens.models import RegisterExport
from tokens.services.register_events import open_register
from tokens.tests.test_company_pack import (
    ADMIN_STORAGES,
    INSTRUCTION,
    ISOLATED,
    RECIPIENT,
    ProducesPacks,
    consume,
    files_of,
    pack_staff,
    page,
    remanifested,
    sha256,
    zipped,
)
from users.models import UserAccount, UserProfile

User = get_user_model()

RATE = "0.00755"
CEILING = "tokens.services.company_pack_documents.COMPANY_PACK_MAX_STORED_BYTES"
PREIMAGE = RawSQL("shareholders_publication_event_preimage(shareholders_publicationevent)", [])
RECOMPUTED = RawSQL("shareholders_publication_event_hash(shareholders_publicationevent)", [])
REVIEW_PERMISSIONS = ("change_companydocument", "change_registerinstruction", "view_registerinstruction")
LINKED = ("sequence", "kind", "previous_hash", "entry_hash", "withheld")


def stamp(moment):
    return moment.astimezone(utc_zone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def numbered(number, label, role, **flags):
    user = User.objects.create_user(email=f"{label}-{number}@example.test", password=PASSWORD, id=number, **flags)
    profile = UserProfile.objects.create(
        user=user, full_name=f"Synthetic {label} {role}", residential_address=f"1 Synthetic {role} Street, Sydney"
    )
    return user, UserAccount.objects.create(user_profile=profile)


def an_authority(company, staff, width):
    content = pdf_bytes(width=width)
    document = CompanyDocument.objects.create(
        company=company,
        document_type="other",
        name="Synthetic board resolution",
        file_size=len(content),
        mime_type="application/pdf",
    )
    document.file.save(f"{document.uuid}.pdf", ContentFile(content), save=True)
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=staff)
    return verify_document(document_id=document.pk, reviewer=staff, confirmation=confirmation)


def publishing_company(label, base, width):
    owner, _ = numbered(base, label, "owner")
    staff, _ = numbered(base + 1, label, "staff", is_active=True, is_staff=True)
    staff.user_permissions.add(*Permission.objects.filter(codename__in=REVIEW_PERMISSIONS))
    reader, _ = numbered(base + 2, label, "reader", is_active=True, is_staff=True)
    company, token = a_share_class(label, owner)
    authority = an_authority(company, User.objects.get(pk=staff.pk), width)
    members = []
    for index, shares in enumerate((100, 40, 1), 1):
        user, account = numbered(base + 10 + index, label, f"member {index}")
        members.append(SimpleNamespace(member=a_member(company, a_listed_wallet(account)), user=user, shares=shares))
    register = open_register(
        token_id=token.pk,
        operation_id=uuid4(),
        changes=[{"member": str(holder.member.pk), "shares": str(holder.shares)} for holder in members],
        effective_on=DAY,
        recorded_by=staff,
    ).register
    return SimpleNamespace(
        label=label,
        owner=owner,
        staff=staff,
        reader=reader,
        company=company,
        token=token,
        authority=authority,
        register=register,
        members=members,
        width=width,
    )


def upload(world, name, offset):
    return an_upload(name, pdf_bytes(width=world.width + offset))


def participation(world):
    first, second, third = world.members
    statement = published(world, upload=upload(world, "statement.pdf", 1))
    resolution = a_resolution(world, upload=upload(world, "resolution.pdf", 2))
    cast_ballot(first.user, resolution.pk, BallotChoice.FOR)
    cast_ballot(second.user, resolution.pk, BallotChoice.AGAINST)
    enter_ballot(world.staff, resolution, roll_row(resolution, third), BallotChoice.ABSTAIN, "Synthetic proxy PF-1")
    for holder in (first, first, second):
        record_publication_read(holder.user, resolution, roll_row(resolution, holder), READ_AS_MEMBER)
    record_publication_read(world.owner, resolution, None, READ_AS_COMPANY)
    resolution = voting_has_closed(resolution)
    close_resolution(resolution)
    distribution = a_distribution(world, rate=RATE, upload=upload(world, "dividend.pdf", 3))
    paid = a_payment(world, distribution, first, evidence=upload(world, "remittance.pdf", 4))
    a_payment(
        world,
        distribution,
        second,
        reference="LDV-4413",
        authority="Payment advice PA-2",
        evidence=upload(world, "remittance.pdf", 5),
    )
    withdraw_payment(
        world.staff, distribution, roll_row(distribution, second), "Synthetic advice PA-2 named the wrong account"
    )
    a_payment(
        world,
        distribution,
        second,
        reference="LDV-4414",
        authority="Payment advice PA-3",
        evidence=upload(world, "remittance.pdf", 6),
    )
    record_publication_read(first.user, distribution, roll_row(distribution, first), READ_AS_MEMBER)
    record_publication_read(world.reader, distribution, roll_row(distribution, first), READ_AS_STAFF, paid)
    return SimpleNamespace(statement=statement, resolution=resolution, distribution=distribution)


def events_of(publication):
    return list(
        PublicationEvent.objects.filter(publication=publication)
        .annotate(preimage=PREIMAGE, recomputed=RECOMPUTED)
        .order_by("sequence")
    )


def folder(publication):
    return f"publications/{publication.pk}"


def read(name):
    with private_storage().open(name) as source:
        return source.read()


def rewrite(name, content):
    private_storage().delete(name)
    private_storage().save(name, ContentFile(content))


def expected_event(event):
    linked = {
        "sequence": event.sequence,
        "kind": event.kind,
        "previous_hash": event.previous_hash,
        "entry_hash": event.entry_hash,
    }
    if event.kind == PublicationEventKind.BALLOT:
        return {**linked, "withheld": True}
    return {
        **linked,
        "withheld": False,
        "uuid": str(event.pk),
        "recipient": None if event.recipient_id is None else str(event.recipient_id),
        "staff_entered": event.staff_entered,
        "authority": event.authority,
        "payload": event.payload,
        "paid_on": None if event.paid_on is None else event.paid_on.isoformat(),
        "reference": event.reference,
        "evidence": (
            {
                "path": f"publications/{event.publication_id}/payments/{event.pk}.pdf",
                "sha256": event.evidence_digest,
                "mime_type": "application/pdf",
            }
            if event.evidence
            else None
        ),
        "created_at": stamp(event.created_at),
        "preimage": event.preimage,
    }


def expected_roll(publication):
    return [
        {
            "uuid": str(row.pk),
            "member": str(row.member_id),
            "name": row.name,
            "holder_type": "member",
            "identity_source": row.identity_source,
            "shares": str(int(row.shares)),
            "entitlement": None if row.entitlement is None else str(row.entitlement),
        }
        for row in PublicationRecipient.objects.filter(publication=publication).order_by("-shares", "member_id")
    ]


def expected_publication(publication, reads, **terms):
    publication = Publication.objects.get(pk=publication.pk)
    return {
        "uuid": str(publication.pk),
        "kind": publication.kind,
        "title": publication.title,
        "company_name": publication.company_name,
        "class": str(publication.token_id),
        "class_name": publication.token_name,
        "class_symbol": publication.token_symbol,
        "record_date": DAY.isoformat(),
        "published_at": publication.created_at.isoformat(),
        "instruction": "SYNTHETIC-PUBLICATION-INSTRUCTION-1",
        "authority_document": str(publication.authority_document),
        "register": {"sequence": publication.register_sequence, "head_hash": publication.register_head_hash},
        "member_rows": 3,
        "audience_digest": publication.audience_digest,
        "document": {
            "path": f"{folder(publication)}/document.pdf",
            "mime_type": "application/pdf",
            "sha256": sha256(read(publication.file.name)),
        },
        "resolution": None,
        "distribution": None,
        **terms,
        "reads": reads,
    }


def reads(member=0, company=0, staff=0, opened=0, evidence=0):
    return {
        "document": {"member": member, "company": company, "staff": staff},
        "members_who_opened": opened,
        "remittance_evidence": evidence,
    }


def ballots_of(company):
    ballots = []
    for ballot in (
        PublicationEvent.objects.filter(company=company, kind=PublicationEventKind.BALLOT)
        .select_related("recipient")
        .annotate(preimage=PREIMAGE)
        .order_by("sequence")
    ):
        roll = {str(ballot.recipient_id), str(ballot.recipient.member_id), ballot.recipient.name}
        ballots.append(
            SimpleNamespace(
                uuid=str(ballot.pk),
                entry_hash=ballot.entry_hash,
                choice=ballot.choice,
                preimage=ballot.preimage,
                cast_at=stamp(ballot.created_at),
                roll=roll,
                who=roll | {str(ballot.actor_id)},
            )
        )
    return ballots


def containers(value):
    if isinstance(value, (dict, list)):
        yield value
        for item in value.values() if isinstance(value, dict) else value:
            yield from containers(item)


def leaves(value):
    if isinstance(value, (dict, list)):
        for item in value.values() if isinstance(value, dict) else value:
            yield from leaves(item)
    else:
        yield str(value)


def disclosed(files, ballots):
    found = set()
    for path, content in files.items():
        records = list(containers(json.loads(content))) if path.endswith(".json") else []
        text = "\n".join([content.decode("latin-1"), *(leaf for record in records[:1] for leaf in leaves(record))])
        for ballot in ballots:
            if ballot.preimage in text or ballot.uuid in text or ballot.cast_at in text:
                found.add((ballot.uuid, path))
            for record in records:
                values = set(leaves(record))
                if ballot.choice in values and values & ballot.who:
                    found.add((ballot.uuid, path))
    return sorted(found)


def numbers_in(files, numbers):
    pattern = re.compile(rf"(?<![0-9a-f])({'|'.join(str(number) for number in numbers)})(?![0-9a-f])")
    return sorted({int(found) for content in files.values() for found in pattern.findall(content.decode("latin-1"))})


def rewritten(files, path, change):
    records = json.loads(files[path])
    change(records)
    return remanifested({**files, path: json.dumps(records).encode()})


def rehashed(event, position, value):
    fields = json.loads(event["preimage"])
    fields[position] = value
    event["preimage"] = json.dumps(fields)
    event["entry_hash"] = sha256(event["preimage"].encode())


def publication_records(world):
    publications = Publication.objects.filter(company=world.company)
    events = PublicationEvent.objects.filter(company=world.company)
    return [
        str(value).lower()
        for value in (
            *publications.values_list("uuid", flat=True),
            *publications.values_list("digest", flat=True),
            *PublicationRecipient.objects.filter(company=world.company).values_list("uuid", flat=True),
            *(holder.user.userprofile.full_name for holder in world.members),
            *events.exclude(kind=PublicationEventKind.BALLOT).values_list("uuid", flat=True),
            *events.values_list("entry_hash", flat=True),
            *events.exclude(evidence_digest="").values_list("evidence_digest", flat=True),
        )
    ]


def stored_bytes(world):
    names = [publication.file.name for publication in Publication.objects.filter(company=world.company)]
    names += [
        event.evidence.name for event in PublicationEvent.objects.filter(company=world.company).exclude(evidence="")
    ]
    return [read(name) for name in names]


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyPackPublicationsTest(ProducesPacks, StubUploadDependencies, TestCase):
    def setUp(self):
        self.a = publishing_company("pub-a", 861_000_100, 600)
        self.scene = participation(self.a)
        self.client.force_login(pack_staff("pack-publications-staff"))

    def refused(self, message):
        response = self.produce()

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/html; charset=utf-8"))
        self.assertContains(response, f"{message} Nothing was recorded.")
        self.assertFalse(RegisterExport.objects.exists())

    def test_a_resolution_is_carried_with_its_roll_its_close_in_full_and_its_ballots_withheld(self):
        files = files_of(self.pack())

        resolution = self.scene.resolution
        path = folder(resolution)
        self.assertEqual(
            json.loads(files[f"{path}/publication.json"]),
            expected_publication(
                resolution,
                reads(member=3, company=1, opened=2),
                resolution={
                    "question": QUESTION,
                    "resolution_kind": "ordinary",
                    "vote_basis": "per_share",
                    "opens_at": resolution.opens_at.isoformat(),
                    "closes_at": resolution.closes_at.isoformat(),
                },
            ),
        )
        self.assertEqual(json.loads(files[f"{path}/roll.json"]), expected_roll(resolution))
        events = events_of(resolution)
        carried = json.loads(files[f"{path}/events.json"])
        self.assertEqual(carried, [expected_event(event) for event in events])
        self.assertEqual([event["kind"] for event in carried], ["ballot", "ballot", "ballot", "close"])
        self.assertEqual([sorted(event) for event in carried[:3]], [sorted(LINKED)] * 3)
        self.assertEqual(
            carried[3]["payload"],
            {
                "basis": "per_share",
                "resolution_kind": "ordinary",
                "for": {"shares": "100", "members": 1},
                "against": {"shares": "40", "members": 1},
                "abstain": {"shares": "1", "members": 1},
                "eligible": {"shares": "141", "members": 3},
                "carried": True,
            },
        )
        self.assertEqual(sha256(carried[3]["preimage"].encode()), carried[3]["entry_hash"])
        self.assertEqual(files[f"{path}/document.pdf"], read(resolution.file.name))
        self.assertIn(
            {"publication": str(resolution.pk), "kind": "resolution", "events": 4, "head_hash": events[3].entry_hash},
            json.loads(files["manifest.json"])["publications"],
        )

    def test_a_dividend_is_carried_with_every_payment_record_its_withdrawal_and_their_remittance_evidence(self):
        files = files_of(self.pack())

        distribution = Publication.objects.get(pk=self.scene.distribution.pk)
        path = folder(distribution)
        self.assertEqual(
            json.loads(files[f"{path}/publication.json"]),
            expected_publication(
                distribution,
                reads(member=1, opened=1, evidence=1),
                distribution={
                    "rate_per_share": "0.007550",
                    "currency": "AUD",
                    "declared_on": distribution.declared_on.isoformat(),
                    "payment_date": distribution.payment_date.isoformat(),
                    "declared_total": "1.06",
                    "undistributed": "0.01",
                },
            ),
        )
        self.assertEqual(
            [(row["shares"], row["entitlement"]) for row in json.loads(files[f"{path}/roll.json"])],
            [("100", "0.75"), ("40", "0.30"), ("1", "0.00")],
        )
        self.assertEqual(json.loads(files[f"{path}/roll.json"]), expected_roll(distribution))
        events = events_of(distribution)
        carried = json.loads(files[f"{path}/events.json"])
        self.assertEqual(carried, [expected_event(event) for event in events])
        self.assertEqual(
            [(event["kind"], event["reference"], event["authority"]) for event in carried],
            [
                ("payment", "LDV-4412", "Payment advice PA-1"),
                ("payment", "LDV-4413", "Payment advice PA-2"),
                ("payment_void", "", "Synthetic advice PA-2 named the wrong account"),
                ("payment", "LDV-4414", "Payment advice PA-3"),
            ],
        )
        for event in events:
            with self.subTest(sequence=event.sequence):
                self.assertEqual(sha256(event.preimage.encode()), event.entry_hash)
                if event.evidence:
                    carried_copy = files[f"{path}/payments/{event.pk}.pdf"]
                    self.assertEqual(carried_copy, read(event.evidence.name))
                    self.assertEqual(sha256(carried_copy), event.evidence_digest)
        self.assertEqual(
            sorted(name for name in files if name.startswith(f"{path}/")),
            sorted(
                [
                    f"{path}/document.pdf",
                    f"{path}/events.json",
                    f"{path}/publication.json",
                    f"{path}/roll.json",
                    *(f"{path}/payments/{event.pk}.pdf" for event in events if event.evidence),
                ]
            ),
        )

    def test_a_publication_without_events_is_carried_with_an_empty_chain(self):
        files = files_of(self.pack())

        statement = self.scene.statement
        self.assertEqual(json.loads(files[f"{folder(statement)}/events.json"]), [])
        self.assertEqual(
            json.loads(files[f"{folder(statement)}/publication.json"]), expected_publication(statement, reads())
        )
        self.assertEqual(
            json.loads(files["manifest.json"])["publications"],
            [
                {"publication": str(statement.pk), "kind": "holding_statement", "events": 0, "head_hash": "0" * 64},
                {
                    "publication": str(self.scene.resolution.pk),
                    "kind": "resolution",
                    "events": 4,
                    "head_hash": events_of(self.scene.resolution)[-1].entry_hash,
                },
                {
                    "publication": str(self.scene.distribution.pk),
                    "kind": "distribution",
                    "events": 4,
                    "head_hash": events_of(self.scene.distribution)[-1].entry_hash,
                },
            ],
        )

    def test_the_preimage_function_returns_the_text_each_version_of_the_hash_function_digests(self):
        events = PublicationEvent.objects.filter(company=self.a.company).annotate(
            preimage=PREIMAGE, recomputed=RECOMPUTED
        )

        self.assertEqual(
            sorted(event.kind for event in events), ["ballot"] * 3 + ["close"] + ["payment"] * 3 + ["payment_void"]
        )
        for event in events:
            with self.subTest(kind=event.kind, sequence=event.sequence):
                self.assertEqual(sha256(event.preimage.encode()), event.recomputed)
                self.assertEqual(event.recomputed, event.entry_hash)
                recipe = "v2" if event.kind in ("payment", "payment_void") else "v1"
                self.assertEqual(json.loads(event.preimage)[:2], [f"ledova-publication-event-{recipe}", str(event.pk)])

    def test_the_readme_lists_each_publication_and_says_what_is_withheld_and_why(self):
        readme = files_of(self.pack())["README.md"].decode()

        for publication, kind, title, events in (
            (self.scene.statement, "holding_statement", "Annual holding statement 2026", 0),
            (self.scene.resolution, "resolution", "Resolution to adopt a constitution", 4),
            (self.scene.distribution, "distribution", "Final dividend 2026", 4),
        ):
            head = events_of(publication)[-1].entry_hash if events else "0" * 64
            with self.subTest(kind=kind):
                self.assertIn(
                    f"| `{publication.pk}` | {kind} | {title} | {self.a.token.symbol} | 2026-09-20 | {events} | "
                    f"`{head}` |",
                    readme,
                )
        for line in (
            "The company sees the result of each resolution and how many members opened each publication, never "
            "how a member voted or who opened what.",
            "Its member, choice, shares, the account that cast it, whether staff entered it, when it was cast and "
            "its preimage are not in this pack, because the preimage holds the choice.",
            "It does not say who.",
            "You cannot recount the tally, because the ballots are withheld.",
            "how any member voted, or which member opened which publication.",
        ):
            with self.subTest(line=line):
                self.assertIn(line, readme)

    def test_no_ballot_choice_or_voter_leaves(self):
        content = self.pack()
        files = files_of(content)
        ballots = ballots_of(self.a.company)
        text = "\n".join(file.decode("latin-1") for file in files.values())

        self.assertEqual([ballot.choice for ballot in ballots], ["for", "against", "abstain"])
        for ballot in ballots:
            with self.subTest(choice=ballot.choice):
                self.assertEqual(sorted(identity for identity in ballot.roll if identity not in text), [])
        self.assertEqual(disclosed(files, ballots), [])
        events = f"{folder(self.scene.resolution)}/events.json"
        first = ballots[0]
        roll = {row["uuid"]: row for row in json.loads(files[f"{folder(self.scene.resolution)}/roll.json"])}
        recipient = next(uuid for uuid in roll if uuid in first.roll)

        def planted(**fields):
            records = json.loads(files[events])
            ballot = next(event for event in records if event["entry_hash"] == first.entry_hash)
            ballot.update(fields)
            return {**files, events: json.dumps(records).encode()}

        for planting, fields in (
            ("the choice beside the roll row", {"choice": first.choice, "recipient": recipient}),
            ("the choice beside the member's name", {"choice": first.choice, "name": roll[recipient]["name"]}),
            ("the preimage", {"preimage": first.preimage}),
        ):
            with self.subTest(planting=planting):
                self.assertEqual(disclosed(planted(**fields), ballots), [(first.uuid, events)])

    def test_no_roll_account_id_leaves(self):
        files = files_of(self.pack())

        accounts = sorted(
            set(PublicationRecipient.objects.filter(company=self.a.company).values_list("user_id", flat=True))
        )
        self.assertEqual(accounts, [holder.user.pk for holder in self.a.members])
        self.assertEqual(numbers_in(files, accounts), [])
        self.assertEqual(numbers_in(files, [*accounts, self.a.staff.pk]), [self.a.staff.pk])
        self.assertEqual(
            [event["kind"] for event in json.loads(files[f"{folder(self.scene.distribution)}/events.json"])],
            ["payment", "payment", "payment_void", "payment"],
        )

    def test_read_counts_leave_and_no_reader_does(self):
        files = files_of(self.pack())

        read_records = PublicationRead.objects.filter(
            publication_uuid__in=[self.scene.resolution.pk, self.scene.distribution.pk]
        )
        readers = sorted(set(read_records.values_list("actor_id", flat=True)))
        self.assertEqual(
            readers,
            sorted([self.a.owner.pk, self.a.reader.pk, *(holder.user.pk for holder in self.a.members[:2])]),
        )
        self.assertEqual(read_records.count(), 6)
        self.assertEqual(numbers_in(files, readers), [])
        self.assertEqual(numbers_in(files, [*readers, self.a.staff.pk]), [self.a.staff.pk])
        text = "\n".join(file.decode("latin-1") for file in files.values())
        self.assertEqual([str(uuid) for uuid in read_records.values_list("uuid", flat=True) if str(uuid) in text], [])
        self.assertEqual(
            {
                kind: json.loads(files[f"{folder(publication)}/publication.json"])["reads"]
                for kind, publication in (
                    ("statement", self.scene.statement),
                    ("resolution", self.scene.resolution),
                    ("distribution", self.scene.distribution),
                )
            },
            {
                "statement": reads(),
                "resolution": reads(member=3, company=1, opened=2),
                "distribution": reads(member=1, opened=1, evidence=1),
            },
        )

    def test_the_consumer_verifies_every_publication_chain_without_the_platform(self):
        content = self.pack()

        result = consume(content, *ISOLATED)

        self.assertEqual((result.returncode, result.stderr), (0, ""))
        self.assertEqual(
            result.stdout.splitlines(),
            [
                f"{self.a.token.symbol}: 1 entries verified, 3 current members",
                "documents: 1 carried, 0 listed only, 0 evidence copies match their records",
                f"holding_statement {self.scene.statement.pk}: 0 events linked, 0 recomputed, 0 withheld",
                f"resolution {self.scene.resolution.pk}: 4 events linked, 1 recomputed, 3 withheld",
                f"distribution {self.scene.distribution.pk}: 4 events linked, 4 recomputed, 0 withheld",
                sha256(files_of(content)["manifest.json"]),
            ],
        )

    def test_the_consumer_names_a_broken_link_a_tampered_close_and_a_removed_event(self):
        files = files_of(self.pack())
        resolution, distribution = folder(self.scene.resolution), folder(self.scene.distribution)
        votes, payments = f"{resolution}/events.json", f"{distribution}/events.json"
        records = json.loads(files[payments])
        evidence = records[0]["evidence"]["path"]

        def ballot_link_broken(events):
            events[1]["previous_hash"] = "f" * 64

        def close_link_broken(events):
            rehashed(events[3], 13, "f" * 64)
            events[3]["previous_hash"] = "f" * 64

        def payload_changed(events):
            fields = json.loads(events[3]["preimage"])
            fields[12]["for"]["shares"] = "140"
            events[3]["preimage"] = json.dumps(fields)
            events[3]["payload"]["for"]["shares"] = "140"

        def payload_field_changed(events):
            events[3]["payload"]["carried"] = False

        flipped = bytearray(files[evidence])
        flipped[20] ^= 1
        for tampering, tampered, refusal in (
            (
                "a ballot's link broken",
                rewritten(files, votes, ballot_link_broken),
                f"{votes} event 2: previous_hash does not link to event 1",
            ),
            (
                "the close's link broken, with its preimage and hash rewritten to match",
                rewritten(files, votes, close_link_broken),
                f"{votes} event 4: previous_hash does not link to event 3",
            ),
            (
                "the close's tally changed, with its hash left unchanged",
                rewritten(files, votes, payload_changed),
                f"{votes} event 4: entry_hash is not the SHA-256 of its preimage",
            ),
            (
                "the close's tally changed outside its preimage",
                rewritten(files, votes, payload_field_changed),
                f"{votes} event 4: the preimage does not match the event's fields",
            ),
            ("a ballot removed", rewritten(files, votes, lambda events: events.pop(1)), f"{votes} event 2: numbered 3"),
            (
                "the last payment record removed",
                rewritten(files, payments, lambda events: events.pop()),
                f"{payments}: ends at event 3 with {records[2]['entry_hash']}, and the manifest's head is event 4 "
                f"with {records[3]['entry_hash']}",
            ),
            (
                "a byte flipped in remittance evidence, with the manifest rewritten to match",
                remanifested({**files, evidence: bytes(flipped)}),
                f"{evidence}: its SHA-256 is not the one {payments} records",
            ),
            (
                "a listed file no publication names",
                remanifested({**files, f"{distribution}/payments/extra.pdf": b"extra"}),
                f"{distribution}/payments/extra.pdf: named by no publication",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(zipped(tampered), *ISOLATED)

                self.assertEqual((result.returncode, result.stdout), (1, ""))
                self.assertEqual(result.stderr, f"REFUSED {refusal}\n")
        untouched = consume(zipped(files), *ISOLATED)
        self.assertEqual((untouched.returncode, untouched.stderr), (0, ""))

    def test_the_consumer_names_a_tally_roll_or_event_the_chain_cannot_account_for(self):
        files = files_of(self.pack())
        resolution, distribution = folder(self.scene.resolution), folder(self.scene.distribution)
        votes, payments = f"{resolution}/events.json", f"{distribution}/events.json"
        paid_to = json.loads(files[payments])[0]["recipient"]

        def closed_with(change):
            events = json.loads(files[votes])
            payload = json.loads(events[3]["preimage"])[12]
            change(payload)
            rehashed(events[3], 12, payload)
            events[3]["payload"] = payload
            manifest = json.loads(files["manifest.json"])
            for row in manifest["publications"]:
                if row["publication"] == str(self.scene.resolution.pk):
                    row["head_hash"] = events[3]["entry_hash"]
            return remanifested(
                {**files, votes: json.dumps(events).encode(), "manifest.json": json.dumps(manifest).encode()}
            )

        def after_the_close(events):
            events.append({**events[0], "sequence": 5, "previous_hash": events[3]["entry_hash"]})

        for tampering, tampered, refusal in (
            (
                "one more member counted for, with the close's hash and the manifest's head rewritten to match",
                closed_with(lambda payload: payload["for"].update(members=2)),
                f"{votes}: the close counts 4 ballots of 141 shares, and the chain holds 3 ballots from a roll of "
                "141 shares",
            ),
            (
                "the eligible shares changed, rewritten to match",
                closed_with(lambda payload: payload["eligible"].update(shares="140")),
                f"{votes}: the close's basis, kind or eligible shares and members are not the resolution's",
            ),
            (
                "the result reversed, rewritten to match",
                closed_with(lambda payload: payload.update(carried=False)),
                f"{votes}: the close says carried is False, and its shares for and against say True",
            ),
            (
                "a ballot marked as carried in full",
                rewritten(files, votes, lambda events: events[0].update(withheld=False)),
                f"{votes} event 1: a ballot is withheld, and nothing else is",
            ),
            (
                "an event after the close",
                rewritten(files, votes, after_the_close),
                f"{votes} event 5: follows the close",
            ),
            (
                "a ballot on a dividend",
                rewritten(files, payments, lambda events: events[0].update(kind="ballot", withheld=True)),
                f"{payments} event 1: a distribution records no ballot",
            ),
            (
                "a roll row's id changed",
                rewritten(files, f"{distribution}/roll.json", lambda rows: rows[0].update(uuid=str(uuid4()))),
                f"{payments} event 1: its recipient {paid_to} is not on the roll",
            ),
            (
                "a roll row removed",
                rewritten(files, f"{distribution}/roll.json", lambda rows: rows.pop()),
                f"{distribution}/roll.json: 2 rows, and the publication records 3",
            ),
            (
                "a publication's kind changed",
                rewritten(files, f"{resolution}/publication.json", lambda record: record.update(kind="distribution")),
                f"{resolution}/publication.json: not the publication the manifest lists",
            ),
        ):
            with self.subTest(tampering=tampering):
                result = consume(zipped(tampered), *ISOLATED)

                self.assertEqual((result.returncode, result.stdout), (1, ""))
                self.assertEqual(result.stderr, f"REFUSED {refusal}\n")

    def test_the_ceiling_counts_each_publication_document_and_remittance_evidence(self):
        documents = [document for document in CompanyDocument.objects.filter(company=self.a.company) if document.file]
        published_files = sum(len(content) for content in stored_bytes(self.a))
        total = sum(document.file_size for document in documents) + published_files
        self.assertEqual((len(documents), len(stored_bytes(self.a))), (1, 6))

        with patch(CEILING, total - 1):
            self.refused(
                f"The files this pack would carry come to {total:,} bytes, over the ceiling of {total - 1:,} bytes "
                "for a pack produced while you wait, so no pack was produced. Ask engineering to build background "
                "production, which is built the first time a pack exceeds the ceiling."
            )
        with patch(CEILING, total):
            self.pack()

        self.assertEqual(RegisterExport.objects.count(), 1)

    def test_a_stored_publication_file_that_changed_or_is_missing_refuses_the_pack(self):
        document = self.scene.resolution.file.name
        payment = PublicationEvent.objects.filter(publication=self.scene.distribution).exclude(evidence="").first()
        for label, name, of in (
            ("document", document, f"the document of publication {self.scene.resolution.pk}"),
            ("remittance evidence", payment.evidence.name, f"the remittance evidence of payment record {payment.pk}"),
        ):
            original = read(name)
            tampered = bytearray(original)
            tampered[20] ^= 1
            with self.subTest(changed=label):
                rewrite(name, bytes(tampered))

                self.refused(
                    f"The copy Ledova kept of {of} no longer matches the SHA-256 recorded when it was submitted, so "
                    "no pack was produced. Restore the copy that was submitted before producing a pack."
                )

            with self.subTest(missing=label):
                private_storage().delete(name)

                self.refused(
                    f"The stored file of {of} is missing, so no pack was produced. Restore it to private storage, "
                    "then produce the pack again."
                )

            rewrite(name, original)
        self.pack()
        self.assertEqual(RegisterExport.objects.count(), 1)

    def test_an_event_or_a_roll_row_that_no_longer_matches_refuses_the_pack(self):
        resolution = self.scene.resolution
        ballot = PublicationEvent.objects.get(publication=resolution, sequence=2)
        row = roll_row(resolution, self.a.members[0])
        verify = f"Run `python manage.py publications verify --publication {resolution.pk}` before producing a pack."
        for label, rewriting, restoring, refusal in (
            (
                "a ballot rewritten",
                lambda: the_chain_is_rewritten(
                    ("UPDATE shareholders_publicationevent SET choice = 'for' WHERE uuid = %s", [ballot.pk])
                ),
                lambda: the_chain_is_rewritten(
                    ("UPDATE shareholders_publicationevent SET choice = 'against' WHERE uuid = %s", [ballot.pk])
                ),
                f"Event 2 of publication {resolution.pk} does not match its hash, so no pack was produced. {verify}",
            ),
            (
                "a roll row rewritten",
                lambda: as_the_schema_owner(
                    "shareholders_publicationrecipient",
                    "shareholders_publication_roll_is_frozen",
                    ("UPDATE shareholders_publicationrecipient SET shares = 99 WHERE uuid = %s", [row.pk]),
                ),
                lambda: as_the_schema_owner(
                    "shareholders_publicationrecipient",
                    "shareholders_publication_roll_is_frozen",
                    ("UPDATE shareholders_publicationrecipient SET shares = 100 WHERE uuid = %s", [row.pk]),
                ),
                f"The roll of publication {resolution.pk} no longer matches the rows and digest it recorded, so no "
                f"pack was produced. {verify}",
            ),
        ):
            with self.subTest(rewritten=label):
                rewriting()

                self.refused(refusal)

                restoring()
        self.pack()
        self.assertEqual(RegisterExport.objects.count(), 1)

    def test_another_companys_pack_carries_none_of_this_companys_publications(self):
        b = publishing_company("pub-b", 861_000_200, 700)
        participation(b)
        packs = {self.a.label: files_of(self.pack()), b.label: files_of(self.pack(b.company))}

        for ours, theirs in ((self.a, b), (b, self.a)):
            with self.subTest(company=ours.label):
                records = publication_records(ours)
                own = "\n".join(file.decode("latin-1") for file in packs[ours.label].values()).lower()
                other = "\n".join(file.decode("latin-1") for file in packs[theirs.label].values()).lower()

                self.assertEqual(len(records), 34)
                self.assertEqual([record for record in records if record not in own], [])
                self.assertEqual([record for record in records if record in other], [])
                self.assertEqual(
                    [raw for raw in stored_bytes(ours) if any(raw in file for file in packs[ours.label].values())],
                    stored_bytes(ours),
                )
                self.assertEqual(
                    [raw for raw in stored_bytes(ours) if any(raw in file for file in packs[theirs.label].values())],
                    [],
                )


class ScopedCompanyPackPublicationsTest(RunsOnTheScopedConnection, StubUploadDependencies, APITransactionTestCase):
    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_the_pack_page_reads_ballots_payment_records_and_reads_on_the_operator_connection(self):
        with use_operator():
            world = publishing_company("scoped-pub", 862_000_100, 800)
            scene = participation(world)
            staff = pack_staff("scoped-publications-pack")
            self.client.force_login(staff)

        response = self.client.post(page(world.company), {"instruction": INSTRUCTION, "recipient": RECIPIENT})

        self.assertEqual((response.status_code, response["Content-Type"]), (200, "application/zip"))
        files = files_of(b"".join(response.streaming_content))
        with use_operator():
            votes = [expected_event(event) for event in events_of(scene.resolution)]
            payments = [expected_event(event) for event in events_of(scene.distribution)]
            record = RegisterExport.objects.get(kind="company_pack")
        self.assertEqual(json.loads(files[f"{folder(scene.resolution)}/events.json"]), votes)
        self.assertEqual([event["withheld"] for event in votes], [True, True, True, False])
        self.assertEqual(json.loads(files[f"{folder(scene.distribution)}/events.json"]), payments)
        self.assertEqual(
            json.loads(files[f"{folder(scene.resolution)}/publication.json"])["reads"],
            reads(member=3, company=1, opened=2),
        )
        self.assertEqual((record.digest, record.requested_by_id), (sha256(files["manifest.json"]), staff.pk))
