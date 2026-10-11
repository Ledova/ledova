import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("documents", "0001_initial"),
        ("users", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="classification",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="supporting_documents",
                to="users.investorclassification",
            ),
        ),
        migrations.AddField(
            model_name="document",
            name="uploaded_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="documents", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="documentextraction",
            name="document",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="extractions", to="documents.document"
            ),
        ),
        migrations.AddIndex(
            model_name="document",
            index=models.Index(fields=["uploaded_by", "document_type"], name="documents_uploade_f4c69d_idx"),
        ),
        migrations.AddIndex(
            model_name="documentextraction",
            index=models.Index(fields=["document", "status"], name="document_ex_documen_effc26_idx"),
        ),
    ]
