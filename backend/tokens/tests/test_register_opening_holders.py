import re
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from django.db import connections
from django.test import override_settings
from django.utils import timezone as django_timezone
from rest_framework.test import APIClient, APITransactionTestCase
from web3 import Web3

from companies.models import CompanyCapability
from companies.services.team import revoke_company_appointment
from integrations.base_chain.exceptions import BaseChainConnectionError
from operators.models import Operator
from shared.db import use_migrate, use_operator
from tokens.models import (
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterMember,
    RegisterMemberWallet,
    RegisterOpening,
    ShareRegister,
    ShareToken,
)
from tokens.services.register_events import create_member
from tokens.services.register_snapshot import ZERO_ADDRESS
from tokens.tests.evidence_fixtures import upload_evidence
from tokens.tests.test_register_access import person
from tokens.tests.test_register_corrections import correction_fixture
from tokens.tests.test_register_events import register_fixture
from tokens.tests.test_register_import_authority import AppointsTeam
from tokens.tests.test_register_imports import live_wallet
from tokens.tests.test_register_openings import (
    ALICE,
    BOB,
    SETTINGS,
    apply_opening,
    deployed_class,
    opening_payload,
    prepared,
    reading,
)
from tokens.tests.test_register_snapshot import transfer
from users.models import UserProfile

HOLDERS = "/api/v1/tokens/{}/register/opening-holders/"
ADA = Web3.to_checksum_address("0x" + "a" * 40)
CY = Web3.to_checksum_address("0x" + "c" * 40)
WRITES = re.compile(r"^\s*(INSERT|UPDATE|DELETE)\b", re.IGNORECASE)
LOCKS = re.compile(r"\bFOR\s+(NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b", re.IGNORECASE)


