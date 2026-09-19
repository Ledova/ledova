from django.db import connections
from django.test import TransactionTestCase

from shared.db.policy_sql import install_tables
from shared.tests.schema import migrate_to, restore_every_migration


class MatcherPolicyUpgradeTest(TransactionTestCase):
    def test_an_existing_swap_insert_permission_is_removed_by_the_upgrade(self):
        self.addCleanup(restore_every_migration)
        migrate_to([("shared", "0011_the_helper_names_the_principal")])
        connection = connections["default"]
        with connection.cursor() as cursor:
            cursor.execute("ALTER POLICY tokens_swaporder_insert ON tokens_swaporder WITH CHECK (true)")
            cursor.execute("SELECT with_check FROM pg_policies WHERE policyname = 'tokens_swaporder_insert'")
            self.assertEqual(cursor.fetchone(), ("true",))
        try:
            migrate_to([("shared", "0012_operator_creates_matches")])
            with connection.cursor() as cursor:
                cursor.execute("SELECT with_check FROM pg_policies WHERE policyname = 'tokens_swaporder_insert'")
                self.assertIn("false", cursor.fetchone()[0])
        finally:
            with connection.schema_editor() as editor:
                install_tables(editor, ["tokens_swaporder"])
