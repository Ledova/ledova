from django.core.management.base import CommandError
from django.db import migrations

TABLES = (
    ("Publication", "publication", "publications"),
    ("PublicationRecipient", "roll row", "roll rows"),
    ("PublicationEvent", "event", "events"),
    ("PublicationRead", "read record", "read records"),
)

RETAINED = (
    "This database retains {found}. Shareholder publications were removed on 2 November 2026, and this "
    "migration deletes no retained publication: the owner decides what happens to these records before it "
    "runs. Nothing was changed."
)

REMOVED = (
    "DROP TRIGGER IF EXISTS shareholders_distribution_adds_up ON shareholders_publication",
    "DROP TRIGGER IF EXISTS shareholders_publication_is_frozen ON shareholders_publication",
    "DROP TRIGGER IF EXISTS shareholders_publication_event_chain ON shareholders_publicationevent",
    "DROP TRIGGER IF EXISTS shareholders_publication_roll_is_frozen ON shareholders_publicationrecipient",
    "DROP FUNCTION IF EXISTS shareholders_distribution_adds_up()",
    "DROP FUNCTION IF EXISTS shareholders_guard_publication()",
    "DROP FUNCTION IF EXISTS shareholders_guard_publication_event()",
    "DROP FUNCTION IF EXISTS shareholders_guard_publication_recipient()",
    "DROP FUNCTION IF EXISTS shareholders_publication_event_hash(shareholders_publicationevent)",
    "DROP FUNCTION IF EXISTS shareholders_publication_event_preimage(shareholders_publicationevent)",
    *(
        f"DROP POLICY IF EXISTS {table}_{command} ON {table}"
        for table in ("shareholders_publication", "shareholders_publicationrecipient", "shareholders_publicationevent")
        for command in ("read", "insert", "update", "delete")
    ),
)


def remove_publications(apps, schema_editor):
    alias = schema_editor.connection.alias
    postgresql = schema_editor.connection.vendor == "postgresql"
    if postgresql:
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET LOCAL row_security = off")
    counted = [
        (apps.get_model("shareholders", model).objects.using(alias).count(), one, many) for model, one, many in TABLES
    ]
    found = [f"{count} {one if count == 1 else many}" for count, one, many in counted if count]
    if found:
        listed = found[0] if len(found) == 1 else f"{', '.join(found[:-1])} and {found[-1]}"
        raise CommandError(RETAINED.format(found=listed))
    if not postgresql:
        return
    with schema_editor.connection.cursor() as cursor:
        for statement in REMOVED:
            cursor.execute(statement)


class Migration(migrations.Migration):

    dependencies = [
        ("shared", "0002_database_guards"),
        ("shareholders", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(remove_publications),
        migrations.DeleteModel(
            name="PublicationEvent",
        ),
        migrations.DeleteModel(
            name="PublicationRecipient",
        ),
        migrations.DeleteModel(
            name="Publication",
        ),
        migrations.DeleteModel(
            name="PublicationRead",
        ),
    ]