class RegisterOpeningHoldersTest(AppointsTeam, APITransactionTestCase):
    def setUp(self):
        self.enterContext(override_settings(**SETTINGS))
        with use_operator():
            self.tenant, self.owner, self.administrator, self.target, self.node = deployed_class()
        self.company = self.tenant.company
        self.token = self.tenant.token
        self.get_block = self.node.client.w3.eth.get_block
        reading(self, self.node)

    def read(self, user, token=None):
        client = APIClient()
        client.force_authenticate(user)
        return client.get(HOLDERS.format(token or self.token.uuid))

    def stored(self):
        with use_operator():
            return [
                model.objects.count()
                for model in (RegisterOpening, RegisterMember, RegisterMemberWallet, ShareRegister, RegisterEntry)
            ]

    def assert_unknown(self, user, token):
        denied, missing = self.read(user, token), self.read(user, uuid4())
        self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
        self.assertEqual(denied.status_code, 404)

    def test_holdings_list_by_shares_then_address_with_each_address_linked_member_and_name(self):
        height = self.target.deployment_block
        self.node.events = [
            transfer(height + 1, ZERO_ADDRESS, ALICE, 1000),
            transfer(height + 2, ALICE, BOB, 5),
            transfer(height + 2, ALICE, ADA, 25, index=1),
            transfer(height + 2, ALICE, CY, 25, index=2),
        ]
        self.node.balances = {ALICE: 945, BOB: 5, ADA: 25, CY: 25}
        self.node.contract.functions.totalSupply.return_value.call.return_value = 1000
        with use_operator():
            _, foreign_company, _, foreign_member, _, _ = register_fixture()
        with use_migrate():
            quiet = create_member(company_id=self.company.pk, member_id=uuid4())
            named = create_member(company_id=self.company.pk, member_id=uuid4())
            RegisterMemberWallet.objects.create(company=self.company, member=quiet, address=ADA.lower())
            live_wallet(self.company, named, CY, "Live Cy")
            RegisterMemberWallet.objects.create(company=foreign_company, member=foreign_member, address=BOB)
        response = self.read(self.owner)
        self.assertEqual(response.status_code, 200, response.content)
        block = self.node.blocks[height + 2]
        self.assertEqual(
            response.json(),
            {
                "block": {
                    "number": height + 2,
                    "hash": block["hash"],
                    "date": datetime.fromtimestamp(block["timestamp"], timezone.utc).date().isoformat(),
                },
                "holdings": [
                    {"address": ALICE, "shares": "945", "member": None, "memberName": None, "memberExists": False},
                    {
                        "address": ADA,
                        "shares": "25",
                        "member": str(quiet.pk),
                        "memberName": None,
                        "memberExists": True,
                    },
                    {
                        "address": CY,
                        "shares": "25",
                        "member": str(named.pk),
                        "memberName": "Live Cy",
                        "memberExists": True,
                    },
                    {"address": BOB, "shares": "5", "member": None, "memberName": None, "memberExists": False},
                ],
            },
        )

    def test_administration_and_preparation_read_the_holders_and_nothing_else_does(self):
        preparer, _ = self.appoint([CompanyCapability.PREPARE])
        for user in (self.owner, preparer):
            with self.subTest(user=user.email):
                self.assertEqual(self.read(user).status_code, 200)
        others = [
            self.appoint([capability])[0]
            for capability in (
                CompanyCapability.READ_REGISTER,
                CompanyCapability.APPROVE,
                CompanyCapability.APPLY,
                CompanyCapability.FINANCE,
            )
        ]
        staff = person(f"staff-{uuid4()}@example.test", is_staff=True)
        superuser = person(f"root-{uuid4()}@example.test", is_staff=True, is_superuser=True)
        self.get_block.reset_mock()
        for user in (*others, staff, superuser):
            with self.subTest(user=user.email):
                self.assert_unknown(user, self.token.uuid)
        revoke_company_appointment(requester=self.owner, appointment_id=self.administrator.pk)
        self.assert_unknown(self.owner, self.token.uuid)
        self.get_block.assert_not_called()
        self.assertEqual(self.read(preparer).status_code, 200)
        self.assertEqual(APIClient().get(HOLDERS.format(self.token.uuid)).status_code, 401)

    def test_an_expired_or_unverified_preparer_reads_nothing(self):
        expires_at = django_timezone.now() + timedelta(days=1)
        expiring, _ = self.appoint([CompanyCapability.PREPARE], expires_at=expires_at)
        self.assertEqual(self.read(expiring).status_code, 200)
        with patch("companies.querysets.company.timezone.now", return_value=expires_at + timedelta(seconds=1)):
            self.assert_unknown(expiring, self.token.uuid)
        preparer, _ = self.appoint([CompanyCapability.PREPARE])
        with use_migrate():
            operator = Operator.get()
            operator.issuer_kyc_required = True
            operator.save(update_fields=["issuer_kyc_required"])
        self.assert_unknown(preparer, self.token.uuid)
        with use_migrate():
            UserProfile.objects.filter(user=preparer).update(is_id_verified=True)
        self.assertEqual(self.read(preparer).status_code, 200)

    def test_another_companys_administrator_finds_this_class_unknown_and_reads_only_its_own(self):
        with use_operator():
            stranger, _, _, issue, _ = correction_fixture()
            foreign_token = issue.register.token
        self.get_block.reset_mock()
        self.assert_unknown(stranger, self.token.uuid)
        self.assert_unknown(self.owner, foreign_token.uuid)
        self.get_block.assert_not_called()
        self.assertContains(self.read(stranger, foreign_token.uuid), "requires a deployed share class", status_code=400)

    def test_a_class_not_deployed_or_already_opened_is_refused_before_the_chain_is_read(self):
        self.get_block.reset_mock()
        for status in ("draft", "deploying"):
            with self.subTest(status=status):
                with use_migrate():
                    ShareToken.objects.filter(pk=self.token.pk).update(status=status)
                self.assertContains(self.read(self.owner), "requires a deployed share class", status_code=400)
        self.get_block.assert_not_called()
        with use_migrate():
            ShareToken.objects.filter(pk=self.token.pk).update(status="paused")
        self.assertEqual(self.read(self.owner).status_code, 200)
        evidence = upload_evidence(self.owner, self.administrator, RegisterEvidenceKind.AUTHORITY)
        proposal = prepared(self.owner, opening_payload(self.token.pk, evidence, self.administrator))
        apply_opening(self.owner, self.administrator, proposal)
        self.get_block.reset_mock()
        self.assertContains(self.read(self.owner), "already has a stored register", status_code=400)
        self.get_block.assert_not_called()

    def test_an_unreadable_chain_answers_service_unavailable_without_the_providers_detail(self):
        self.get_block.side_effect = RuntimeError("private endpoint response")
        unreadable = self.read(self.owner)
        self.assertEqual(unreadable.status_code, 503, unreadable.content)
        self.assertNotIn(b"private endpoint", unreadable.content)
        failure = BaseChainConnectionError("private endpoint connection details")
        self.enterContext(patch("tokens.services.register_snapshot.get_base_chain_client", side_effect=failure))
        unreachable = self.read(self.owner)
        self.assertEqual(unreachable.status_code, 503, unreachable.content)
        self.assertNotIn(b"private endpoint", unreachable.content)

    def test_the_read_stores_nothing_takes_no_lock_and_reads_the_chain_outside_any_transaction(self):
        held, statements = [], []
        read = self.node.block

        def recording(identifier):
            held.append(any(connections[alias].in_atomic_block for alias in connections))
            return read(identifier)

        def record(execute, sql, params, many, context):
            statements.append(sql)
            return execute(sql, params, many, context)

        self.get_block.side_effect = recording
        before = self.stored()
        with ExitStack() as stack:
            for alias in connections:
                stack.enter_context(connections[alias].execute_wrapper(record))
            response = self.read(self.owner)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(held)
        self.assertNotIn(True, held)
        self.assertTrue(statements)
        self.assertEqual([sql for sql in statements if WRITES.search(sql) or LOCKS.search(sql)], [])
        self.assertEqual(self.stored(), before)
