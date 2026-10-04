import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

INVITATION_TABLE = "companies_companyteaminvitation"
PRINCIPAL_ANCHOR = "    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;"
INITIAL_EXPIRY = "        OR NEW.expires_at <= statement_timestamp()"
CURRENT_INITIAL_EXPIRY = "        OR NEW.expires_at <= clock_timestamp()"
INITIAL_LOCKS = """    SELECT * INTO actor FROM authentication_customuser WHERE id = proposal.requester_id FOR UPDATE;
    SELECT * INTO representative FROM users_userprofile WHERE uuid = proposal.requester_profile_id FOR UPDATE;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;"""
CURRENT_INITIAL_LOCKS = """    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = proposal.requester_id FOR UPDATE;
    SELECT * INTO representative FROM users_userprofile WHERE uuid = proposal.requester_profile_id FOR UPDATE;"""
INVITED_BRANCH = """    IF NEW.invitation_id IS NOT NULL THEN
        PERFORM companies_validate_invited_appointment(NEW);
        RETURN NEW;
    END IF;
"""
REVOCATION_PROPOSAL_DECLARATION = "    proposal companies_companyauthorityrequest;\n"
REVOCATION_PROPOSAL_READ = (
    "    SELECT * INTO proposal FROM companies_companyauthorityrequest "
    "WHERE uuid = appointment.request_id FOR SHARE;\n"
)
REVOCATION_SELF = "        OR appointment.uuid IS NULL OR proposal.requester_id IS DISTINCT FROM actor.id"
REVOCATION_AUTHORITY = """        OR appointment.uuid IS NULL
        OR (appointment.appointee_id IS DISTINCT FROM actor.id AND NOT EXISTS (
            SELECT 1 FROM companies_companyappointment administrator
            WHERE administrator.company_id = appointment.company_id AND administrator.appointee_id = actor.id
              AND administrator.capabilities @> '["admin"]'::jsonb
              AND companies_current_team_appointment(administrator.uuid, appointment.company_id)))"""
REVOCATION_COMPANY_LOCK = """    PERFORM 1 FROM companies_company
        WHERE uuid = (SELECT company_id FROM companies_companyappointment WHERE uuid = NEW.appointment_id) FOR UPDATE;
"""


def replace_once(body, old, new):
    if body.count(old) != 1:
        raise RuntimeError("The appointment guard no longer has the exact clause this migration changes.")
    return body.replace(old, new)


def install_guards(apps, schema_editor):
    from importlib import import_module

    from shared.db.policy_sql import install_tables

    declaration = import_module("companies.migrations.0015_self_declared_company_appointments").DECLARATION
    install_tables(schema_editor, (INVITATION_TABLE,))
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION companies_current_team_appointment(source_id uuid, issuer_id uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    appointment companies_companyappointment;
    actor authentication_customuser;
    profile users_userprofile;
    requires_identity boolean;
BEGIN
    SELECT * INTO appointment FROM companies_companyappointment
        WHERE uuid = source_id AND company_id = issuer_id FOR SHARE;
    IF appointment.uuid IS NULL THEN RETURN false; END IF;
    SELECT * INTO actor FROM authentication_customuser WHERE id = appointment.appointee_id FOR SHARE;
    SELECT * INTO profile FROM users_userprofile WHERE uuid = appointment.appointee_profile_id FOR SHARE;
    SELECT issuer_kyc_required INTO requires_identity FROM operators_operator WHERE id = 1 FOR SHARE;
    RETURN actor.id IS NOT NULL AND actor.is_active AND actor.is_email_verified
        AND profile.user_id IS NOT DISTINCT FROM actor.id
        AND (NOT COALESCE(requires_identity, false) OR profile.is_id_verified)
        AND (appointment.expires_at IS NULL OR appointment.expires_at > clock_timestamp())
        AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation WHERE appointment_id = appointment.uuid);
