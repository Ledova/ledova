from django.conf import settings

from shared.db.policies import (
    ADMINISTRABLE_COMPANIES,
    ADMITTED,
    AWAITING_RLS,
    BYPASSES_THE_POLICIES,
    DISCOVERABLE_COMPANIES,
    ELIGIBILITY_COMPANIES,
    FRAMEWORK,
    HAS_A_TOKEN_ON_THE_MARKET,
    HELPERS,
    MANAGEABLE_COMPANIES,
    NOT_TENANCY,
    OPEN_TO_INVESTORS,
    POLICIES,
    PRINCIPAL,
    REACHED_DESPITE_OPERATOR_ONLY,
    VISIBLE_COMPANIES,
)

SUFFIXES = ("read", "insert", "update", "delete")

PRE_ADMINISTRATION_POLICIES = {
    "companies_company": (
        f"owner_id = {PRINCIPAL} OR ({OPEN_TO_INVESTORS}) OR {HAS_A_TOKEN_ON_THE_MARKET}",
        f"owner_id = {PRINCIPAL}",
    ),
    "companies_companydocument": (
        f"company_id IN (SELECT {VISIBLE_COMPANIES}())",
        f"company_id IN (SELECT {MANAGEABLE_COMPANIES}())",
    ),
}

OWNER_SUBMITTED = (
    f"company_id IN (SELECT {VISIBLE_COMPANIES}())",
    f"company_id IN (SELECT {MANAGEABLE_COMPANIES}()) AND submitted_by_id = {PRINCIPAL} AND status = 'submitted'",
)

PRE_COMPANY_DECISION_POLICIES = {
    "tokens_registerimport": ("tokens_registerimportdecision", OWNER_SUBMITTED),
    "tokens_registercorrection": ("tokens_registercorrectiondecision", OWNER_SUBMITTED),
}

TABLE_CREATION_AFTER_INITIAL_GRANTS = (
    {
        table: ("tokens", "0062_register_foundation")
        for table in (
            "tokens_registermember",
            "tokens_shareregister",
            "tokens_registerentry",
            "tokens_registerposition",
        )
    }
    | {
        "blockchain_freshsignerbootstrap": ("blockchain", "0008_fresh_signer_bootstrap"),
        "companies_companyauthorityrequest": ("companies", "0012_company_authority_request"),
        "companies_companyauthorityrequestwithdrawal": ("companies", "0013_company_authority_request_withdrawal"),
        "companies_companyappointment": ("companies", "0015_self_declared_company_appointments"),
        "companies_companyappointmentrevocation": ("companies", "0015_self_declared_company_appointments"),
        "companies_companyteaminvitation": ("companies", "0017_company_team_invitations"),
        "companies_companylegacyownersource": ("companies", "0019_legacy_owner_appointments"),
        "users_companyeligibilityrequest": ("users", "0032_company_eligibility_records"),
        "users_companyeligibilitydecision": ("users", "0032_company_eligibility_records"),
        "users_companyeligibilityrequestwithdrawal": ("users", "0032_company_eligibility_records"),
        "users_companyeligibilityrevocation": ("users", "0032_company_eligibility_records"),
        "tokens_registercorrection": ("tokens", "0064_reviewed_register_corrections"),
        "tokens_registermemberwallet": ("tokens", "0065_register_opening"),
        "tokens_registeropening": ("tokens", "0065_register_opening"),
        "tokens_registerwalletlink": ("tokens", "0067_register_wallet_links"),
        "tokens_registerreconciliation": ("tokens", "0070_register_reconciliation"),
        "tokens_registerimport": ("tokens", "0072_register_import"),
        "tokens_registermemberparticulars": ("tokens", "0072_register_import"),
        "tokens_importedformermember": ("tokens", "0072_register_import"),
        "tokens_registerinstruction": ("tokens", "0073_register_instructions"),
        "whitelist_whitelistapproval": ("whitelist", "0007_per_company_approvals"),
    }
    | {
        table: ("shareholders", "0001_publications")
        for table in ("shareholders_publication", "shareholders_publicationrecipient")
    }
    | {"shareholders_publicationevent": ("shareholders", "0003_resolutions")}
)

TERM_COLUMNS_ADDED_AFTER_CREATION = {
    "portfolios": ("user_account_id",),
    "companies_companyappointment": ("appointee_id",),
}

HAS_COLUMNS = """
    SELECT count(*) = cardinality(%s::text[])
      FROM pg_attribute
     WHERE attrelid = %s::regclass AND attname = ANY(%s::text[]) AND NOT attisdropped
"""

NOT_YET_CREATED = (
    "The catalogue says the app role reaches {tables}, and the grant ran before they existed. "
    "Default privileges now deny them, so leaving this silent would take the role's access away "
    "rather than leave it unchanged. Check the creating migration and its grant step."
)


