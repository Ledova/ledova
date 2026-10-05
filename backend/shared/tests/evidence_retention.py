from contextlib import contextmanager

from django.conf import settings
from django.db import connections

from shared.db import current_alias, use_migrate

RETENTION_FUNCTIONS = (
    ("users_classification_evidence_retention_days", "CLASSIFICATION_EVIDENCE_RETENTION_DAYS"),
    ("users_unattached_document_retention_days", "UNATTACHED_DOCUMENT_RETENTION_DAYS"),
)


@contextmanager
def installed_evidence_retention_policy():
    values = [getattr(settings, setting) for _, setting in RETENTION_FUNCTIONS]
    if any(type(value) is not int or value < 0 for value in values):
        raise ValueError("Fixture retention periods must be nonnegative integers.")
    with use_migrate(), connections[current_alias()].cursor() as cursor:
        previous = []
        for name, _ in RETENTION_FUNCTIONS:
            cursor.execute("SELECT pg_get_functiondef(%s::regprocedure)", [f"public.{name}()"])
            previous.append(cursor.fetchone()[0])
    try:
        with use_migrate(), connections[current_alias()].cursor() as cursor:
            for (name, _), value in zip(RETENTION_FUNCTIONS, values):
                cursor.execute(
                    f"CREATE OR REPLACE FUNCTION {name}() RETURNS integer LANGUAGE sql IMMUTABLE "
                    f"SET search_path = pg_catalog, public AS $$ SELECT {value}; $$"
                )
        yield
    finally:
        with use_migrate(), connections[current_alias()].cursor() as cursor:
            for definition in previous:
                cursor.execute(definition)
