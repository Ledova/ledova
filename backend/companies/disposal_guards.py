from pathlib import Path

from django.conf import settings

from tokens.database_mirror_guards import _function
from tokens.database_mirror_guards import install as install_mirror

GUARDS = {
    "companies/authority_guards.sql": (
        "companies_guard_authority_request",
        "companies_guard_authority_request_withdrawal",
        "companies_guard_initial_appointment",
    ),
    "companies/database_guards.sql": (
        "companies_guard_appointment_revocation",
        "companies_guard_team_invitation",
        "companies_guard_legacy_owner_source",
        "companies_guard_administration",
    ),
    "companies/signup_terms_guards.sql": ("companies_guard_signup_terms_acceptance",),
    "companies/activation_guards.sql": ("companies_guard_activation",),
    "tokens/database_guards.sql": (
        "tokens_guard_register_acknowledgement",
        "tokens_guard_member_cessation",
        "tokens_guard_register_correction",
        "tokens_guard_register_correction_decision",
        "tokens_guard_register_entry",
        "tokens_guard_register_import",
        "tokens_guard_register_import_decision",
        "tokens_guard_register_member",
        "tokens_guard_register_particulars_change",
        "tokens_guard_register_particulars_decision",
        "tokens_guard_register_position",
        "tokens_guard_register_reconciliation",
        "tokens_guard_register_transfer",
        "tokens_guard_share_register",
    ),
    "tokens/database_award_guards.sql": (
        "tokens_guard_employee_award",
        "tokens_guard_employee_award_vesting",
        "tokens_guard_employee_award_adjustment",
        "tokens_guard_register_grant",
        "tokens_guard_register_grant_decision",
    ),
    "tokens/database_allotment_guards.sql": (
        "tokens_guard_allotment_source",
        "tokens_guard_register_allotment",
        "tokens_guard_register_member_particulars",
    ),
    "tokens/database_member_guards.sql": (
        "tokens_guard_member_invitation",
        "tokens_guard_member_association",
        "tokens_guard_member_revocation",
    ),
    "tokens/database_class_documents.sql": (
        "tokens_guard_class_rights_revision",
        "tokens_guard_register_evidence",
    ),
    "tokens/database_member_documents.sql": ("tokens_guard_member_document",),
    "tokens/database_people.sql": ("tokens_guard_person_registration",),
    "tokens/database_allotment_completion.sql": ("tokens_guard_register_allotment_decision",),
    "tokens/database_transfer_completion.sql": ("tokens_guard_register_transfer_decision",),
}


def install(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["migrate"]])
        migrate = cursor.fetchone()[0]
        cursor.execute(Path(__file__).with_suffix(".sql").read_text().replace("@MIGRATE_ROLE@", migrate))
        for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
            cursor.execute("SELECT quote_ident(%s)", [role])
            quoted = cursor.fetchone()[0]
            cursor.execute(f"REVOKE ALL ON FUNCTION companies_disposal_allows(text, uuid) FROM {quoted}")
        cursor.execute("SELECT to_regclass('public.companies_companydisposal') IS NOT NULL")
        if cursor.fetchone()[0]:
            cursor.execute("ALTER TABLE companies_companydisposal ENABLE ROW LEVEL SECURITY")
            cursor.execute("ALTER TABLE companies_companydisposal FORCE ROW LEVEL SECURITY")
            for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
                cursor.execute("SELECT quote_ident(%s)", [role])
                quoted = cursor.fetchone()[0]
                cursor.execute(f"REVOKE ALL ON companies_companydisposal FROM {quoted}")


def install_current_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    install(apps, schema_editor)
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for filename, names in GUARDS.items():
            source = (Path(__file__).parent.parent / filename).read_text()
            for name in names:
                statement = _function(source, name)
                for marker, role in (
                    ("@OPERATOR_ROLE@", operator),
                    ("@MIGRATE_ROLE@", migrate),
                    ("@APP_ROLE@", app),
                    ("__OPERATOR__", operator),
                    ("__MIGRATE__", migrate),
                    ("__APP__", app),
                ):
                    statement = statement.replace(marker, role)
                cursor.execute(statement)
    install_mirror(apps, schema_editor)
