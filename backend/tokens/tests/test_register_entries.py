from datetime import datetime
from uuid import uuid4

from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase

from shared.db import use_migrate, use_operator
from tokens.models import RegisterEvidenceKind, ShareToken
from tokens.services.register_events import (
    create_member,
    open_register,
)
from tokens.tests.register_command_fixtures import (
    legacy_entry_before_company_transfers,
    transfer_existing_member,
)
from tokens.tests.register_grant_fixtures import grant_existing_member
from tokens.tests.test_register_corrections import (
    apply_correction,
    correction_payload,
)
from tokens.tests.test_register_corrections import prepared as prepared_correction
from tokens.tests.test_register_events import DAY
from tokens.tests.test_register_imports import (
    LIVE,
    apply_import,
    import_fixture,
    import_payload,
    live_wallet,
    prepared,
    upload_evidence,
)


class RegisterEntriesTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            (
                self.owner,
                self.company,
                self.token,
                self.member,
                self.appointment,
                register_copy,
                asic,
                self.opening,
            ) = import_fixture()
        self.submit(import_payload(self.token, register_copy, asic, self.member, self.appointment))
        with use_operator():
            self.newcomer = create_member(company_id=self.company.pk, member_id=uuid4())
            self.newcomer_name = f"Synthetic member {self.newcomer.pk}"
            self.issue = self.record("issue", (self.member, "5"))
            self.transfer = self.record("transfer", (self.member, "-10"), (self.newcomer, "10"))
        evidence = upload_evidence(self.owner, self.appointment, RegisterEvidenceKind.AUTHORITY)
        correction = prepared_correction(self.owner, correction_payload(self.issue, evidence, self.appointment))
        self.correction = apply_correction(self.owner, self.appointment, correction).applied_entry

    def submit(self, payload):
        apply_import(self.owner, self.appointment, prepared(self.owner, payload))

    def record(self, kind, *changes):
        if kind == "issue":
            ((member, shares),) = changes
            return grant_existing_member(self.owner, self.appointment, self.token, member, shares, DAY)
        (source, _), (target, shares) = changes
        return transfer_existing_member(self.owner, self.appointment, self.token, source, target, shares)

    def entries(self, token=None, **params):
        client = APIClient()
        client.force_authenticate(self.owner)
        response = client.get(f"/api/v1/tokens/{(token or self.token).uuid}/register/entries/", params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def names(self):
        return [
            [(change["member"], change["name"], change["shares"]) for change in row["changes"]]
            for row in self.entries()["results"]
        ]

    def test_entries_read_newest_first_and_name_each_member_as_the_register_does(self):
        page = self.entries()
        self.assertEqual(page["count"], 4)
        self.assertEqual(
            [(row["uuid"], row["sequence"], row["kind"], row["effectiveOn"]) for row in page["results"]],
            [
                (str(self.correction.pk), 4, "correction", DAY.isoformat()),
                (str(self.transfer.pk), 3, "transfer", timezone.now().date().isoformat()),
                (str(self.issue.pk), 2, "issue", timezone.now().date().isoformat()),
                (str(self.opening.pk), 1, "opening", DAY.isoformat()),
            ],
        )
        self.assertEqual(
            [datetime.fromisoformat(row["recordedAt"]) for row in page["results"]],
            [entry.created_at for entry in (self.correction, self.transfer, self.issue, self.opening)],
        )
        member, newcomer = str(self.member.pk), str(self.newcomer.pk)
        transferred = sorted([(member, "Mia Member", "-10"), (newcomer, self.newcomer_name, "10")])
        self.assertEqual(
            self.names(),
            [
                [(member, "Mia Member", "-5")],
                transferred,
                [(member, "Mia Member", "5")],
                [(member, "Mia Member", "100")],
            ],
        )
        with use_migrate():
            live_wallet(self.company, self.member, LIVE, "Live Mia")
        live = sorted([(member, "Live Mia", "-10"), (newcomer, self.newcomer_name, "10")])
        self.assertEqual(
            self.names(),
            [[(member, "Live Mia", "-5")], live, [(member, "Live Mia", "5")], [(member, "Live Mia", "100")]],
        )

    def test_a_correction_and_the_entry_it_reverses_name_each_other_and_only_uncorrected_changes_are_correctable(self):
        self.assertEqual(
            [(row["corrects"], row["correctedBy"], row["correctable"]) for row in self.entries()["results"]],
            [
                (str(self.issue.pk), None, True),
                (None, None, True),
                (None, str(self.correction.pk), False),
                (None, None, True),
            ],
        )

    def test_an_unopened_register_lists_nothing_and_an_entry_without_changes_is_not_correctable(self):
        with use_operator():
            token = ShareToken.objects.create(company=self.company, name="Empty", symbol="EMP", total_supply="1000")
        self.assertEqual((self.entries(token)["count"], self.entries(token)["results"]), (0, []))
        with use_operator():
            opening = open_register(
                token_id=token.pk, operation_id=uuid4(), changes=[], effective_on=DAY, recorded_by=self.owner
            )
        [row] = self.entries(token)["results"]
        self.assertEqual(
            (row["uuid"], row["changes"], row["corrects"], row["correctedBy"], row["correctable"]),
            (str(opening.pk), [], None, None, False),
        )

    def test_entries_are_read_a_page_at_a_time(self):
        with use_operator():
            for _ in range(22):
                self.record("issue", (self.member, "1"))
        first = self.entries()
        self.assertEqual(first["count"], 26)
        self.assertEqual([row["sequence"] for row in first["results"]], list(range(26, 1, -1)))
        self.assertIsNotNone(first["next"])
        second = self.entries(page=2)
        self.assertEqual(([row["sequence"] for row in second["results"]], second["next"]), ([1], None))

    def test_named_entries_are_read_alone_and_only_from_their_own_class(self):
        named = self.entries(entry=[str(self.issue.pk), str(self.correction.pk)])
        self.assertEqual(
            [(row["uuid"], row["correctedBy"]) for row in named["results"]],
            [(str(self.correction.pk), None), (str(self.issue.pk), str(self.correction.pk))],
        )
        with use_operator():
            token = ShareToken.objects.create(company=self.company, name="Other", symbol="OTH", total_supply="1000")
        self.assertEqual(self.entries(token, entry=str(self.issue.pk))["results"], [])
        client = APIClient()
        client.force_authenticate(self.owner)
        refused = client.get(f"/api/v1/tokens/{self.token.uuid}/register/entries/", {"entry": "not-a-uuid"})
        self.assertEqual(refused.status_code, 400, refused.content)


class RegisterEntryLegacyMigrationTest(APITransactionTestCase):
    def test_an_unidentified_preexisting_transfer_stays_readable_after_the_upgrade(self):
        with use_operator():
            owner, company, token, member, appointment, register_copy, asic, _ = import_fixture()
        apply_import(
            owner, appointment, prepared(owner, import_payload(token, register_copy, asic, member, appointment))
        )
        with use_operator():
            recipient = create_member(company_id=company.pk, member_id=uuid4())
        transfer = legacy_entry_before_company_transfers(
            token,
            owner,
            "transfer",
            sorted(
                [
                    {"member": str(member.pk), "shares": "-10"},
                    {"member": str(recipient.pk), "shares": "10"},
                ],
                key=lambda change: change["member"],
            ),
            DAY,
        )
        self.client.force_authenticate(owner)
        response = self.client.get(f"/api/v1/tokens/{token.pk}/register/entries/", {"entry": str(transfer.pk)})
        self.assertEqual(response.status_code, 200, response.content)
        (row,) = response.json()["results"]
        self.assertEqual(
            (row["uuid"], row["kind"], row["effectiveOn"]), (str(transfer.pk), "transfer", DAY.isoformat())
        )
        self.assertEqual(
            sorted((effect["member"], effect["name"], effect["shares"]) for effect in row["changes"]),
            sorted([(str(member.pk), "Mia Member", "-10"), (str(recipient.pk), None, "10")]),
        )
