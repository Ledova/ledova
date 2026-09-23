from django.db import migrations, models

BACKFILL = """
ALTER TABLE shareholders_publication DISABLE TRIGGER shareholders_publication_is_frozen;
UPDATE shareholders_publication AS published
   SET company_name = issuer.name, token_name = listed.name, token_symbol = listed.symbol
  FROM tokens_sharetoken AS listed
  JOIN companies_company AS issuer ON issuer.uuid = listed.company_id
 WHERE listed.uuid = published.token_id;
ALTER TABLE shareholders_publication ENABLE TRIGGER shareholders_publication_is_frozen;
"""


class Migration(migrations.Migration):

    dependencies = [("shareholders", "0001_publications")]

    operations = [
        migrations.AddField(
            model_name="publication",
            name="company_name",
            field=models.CharField(default="", editable=False, max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="publication",
            name="token_name",
            field=models.CharField(default="", editable=False, max_length=100),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="publication",
            name="token_symbol",
            field=models.CharField(default="", editable=False, max_length=10),
            preserve_default=False,
        ),
        migrations.RunSQL(sql=BACKFILL, reverse_sql=migrations.RunSQL.noop),
        migrations.AddConstraint(
            model_name="publication",
            constraint=models.CheckConstraint(
                condition=~models.Q(company_name__regex="^\\s*$")
                & ~models.Q(token_name__regex="^\\s*$")
                & ~models.Q(token_symbol__regex="^\\s*$"),
                name="publication_names_the_company_and_the_class",
            ),
        ),
    ]
