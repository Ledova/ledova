import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0012_class_rights_revisions"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="registermemberparticulars",
            name="register_member_particulars_one_source",
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_award",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registeraward",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    models.Q(
                        ("source_allotment__isnull", False),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", False),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
    ]
