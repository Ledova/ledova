import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from importlib import import_module
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, IntegrityError, connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from companies.exceptions import IssuerIdentityVerificationRequiredException
from companies.models import CompanyCapability
from companies.services.administration import company_operation
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from operators.models import Operator
from shared.db import MIGRATE_ALIAS, atomic, current_alias, use_migrate, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterAcknowledgement, RegisterReconciliation, ShareToken
from tokens.services import register_reconciliation
from tokens.services.register_authority import APPOINTMENT_NOT_FOUND
from tokens.services.register_reconciliation import acknowledge_discrepancy
from tokens.tests.test_register_access import person
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import owner_appointment, staff_user
from users.models import UserProfile

RECONCILIATIONS = "/api/v1/tokens/register-reconciliations/"
OPERATION = "register_discrepancy_acknowledge"
REFUSED = "current company approver"
NOT_READABLE = "Reconciliation not found."
PREVIOUS = ("tokens", "0086_company_register_correction_guards")
ACKNOWLEDGEMENTS = import_module("tokens.migrations.0087_company_discrepancy_acknowledgements")


def discrepancies(member):
    return [
        {"kind": "unrecognised_transfer", "transaction": "0x" + "ab" * 32, "block": 7},
        {"kind": "member", "member": str(member.pk), "chain": "97", "expected": "100"},
        {"kind": "unlinked", "address": "0x" + "cd" * 20, "chain": "3", "expected": "0"},
        {"kind": "attribution", "effect": "issue", "source": "10000000-0000-4000-8000-000000000041"},
        {
            "kind": "missing_transfer",
            "effect": "issue",
            "source": "10000000-0000-4000-8000-000000000042",
            "transaction": "0x" + "ef" * 32,
        },
    ]


def reconciled(token, member, block=7):
    return RegisterReconciliation.objects.create(
        token=token,
        status="discrepant",
        block_number=block,
        block_hash=f"0x{block:064x}",
        register_sequence=1,
        discrepancies=discrepancies(member),
    )


def acknowledgement_fixture():
    owner, company, token, member, _, _ = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    Operator.get()
    return owner, company, token, member, owner_appointment(company)


def acknowledge(actor, appointment, record, index, reason="Accepted by the directors", idempotency_key=None):
    return acknowledge_discrepancy(
        actor=actor,
        reconciliation_id=record.pk,
        appointment=appointment.pk,
        discrepancy=index,
        reason=reason,
        idempotency_key=idempotency_key or uuid4(),
    )


@contextmanager
def under_the_staff_era_guard():
    with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
        cursor.execute(ACKNOWLEDGEMENTS.ACKNOWLEDGEMENT_GUARD_AS_0070_INSTALLED_IT, [settings.RLS_ROLES["app"]])
        yield
        cursor.execute(ACKNOWLEDGEMENTS.COMPANY_IMPORTS._with_roles(cursor, ACKNOWLEDGEMENTS.ACKNOWLEDGEMENT_GUARD))


def staff_era_acknowledgement(record, index, reason, staff):
    with under_the_staff_era_guard():
        return RegisterAcknowledgement.objects.create(
            token_id=record.token_id,
            reconciliation=record,
            discrepancy=record.discrepancies[index],
            reason=reason,
            acknowledged_by_id=staff.pk,
        )


def forge(record, company_id, actor, appointment, *, index=0, operation=OPERATION, lock_timeout=None, **changes):
    fields = {
        "token_id": record.token_id,
        "reconciliation": record,
        "discrepancy": record.discrepancies[index],
        "reason": "Accepted by the directors",
        "acknowledged_by_id": actor.pk,
        "appointment": appointment,
        "idempotency_key": uuid4(),
        **changes,
    }
    with company_operation(actor, company_id, operation), atomic():
        if lock_timeout:
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT set_config('lock_timeout', %s, true)", [lock_timeout])
        return RegisterAcknowledgement.objects.create(**fields)


def locked(probe, company, token):
    found = []
    for table, key in (("companies_company", company.pk), ("tokens_sharetoken", token.pk)):
        with probe.cursor() as cursor:
            try:
                cursor.execute(f"SELECT uuid FROM {table} WHERE uuid = %s FOR UPDATE NOWAIT", [key])
            except DatabaseError:
                found.append(True)
                continue
            found.append(cursor.fetchall() != [(key,)])
    return tuple(found)


