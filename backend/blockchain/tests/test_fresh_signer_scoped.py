import json
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError, connections
from django.test import TransactionTestCase

from blockchain.exceptions import FreshSignerBootstrapError
from blockchain.models import FreshSignerBootstrap, SigningAccount
from blockchain.services.fresh_signer import bootstrap_fresh_signer
from blockchain.tests.fresh_signer_fixtures import FreshSignerFixture
from shared.db import atomic, current_alias
from shared.tests.scoped import RunsOnTheScopedConnection


class ScopedFreshSignerTest(FreshSignerFixture, RunsOnTheScopedConnection, TransactionTestCase):
    def test_operator_boundary_and_real_app_policy_protect_the_bootstrap_receipt(self):
        with self.assertRaisesMessage(FreshSignerBootstrapError, "operator connection"):
            bootstrap_fresh_signer(self.manifest)
        self.chain.get_transaction.assert_not_called()
        observed_roles = []
        original = self.chain.get_transaction.side_effect

        def transaction(tx_hash):
            self.assertFalse(connections[current_alias()].in_atomic_block)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                observed_roles.append(cursor.fetchone()[0])
            return original(tx_hash)

        self.chain.get_transaction.side_effect = transaction
        with self.as_an_operator_would():
            bootstrap_fresh_signer(self.manifest)
            record = FreshSignerBootstrap.objects.get()
            saved = {field.attname: getattr(record, field.attname) for field in record._meta.concrete_fields}
        self.assertEqual(len(observed_roles), 5)
        self.assertEqual(set(observed_roles), {connections["operator"].settings_dict["USER"]})
        self.assertEqual(FreshSignerBootstrap.objects.count(), 0)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("UPDATE blockchain_freshsignerbootstrap SET validator_version = 'wrong'")
            self.assertEqual(cursor.rowcount, 0)
            cursor.execute("DELETE FROM blockchain_freshsignerbootstrap")
            self.assertEqual(cursor.rowcount, 0)
        with self.assertRaises(DatabaseError), atomic():
            FreshSignerBootstrap.objects.create(**saved)
        with self.as_an_operator_would():
            self.assertEqual(FreshSignerBootstrap.objects.count(), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 5)

    def test_operator_sql_cannot_update_delete_or_duplicate_bootstrap_evidence(self):
        with self.as_an_operator_would():
            bootstrap_fresh_signer(self.manifest)
            for statement in (
                "UPDATE blockchain_freshsignerbootstrap SET manifest = '{}'::jsonb",
                "UPDATE blockchain_freshsignerbootstrap SET chain_evidence = '{}'::jsonb",
                "DELETE FROM blockchain_freshsignerbootstrap",
                "INSERT INTO blockchain_freshsignerbootstrap SELECT * FROM blockchain_freshsignerbootstrap",
            ):
                with self.subTest(statement=statement), self.assertRaises(DatabaseError), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(statement)
            self.assertEqual(FreshSignerBootstrap.objects.count(), 1)
            self.assertEqual(SigningAccount.objects.get().admission_generation, 1)

    def test_command_never_elevates_an_app_alias_and_operator_command_commits(self):
        path = self.directory / "manifest.json"
        path.write_text(json.dumps(self.manifest))
        with self.assertRaisesMessage(CommandError, "operator connection"):
            call_command("bootstrap_fresh_signer", manifest=path, stdout=StringIO())
        with self.as_an_operator_would():
            output = StringIO()
            call_command("bootstrap_fresh_signer", manifest=path, stdout=output)
            self.assertFalse(json.loads(output.getvalue())["unchanged"])
            with patch.object(SigningAccount, "save", side_effect=RuntimeError("replay must not save")):
                self.assertTrue(bootstrap_fresh_signer(self.manifest)["unchanged"])
