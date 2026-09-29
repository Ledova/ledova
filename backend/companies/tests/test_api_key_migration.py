from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection
from django.test import TransactionTestCase

from companies.models import Company
from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import an_acn

BEFORE = [("companies", "0010_company_pack")]
AFTER = [("companies", "0011_remove_company_api_key")]
DROPPED = {"api_key", "api_key_created_at"}


class CompanyApiKeyMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)

    def columns(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'companies_company'")
            return {row[0] for row in cursor.fetchall()}

    def test_the_columns_go_and_a_reversal_issues_every_company_its_own_fresh_key(self):
        owner = get_user_model().objects.create_user(email="keys@migration.example.test", password="pw-12345678")
        names = [f"Keyed {number} Pty Ltd" for number in range(3)]
        for number, name in enumerate(names):
            Company.objects.create(owner=owner, name=name, acn=an_acn(81000000 + number))
        self.assertFalse(DROPPED & self.columns())

        historical = migrate_to(BEFORE).get_model("companies", "Company")
        self.assertTrue(DROPPED <= self.columns())
        keys = dict(historical.objects.values_list("name", "api_key"))
        self.assertEqual(set(keys), set(names))
        self.assertEqual(len(set(keys.values())), len(names))
        for key in keys.values():
            self.assertRegex(key, r"^ledova_[0-9a-f]{56}$")
        self.assertFalse(historical.objects.filter(api_key_created_at__isnull=True).exists())
        with self.assertRaises(IntegrityError), atomic():
            historical.objects.filter(name=names[0]).update(api_key=keys[names[1]])

        migrate_to(AFTER)
        self.assertFalse(DROPPED & self.columns())
        self.assertEqual(sorted(Company.objects.values_list("name", flat=True)), sorted(names))
