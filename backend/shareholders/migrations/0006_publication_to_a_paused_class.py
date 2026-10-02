import importlib

from django.conf import settings
from django.db import migrations

DEPLOYED = "AND listed.status = 'deployed' AND length(listed.contract_address) > 0"
ON_CHAIN = "AND listed.status IN ('deployed', 'paused') AND length(listed.contract_address) > 0"
REFUSAL = "A publication requires a deployed share class, its opened register head"
ON_CHAIN_REFUSAL = "A publication requires a share class on chain, deployed or paused, its opened register head"


def _publication_guard():
    sql = importlib.import_module("shareholders.migrations.0001_publications").GUARDS
    start = sql.index("CREATE FUNCTION shareholders_guard_publication()")
    return sql[start : sql.index("$$;", start) + 3].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


def _admitting_a_paused_class(sql):
    if sql.count(DEPLOYED) != 1 or sql.count(REFUSAL) != 1:
        raise RuntimeError("The publication guard no longer has the shape this migration extends.")
    return sql.replace(DEPLOYED, ON_CHAIN).replace(REFUSAL, ON_CHAIN_REFUSAL)


DEPLOYED_ONLY = _publication_guard()
DEPLOYED_OR_PAUSED = _admitting_a_paused_class(DEPLOYED_ONLY)


def _install(sql):
    def install(apps, schema_editor):
        if schema_editor.connection.vendor != "postgresql":
            return
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(sql, {"app": settings.RLS_ROLES["app"]})

    return install


class Migration(migrations.Migration):

    dependencies = [
        ("shareholders", "0005_publication_event_preimage"),
    ]

    operations = [
        migrations.RunPython(_install(DEPLOYED_OR_PAUSED), _install(DEPLOYED_ONLY)),
    ]
