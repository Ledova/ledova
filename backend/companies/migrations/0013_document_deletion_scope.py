from django.db import migrations, models

from companies.disposal_guards import install


class Migration(migrations.Migration):
    dependencies = [("companies", "0012_pending_deletion_scopes")]

    operations = [
        migrations.AlterField(
            model_name="companydisposal",
            name="scope",
            field=models.CharField(
                choices=[
                    ("company", "Company"),
                    ("share_class", "Share class"),
                    ("proposal", "Pending proposal"),
                    ("invitation", "Pending invitation"),
                    ("document", "Shareholder document"),
                ],
                default="company",
                max_length=20,
            ),
        ),
        migrations.RemoveConstraint(model_name="companydisposal", name="company_disposal_scope_known"),
        migrations.AddConstraint(
            model_name="companydisposal",
            constraint=models.CheckConstraint(
                condition=models.Q(("scope__in", ["company", "share_class", "proposal", "invitation", "document"])),
                name="company_disposal_scope_known",
            ),
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
