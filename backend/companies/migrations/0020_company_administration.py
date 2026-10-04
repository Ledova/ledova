from django.conf import settings
from django.db import migrations

TABLES = ("companies_company", "companies_companydocument")


def install_guards(apps, schema_editor):
    from shared.db.policies import (
        ADMINISTRABLE_COMPANIES,
        DISCOVERABLE_COMPANIES,
        HELPERS,
        MANAGEABLE_COMPANIES,
        VISIBLE_COMPANIES,
    )
    from shared.db.policy_sql import install_tables

    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_company, companies_companydocument IN ACCESS EXCLUSIVE MODE")
        for helper in (ADMINISTRABLE_COMPANIES, DISCOVERABLE_COMPANIES):
            cursor.execute(
                f"CREATE FUNCTION {helper}() RETURNS SETOF uuid LANGUAGE sql STABLE "
                f"SECURITY DEFINER SET search_path = pg_catalog, public AS $${HELPERS[helper]}$$"
            )
        for helper in (VISIBLE_COMPANIES, MANAGEABLE_COMPANIES):
            cursor.execute(
                f"CREATE OR REPLACE FUNCTION {helper}() RETURNS SETOF uuid LANGUAGE sql STABLE "
                f"SECURITY DEFINER SET search_path = pg_catalog, public AS $${HELPERS[helper]}$$"
            )
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator_role, migrate_role = cursor.fetchone()
        cursor.execute(f"""
CREATE FUNCTION companies_valid_identifiers(acn text, abn text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN acn ~ '^[0-9]{{9}}$' AND (abn = '' OR abn ~ '^[0-9]{{11}}$') THEN
        mod(10 - mod((SELECT sum(substring(acn, digit, 1)::integer * (9 - digit))
            FROM generate_series(1, 8) digit), 10), 10) = substring(acn, 9, 1)::integer
        AND (abn = '' OR (substring(abn, 3) = acn AND mod((SELECT sum(
            (substring(abn, digit, 1)::integer - CASE WHEN digit = 1 THEN 1 ELSE 0 END)
            * (ARRAY[10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19])[digit])
            FROM generate_series(1, 11) digit), 89) = 0))
        ELSE false END;
$$;
CREATE FUNCTION companies_locked_administration(issuer_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
    issuer companies_company;
    actor authentication_customuser;
    profile users_userprofile;
    identity_required boolean;
    principal bigint;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO issuer FROM companies_company WHERE uuid = issuer_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    SELECT * INTO profile FROM users_userprofile WHERE user_id = principal FOR SHARE;
    SELECT issuer_kyc_required INTO identity_required FROM operators_operator WHERE id = 1 FOR SHARE;
    PERFORM 1 FROM companies_companyappointment
        WHERE company_id = issuer_id AND appointee_id = principal ORDER BY uuid FOR SHARE;
    IF actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified OR issuer.uuid IS NULL THEN
        RETURN false;
    END IF;
    IF issuer.owner_id = actor.id AND issuer.status = 'draft'
        AND NOT EXISTS (SELECT 1 FROM companies_companylegacyownersource WHERE company_id = issuer_id)
        AND NOT EXISTS (SELECT 1 FROM companies_companyappointment WHERE company_id = issuer_id AND request_id IS NOT NULL)
    THEN RETURN true; END IF;
    RETURN EXISTS (SELECT 1 FROM companies_companyappointment appointment
        WHERE appointment.company_id = issuer_id AND appointment.appointee_id = actor.id
            AND appointment.appointee_profile_id = profile.uuid AND profile.user_id = actor.id
            AND appointment.capabilities @> '["admin"]'::jsonb
            AND (NOT COALESCE(identity_required, false) OR profile.is_id_verified)
            AND (appointment.expires_at IS NULL OR appointment.expires_at > clock_timestamp())
            AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation WHERE appointment_id = appointment.uuid));
END;
$$;
CREATE FUNCTION companies_guard_administration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actor authentication_customuser;
    provider companies_companyregistrycheck;
    operation text;
    principal bigint;
    allowed text[];
    reviewed boolean;
    wallet wallets;
    wallet_account customer_accounts_account;
    wallet_profile users_userprofile;
BEGIN
    IF current_user = {migrate_role} THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF current_user <> {operator_role} OR TG_OP = 'DELETE' OR principal IS NULL
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM NEW.uuid
    THEN RAISE EXCEPTION 'Use the exact actor-bound company command' USING ERRCODE = '23514'; END IF;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    IF TG_OP = 'INSERT' THEN
        IF operation <> 'register' OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
            OR NOT companies_valid_identifiers(NEW.acn, NEW.abn)
            OR NEW.company_type NOT IN ('pty', 'public', 'unlisted') OR NEW.name = ''
            OR NEW.owner_id IS DISTINCT FROM actor.id OR NEW.status IS DISTINCT FROM 'draft'
            OR NEW.lifecycle_revision <> 0 OR NEW.registry_check_id IS NOT NULL
            OR NEW.registry_status IS DISTINCT FROM 'pending' OR NEW.registry_reason <> ''
            OR NEW.registry_checked_at IS NOT NULL OR NEW.registry_identity <> '{{}}'::jsonb
            OR NEW.registry_revision IS NOT NULL OR NEW.registry_purpose <> ''
            OR NEW.registry_entity_name <> '' OR NEW.registry_entity_status <> ''
            OR NEW.submitted_by_id IS NOT NULL OR NEW.submitted_at IS NOT NULL
            OR NEW.review_started_at IS NOT NULL OR NEW.review_completed_at IS NOT NULL
            OR NEW.approved_by_id IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.activated_at IS NOT NULL
            OR NEW.rejected_by_id IS NOT NULL OR NEW.rejection_at IS NOT NULL OR NEW.rejection_reason <> ''
            OR NEW.info_requested_at IS NOT NULL OR NEW.info_request_reason <> '' OR NEW.additional_info_response <> ''
            OR NEW.warning_issued_at IS NOT NULL OR NEW.warning_reason <> ''
            OR NEW.suspended_at IS NOT NULL OR NEW.suspension_reason <> ''
            OR NEW.delisted_at IS NOT NULL OR NEW.delisting_reason <> ''
            OR NEW.withdrawn_at IS NOT NULL OR NEW.withdrawal_reason <> ''
            OR NEW.declarant_name <> '' OR NEW.board_resolution_reference <> ''
            OR NEW.officeholder_attested_by_id IS NOT NULL OR NEW.officeholder_attested_at IS NOT NULL
            OR NEW.officeholder_attestation <> '{{}}'::jsonb OR NEW.operator_wallet_id IS NOT NULL
        THEN RAISE EXCEPTION 'Registration records only the exact active owner draft' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF operation = 'edit' THEN
        IF NOT companies_locked_administration(OLD.uuid) THEN
            RAISE EXCEPTION 'Current personal company administration is required' USING ERRCODE = '23514';
        END IF;
        allowed := ARRAY['name', 'trading_name', 'company_type', 'acn', 'abn', 'declarant_name',
            'board_resolution_reference', 'phone', 'address_line_1', 'address_line_2', 'city', 'state', 'postcode',
            'country', 'description', 'industry', 'founded_year', 'operator_wallet_id', 'is_open_to_investors',
            'updated_at', 'lifecycle_revision', 'registry_status', 'registry_reason'];
        IF to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed
            OR (ROW(NEW.acn, NEW.abn) IS DISTINCT FROM ROW(OLD.acn, OLD.abn)
                AND NOT companies_valid_identifiers(NEW.acn, NEW.abn))
            OR NEW.company_type NOT IN ('pty', 'public', 'unlisted') OR NEW.name = ''
            OR (OLD.status <> 'draft' AND ROW(NEW.acn, NEW.abn, NEW.company_type)
                IS DISTINCT FROM ROW(OLD.acn, OLD.abn, OLD.company_type))
            OR (OLD.status NOT IN ('draft', 'info_required') AND ROW(NEW.name, NEW.declarant_name, NEW.board_resolution_reference)
                IS DISTINCT FROM ROW(OLD.name, OLD.declarant_name, OLD.board_resolution_reference))
        THEN RAISE EXCEPTION 'Retain protected company identity and review fields' USING ERRCODE = '23514'; END IF;
        reviewed := ROW(NEW.name, NEW.acn, NEW.abn, NEW.company_type, NEW.declarant_name, NEW.board_resolution_reference)
            IS DISTINCT FROM ROW(OLD.name, OLD.acn, OLD.abn, OLD.company_type, OLD.declarant_name, OLD.board_resolution_reference);
        IF (reviewed AND (NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1
                OR NEW.registry_status IS DISTINCT FROM 'pending' OR NEW.registry_reason IS DISTINCT FROM 'identity_changed'))
            OR (NOT reviewed AND ROW(NEW.lifecycle_revision, NEW.registry_status, NEW.registry_reason)
                IS DISTINCT FROM ROW(OLD.lifecycle_revision, OLD.registry_status, OLD.registry_reason))
        THEN RAISE EXCEPTION 'Identity edits must invalidate the current registry review' USING ERRCODE = '23514'; END IF;
        IF NEW.operator_wallet_id IS DISTINCT FROM OLD.operator_wallet_id AND NEW.operator_wallet_id IS NOT NULL THEN
            SELECT * INTO wallet FROM wallets WHERE uuid = NEW.operator_wallet_id FOR SHARE;
            SELECT * INTO wallet_account FROM customer_accounts_account WHERE uuid = wallet.user_account_id FOR SHARE;
            SELECT * INTO wallet_profile FROM users_userprofile WHERE uuid = wallet_account.user_profile_id FOR SHARE;
            IF wallet.uuid IS NULL OR wallet.verification_status <> 'verified' OR wallet.chain NOT IN ('base', 'ethereum')
                OR wallet_account.uuid IS NULL OR wallet_profile.uuid IS NULL OR wallet_profile.user_id IS DISTINCT FROM actor.id
            THEN RAISE EXCEPTION 'Select the actors current verified EVM wallet' USING ERRCODE = '23514'; END IF;
            IF NOT companies_locked_administration(OLD.uuid) THEN
                RAISE EXCEPTION 'Current administration must remain effective after wallet locks' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF operation = 'registry' THEN
        allowed := ARRAY['registry_check_id', 'registry_status', 'registry_reason', 'registry_checked_at',
            'registry_entity_name', 'registry_entity_status', 'registry_identity', 'registry_revision', 'registry_purpose', 'updated_at'];
        SELECT * INTO provider FROM companies_companyregistrycheck WHERE uuid = NEW.registry_check_id FOR SHARE;
        IF to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed
            OR provider.uuid IS NULL OR provider.company_id IS DISTINCT FROM NEW.uuid
            OR provider.initiated_by_id IS DISTINCT FROM principal
            OR provider.lifecycle_revision IS DISTINCT FROM NEW.lifecycle_revision
            OR provider.requested_name IS DISTINCT FROM NEW.name OR provider.requested_acn IS DISTINCT FROM NEW.acn
            OR provider.requested_abn IS DISTINCT FROM NEW.abn
            OR NEW.registry_identity IS DISTINCT FROM provider.identity
            OR NEW.registry_revision IS DISTINCT FROM provider.lifecycle_revision
            OR NEW.registry_purpose IS DISTINCT FROM provider.purpose
            OR (provider.completed_at IS NULL AND (NEW.registry_status IS DISTINCT FROM 'pending'
                OR NEW.registry_reason IS DISTINCT FROM 'checking' OR NEW.registry_checked_at IS NOT NULL
                OR NEW.registry_entity_name <> '' OR NEW.registry_entity_status <> ''))
            OR (provider.completed_at IS NOT NULL AND ROW(NEW.registry_status, NEW.registry_reason, NEW.registry_checked_at,
                    NEW.registry_entity_name, NEW.registry_entity_status)
                IS DISTINCT FROM ROW(provider.status, provider.reason, provider.completed_at, provider.entity_name, provider.entity_status))
        THEN RAISE EXCEPTION 'Registry projection requires its exact retained provider check' USING ERRCODE = '23514'; END IF;
    ELSIF operation IN ('workflow', 'admin_workflow') THEN
        IF operation = 'admin_workflow' AND NOT (actor.is_superuser OR EXISTS (SELECT 1 FROM auth_permission permission
            JOIN django_content_type kind ON kind.id = permission.content_type_id
            WHERE kind.app_label = 'companies' AND permission.codename = 'change_company'
                AND (EXISTS (SELECT 1 FROM authentication_customuser_user_permissions assigned
                    WHERE assigned.customuser_id = actor.id AND assigned.permission_id = permission.id)
                OR EXISTS (SELECT 1 FROM authentication_customuser_groups member JOIN auth_group_permissions assigned
                    ON assigned.group_id = member.group_id WHERE member.customuser_id = actor.id AND assigned.permission_id = permission.id))))
        THEN RAISE EXCEPTION 'The existing admin review requires current model change permission' USING ERRCODE = '23514'; END IF;
        allowed := ARRAY['status', 'lifecycle_revision', 'submitted_at', 'submitted_by_id', 'review_started_at',
            'review_completed_at', 'approved_at', 'approved_by_id', 'activated_at', 'info_requested_at', 'info_request_reason',
            'additional_info_response', 'rejection_at', 'rejection_reason', 'rejected_by_id', 'warning_issued_at', 'warning_reason',
            'suspended_at', 'suspension_reason', 'delisted_at', 'delisting_reason', 'withdrawn_at', 'withdrawal_reason',
            'declarant_name', 'board_resolution_reference', 'officeholder_attested_by_id', 'officeholder_attested_at',
            'officeholder_attestation', 'updated_at'];
        IF actor.id IS NULL OR NOT actor.is_active OR to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed
            OR (NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id AND NEW.approved_by_id IS DISTINCT FROM actor.id)
            OR (NEW.rejected_by_id IS DISTINCT FROM OLD.rejected_by_id AND NEW.rejected_by_id IS DISTINCT FROM actor.id)
            OR (NEW.officeholder_attested_by_id IS DISTINCT FROM OLD.officeholder_attested_by_id
                AND NEW.officeholder_attested_by_id IS DISTINCT FROM actor.id)
            OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1)
            OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
                (OLD.status IN ('draft', 'info_required') AND NEW.status = 'submitted')
                OR (OLD.status = 'submitted' AND NEW.status = 'review')
                OR (OLD.status = 'review' AND NEW.status IN ('info_required', 'approved', 'rejected'))
                OR (OLD.status = 'submitted' AND NEW.status = 'rejected')
                OR (OLD.status IN ('approved', 'warning', 'suspended') AND NEW.status = 'active')
                OR (OLD.status = 'active' AND NEW.status = 'warning')
                OR (OLD.status IN ('active', 'warning') AND NEW.status = 'suspended')
                OR (OLD.status NOT IN ('draft', 'rejected', 'withdrawn') AND NEW.status = 'delisted')
                OR (OLD.status IN ('draft', 'submitted', 'info_required') AND NEW.status = 'withdrawn')))
            OR (NEW.status = 'active' AND OLD.status <> 'active' AND (
                OLD.registry_status <> 'passed' OR OLD.registry_purpose <> 'activation'
                OR OLD.registry_checked_at IS NULL OR OLD.registry_revision IS DISTINCT FROM OLD.lifecycle_revision
                OR OLD.officeholder_attested_by_id IS NULL OR OLD.officeholder_attested_at IS NULL
                OR OLD.declarant_name = '' OR OLD.board_resolution_reference = ''))
            OR (NOT actor.is_staff AND (actor.id IS DISTINCT FROM OLD.owner_id OR NOT actor.is_email_verified
                OR NEW.status NOT IN ('submitted', 'withdrawn')
                OR OLD.status NOT IN ('draft', 'info_required', 'submitted')
                OR (NEW.status = 'submitted' AND OLD.status NOT IN ('draft', 'info_required'))
                OR (NEW.status = 'submitted' AND (NEW.submitted_at IS NULL OR (OLD.status = 'draft' AND NEW.submitted_by_id IS DISTINCT FROM actor.id)))
                OR (NEW.status = 'withdrawn' AND (NEW.withdrawn_at IS NULL OR ROW(NEW.submitted_at, NEW.submitted_by_id, NEW.additional_info_response)
                    IS DISTINCT FROM ROW(OLD.submitted_at, OLD.submitted_by_id, OLD.additional_info_response)))
                OR NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1
                OR ROW(NEW.review_started_at, NEW.review_completed_at, NEW.approved_at, NEW.approved_by_id, NEW.activated_at,
                    NEW.declarant_name, NEW.board_resolution_reference, NEW.officeholder_attested_by_id,
                    NEW.officeholder_attested_at, NEW.officeholder_attestation, NEW.rejection_at, NEW.rejection_reason, NEW.rejected_by_id,
                    NEW.warning_issued_at, NEW.warning_reason, NEW.suspended_at, NEW.suspension_reason, NEW.delisted_at, NEW.delisting_reason)
                IS DISTINCT FROM ROW(OLD.review_started_at, OLD.review_completed_at, OLD.approved_at, OLD.approved_by_id, OLD.activated_at,
                    OLD.declarant_name, OLD.board_resolution_reference, OLD.officeholder_attested_by_id,
                    OLD.officeholder_attested_at, OLD.officeholder_attestation, OLD.rejection_at, OLD.rejection_reason, OLD.rejected_by_id,
                    OLD.warning_issued_at, OLD.warning_reason, OLD.suspended_at, OLD.suspension_reason, OLD.delisted_at, OLD.delisting_reason)))
        THEN RAISE EXCEPTION 'Retain the existing exact owner submission and staff review boundary' USING ERRCODE = '23514'; END IF;
    ELSE RAISE EXCEPTION 'Use a bounded company command' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_administration BEFORE INSERT OR UPDATE OR DELETE ON companies_company
FOR EACH ROW EXECUTE FUNCTION companies_guard_administration();
CREATE FUNCTION companies_guard_document_administration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    issuer_id uuid;
    actor authentication_customuser;
    principal bigint;
    operation text;
BEGIN
    IF current_user = {migrate_role} THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    issuer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF current_user <> {operator_role} OR principal IS NULL
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM issuer_id
    THEN RAISE EXCEPTION 'Use the exact actor-bound company document command' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM companies_company WHERE uuid = issuer_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    IF TG_OP = 'UPDATE' THEN
        IF operation = 'edit' AND pg_trigger_depth() = 2 AND companies_locked_administration(issuer_id)
            AND NOT NEW.is_verified AND NEW.verified_fingerprint = ''
            AND NEW.verified_by_id IS NULL AND NEW.verified_at IS NULL
            AND to_jsonb(NEW) - ARRAY['is_verified', 'verified_fingerprint', 'verified_by_id', 'verified_at']
                IS NOT DISTINCT FROM to_jsonb(OLD) - ARRAY['is_verified', 'verified_fingerprint', 'verified_by_id', 'verified_at']
        THEN RETURN NEW; END IF;
        IF operation = 'document_review' AND actor.id IS NOT NULL AND actor.is_active AND actor.is_staff
            AND NEW.verified_by_id = actor.id
            AND (actor.is_superuser OR EXISTS (SELECT 1 FROM auth_permission permission
                JOIN django_content_type kind ON kind.id = permission.content_type_id
                WHERE kind.app_label = 'companies' AND permission.codename = 'change_companydocument'
                    AND (EXISTS (SELECT 1 FROM authentication_customuser_user_permissions assigned
                        WHERE assigned.customuser_id = actor.id AND assigned.permission_id = permission.id)
                    OR EXISTS (SELECT 1 FROM authentication_customuser_groups member JOIN auth_group_permissions assigned
                        ON assigned.group_id = member.group_id WHERE member.customuser_id = actor.id AND assigned.permission_id = permission.id))))
            AND to_jsonb(NEW) - ARRAY['is_verified', 'verified_fingerprint', 'verified_by_id', 'verified_at', 'updated_at']
                IS NOT DISTINCT FROM to_jsonb(OLD) - ARRAY['is_verified', 'verified_fingerprint', 'verified_by_id', 'verified_at', 'updated_at']
        THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Use current content-bound staff verification; retain company document metadata' USING ERRCODE = '23514';
    END IF;
    IF NOT companies_locked_administration(issuer_id) THEN
        RAISE EXCEPTION 'Current personal company administration is required for documents' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF operation <> 'document_create' OR NEW.is_verified OR NEW.verified_fingerprint <> ''
            OR NEW.verified_by_id IS NOT NULL OR NEW.verified_at IS NOT NULL
            OR NEW.valid_from IS NOT NULL OR NEW.valid_until IS NOT NULL OR NEW.notes <> '' OR NEW.rejection_reason <> ''
            OR NEW.name = '' OR NEW.file_size = 0
            OR NEW.document_type NOT IN ('cert_inc', 'asic', 'constitution', 'share_register', 'financials',
                'auditor_report', 'director_id', 'beneficial_ownership', 'shareholder', 'business_plan',
                'risk_disclosure', 'prospectus', 'legal_opinion', 'tax_return', 'bank_statement', 'other')
            OR (COALESCE(NEW.file, '') = '' AND NEW.external_url = '')
            OR (COALESCE(NEW.file, '') <> '' AND (
                NEW.file !~ ('^companies/' || issuer_id::text || '/documents/' || NEW.document_type
                    || '/[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}[.](pdf|png|jpg|jpeg)$')
                OR EXISTS (SELECT 1 FROM companies_companydocument retained WHERE retained.file = NEW.file)))
        THEN RAISE EXCEPTION 'Uploads retain exact company binding and unverified source fields' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF operation <> 'document_delete' THEN
        RAISE EXCEPTION 'Use the bounded document deletion command' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM offerings_offering WHERE uuid IN
        (SELECT offering_id FROM offerings_offering_documents WHERE companydocument_id = OLD.uuid)
        ORDER BY uuid FOR SHARE;
    IF NOT companies_locked_administration(issuer_id) THEN
        RAISE EXCEPTION 'Current administration must remain effective after offering locks' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM offerings_offering_documents attached JOIN offerings_offering offered
        ON offered.uuid = attached.offering_id WHERE attached.companydocument_id = OLD.uuid AND offered.status IN ('approved', 'closed'))
    THEN RAISE EXCEPTION 'Retain documents attached to published offerings' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER companies_document_administration BEFORE INSERT OR UPDATE OR DELETE ON companies_companydocument
FOR EACH ROW EXECUTE FUNCTION companies_guard_document_administration();
CREATE FUNCTION companies_lock_document_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    operation text;
    issuer_id uuid;
    admitted boolean;
BEGIN
    IF current_user = {migrate_role} THEN RETURN NULL; END IF;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF TG_TABLE_NAME = 'offerings_offering_documents' AND operation <> 'document_delete' THEN RETURN NULL; END IF;
    issuer_id := NULLIF(current_setting('app.company_id', true), '')::uuid;
    IF current_user <> {operator_role} OR NULLIF(current_setting('app.user_id', true), '')::bigint IS NULL
        OR issuer_id IS NULL OR (TG_OP = 'DELETE' AND operation <> 'document_delete')
        OR (TG_OP = 'UPDATE' AND operation NOT IN ('edit', 'document_review'))
    THEN RAISE EXCEPTION 'Lock the exact actor-bound company document command before rows' USING ERRCODE = '23514'; END IF;
    admitted := companies_locked_administration(issuer_id);
    IF operation <> 'document_review' AND NOT admitted THEN
        RAISE EXCEPTION 'Current personal company administration is required before document rows' USING ERRCODE = '23514';
    END IF;
    IF operation = 'document_delete' THEN
        PERFORM 1 FROM offerings_offering WHERE company_id = issuer_id ORDER BY uuid FOR SHARE;
        IF NOT companies_locked_administration(issuer_id) THEN
            RAISE EXCEPTION 'Current administration is required after document command offering locks' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER companies_document_command_locks BEFORE UPDATE OR DELETE ON companies_companydocument
FOR EACH STATEMENT EXECUTE FUNCTION companies_lock_document_command();
CREATE TRIGGER companies_document_removal_locks BEFORE DELETE ON offerings_offering_documents
FOR EACH STATEMENT EXECUTE FUNCTION companies_lock_document_command();
CREATE FUNCTION companies_guard_document_removal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    issuer_id uuid;
    published boolean;
BEGIN
    IF current_user = {migrate_role} THEN RETURN OLD; END IF;
    IF COALESCE(current_setting('app.company_operation', true), '') <> 'document_delete' THEN RETURN OLD; END IF;
    SELECT company_id INTO issuer_id FROM companies_companydocument WHERE uuid = OLD.companydocument_id;
    IF current_user <> {operator_role}
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM issuer_id
        OR NOT companies_locked_administration(issuer_id)
    THEN RAISE EXCEPTION 'Document removal requires its exact current company administrator' USING ERRCODE = '23514'; END IF;
    SELECT status IN ('approved', 'closed') INTO published FROM offerings_offering WHERE uuid = OLD.offering_id FOR SHARE;
    IF published OR NOT companies_locked_administration(issuer_id) THEN
        RAISE EXCEPTION 'Retain published documents and current administration after offering locks' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER companies_document_removal_authority BEFORE DELETE ON offerings_offering_documents
FOR EACH ROW EXECUTE FUNCTION companies_guard_document_removal();
""")
    install_tables(schema_editor, TABLES)


