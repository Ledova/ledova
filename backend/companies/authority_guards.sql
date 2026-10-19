CREATE OR REPLACE FUNCTION public.companies_guard_authority_request()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    actor authentication_customuser;
    representative users_userprofile;
    issuer companies_company;
    requested jsonb;
    delegated jsonb;
    principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company authority requests and their evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.requester_id FOR KEY SHARE;
    SELECT * INTO representative FROM users_userprofile WHERE uuid = NEW.requester_profile_id FOR KEY SHARE;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
    IF current_user = @APP_ROLE@ OR principal IS DISTINCT FROM NEW.requester_id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR representative.user_id IS DISTINCT FROM actor.id OR issuer.owner_id IS DISTINCT FROM actor.id
        OR issuer.status IS DISTINCT FROM 'draft' OR NEW.purpose <> 'bootstrap'
        OR NEW.company_identity_raw IS DISTINCT FROM jsonb_build_object(
            'name', issuer.name, 'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
        OR NEW.person_identity_raw IS DISTINCT FROM jsonb_build_object(
            'user_id', actor.id, 'profile_uuid', representative.uuid::text,
            'email', actor.email, 'full_name', COALESCE(representative.full_name, ''))
        OR NEW.person_identity->>'user_id' IS DISTINCT FROM actor.id::text
        OR NEW.person_identity->>'profile_uuid' IS DISTINCT FROM representative.uuid::text
        OR NEW.company_identity->>'company_type' IS DISTINCT FROM issuer.company_type
        OR NEW.request_digest !~ '^[0-9a-f]{64}$'
        OR NOT (
            NEW.file = '' AND NEW.original_filename = '' AND NEW.file_size = 0
                AND NEW.mime_type = '' AND NEW.file_sha256 = ''
            OR NEW.file_sha256 ~ '^[0-9a-f]{64}$' AND NEW.file_size > 0
                AND NEW.mime_type IN ('application/pdf', 'image/png', 'image/jpeg')
                AND NEW.file ~ ('^companies/' || NEW.company_id || '/authority-requests/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
                AND length(NEW.original_filename) > 0
        )
        OR NEW.requested_expires_at <= statement_timestamp()
        OR jsonb_typeof(NEW.requested_capabilities) IS DISTINCT FROM 'array'
        OR jsonb_typeof(NEW.delegatable_capabilities) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION 'Authority evidence requires the exact active requester and owned draft company'
            USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO requested
        FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.requested_capabilities)) scope;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO delegated
        FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.delegatable_capabilities)) scope;
    IF NEW.requested_capabilities IS DISTINCT FROM requested
        OR NEW.delegatable_capabilities IS DISTINCT FROM delegated
        OR jsonb_array_length(requested) + jsonb_array_length(delegated) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(requested || delegated) scope(value)
            WHERE value IS NULL OR value NOT IN ('admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'))
    THEN
        RAISE EXCEPTION 'Request closed, canonical personal and delegation capability sets' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_authority_request_withdrawal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    actor authentication_customuser;
    proposal companies_companyauthorityrequest;
    principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable authority request withdrawal history' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.withdrawn_by_id FOR KEY SHARE;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = NEW.request_id FOR UPDATE;
    IF current_user = @APP_ROLE@ OR principal IS DISTINCT FROM NEW.withdrawn_by_id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR proposal.uuid IS NULL OR proposal.requester_id IS DISTINCT FROM actor.id
    THEN
        RAISE EXCEPTION 'Only the exact active requester can withdraw an authority request'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (SELECT 1 FROM companies_companyappointment WHERE request_id = NEW.request_id) THEN
        RAISE EXCEPTION 'An admitted appointment must be revoked instead of withdrawn' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_initial_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    actor authentication_customuser;
    representative users_userprofile;
    issuer companies_company;
    proposal companies_companyauthorityrequest;
    principal bigint;
    requires_identity boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company appointments and declarations' USING ERRCODE = '23514';
    END IF;
    IF NEW.legacy_owner_id IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy owner appointments can only be recorded by the upgrade'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.invitation_id IS NOT NULL THEN
        PERFORM companies_validate_invited_appointment(NEW);
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = NEW.request_id;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = proposal.requester_id FOR UPDATE;
    SELECT * INTO representative FROM users_userprofile WHERE uuid = proposal.requester_profile_id FOR UPDATE;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = NEW.request_id FOR UPDATE;
    SELECT issuer_kyc_required INTO requires_identity FROM operators_operator WHERE id = 1 FOR SHARE;
    IF current_user = @APP_ROLE@ OR principal IS DISTINCT FROM actor.id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR representative.user_id IS DISTINCT FROM actor.id
        OR issuer.uuid IS NULL OR issuer.owner_id IS DISTINCT FROM actor.id OR issuer.status IS DISTINCT FROM 'draft'
        OR NEW.appointee_id IS DISTINCT FROM proposal.requester_id
        OR NEW.appointee_profile_id IS DISTINCT FROM proposal.requester_profile_id
        OR proposal.company_id IS DISTINCT FROM issuer.uuid OR proposal.purpose IS DISTINCT FROM 'bootstrap'
        OR EXISTS (SELECT 1 FROM companies_companyauthorityrequestwithdrawal WHERE request_id = proposal.uuid)
        OR NEW.capabilities IS DISTINCT FROM proposal.requested_capabilities
        OR NEW.delegatable_capabilities IS DISTINCT FROM proposal.delegatable_capabilities
        OR NOT NEW.capabilities @> '["admin"]'::jsonb
        OR NEW.expires_at IS DISTINCT FROM proposal.requested_expires_at
        OR NEW.expires_at <= clock_timestamp()
        OR NEW.declaration_version IS DISTINCT FROM '2026-10-14' OR NEW.declaration_text IS DISTINCT FROM 'I am authorised to set up and administer this company’s workspace, including managing its users, and I accept the Terms of Service (version 2026-10-14) on the company’s behalf. The company is responsible for the company and share information it provides, its ASIC filings and legal obligations.'
        OR proposal.company_identity_raw IS DISTINCT FROM jsonb_build_object(
            'name', issuer.name, 'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
        OR proposal.person_identity_raw IS DISTINCT FROM jsonb_build_object(
            'user_id', actor.id, 'profile_uuid', representative.uuid::text,
            'email', actor.email, 'full_name', COALESCE(representative.full_name, ''))
        OR COALESCE(requires_identity, false) AND NOT representative.is_id_verified
        OR NEW.registry_check_id IS NOT NULL
    THEN
        RAISE EXCEPTION 'Initial company authority requires the exact current declaration and requester'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;
