from django.db import migrations, models

from tokens.database_entry_deletion import install_guards


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0014_person_deletion_scope"),
        ("tokens", "0015_hard_delete_classes"),
    ]

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
                    ("person", "Person"),
                    ("entry", "Register entry"),
                ],
                default="company",
                max_length=20,
            ),
        ),
        migrations.RemoveConstraint(model_name="companydisposal", name="company_disposal_scope_known"),
        migrations.AddConstraint(
            model_name="companydisposal",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("scope__in", ["company", "share_class", "proposal", "invitation", "document", "person", "entry"])
                ),
                name="company_disposal_scope_known",
            ),
        ),
        migrations.RunPython(install_guards, migrations.RunPython.noop),
    ]
