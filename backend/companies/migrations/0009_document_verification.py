from django.conf import settings
from django.db import migrations, models


def install_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION companies_guard_document_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = %s
        AND (NEW.is_verified OR NEW.verified_fingerprint <> ''
            OR NEW.verified_by_id IS NOT NULL OR NEW.verified_at IS NOT NULL)
        AND (TG_OP = 'INSERT' OR ROW(NEW.is_verified, NEW.verified_fingerprint, NEW.verified_by_id, NEW.verified_at)
            IS DISTINCT FROM ROW(OLD.is_verified, OLD.verified_fingerprint, OLD.verified_by_id, OLD.verified_at))
    THEN
        RAISE EXCEPTION 'Only operator review may write document verification' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
        ROW(NEW.company_id, NEW.document_type, NEW.name, NEW.file, NEW.file_size, NEW.mime_type,
            NEW.external_url, NEW.valid_from, NEW.valid_until, NEW.rejection_reason)
        IS DISTINCT FROM ROW(OLD.company_id, OLD.document_type, OLD.name, OLD.file, OLD.file_size, OLD.mime_type,
            OLD.external_url, OLD.valid_from, OLD.valid_until, OLD.rejection_reason)
        OR NOT NEW.is_verified
        OR (NEW.verified_by_id IS NULL AND OLD.verified_by_id IS NOT NULL)
    ) THEN
        NEW.is_verified := false;
        NEW.verified_fingerprint := '';
        NEW.verified_by_id := NULL;
        NEW.verified_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_document_verification BEFORE INSERT OR UPDATE ON companies_companydocument
FOR EACH ROW EXECUTE FUNCTION companies_guard_document_verification();
CREATE FUNCTION companies_revoke_document_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.name, NEW.acn, NEW.abn, NEW.company_type, NEW.owner_id)
        IS DISTINCT FROM ROW(OLD.name, OLD.acn, OLD.abn, OLD.company_type, OLD.owner_id) THEN
        UPDATE companies_companydocument SET is_verified = false, verified_fingerprint = '',
            verified_by_id = NULL, verified_at = NULL
        WHERE company_id = NEW.uuid AND (is_verified OR verified_fingerprint <> ''
            OR verified_by_id IS NOT NULL OR verified_at IS NOT NULL);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_identity_document_verification
AFTER UPDATE OF name, acn, abn, company_type, owner_id ON companies_company
FOR EACH ROW EXECUTE FUNCTION companies_revoke_document_verification();
""",
            [settings.RLS_ROLES["app"]],
        )


def remove_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_company, companies_companydocument IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM companies_companydocument WHERE verified_fingerprint <> '')")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain document verification evidence; downgrade would discard its content binding.")
        cursor.execute("DROP TRIGGER companies_identity_document_verification ON companies_company")
        cursor.execute("DROP FUNCTION companies_revoke_document_verification()")
        cursor.execute("DROP TRIGGER companies_document_verification ON companies_companydocument")
        cursor.execute("DROP FUNCTION companies_guard_document_verification()")


class Migration(migrations.Migration):
    dependencies = [("companies", "0008_company_registry_verification")]

    operations = [
        migrations.AddField(
            model_name="companydocument",
            name="verified_fingerprint",
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
        migrations.RunPython(install_guard, remove_guard),
    ]