class AcknowledgementFixtures(AppointsTeam):
    def setUp(self):
        with use_operator():
            self.owner, self.company, self.token, self.member, self.administrator = acknowledgement_fixture()
            self.record = reconciled(self.token, self.member)

    def newer(self):
        with use_operator():
            return reconciled(self.token, self.member, block=8)

    def recorded(self):
        with use_operator():
            return list(
                RegisterAcknowledgement.objects.values_list(
                    "reconciliation_id", "discrepancy", "acknowledged_by_id", "appointment_id", "reason"
                )
            )


class RegisterAcknowledgementAuthorityTest(AcknowledgementFixtures, APITransactionTestCase):
    def reappoint(self, appointee, capabilities):
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.administrator.pk,
            idempotency_key=uuid4(),
            capabilities=list(capabilities),
            delegatable_capabilities=[],
        )
        return accept_team_invitation(
            requester=appointee, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )

    def test_approval_or_administration_acknowledges_an_exact_row_and_one_person_suffices(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        key = uuid4()
        approved, created = acknowledge(approver, approving, self.record, 0, idempotency_key=key)
        administered, _ = acknowledge(self.owner, self.administrator, self.record, 1, reason="Accepted by the board")
        rows = self.record.discrepancies
        self.assertTrue(created)
        self.assertEqual(
            [
                (row.token_id, row.reconciliation_id, row.discrepancy, row.acknowledged_by_id, row.appointment_id)
                for row in (approved, administered)
            ],
            [
                (self.token.pk, self.record.pk, rows[0], approver.pk, approving.pk),
                (self.token.pk, self.record.pk, rows[1], self.owner.pk, self.administrator.pk),
            ],
        )
        self.assertEqual((approved.idempotency_key, administered.reason), (key, "Accepted by the board"))

    def test_other_capabilities_platform_roles_and_an_owner_without_an_appointment_acknowledge_nothing(self):
        cases = [
            (capability, *self.appoint([capability]), APPOINTMENT_NOT_FOUND)
            for capability in (
                CompanyCapability.PREPARE,
                CompanyCapability.APPLY,
                CompanyCapability.READ_REGISTER,
            )
        ]
        finance, financing = self.appoint([CompanyCapability.FINANCE])
        with use_operator():
            foreign_owner, _, _, _, foreign_administrator = acknowledgement_fixture()
        cases += [
            ("finance", finance, financing, NOT_READABLE),
            ("staff", staff_user(), self.administrator, NOT_READABLE),
            ("another company's administrator", foreign_owner, foreign_administrator, NOT_READABLE),
        ]
        for label, actor, appointment, refusal in cases:
            with self.subTest(actor=label), self.assertRaisesMessage(NotFound, refusal):
                acknowledge(actor, appointment, self.record, 0)
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        with self.assertRaisesMessage(NotFound, APPOINTMENT_NOT_FOUND):
            acknowledge(self.owner, self.administrator, self.record, 0)
        self.assertEqual(self.recorded(), [])

    def test_a_revoked_or_expired_appointment_acknowledges_nothing(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        expires_at = timezone.now() + timedelta(days=1)
        expiring, lapsing = self.appoint([CompanyCapability.APPROVE], expires_at=expires_at)
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        with self.assertRaises(NotFound):
            acknowledge(approver, approving, self.record, 0)
        later = expires_at + timedelta(seconds=1)
        with patch("tokens.services.register_authority.timezone.now", return_value=later):
            with self.assertRaises(NotFound):
                acknowledge(expiring, lapsing, self.record, 0)
        self.assertEqual(self.recorded(), [])
        acknowledge(expiring, lapsing, self.record, 0)
        self.assertEqual(len(self.recorded()), 1)

    def test_the_issuer_identity_requirement_applies(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        with use_migrate():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        with self.assertRaisesMessage(NotFound, NOT_READABLE):
            acknowledge(approver, approving, self.record, 0)
        with self.assertRaises(IssuerIdentityVerificationRequiredException):
            acknowledge(self.owner, self.administrator, self.record, 0)
        self.assertEqual(self.recorded(), [])
        with use_migrate():
            UserProfile.objects.filter(user=approver).update(is_id_verified=True)
        acknowledge(approver, approving, self.record, 0)
        self.assertEqual([row[2] for row in self.recorded()], [approver.pk])

    def test_an_identical_retry_returns_the_acknowledgement_and_a_changed_one_conflicts(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        key = uuid4()
        first, created = acknowledge(approver, approving, self.record, 0, idempotency_key=key)
        again, repeated = acknowledge(approver, approving, self.record, 0, idempotency_key=key)
        self.assertEqual((again.pk, created, repeated), (first.pk, True, False))
        newer = self.newer()
        self.assertEqual(acknowledge(approver, approving, self.record, 0, idempotency_key=key), (first, False))
        for label, record, index, reason in (
            ("reconciliation", newer, 0, "Accepted by the directors"),
            ("row", self.record, 1, "Accepted by the directors"),
            ("reason", self.record, 0, "Accepted for another reason"),
        ):
            with self.subTest(changed=label), self.assertRaises(RegisterChangeConflict):
                acknowledge(approver, approving, record, index, reason=reason, idempotency_key=key)
        revoke_company_appointment(requester=self.owner, appointment_id=approving.pk)
        reappointed = self.reappoint(approver, [CompanyCapability.APPROVE])
        with self.assertRaises(RegisterChangeConflict):
            acknowledge(approver, reappointed, self.record, 0, idempotency_key=key)
        colleague, colleagues = self.appoint([CompanyCapability.APPROVE])
        self.assertTrue(acknowledge(colleague, colleagues, newer, 0, idempotency_key=key)[1])
        self.assertEqual(len(self.recorded()), 2)

    def test_only_the_latest_reconciliation_takes_an_acknowledgement(self):
        newer = self.newer()
        with self.assertRaisesMessage(ValidationError, "latest reconciliation"):
            acknowledge(self.owner, self.administrator, self.record, 0)
        self.assertEqual(self.recorded(), [])
        acknowledge(self.owner, self.administrator, newer, 0)
        self.assertEqual([row[0] for row in self.recorded()], [newer.pk])

    def test_attributions_missing_transfers_and_unknown_positions_are_not_acknowledged(self):
        for index, refusal in ((3, "needs attribution"), (4, "needs attribution"), (5, "by its position")):
            with self.subTest(index=index), self.assertRaisesMessage(ValidationError, refusal):
                acknowledge(self.owner, self.administrator, self.record, index)
        self.assertEqual(self.recorded(), [])

    def test_a_row_is_acknowledged_once(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        acknowledge(self.owner, self.administrator, self.record, 2)
        with self.assertRaisesMessage(ValidationError, "already acknowledged"):
            acknowledge(approver, approving, self.record, 2)
        self.assertEqual([row[2] for row in self.recorded()], [self.owner.pk])

    def test_the_reason_is_required_and_bounded(self):
        for reason in ("", " \n", "x" * 1001, None):
            with self.subTest(reason=reason), self.assertRaisesMessage(ValidationError, "at most 1000 characters"):
                acknowledge(self.owner, self.administrator, self.record, 0, reason=reason)
        self.assertEqual(self.recorded(), [])
        acknowledge(self.owner, self.administrator, self.record, 0, reason="x" * 1000)
        self.assertEqual([row[4] for row in self.recorded()], ["x" * 1000])

    def test_an_acknowledgement_is_recorded_under_the_company_and_share_class_locks(self):
        probe = connections[MIGRATE_ALIAS].copy(alias="acknowledgement-lock-probe")
        self.addCleanup(probe.close)
        row = register_reconciliation._row
        observed = []

        def probed(reconciliation, discrepancy):
            observed.append(locked(probe, self.company, self.token))
            return row(reconciliation, discrepancy)

        with patch.object(register_reconciliation, "_row", side_effect=probed):
            acknowledge(self.owner, self.administrator, self.record, 0)
        self.assertEqual(observed, [(True, True)])
        self.assertEqual(locked(probe, self.company, self.token), (False, False))

    def test_the_api_lists_reads_and_acknowledges_and_a_register_reader_cannot_acknowledge(self):
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        reader, reading = self.appoint([CompanyCapability.READ_REGISTER])
        staff = staff_user()
        with use_migrate():
            UserProfile.objects.create(user=staff, full_name="Synthetic Ledova reviewer")
        staff_era_acknowledgement(self.record, 1, "Accepted before company-run acknowledgement", staff)
        client = APIClient()
        client.force_authenticate(approver)
        detail = f"{RECONCILIATIONS}{self.record.pk}/"
        body = {
            "appointment": str(approving.pk),
            "discrepancy": 0,
            "reason": "The directors accept the outside transfer",
            "idempotency_key": str(uuid4()),
        }
        created = client.post(f"{detail}acknowledge/", body, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        result = created.json()
        self.assertEqual(
            {key: result[key] for key in ("uuid", "token", "status", "blockNumber", "registerSequence", "latest")},
            {
                "uuid": str(self.record.pk),
                "token": str(self.token.pk),
                "status": "discrepant",
                "blockNumber": 7,
                "registerSequence": 1,
                "latest": True,
            },
        )
        rows = self.record.discrepancies
        with use_operator():
            acknowledged_at = RegisterAcknowledgement.objects.get(appointment=approving).created_at
        acknowledged = result["discrepancies"][0]
        self.assertEqual(datetime.fromisoformat(acknowledged["acknowledgement"].pop("acknowledgedAt")), acknowledged_at)
        self.assertEqual(
            acknowledged,
            {
                **rows[0],
                "acknowledgeable": False,
                "acknowledgement": {
                    "reason": "The directors accept the outside transfer",
                    "appointment": str(approving.pk),
                    "acknowledgedByName": approver.email,
                    "providedBy": "company",
                },
            },
        )
        self.assertEqual(client.post(f"{detail}acknowledge/", body, format="json").status_code, 200)
        changed = client.post(f"{detail}acknowledge/", {**body, "reason": "Changed"}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        client.force_authenticate(reader)
        listed = client.get(RECONCILIATIONS, {"token": str(self.token.pk)})
        self.assertEqual(listed.status_code, 200, listed.content)
        [read] = listed.json()["results"]
        self.assertEqual(read, client.get(detail).json())
        self.assertEqual(
            [
                (row["acknowledgeable"], (row["acknowledgement"] or {}).get("providedBy"))
                for row in read["discrepancies"]
            ],
            [(False, "company"), (False, "staff"), (True, None), (False, None), (False, None)],
        )
        self.assertEqual(
            read["discrepancies"][1]["acknowledgement"]["reason"], "Accepted before company-run acknowledgement"
        )
        self.assertEqual(
            [read["discrepancies"][1]["acknowledgement"][key] for key in ("acknowledgedByName", "appointment")],
            [None, None],
        )
        refused = client.post(
            f"{detail}acknowledge/",
            {**body, "appointment": str(reading.pk), "discrepancy": 2, "idempotency_key": str(uuid4())},
            format="json",
        )
        self.assertEqual(refused.status_code, 404, refused.content)
        self.assertEqual(len(self.recorded()), 2)
        newer = self.newer()
        listed = client.get(RECONCILIATIONS, {"company": str(self.company.pk)}).json()["results"]
        self.assertEqual(
            [(row["uuid"], row["latest"]) for row in listed], [(str(newer.pk), True), (read["uuid"], False)]
        )
        self.assertEqual([row["acknowledgeable"] for row in listed[1]["discrepancies"]], [False] * 5)
        self.assertEqual(client.get(RECONCILIATIONS, {"company": str(uuid4())}).json()["results"], [])
        for ordering in ("latest", "-latest", "created_at"):
            with self.subTest(ordering=ordering):
                ordered = client.get(RECONCILIATIONS, {"ordering": ordering})
                self.assertEqual(ordered.status_code, 200, ordered.content)
                self.assertEqual(len(ordered.json()["results"]), 2)
        with use_operator():
            _, _, other_token, _, _, _ = register_fixture()
        self.assertEqual(client.get(RECONCILIATIONS, {"token": str(other_token.pk)}).json()["results"], [])


class RegisterAcknowledgementGuardTest(AcknowledgementFixtures, APITransactionTestCase):
    def assert_refused(self, message, write):
        with self.assertRaises(RuntimeError), atomic():
            with self.assertRaisesMessage(DatabaseError, message), atomic():
                write()
            raise RuntimeError("rollback")

    def forge(self, actor=None, appointment=None, *, record=None, company_id=None, **changes):
        return forge(
            record or self.record,
            company_id or self.company.pk,
            actor or self.owner,
            appointment or self.administrator,
            **changes,
        )

    def test_the_database_admits_only_an_exact_current_company_acknowledgement(self):
        stranger = person(f"stranger-{uuid4()}@example.test")
        with use_operator():
            sibling = ShareToken.objects.create(
                company=self.company, name="Synthetic preference shares", symbol="PRF", total_supply="1000"
            )
        member = self.record.discrepancies[1]
        for label, changes in (
            ("operation", {"operation": "register_import_approve"}),
            ("company", {"company_id": uuid4()}),
            ("principal", {"acknowledged_by_id": stranger.pk}),
            ("retry key", {"idempotency_key": None}),
            ("share class", {"token_id": sibling.pk}),
            ("row", {"index": 1, "discrepancy": {**member, "chain": "98"}}),
            ("reason", {"reason": " "}),
            ("whitespace reason", {"reason": "\t\n"}),
            ("attribution", {"index": 3}),
            ("missing transfer", {"index": 4}),
        ):
            with self.subTest(forged=label):
                self.assert_refused(REFUSED, lambda: self.forge(**changes))
        self.forge()
        self.assertEqual([row[1] for row in self.recorded()], [self.record.discrepancies[0]])

    def test_the_database_admits_only_an_appointment_holding_approval_or_administration(self):
        for capability in (
            CompanyCapability.PREPARE,
            CompanyCapability.APPLY,
            CompanyCapability.READ_REGISTER,
        ):
            actor, appointment = self.appoint([capability])
            with self.subTest(capability=capability):
                self.assert_refused(REFUSED, lambda: self.forge(actor, appointment))
        approver, approving = self.appoint([CompanyCapability.APPROVE])
        self.assert_refused(REFUSED, lambda: self.forge(approver, self.administrator))
        self.forge(approver, approving)
        self.assertEqual([row[3] for row in self.recorded()], [approving.pk])

    def test_the_database_refuses_an_older_reconciliation_and_a_revoked_appointment(self):
        newer = self.newer()
        self.assert_refused(REFUSED, lambda: self.forge())
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        self.assert_refused(REFUSED, lambda: self.forge(record=newer))
        self.assertEqual(self.recorded(), [])

    def test_the_database_checks_an_acknowledgement_under_the_company_and_share_class_locks(self):
        probe = connections[MIGRATE_ALIAS].copy(alias="acknowledgement-guard-probe")
        self.addCleanup(probe.close)
        for table, key in (("companies_company", self.company.pk), ("tokens_sharetoken", self.token.pk)):
            probe.set_autocommit(False)
            try:
                with probe.cursor() as cursor:
                    cursor.execute(f"SELECT uuid FROM {table} WHERE uuid = %s FOR UPDATE", [key])
                with self.subTest(locked=table):
                    self.assert_refused("lock timeout", lambda: self.forge(lock_timeout="200ms"))
            finally:
                probe.rollback()
                probe.set_autocommit(True)
        self.forge()
        self.assertEqual(len(self.recorded()), 1)

    def test_the_app_role_records_nothing_even_where_it_holds_the_table(self):
        app = settings.RLS_ROLES["app"]
        with self.assertRaises(RuntimeError), use_migrate(), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT quote_ident(%s)", [app])
                role = cursor.fetchone()[0]
                cursor.execute(f"GRANT SELECT, INSERT ON tokens_registeracknowledgement TO {role}")
                cursor.execute(f"SET LOCAL ROLE {role}")
                cursor.execute(
                    "SELECT set_config('app.user_id', %s, true), set_config('app.company_operation', %s, true), "
                    "set_config('app.company_id', %s, true)",
                    [str(self.owner.pk), OPERATION, str(self.company.pk)],
                )
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], app)
            with self.assertRaisesMessage(DatabaseError, REFUSED), atomic():
                RegisterAcknowledgement.objects.create(
                    token_id=self.token.pk,
                    reconciliation_id=self.record.pk,
                    discrepancy=self.record.discrepancies[0],
                    reason="Accepted by the directors",
                    acknowledged_by_id=self.owner.pk,
                    appointment_id=self.administrator.pk,
                    idempotency_key=uuid4(),
                )
            raise RuntimeError("rollback")
        self.assertEqual(self.recorded(), [])

    def test_acknowledgements_are_retained_as_recorded(self):
        acknowledgement = self.forge()
        with company_operation(self.owner, self.company.pk, OPERATION):
            for write in (
                lambda: RegisterAcknowledgement.objects.filter(pk=acknowledgement.pk).update(reason="Rewritten"),
                lambda: RegisterAcknowledgement.objects.filter(pk=acknowledgement.pk).delete(),
            ):
                with self.assertRaisesMessage(DatabaseError, "Retain register acknowledgements as recorded"), atomic():
                    write()
        self.assertEqual([row[4] for row in self.recorded()], ["Accepted by the directors"])

    def test_the_database_stamps_an_acknowledgement_when_it_checks_its_authority(self):
        claimed = timezone.now() - timedelta(days=30)
        acknowledgement = uuid4()
        with company_operation(self.owner, self.company.pk, OPERATION), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "INSERT INTO tokens_registeracknowledgement (uuid, created_at, updated_at, token_id, "
                    "reconciliation_id, discrepancy, reason, acknowledged_by_id, appointment_id, idempotency_key) "
                    "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s)",
                    [
                        acknowledgement,
                        claimed,
                        claimed,
                        self.token.pk,
                        self.record.pk,
                        json.dumps(self.record.discrepancies[0]),
                        "Accepted by the directors",
                        self.owner.pk,
                        self.administrator.pk,
                        uuid4(),
                    ],
                )
        with use_operator():
            stored = RegisterAcknowledgement.objects.get(pk=acknowledgement)
        self.assertEqual(stored.created_at, stored.updated_at)
        self.assertGreater(stored.created_at, claimed + timedelta(days=29))

    def test_each_row_and_each_retry_key_is_recorded_once(self):
        key = uuid4()
        self.forge(idempotency_key=key)
        self.assert_refused("register_acknowledged_once", lambda: self.forge())
        self.assert_refused("one_register_acknowledgement_per_key", lambda: self.forge(index=1, idempotency_key=key))
        self.assertEqual(len(self.recorded()), 1)

    def test_a_row_is_either_staff_era_or_company_run(self):
        staff = staff_user()
        for label, changes in (
            ("appointment without a retry key", {"appointment_id": self.administrator.pk}),
            ("retry key without an appointment", {"idempotency_key": uuid4()}),
        ):
            with self.subTest(shape=label), under_the_staff_era_guard():
                with self.assertRaisesMessage(IntegrityError, "register_acknowledgement_exact_provenance"), atomic():
                    RegisterAcknowledgement.objects.create(
                        token_id=self.token.pk,
                        reconciliation_id=self.record.pk,
                        discrepancy=self.record.discrepancies[0],
                        reason="Accepted by staff",
                        acknowledged_by_id=staff.pk,
                        **changes,
                    )
        retained = staff_era_acknowledgement(self.record, 0, "Accepted by staff", staff)
        self.assertEqual(
            self.recorded(), [(self.record.pk, self.record.discrepancies[0], staff.pk, None, "Accepted by staff")]
        )
        self.assertIsNone(retained.idempotency_key)


class CompanyAcknowledgementMigrationTest(TransactionTestCase):
    def guard(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_get_functiondef('tokens_guard_register_acknowledgement()'::regprocedure)")
            return cursor.fetchone()[0]

    def test_reversal_restores_the_staff_guard_keeps_staff_era_rows_and_reapplies(self):
        self.addCleanup(restore_every_migration)
        company_run = self.guard()
        self.assertIn(OPERATION, company_run)
        migrate_to([("tokens", "0069_opening_mapping_values")])
        migrate_to([PREVIOUS])
        staff_review = self.guard()
        self.assertIn("is_staff", staff_review)
        self.assertNotIn(OPERATION, staff_review)
        restore_every_migration()
        self.assertEqual(self.guard(), company_run)
        _, _, token, member, _ = acknowledgement_fixture()
        retained = staff_era_acknowledgement(reconciled(token, member), 0, "Accepted by staff", staff_user())
        migrate_to([PREVIOUS])
        self.assertEqual(self.guard(), staff_review)
        with connection.cursor() as cursor:
            cursor.execute("SELECT uuid, reason, acknowledged_by_id FROM tokens_registeracknowledgement")
            self.assertEqual(cursor.fetchall(), [(retained.pk, "Accepted by staff", retained.acknowledged_by_id)])
        restore_every_migration()
        self.assertEqual(self.guard(), company_run)
        retained.refresh_from_db()
        self.assertEqual((retained.appointment_id, retained.idempotency_key), (None, None))

    def test_reversal_refuses_while_a_company_acknowledgement_exists(self):
        owner, _, token, member, administrator = acknowledgement_fixture()
        acknowledge(owner, administrator, reconciled(token, member), 0)
        company_run = self.guard()
        with self.assertRaisesMessage(DatabaseError, "Retain company acknowledgements"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                ACKNOWLEDGEMENTS.remove_company_acknowledgements(None, editor)
        self.assertEqual(self.guard(), company_run)


class ScopedRegisterAcknowledgementAuthorityTest(RunsOnTheScopedConnection, RegisterAcknowledgementAuthorityTest):
    pass


class ScopedRegisterAcknowledgementGuardTest(RunsOnTheScopedConnection, RegisterAcknowledgementGuardTest):
    pass
