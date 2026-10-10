from datetime import timedelta
from uuid import uuid4

from django.db import DatabaseError
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from whitelist.models import WhitelistChange
from whitelist.tests.change_fixtures import CHAIN_ID, FACTORY, KEY
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class WhitelistChangeGuardTest(CompanyWalletCases, APITransactionTestCase):
    def test_the_guard_binds_the_expiry_into_the_registry_call(self):
        proposal, _ = self.applied_wallet()
        with use_operator():
            command = WhitelistChange.objects.get(pk=proposal.change_id)
            terms = WhitelistChange.objects.filter(pk=command.pk).values().get()
            expires_at = command.expires_at
            before = WhitelistChange.objects.count()
            for label, values, message in (
                (
                    "another expiry",
                    {"expires_at": expires_at + timedelta(seconds=1)},
                    "must bind its exact registry call",
                ),
                ("no expiry", {"expires_at": None}, "must bind its exact registry call"),
                ("a fractional second", {"expires_at": expires_at + timedelta(microseconds=5)}, "a whole second"),
                ("a removal with an expiry", {"action": "remove"}, "on an addition"),
            ):
                with self.subTest(label=label), self.assertRaisesMessage(DatabaseError, message), atomic():
                    WhitelistChange.objects.create(**(terms | {"uuid": uuid4()} | values))
            self.assertEqual(WhitelistChange.objects.count(), before)
            self.assertEqual(WhitelistChange.objects.get(pk=command.pk).expires_at, expires_at)
