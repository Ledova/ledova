from unittest import skipUnless

from django.conf import settings
from django.db import connection, transaction
from django.db.utils import ProgrammingError
from django.test import TestCase

from shared.db.policies import INSERT_ONLY_REASONS, INSERTABLE, POLICIES
from shared.db.principal import PRINCIPAL_SETTING
from shared.tests.tenants import a_profile
from users.models import UserAccount

POSTGRES = connection.vendor == "postgresql"
REASON = "row-level security exists only in PostgreSQL, and on SQLite every write here would be allowed"


class TheCatalogueKeepsTheOverrideHonestTest(TestCase):

    def test_every_insert_only_term_is_a_table_the_catalogue_carries(self):
        self.assertEqual(sorted(set(INSERTABLE) - set(POLICIES)), [])

    def test_every_insert_only_term_states_why_it_differs_from_the_writable_one(self):
        for table in INSERTABLE:
            with self.subTest(table=table):
                self.assertGreater(len(INSERT_ONLY_REASONS.get(table, "")), 200)

    def test_an_override_that_matched_its_writable_term_would_be_pointless(self):
        for table, term in INSERTABLE.items():
            with self.subTest(table=table):
                self.assertNotEqual(term, POLICIES[table][1])


@skipUnless(POSTGRES, REASON)
class AnAccountIsInsertedForItsOwnPersonOnlyTest(TestCase):

    @classmethod
    def setUpTestData(cls):
        cls.profile = a_profile("unaccounted")
        cls.stranger = a_profile("stranger")

    def as_the_app_role_for(self, user):
        self.addCleanup(self.back_to_the_owner)
        with connection.cursor() as cursor:
            cursor.execute(f"SET ROLE {settings.RLS_ROLES['app']}")
            cursor.execute("SELECT set_config(%s, %s, false)", [PRINCIPAL_SETTING, str(user.pk)])

    def back_to_the_owner(self):
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
            cursor.execute("SELECT set_config(%s, NULL, false)", [PRINCIPAL_SETTING])

    def test_a_principal_creates_the_account_that_names_its_own_profile(self):
        self.as_the_app_role_for(self.profile.user)

        account = UserAccount.objects.create(account_number="ACC-OWNED", user_profile=self.profile)

        self.assertIn(account, UserAccount.objects.all())

    def test_a_principal_cannot_create_an_account_for_somebody_else(self):
        self.as_the_app_role_for(self.stranger.user)

        with self.assertRaises(ProgrammingError) as refused, transaction.atomic():
            UserAccount.objects.create(account_number="ACC-STRANGER", user_profile=self.profile)

        self.assertIn("row-level security policy", str(refused.exception))

    def test_no_policy_carries_a_director_term(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') FROM pg_policies "
                "WHERE tablename = 'customer_accounts_account' ORDER BY policyname"
            )
            installed = dict(cursor.fetchall())

        for command in ("read", "insert", "update", "delete"):
            with self.subTest(policy=command):
                self.assertNotIn("director_id", installed[f"customer_accounts_account_{command}"])