END;
$$;
CREATE FUNCTION companies_guard_team_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    source companies_companyappointment;
    issuer companies_company;
    personal jsonb;
    delegated jsonb;
    principal bigint;
    current_source boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company team invitations' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO source FROM companies_companyappointment WHERE uuid = NEW.inviter_appointment_id FOR SHARE;
    current_source := companies_current_team_appointment(source.uuid, issuer.uuid);
    IF current_user = %s OR principal IS DISTINCT FROM NEW.inviter_id
        OR issuer.uuid IS NULL OR NEW.company_name IS DISTINCT FROM issuer.name
        OR source.appointee_id IS DISTINCT FROM NEW.inviter_id OR source.company_id IS DISTINCT FROM NEW.company_id
        OR NOT current_source OR source.expires_at <= clock_timestamp()
        OR NEW.acceptance_deadline <= clock_timestamp()
        OR NEW.acceptance_deadline > clock_timestamp() + interval '30 days'
        OR NEW.appointment_expires_at <= clock_timestamp()
        OR NEW.code_sha256 !~ '^[0-9a-f]{64}$'
        OR jsonb_typeof(NEW.capabilities) IS DISTINCT FROM 'array'
        OR jsonb_typeof(NEW.delegatable_capabilities) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION 'Invitation requires the exact current company appointee and delegation scope'
            USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO personal
        FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.capabilities)) scope;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO delegated
        FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.delegatable_capabilities)) scope;
    IF NEW.capabilities IS DISTINCT FROM personal OR NEW.delegatable_capabilities IS DISTINCT FROM delegated
        OR jsonb_array_length(personal) + jsonb_array_length(delegated) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(personal || delegated) scope(value)
            WHERE value NOT IN ('admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'))
        OR NOT source.delegatable_capabilities @> personal OR NOT source.delegatable_capabilities @> delegated
        OR ((personal || delegated) @> '["admin"]'::jsonb AND NOT EXISTS (
            SELECT 1 FROM companies_companyappointment administrator
            WHERE administrator.company_id = issuer.uuid AND administrator.appointee_id = NEW.inviter_id
              AND administrator.capabilities @> '["admin"]'::jsonb
              AND companies_current_team_appointment(administrator.uuid, issuer.uuid)))
    THEN
        RAISE EXCEPTION 'Invitation requires canonical capabilities within current company delegation'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_team_invitation_identity BEFORE INSERT OR UPDATE OR DELETE
ON companies_companyteaminvitation FOR EACH ROW EXECUTE FUNCTION companies_guard_team_invitation();
CREATE FUNCTION companies_validate_invited_appointment(candidate companies_companyappointment)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    invitation companies_companyteaminvitation;
    source companies_companyappointment;
    actor authentication_customuser;
    profile users_userprofile;
    requires_identity boolean;
    principal bigint;
    current_source boolean;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = candidate.company_id FOR UPDATE;
    SELECT * INTO invitation FROM companies_companyteaminvitation WHERE uuid = candidate.invitation_id FOR UPDATE;
    PERFORM 1 FROM authentication_customuser WHERE id IN (candidate.appointee_id, invitation.inviter_id)
        ORDER BY id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = candidate.appointee_id;
    SELECT * INTO profile FROM users_userprofile WHERE uuid = candidate.appointee_profile_id FOR UPDATE;
    SELECT * INTO source FROM companies_companyappointment WHERE uuid = invitation.inviter_appointment_id FOR SHARE;
    SELECT issuer_kyc_required INTO requires_identity FROM operators_operator WHERE id = 1 FOR SHARE;
    current_source := companies_current_team_appointment(source.uuid, candidate.company_id);
    IF current_user = %s OR principal IS DISTINCT FROM actor.id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR profile.user_id IS DISTINCT FROM actor.id
        OR COALESCE(requires_identity, false) AND NOT profile.is_id_verified
        OR candidate.request_id IS NOT NULL OR candidate.registry_check_id IS NOT NULL
        OR invitation.uuid IS NULL OR invitation.company_id IS DISTINCT FROM candidate.company_id
        OR invitation.acceptance_deadline <= clock_timestamp()
        OR invitation.appointment_expires_at <= clock_timestamp()
        OR encode(sha256(convert_to(COALESCE(current_setting('app.team_invitation_code', true), ''), 'UTF8')), 'hex')
            IS DISTINCT FROM invitation.code_sha256
        OR source.appointee_id IS DISTINCT FROM invitation.inviter_id
        OR source.company_id IS DISTINCT FROM candidate.company_id
        OR NOT current_source OR source.expires_at <= clock_timestamp()
        OR NOT source.delegatable_capabilities @> invitation.capabilities
        OR NOT source.delegatable_capabilities @> invitation.delegatable_capabilities
        OR ((invitation.capabilities || invitation.delegatable_capabilities) @> '["admin"]'::jsonb AND NOT EXISTS (
            SELECT 1 FROM companies_companyappointment administrator
            WHERE administrator.company_id = candidate.company_id AND administrator.appointee_id = invitation.inviter_id
              AND administrator.capabilities @> '["admin"]'::jsonb
              AND companies_current_team_appointment(administrator.uuid, candidate.company_id)))
        OR candidate.capabilities IS DISTINCT FROM invitation.capabilities
        OR candidate.delegatable_capabilities IS DISTINCT FROM invitation.delegatable_capabilities
        OR candidate.expires_at IS DISTINCT FROM invitation.appointment_expires_at
        OR candidate.declaration_version IS DISTINCT FROM '2026-10-04' OR candidate.declaration_text IS DISTINCT FROM %s
    THEN
        RAISE EXCEPTION 'Appointment requires the exact current invitation, appointee, code and declaration'
            USING ERRCODE = '23514';
    END IF;
