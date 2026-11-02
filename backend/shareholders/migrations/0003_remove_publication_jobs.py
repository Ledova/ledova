from django.db import migrations

TASKS = (
    "shareholders.tasks.publications.purge_publications_past_the_clock",
    "shareholders.tasks.publications.tell_the_members",
    "shareholders.tasks.resolutions.close_resolutions_past_their_window",
)


def remove_jobs(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM procrastinate_jobs WHERE status = 'todo' AND task_name = ANY(%s)", [list(TASKS)]
            )


class Migration(migrations.Migration):

    dependencies = [
        ("shareholders", "0002_remove_publications"),
    ]

    operations = [
        migrations.RunPython(remove_jobs),
    ]
