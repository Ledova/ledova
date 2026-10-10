from contextlib import contextmanager

from django.conf import settings
from django.db import connections

from shared.db import MIGRATE_ALIAS, configured, use_migrate

RESTORE = {"O": "ENABLE", "D": "DISABLE", "R": "ENABLE REPLICA", "A": "ENABLE ALWAYS"}


@contextmanager
def retained_rows(*triggers):
    connection = connections[configured(MIGRATE_ALIAS)]
    if connection.vendor != "postgresql":
        raise AssertionError("Retained SQL history fixtures require PostgreSQL")
    if not connection.settings_dict["NAME"].startswith("test_") or not connection.get_autocommit():
        raise AssertionError("Retained history setup requires an autocommit synthetic test database")
    if not triggers or len(triggers) != len(set(triggers)):
        raise AssertionError("Retained history setup requires distinct explicit trigger pairs")
    selected = set(triggers)
    with use_migrate(), connection.cursor() as cursor:
        cursor.execute("SELECT current_user")
        if cursor.fetchone()[0] != settings.RLS_ROLES["migrate"]:
            raise AssertionError("Retained history setup requires the migration role")
        cursor.execute(
            "SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t "
            "JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY(%s)",
            [sorted({table for table, _ in triggers})],
        )
        states = {(table, name): state for table, name, state in cursor.fetchall() if (table, name) in selected}
        if states.keys() != selected or any(state not in RESTORE for state in states.values()):
            raise AssertionError("Every retained fixture trigger must exist with a known enable state")
        disabled = []
        quote = connection.ops.quote_name
        try:
            for table, name in triggers:
                cursor.execute(f"ALTER TABLE public.{quote(table)} DISABLE TRIGGER {quote(name)}")
                disabled.append((table, name))
            yield
        finally:
            errors = []
            for table, name in reversed(disabled):
                try:
                    cursor.execute(
                        f"ALTER TABLE public.{quote(table)} {RESTORE[states[table, name]]} TRIGGER {quote(name)}"
                    )
                except Exception as error:
                    errors.append(error)
            if errors:
                raise ExceptionGroup("Retained fixture trigger restoration failed", errors)
            cursor.execute(
                "SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t "
                "JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE n.nspname='public' AND NOT t.tgisinternal AND c.relname=ANY(%s)",
                [sorted({table for table, _ in triggers})],
            )
            restored = {(table, name): state for table, name, state in cursor.fetchall() if (table, name) in selected}
            if restored != states:
                raise AssertionError("Retained fixture trigger enable states did not restore exactly")
