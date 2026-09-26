from django.db import migrations, models

BACKFILL = """
UPDATE offerings_subscription AS application
   SET company_name = COALESCE(NULLIF(issuer.trading_name, ''), issuer.name),
       token_name = listed.name, token_symbol = listed.symbol, currency = offering.price_currency
  FROM offerings_offering AS offering
  JOIN tokens_sharetoken AS listed ON listed.uuid = offering.token_id
  JOIN companies_company AS issuer ON issuer.uuid = listed.company_id
 WHERE offering.uuid = application.offering_id;
"""

RETAIN_UNCHANGED_HIDDEN_PARENT = """
CREATE OR REPLACE FUNCTION offerings_subscription_company_is_derived() RETURNS trigger AS $derive$
DECLARE
    parent_company_id offerings_offering.company_id%TYPE;
BEGIN
    SELECT parent.company_id INTO parent_company_id
    FROM offerings_offering AS parent
    WHERE parent.uuid = NEW.offering_id;

    IF parent_company_id IS NULL AND TG_OP = 'UPDATE'
       AND OLD.company_id IS NOT NULL
       AND NEW.offering_id IS NOT DISTINCT FROM OLD.offering_id
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
        RETURN NEW;
    END IF;

    IF parent_company_id IS NULL THEN
        RAISE EXCEPTION 'offerings_subscription.company_id cannot be derived: offering_id % has no company', NEW.offering_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.offering_id IS DISTINCT FROM OLD.offering_id
           AND parent_company_id IS DISTINCT FROM OLD.company_id THEN
            RAISE EXCEPTION 'offerings_subscription.offering_id cannot move this row to another company, from % to %',
                OLD.company_id, parent_company_id;
        END IF;

        IF NEW.company_id IS NULL OR NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_subscription.company_id cannot be moved to %: offering_id % names %',
                NEW.company_id, NEW.offering_id, parent_company_id;
        END IF;
    ELSE
        IF NEW.company_id IS NULL THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_subscription.company_id % does not match its parent %', NEW.company_id, parent_company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$derive$ LANGUAGE plpgsql;
"""

REQUIRE_VISIBLE_PARENT = """
CREATE OR REPLACE FUNCTION offerings_subscription_company_is_derived() RETURNS trigger AS $derive$
DECLARE
    parent_company_id offerings_offering.company_id%TYPE;
BEGIN
    SELECT parent.company_id INTO parent_company_id
    FROM offerings_offering AS parent
    WHERE parent.uuid = NEW.offering_id;

    IF parent_company_id IS NULL THEN
        RAISE EXCEPTION 'offerings_subscription.company_id cannot be derived: offering_id % has no company', NEW.offering_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.offering_id IS DISTINCT FROM OLD.offering_id
           AND parent_company_id IS DISTINCT FROM OLD.company_id THEN
            RAISE EXCEPTION 'offerings_subscription.offering_id cannot move this row to another company, from % to %',
                OLD.company_id, parent_company_id;
        END IF;

        IF NEW.company_id IS NULL OR NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_subscription.company_id cannot be moved to %: offering_id % names %',
                NEW.company_id, NEW.offering_id, parent_company_id;
        END IF;
    ELSE
        IF NEW.company_id IS NULL THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_subscription.company_id % does not match its parent %', NEW.company_id, parent_company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$derive$ LANGUAGE plpgsql;
"""


class Migration(migrations.Migration):

    dependencies = [("offerings", "0007_subscription_step_times")]

    operations = [
        migrations.AddField(
            model_name="subscription",
            name="company_name",
            field=models.CharField(default="", editable=False, max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="subscription",
            name="token_name",
            field=models.CharField(default="", editable=False, max_length=100),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="subscription",
            name="token_symbol",
            field=models.CharField(default="", editable=False, max_length=10),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="subscription",
            name="currency",
            field=models.CharField(default="", editable=False, max_length=16),
            preserve_default=False,
        ),
        migrations.RunSQL(BACKFILL, reverse_sql=migrations.RunSQL.noop),
        migrations.RunSQL(RETAIN_UNCHANGED_HIDDEN_PARENT, reverse_sql=REQUIRE_VISIBLE_PARENT),
    ]