END;
$$;
""",
            [settings.RLS_ROLES["app"], settings.RLS_ROLES["app"], declaration],
        )
        cursor.execute("SELECT pg_get_functiondef('companies_guard_initial_appointment'::regproc)")
        guard = replace_once(cursor.fetchone()[0], INITIAL_EXPIRY, CURRENT_INITIAL_EXPIRY)
        guard = replace_once(guard, INITIAL_LOCKS, CURRENT_INITIAL_LOCKS)
        cursor.execute(replace_once(guard, PRINCIPAL_ANCHOR, INVITED_BRANCH + PRINCIPAL_ANCHOR))
        cursor.execute("SELECT pg_get_functiondef('companies_guard_appointment_revocation'::regproc)")
        guard = cursor.fetchone()[0]
        guard = replace_once(guard, REVOCATION_PROPOSAL_DECLARATION, "")
        guard = replace_once(guard, REVOCATION_PROPOSAL_READ, "")
        guard = replace_once(guard, REVOCATION_SELF, REVOCATION_AUTHORITY)
        guard = replace_once(guard, PRINCIPAL_ANCHOR, PRINCIPAL_ANCHOR + "\n" + REVOCATION_COMPANY_LOCK)
        cursor.execute(guard)
        for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
            cursor.execute("SELECT quote_ident(%s)", [role])
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {INVITATION_TABLE} TO {cursor.fetchone()[0]}")


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE companies_companyteaminvitation, companies_companyappointment, "
            "companies_companyappointmentrevocation IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute("SELECT EXISTS (SELECT 1 FROM companies_companyteaminvitation)")
        if cursor.fetchone()[0]:
            raise RuntimeError(
                "Retain company team invitations and appointments; downgrade would discard authority history."
            )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation revoked "
            "JOIN companies_companyappointment appointment ON appointment.uuid = revoked.appointment_id "
            "WHERE revoked.revoked_by_id IS DISTINCT FROM appointment.appointee_id)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company administrator revocations; downgrade would discard their authority.")
        cursor.execute("SELECT pg_get_functiondef('companies_guard_initial_appointment'::regproc)")
        guard = replace_once(cursor.fetchone()[0], CURRENT_INITIAL_EXPIRY, INITIAL_EXPIRY)
        guard = replace_once(guard, CURRENT_INITIAL_LOCKS, INITIAL_LOCKS)
        cursor.execute(replace_once(guard, INVITED_BRANCH, ""))
        cursor.execute("SELECT pg_get_functiondef('companies_guard_appointment_revocation'::regproc)")
        guard = cursor.fetchone()[0]
        guard = replace_once(guard, REVOCATION_AUTHORITY, REVOCATION_SELF)
        guard = replace_once(guard, PRINCIPAL_ANCHOR + "\n" + REVOCATION_COMPANY_LOCK, PRINCIPAL_ANCHOR)
        guard = replace_once(
            guard,
            "    appointment companies_companyappointment;\n",
            "    appointment companies_companyappointment;\n" + REVOCATION_PROPOSAL_DECLARATION,
        )
        anchor = "    SELECT * INTO appointment FROM companies_companyappointment WHERE uuid = NEW.appointment_id FOR UPDATE;\n"
        guard = replace_once(guard, anchor, anchor + REVOCATION_PROPOSAL_READ)
        cursor.execute(guard)
        cursor.execute("DROP TRIGGER companies_team_invitation_identity ON companies_companyteaminvitation")
        cursor.execute("DROP FUNCTION companies_guard_team_invitation()")
        cursor.execute("DROP FUNCTION companies_validate_invited_appointment(companies_companyappointment)")
        cursor.execute("DROP FUNCTION companies_current_team_appointment(uuid, uuid)")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0016_appointee_keyed_appointments"),
        ("users", "0031_protected_identity_results"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="companyappointment",
            name="registry_check",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyregistrycheck",
            ),
        ),
        migrations.AlterField(
            model_name="companyappointment",
            name="request",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="appointment",
                to="companies.companyauthorityrequest",
            ),
        ),
        migrations.CreateModel(
            name="CompanyTeamInvitation",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("company_name", models.CharField(editable=False, max_length=255)),
                ("idempotency_key", models.UUIDField()),
                ("capabilities", models.JSONField(editable=False)),
                ("delegatable_capabilities", models.JSONField(editable=False)),
                ("acceptance_deadline", models.DateTimeField(editable=False)),
                ("appointment_expires_at", models.DateTimeField(editable=False, null=True)),
                ("code_sha256", models.CharField(editable=False, max_length=64, unique=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="team_invitations",
                        to="companies.company",
                    ),
                ),
                (
                    "inviter",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "inviter_appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="invitation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="appointment",
                to="companies.companyteaminvitation",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("invitation__isnull", True), ("registry_check__isnull", False), ("request__isnull", False)
                    ),
                    models.Q(
                        ("invitation__isnull", False), ("registry_check__isnull", True), ("request__isnull", True)
                    ),
                    _connector="OR",
                ),
                name="companies_appointment_exact_source",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyteaminvitation",
            constraint=models.UniqueConstraint(
                fields=("inviter", "idempotency_key"), name="companies_team_invitation_key"
            ),
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
