from uuid import uuid4

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from tokens import database_guards, database_mirror_guards
from tokens.constants import REGISTER_IMPORT_ADDRESS_LENGTH
from tokens.database_mirror_guards import _function
from users import database_guards as users_guards

REPLACED = (
    (database_guards.SQL, "tokens_guard_register_particulars_change"),
    (database_guards.SQL, "tokens_check_register_particulars_edit"),
    (database_guards.ALLOTMENT_SQL, "tokens_guard_register_member_particulars"),
    (database_mirror_guards.SQL, "tokens_validate_mirror_import"),
    (users_guards.SQL, "users_guard_provider_identity"),
)

LINKED = """
    SELECT association.uuid, association.company_id, association.member, association.user_id,
        profile.full_name, profile.residential_address, held.name, held.residential_address
    FROM tokens_memberassociation association
    JOIN users_userprofile profile ON profile.user_id = association.user_id
    JOIN tokens_registermemberparticulars held ON held.member_id = association.member
    WHERE association.current AND tokens_member_association_current(association.uuid, association.user_id)
        AND held.as_at <= (clock_timestamp() AT TIME ZONE 'UTC')::date
    ORDER BY association.company_id, association.uuid
"""

COMMAND = (
    "SELECT set_config('app.user_id', %s, true), set_config('app.company_operation', %s, true), "
    "set_config('app.company_id', %s, true)"
)

CHANGE = """
    INSERT INTO tokens_registerparticularschange (uuid, created_at, updated_at, company_id, member_id, name,
        residential_address, as_at, reason, supporting_evidence_id, evidence_fingerprint, evidence_snapshot, file,
        previous_particulars, preparing_appointment_id, member_association_id, submitted_by_id, status,
        reviewed_by_id, reviewed_at, rejection_reason)
    VALUES (%s, now(), now(), %s, %s, %s, %s, (clock_timestamp() AT TIME ZONE 'UTC')::date, '', NULL, '',
        '{}'::jsonb, '', NULL, NULL, %s, %s, 'applied', %s, NULL, '')
"""

HELD = """
    UPDATE tokens_registermemberparticulars SET name = %s, residential_address = %s,
        as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date, source_import_id = NULL, source_grant_id = NULL,
        source_allotment_id = NULL, source_transfer_id = NULL, source_award_id = NULL,
        source_registration_id = NULL, source_change_id = %s, updated_at = now()
    WHERE member_id = %s
"""


def install_profile_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for source, name in REPLACED:
            cursor.execute(
                _function(source, name)
                .replace("__OPERATOR__", operator)
                .replace("__MIGRATE__", migrate)
                .replace("__APP__", app)
                .replace("@APP_ROLE@", app)
            )


def _provided(value, kept, limit=None):
    if not isinstance(value, str) or not value.strip() or (limit is not None and len(value) > limit):
        return kept
    return value


def follow_linked_profiles(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(LINKED)
        for association, company, member, user, full_name, address, held_name, held_address in cursor.fetchall():
            name = _provided(full_name, held_name)
            residence = _provided(address, held_address, REGISTER_IMPORT_ADDRESS_LENGTH)
            if (name, residence) == (held_name, held_address):
                continue
            change = uuid4()
            cursor.execute(COMMAND, [str(user), "member_particulars_profile", str(company)])
            cursor.execute(CHANGE, [change, company, member, name, residence, association, user, user])
            cursor.execute(HELD, [name, residence, change, member])
        cursor.execute(COMMAND, ["", "", ""])
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0006_remove_trading_eligibility"),
        ("users", "0003_remove_investor_eligibility"),
    ]

    operations = [
        migrations.AddField(
            model_name="registerparticularschange",
            name="member_association",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.memberassociation",
            ),
        ),
        migrations.AlterField(
            model_name="registerparticularschange",
            name="preparing_appointment",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerparticularschange",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("member_association__isnull", True), ("preparing_appointment__isnull", False)),
                    models.Q(("member_association__isnull", False), ("preparing_appointment__isnull", True)),
                    _connector="OR",
                ),
                name="register_particulars_change_one_source",
            ),
        ),
        migrations.RunPython(install_profile_guards),
        migrations.RunPython(follow_linked_profiles),
    ]
