from django.db import migrations


def record_kyc_results_as_the_mappings_now_do(apps, schema_editor):
    profiles = apps.get_model("users", "UserProfile")._base_manager.using(schema_editor.connection.alias)
    profiles.filter(review_result="").update(review_result=None)
    profiles.filter(verification_status="unused").update(verification_status="init")


class Migration(migrations.Migration):
    dependencies = [("users", "0028_remove_theme_and_selected_portfolio")]

    operations = [migrations.RunPython(record_kyc_results_as_the_mappings_now_do, migrations.RunPython.noop)]
