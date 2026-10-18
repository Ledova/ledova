import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tokens", "0009_award_entitlement_records")]

    operations = [
        migrations.AlterField(
            model_name="registeracknowledgement",
            name="appointment",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AlterField(
            model_name="registeracknowledgement",
            name="idempotency_key",
            field=models.UUIDField(editable=False),
        ),
        migrations.RemoveConstraint(
            model_name="registeracknowledgement",
            name="register_acknowledgement_exact_provenance",
        ),
    ]