def remove_guards(apps, schema_editor):
    from shared.db.policies import HELPERS, MANAGEABLE_COMPANIES, VISIBLE_COMPANIES
    from shared.db.policy_sql import install_tables

    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_company, companies_companydocument IN ACCESS EXCLUSIVE MODE")
        cursor.execute("DROP TRIGGER companies_document_removal_locks ON offerings_offering_documents")
        cursor.execute("DROP TRIGGER companies_document_command_locks ON companies_companydocument")
        cursor.execute("DROP FUNCTION companies_lock_document_command()")
        cursor.execute("DROP TRIGGER companies_document_removal_authority ON offerings_offering_documents")
        cursor.execute("DROP FUNCTION companies_guard_document_removal()")
        cursor.execute("DROP TRIGGER companies_document_administration ON companies_companydocument")
        cursor.execute("DROP FUNCTION companies_guard_document_administration()")
        cursor.execute("DROP TRIGGER companies_administration ON companies_company")
        cursor.execute("DROP FUNCTION companies_guard_administration()")
        cursor.execute("DROP FUNCTION companies_locked_administration(uuid)")
        cursor.execute("DROP FUNCTION companies_valid_identifiers(text, text)")
        for table in TABLES:
            for suffix in ("read", "insert", "update", "delete"):
                cursor.execute(f"DROP POLICY {table}_{suffix} ON {table}")
        cursor.execute("DROP FUNCTION app_company_administration_ids()")
        cursor.execute("DROP FUNCTION app_company_discovery_ids()")
        for helper in (VISIBLE_COMPANIES, MANAGEABLE_COMPANIES):
            cursor.execute(
                f"CREATE OR REPLACE FUNCTION {helper}() RETURNS SETOF uuid LANGUAGE sql STABLE "
                f"SECURITY INVOKER AS $${HELPERS[helper]}$$"
            )
    install_tables(schema_editor, TABLES)


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0019_legacy_owner_appointments"),
        ("offerings", "0009_published_documents_stay"),
        ("shared", "0004_rls_policies"),
    ]

    operations = [migrations.RunPython(install_guards, remove_guards)]
