import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

TABLE = "companies_companyappointment"
BACKFILL = f"""
ALTER TABLE {TABLE} DISABLE TRIGGER companies_initial_appointment_identity;
UPDATE {TABLE} AS appointment
   SET appointee_id = proposal.requester_id, appointee_profile_id = proposal.requester_profile_id
  FROM companies_companyauthorityrequest AS proposal
 WHERE proposal.uuid = appointment.request_id;
ALTER TABLE {TABLE} ENABLE TRIGGER companies_initial_appointment_identity;
"""
APPOINTEE_CHECK = """        OR NEW.appointee_id IS DISTINCT FROM proposal.requester_id
        OR NEW.appointee_profile_id IS DISTINCT FROM proposal.requester_profile_id
"""
ANCHOR = "        OR proposal.company_id IS DISTINCT FROM issuer.uuid"
MISMATCHED = f"""
    SELECT EXISTS (
        SELECT 1 FROM {TABLE} AS appointment
        JOIN companies_companyauthorityrequest AS proposal ON proposal.uuid = appointment.request_id
        WHERE appointment.appointee_id IS DISTINCT FROM proposal.requester_id
           OR appointment.appointee_profile_id IS DISTINCT FROM proposal.requester_profile_id
    )
"""


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, (TABLE,))
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT pg_get_functiondef('companies_guard_initial_appointment'::regproc)")
        guard = cursor.fetchone()[0]
        if guard.count(ANCHOR) != 1:
            raise RuntimeError("The initial appointment guard no longer has the clause this migration extends.")
        cursor.execute(guard.replace(ANCHOR, APPOINTEE_CHECK + ANCHOR))


def remove_guards(apps, schema_editor):
    from shared.db.policies import ADMITTED, PRINCIPAL

    readable = f"request_id IN (SELECT uuid FROM companies_companyauthorityrequest WHERE requester_id = {PRINCIPAL})"
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f"LOCK TABLE {TABLE} IN ACCESS EXCLUSIVE MODE")
        cursor.execute(MISMATCHED)
        if cursor.fetchone()[0]:
            raise RuntimeError(
                "Retain appointments keyed on an appointee other than their request's requester; "
                "downgrade would discard that authority."
            )
        cursor.execute("SELECT pg_get_functiondef('companies_guard_initial_appointment'::regproc)")
        guard = cursor.fetchone()[0]
        if guard.count(APPOINTEE_CHECK) != 1:
            raise RuntimeError(
                "The initial appointment guard no longer has the appointee clause this migration removes."
            )
        cursor.execute(guard.replace(APPOINTEE_CHECK, ""))
        cursor.execute("SELECT policyname FROM pg_policies WHERE tablename = %s", [TABLE])
        for (policy,) in cursor.fetchall():
            if policy in (f"{TABLE}_read", f"{TABLE}_update"):
                cursor.execute(f"ALTER POLICY {policy} ON {TABLE} USING ({ADMITTED} AND ({readable}))")


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0015_self_declared_company_appointments"),
        ("users", "0031_protected_identity_results"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="companyappointment",
            name="appointee",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_appointments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="appointee_profile",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.userprofile",
            ),
        ),
        migrations.RunSQL(sql=BACKFILL, reverse_sql=migrations.RunSQL.noop),
        migrations.AlterField(
            model_name="companyappointment",
            name="appointee",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_appointments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="companyappointment",
            name="appointee_profile",
            field=models.ForeignKey(
                editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
            ),
        ),
        migrations.AlterField(
            model_name="companyappointment",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="appointments", to="companies.company"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("request__isnull", False)),
                fields=("company",),
                name="companies_one_initial_appointment_per_company",
            ),
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
