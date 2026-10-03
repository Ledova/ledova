from django.conf import settings
from django.db import migrations


def install_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION users_guard_provider_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user <> %s THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_id_verified OR NEW.verified_at IS NOT NULL OR NEW.review_result IS NOT NULL
            OR NEW.verification_status IS NOT NULL OR NEW.rejection_labels IS NOT NULL
            OR NEW.kyc_provider IS DISTINCT FROM 'kycaid' OR NEW.kycaid_applicant_id IS NOT NULL
            OR NEW.sumsub_applicant_id IS NOT NULL OR NEW.sumsub_verification_status IS NOT NULL
        THEN
            RAISE EXCEPTION 'Provider identity results are recorded by the bounded verification service'
                USING ERRCODE = '23514';
        END IF;
    ELSIF ROW(NEW.is_id_verified, NEW.verified_at, NEW.review_result, NEW.verification_status,
        NEW.rejection_labels, NEW.kyc_provider, NEW.kycaid_applicant_id, NEW.sumsub_applicant_id,
        NEW.sumsub_verification_status) IS DISTINCT FROM ROW(OLD.is_id_verified, OLD.verified_at,
        OLD.review_result, OLD.verification_status, OLD.rejection_labels, OLD.kyc_provider,
        OLD.kycaid_applicant_id, OLD.sumsub_applicant_id, OLD.sumsub_verification_status)
    THEN
        RAISE EXCEPTION 'Provider identity results are recorded by the bounded verification service'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER users_provider_identity BEFORE INSERT OR UPDATE ON users_userprofile
FOR EACH ROW EXECUTE FUNCTION users_guard_provider_identity();
CREATE FUNCTION operators_guard_issuer_identity_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = %s AND (TG_OP = 'DELETE' OR NEW.issuer_kyc_required IS DISTINCT FROM OLD.issuer_kyc_required) THEN
        RAISE EXCEPTION 'Only platform configuration can change the required issuer identity policy'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER operators_issuer_identity_policy BEFORE UPDATE OR DELETE ON operators_operator
FOR EACH ROW EXECUTE FUNCTION operators_guard_issuer_identity_policy();
""",
            [settings.RLS_ROLES["app"], settings.RLS_ROLES["app"]],
        )


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP TRIGGER operators_issuer_identity_policy ON operators_operator")
        cursor.execute("DROP FUNCTION operators_guard_issuer_identity_policy()")
        cursor.execute("DROP TRIGGER users_provider_identity ON users_userprofile")
        cursor.execute("DROP FUNCTION users_guard_provider_identity()")


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0030_join_activation_and_kyc_results"),
        ("operators", "0002_remove_operator_deployment_mode"),
    ]

    operations = [migrations.RunPython(install_guards, remove_guards)]
