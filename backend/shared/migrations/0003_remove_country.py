from django.db import migrations


def remove_country_content_type(apps, schema_editor):
    apps.get_model("contenttypes", "ContentType").objects.using(schema_editor.connection.alias).filter(
        app_label="shared", model="country"
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("contenttypes", "0002_remove_content_type_name"),
        ("shared", "0002_database_guards"),
        ("users", "0007_remove_account_profile_details"),
    ]

    operations = [
        migrations.RunPython(remove_country_content_type, migrations.RunPython.noop),
        migrations.DeleteModel(
            name="Country",
        ),
    ]
