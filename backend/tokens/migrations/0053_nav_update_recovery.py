import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("blockchain", "0006_signer_admission"),
        ("tokens", "0052_pause_change_guards"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="navupdate",
            name="completed_at",
            field=models.DateTimeField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="navupdate",
            name="event",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="navupdate",
            name="intent",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="navupdate",
            name="mode",
            field=models.CharField(
                choices=[("historical", "Historical"), ("local", "Local only"), ("chain", "On-chain")],
                default="historical",
                editable=False,
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="navupdate",
            name="operation",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="nav_update",
                to="blockchain.outgoingoperation",
            ),
        ),
        migrations.AddField(
            model_name="navupdate",
            name="status",
            field=models.CharField(
                choices=[
                    ("historical", "Historical outcome"),
                    ("queued", "Queued"),
                    ("executing", "Outcome unresolved"),
                    ("confirmed", "Receipt confirmed"),
                    ("applied", "Applied locally"),
                    ("failed", "Refused or failed"),
                ],
                default="historical",
                editable=False,
                max_length=12,
            ),
        ),
        migrations.AddConstraint(
            model_name="navupdate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("completed_at__isnull", True), ("mode__in", ["local", "chain"])),
                fields=("yield_token",),
                name="one_unresolved_nav_per_token",
            ),
        ),
        migrations.AddConstraint(
            model_name="navupdate",
            constraint=models.UniqueConstraint(
                models.F("intent__contract_address"),
                condition=models.Q(("completed_at__isnull", True), ("mode", "chain")),
                name="one_unresolved_nav_per_contract",
            ),
        ),
    ]
