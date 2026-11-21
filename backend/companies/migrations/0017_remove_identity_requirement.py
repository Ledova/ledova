from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [("companies", "0016_terms_2026_11_21")]

    operations = [migrations.RemoveField(model_name="companyactivation", name="issuer_identity_required")]
