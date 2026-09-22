from django.db import migrations


def install_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""
CREATE FUNCTION tokens_guard_register_opening_mapping_values() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF jsonb_typeof(NEW.mapping) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
        WHERE jsonb_typeof(item) = 'object'
        AND (jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
            OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string'))
    THEN
        RAISE EXCEPTION 'Opening submissions require exact current intent and verified company evidence'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_opening_mapping_values
    BEFORE INSERT ON tokens_registeropening
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening_mapping_values();
""")


def remove_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP TRIGGER tokens_register_opening_mapping_values ON tokens_registeropening")
        cursor.execute("DROP FUNCTION tokens_guard_register_opening_mapping_values()")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0068_completion_transaction_index"),
    ]

    operations = [
        migrations.RunPython(install_guard, remove_guard),
    ]
