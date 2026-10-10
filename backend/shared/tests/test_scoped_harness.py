from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connections
from rest_framework.test import APITransactionTestCase

from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    PRINCIPAL_SETTING,
    atomic,
    current_alias,
)
from shared.models import Country
from shared.tests.scoped import RunsOnTheScopedConnection

User = get_user_model()


class Planted(Exception):
    pass


@atomic()
def a_decorated_service_that_fails(name):
    Country.objects.create(name=name, code=name[:2].upper())
    raise Planted("after the write, before the commit")


class TheScopedHarnessIsActuallyScopedTest(RunsOnTheScopedConnection, APITransactionTestCase):

    def test_the_ambient_alias_is_the_scoped_one_and_not_the_migrate_one(self):
        self.assertEqual(settings.RLS_AMBIENT_ALIAS, APP_ALIAS)
        self.assertEqual(current_alias(), APP_ALIAS)

    def test_the_queries_really_reach_the_scoped_role(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")

            role, superuser, bypass = cursor.fetchone()
            self.assertEqual(role, settings.RLS_ROLES[APP_ALIAS])
            self.assertNotIn(role, (settings.RLS_ROLES[OPERATOR_ALIAS], settings.RLS_ROLES["migrate"]))
            self.assertFalse(superuser)
            self.assertFalse(bypass)

    def test_without_a_principal_the_same_connection_carries_none(self):
        self.no_principal_is_set()

        with connections[current_alias()].cursor() as cursor:
            cursor.execute(f"SELECT NULLIF(current_setting('{PRINCIPAL_SETTING}', true), '') IS NULL")

            self.assertTrue(cursor.fetchone()[0])


class ADecoratedServiceRollsBackOnTheConnectionItRanOnTest(RunsOnTheScopedConnection, APITransactionTestCase):

    def _attempt(self, name):
        try:
            a_decorated_service_that_fails(name)
        except Planted:
            pass

    def test_the_write_is_gone_when_the_service_ran_as_an_operator(self):
        with self.as_an_operator_would():
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            self._attempt("Rollbackia")

            self.assertFalse(Country.objects.filter(name="Rollbackia").exists())

    def test_the_write_is_gone_on_the_app_alias_too_which_is_the_control(self):
        self.assertEqual(current_alias(), APP_ALIAS)
        self._attempt("Controlia")

        self.assertFalse(Country.objects.filter(name="Controlia").exists())