def install(schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    with schema_editor.connection.cursor() as cursor:
        for name, body in HELPERS.items():
            if name == ELIGIBILITY_COMPANIES:
                cursor.execute(
                    "SELECT EXISTS (SELECT 1 FROM django_migrations WHERE app = 'users' "
                    "AND name = '0032_company_eligibility_records')"
                )
                if not cursor.fetchone()[0]:
                    continue
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM django_migrations WHERE app = 'companies' "
                "AND name = '0020_company_administration')"
            )
            administration_installed = cursor.fetchone()[0]
            if name in (ADMINISTRABLE_COMPANIES, DISCOVERABLE_COMPANIES):
                if not administration_installed:
                    continue
            bypasses = (name in BYPASSES_THE_POLICIES and name not in (VISIBLE_COMPANIES, MANAGEABLE_COMPANIES)) or (
                administration_installed and name in (VISIBLE_COMPANIES, MANAGEABLE_COMPANIES)
            )
            reading = "SECURITY DEFINER SET search_path = pg_catalog, public" if bypasses else "SECURITY INVOKER"
            cursor.execute(
                f"CREATE OR REPLACE FUNCTION {name}() RETURNS SETOF uuid "
                f"LANGUAGE sql STABLE {reading} AS $${body}$$"
            )

    install_tables(schema_editor, POLICIES)


def reachable_by_the_app_role() -> tuple[str, ...]:
    return (*POLICIES, *FRAMEWORK, *NOT_TENANCY, *AWAITING_RLS, *REACHED_DESPITE_OPERATOR_ONLY)


def grant_reachable_tables(schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    app_role = settings.RLS_ROLES["app"]
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_ident(%s), quote_ident(current_user)", [app_role])
        quoted_app, quoted_owner = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {quoted_app}")
        cursor.execute(
            f"ALTER DEFAULT PRIVILEGES FOR ROLE {quoted_owner} IN SCHEMA public "
            f"REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {quoted_app}"
        )
        missing = []
        for table in reachable_by_the_app_role():
            cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [table])
            if not cursor.fetchone()[0]:
                migration = TABLE_CREATION_AFTER_INITIAL_GRANTS.get(table)
                if migration:
                    cursor.execute(
                        "SELECT EXISTS (SELECT 1 FROM django_migrations WHERE app = %s AND name = %s)", migration
                    )
                    if not cursor.fetchone()[0]:
                        continue
                missing.append(table)
                continue
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {quoted_app}")
    if missing:
        raise RuntimeError(NOT_YET_CREATED.format(tables=", ".join(sorted(missing))))


def install_tables(schema_editor, tables):
    if schema_editor.connection.vendor != "postgresql":
        return

    with schema_editor.connection.cursor() as cursor:
        for table in tables:
            readable, writable = POLICIES[table]
            if table in PRE_ADMINISTRATION_POLICIES:
                cursor.execute("SELECT to_regprocedure('app_company_administration_ids()') IS NOT NULL")
                if not cursor.fetchone()[0]:
                    readable, writable = PRE_ADMINISTRATION_POLICIES[table]
            if table in PRE_COMPANY_DECISION_POLICIES:
                decisions, older = PRE_COMPANY_DECISION_POLICIES[table]
                cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [decisions])
                if not cursor.fetchone()[0]:
                    readable, writable = older
            cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [table])
            if not cursor.fetchone()[0]:
                continue
            cursor.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
            cursor.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
            columns = list(TERM_COLUMNS_ADDED_AFTER_CREATION.get(table, ()))
            cursor.execute(HAS_COLUMNS, [columns, table, columns])
            if not cursor.fetchone()[0]:
                continue
            for suffix in SUFFIXES:
                cursor.execute(f"DROP POLICY IF EXISTS {table}_{suffix} ON {table}")
            cursor.execute(f"CREATE POLICY {table}_read ON {table} FOR SELECT USING ({ADMITTED} AND ({readable}))")
            cursor.execute(
                f"CREATE POLICY {table}_insert ON {table} FOR INSERT WITH CHECK ({ADMITTED} AND ({writable}))"
            )
            cursor.execute(
                f"CREATE POLICY {table}_update ON {table} FOR UPDATE USING ({ADMITTED} AND ({readable})) "
                f"WITH CHECK ({ADMITTED} AND ({writable}))"
            )
            cursor.execute(f"CREATE POLICY {table}_delete ON {table} FOR DELETE USING ({ADMITTED} AND ({writable}))")


def remove(schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    with schema_editor.connection.cursor() as cursor:
        for table in POLICIES:
            cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [table])
            if not cursor.fetchone()[0]:
                continue
            for suffix in SUFFIXES:
                cursor.execute(f"DROP POLICY IF EXISTS {table}_{suffix} ON {table}")
            cursor.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

        for name in HELPERS:
            cursor.execute(f"DROP FUNCTION IF EXISTS {name}()")
