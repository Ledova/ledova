CREATE OR REPLACE FUNCTION public.companies_guard_document_verification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF current_user = @APP_ROLE@
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
$function$;

CREATE OR REPLACE FUNCTION public.companies_revoke_document_verification()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$;

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
        OR NEW.file_sha256 !~ '^[0-9a-f]{64}$' OR NEW.request_digest !~ '^[0-9a-f]{64}$'
        OR NEW.file_size <= 0 OR NEW.mime_type NOT IN ('application/pdf', 'image/png', 'image/jpeg')
        OR NEW.file !~ ('^companies/' || NEW.company_id || '/authority-requests/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
        OR length(NEW.original_filename) = 0 OR NEW.requested_expires_at <= statement_timestamp()
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
    provider_check companies_companyregistrycheck;
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
    SELECT * INTO provider_check FROM companies_companyregistrycheck WHERE uuid = NEW.registry_check_id FOR SHARE;
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
        OR NEW.declaration_version IS DISTINCT FROM '2026-10-04' OR NEW.declaration_text IS DISTINCT FROM 'I am authorised to act for this company. The company is responsible for the company and share information it provides, its ASIC filings and legal obligations.'
        OR proposal.company_identity_raw IS DISTINCT FROM jsonb_build_object(
            'name', issuer.name, 'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
        OR proposal.person_identity_raw IS DISTINCT FROM jsonb_build_object(
            'user_id', actor.id, 'profile_uuid', representative.uuid::text,
            'email', actor.email, 'full_name', COALESCE(representative.full_name, ''))
        OR COALESCE(requires_identity, false) AND NOT representative.is_id_verified
        OR provider_check.uuid IS NULL OR provider_check.company_id IS DISTINCT FROM issuer.uuid
        OR provider_check.initiated_by_id IS DISTINCT FROM actor.id
        OR provider_check.purpose IS DISTINCT FROM 'authority' OR provider_check.status IS DISTINCT FROM 'passed'
        OR provider_check.completed_at IS NULL OR provider_check.lifecycle_revision IS DISTINCT FROM issuer.lifecycle_revision
        OR provider_check.identity IS DISTINCT FROM proposal.company_identity
        OR provider_check.requested_name IS DISTINCT FROM issuer.name
        OR provider_check.requested_acn IS DISTINCT FROM issuer.acn OR provider_check.requested_abn IS DISTINCT FROM issuer.abn
    THEN
        RAISE EXCEPTION 'Initial company authority requires the exact current declaration, requester and ABR result'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_appointment_revocation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    actor authentication_customuser;
    appointment companies_companyappointment;
    principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company appointment revocations' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company
        WHERE uuid = (SELECT company_id FROM companies_companyappointment WHERE uuid = NEW.appointment_id) FOR UPDATE;

    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.revoked_by_id FOR UPDATE;
    SELECT * INTO appointment FROM companies_companyappointment WHERE uuid = NEW.appointment_id FOR UPDATE;
    IF current_user = @APP_ROLE@ OR principal IS DISTINCT FROM actor.id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR appointment.uuid IS NULL
        OR (appointment.appointee_id IS DISTINCT FROM actor.id AND NOT EXISTS (
            SELECT 1 FROM companies_companyappointment administrator
            WHERE administrator.company_id = appointment.company_id AND administrator.appointee_id = actor.id
              AND administrator.capabilities @> '["admin"]'::jsonb
              AND companies_current_team_appointment(administrator.uuid, appointment.company_id)))
    THEN
        RAISE EXCEPTION 'Only the exact active appointee can revoke their appointment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_current_team_appointment(source_id uuid, issuer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_team_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    IF current_user = @APP_ROLE@ OR principal IS DISTINCT FROM NEW.inviter_id
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
$function$;

CREATE OR REPLACE FUNCTION public.companies_validate_invited_appointment(candidate companies_companyappointment)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
    IF current_user = @APP_ROLE@ OR principal IS DISTINCT FROM actor.id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR profile.user_id IS DISTINCT FROM actor.id
        OR COALESCE(requires_identity, false) AND NOT profile.is_id_verified
        OR candidate.request_id IS NOT NULL OR candidate.registry_check_id IS NOT NULL
        OR invitation.uuid IS NULL OR invitation.company_id IS DISTINCT FROM candidate.company_id
        OR candidate.appointee_id IS NOT DISTINCT FROM invitation.inviter_id
        OR EXISTS (
            SELECT 1 FROM companies_companyappointment retained
            WHERE retained.company_id = candidate.company_id AND retained.appointee_id = candidate.appointee_id
              AND (retained.expires_at IS NULL OR retained.expires_at > clock_timestamp())
              AND NOT EXISTS (
                  SELECT 1 FROM companies_companyappointmentrevocation revoked
                  WHERE revoked.appointment_id = retained.uuid))
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
        OR candidate.declaration_version IS DISTINCT FROM '2026-10-04' OR candidate.declaration_text IS DISTINCT FROM 'I am authorised to act for this company. The company is responsible for the company and share information it provides, its ASIC filings and legal obligations.'
    THEN
        RAISE EXCEPTION 'Appointment requires the exact current invitation, appointee, code and declaration'
            USING ERRCODE = '23514';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_legacy_owner_source()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Retain immutable legacy owner sources' USING ERRCODE = '23514';
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_valid_identifiers(acn text, abn text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT CASE WHEN acn ~ '^[0-9]{9}$' AND (abn = '' OR abn ~ '^[0-9]{11}$') THEN
        mod(10 - mod((SELECT sum(substring(acn, digit, 1)::integer * (9 - digit))
            FROM generate_series(1, 8) digit), 10), 10) = substring(acn, 9, 1)::integer
        AND (abn = '' OR (substring(abn, 3) = acn AND mod((SELECT sum(
            (substring(abn, digit, 1)::integer - CASE WHEN digit = 1 THEN 1 ELSE 0 END)
            * (ARRAY[10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19])[digit])
            FROM generate_series(1, 11) digit), 89) = 0))
        ELSE false END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_locked_administration(issuer_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_administration()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF current_user <> @OPERATOR_ROLE@ OR TG_OP = 'DELETE' OR principal IS NULL
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM NEW.uuid
    THEN RAISE EXCEPTION 'Use the exact actor-bound company command' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' AND operation = 'edit'
        AND NEW.operator_wallet_id IS DISTINCT FROM OLD.operator_wallet_id AND NEW.operator_wallet_id IS NOT NULL
    THEN
        SELECT * INTO wallet FROM wallets WHERE uuid = NEW.operator_wallet_id FOR NO KEY UPDATE;
        SELECT * INTO wallet_account FROM customer_accounts_account WHERE uuid = wallet.user_account_id FOR NO KEY UPDATE;
        SELECT * INTO wallet_profile FROM users_userprofile WHERE uuid = wallet_account.user_profile_id;
        IF wallet.uuid IS NULL OR wallet.verification_status <> 'VERIFIED' OR wallet.chain NOT IN ('base', 'ethereum')
            OR wallet_account.uuid IS NULL OR wallet_profile.uuid IS NULL OR wallet_profile.user_id IS DISTINCT FROM principal
        THEN RAISE EXCEPTION 'Select the actors current verified EVM wallet' USING ERRCODE = '23514'; END IF;
    END IF;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    IF TG_OP = 'UPDATE' AND operation = 'edit'
        AND NEW.operator_wallet_id IS DISTINCT FROM OLD.operator_wallet_id AND NEW.operator_wallet_id IS NOT NULL
    THEN
        SELECT * INTO wallet_profile FROM users_userprofile WHERE uuid = wallet_account.user_profile_id FOR SHARE;
        IF wallet_profile.uuid IS NULL OR wallet_profile.user_id IS DISTINCT FROM principal
        THEN RAISE EXCEPTION 'Select the actors current verified EVM wallet' USING ERRCODE = '23514'; END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF operation <> 'register' OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
            OR NOT companies_valid_identifiers(NEW.acn, NEW.abn)
            OR NEW.company_type NOT IN ('pty', 'public', 'unlisted') OR NEW.name = ''
            OR NEW.owner_id IS DISTINCT FROM actor.id OR NEW.status IS DISTINCT FROM 'draft'
            OR NEW.lifecycle_revision <> 0 OR NEW.registry_check_id IS NOT NULL
            OR NEW.registry_status IS DISTINCT FROM 'pending' OR NEW.registry_reason <> ''
            OR NEW.registry_checked_at IS NOT NULL OR NEW.registry_identity <> '{}'::jsonb
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
            OR NEW.officeholder_attestation <> '{}'::jsonb OR NEW.operator_wallet_id IS NOT NULL
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
            IF wallet.uuid IS NULL OR wallet.verification_status <> 'VERIFIED' OR wallet.chain NOT IN ('base', 'ethereum')
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

    ELSIF operation = 'activation' THEN
        SELECT * INTO provider FROM companies_companyregistrycheck WHERE uuid = OLD.registry_check_id FOR SHARE;
        IF to_jsonb(NEW) - ARRAY['status', 'activated_at', 'lifecycle_revision', 'updated_at']
                IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'activated_at', 'lifecycle_revision', 'updated_at']
            OR OLD.status NOT IN ('draft', 'submitted', 'review', 'info_required', 'approved', 'rejected', 'withdrawn')
            OR OLD.activated_at IS NOT NULL OR NEW.status IS DISTINCT FROM 'active'
            OR NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1
            OR provider.uuid IS NULL OR provider.applied_at IS NULL
            OR NEW.activated_at IS DISTINCT FROM provider.applied_at
            OR NOT COALESCE(companies_current_activation_source(provider), false)
            OR provider.status <> 'passed' OR provider.completed_at IS NULL
            OR OLD.registry_status <> 'passed' OR OLD.registry_purpose <> 'activation'
            OR OLD.registry_revision IS DISTINCT FROM OLD.lifecycle_revision
        THEN RAISE EXCEPTION 'Activation requires its exact current personal appointment and applied provider receipt'
            USING ERRCODE = '23514'; END IF;
    ELSIF operation IN ('workflow', 'admin_workflow') THEN
        IF operation = 'admin_workflow' AND NOT (actor.is_superuser OR EXISTS (SELECT 1 FROM auth_permission permission
            JOIN django_content_type kind ON kind.id = permission.content_type_id
            WHERE kind.app_label = 'companies' AND permission.codename = 'change_company'
                AND (EXISTS (SELECT 1 FROM authentication_customuser_user_permissions assigned
                    WHERE assigned.customuser_id = actor.id AND assigned.permission_id = permission.id)
                OR EXISTS (SELECT 1 FROM authentication_customuser_groups member JOIN auth_group_permissions assigned
                    ON assigned.group_id = member.group_id WHERE member.customuser_id = actor.id AND assigned.permission_id = permission.id))))
        THEN RAISE EXCEPTION 'Technical recovery requires current model change permission' USING ERRCODE = '23514'; END IF;
        allowed := ARRAY['status', 'lifecycle_revision', 'warning_issued_at', 'warning_reason', 'suspended_at',
            'suspension_reason', 'delisted_at', 'delisting_reason', 'declarant_name', 'board_resolution_reference',
            'officeholder_attested_by_id', 'officeholder_attested_at', 'officeholder_attestation', 'updated_at'];
        SELECT * INTO provider FROM companies_companyregistrycheck WHERE uuid = OLD.registry_check_id FOR SHARE;
        IF actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_staff
            OR to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed
            OR OLD.status NOT IN ('active', 'warning', 'suspended')
            OR (NEW.officeholder_attested_by_id IS DISTINCT FROM OLD.officeholder_attested_by_id
                AND NEW.officeholder_attested_by_id IS DISTINCT FROM actor.id)
            OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1)
            OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
                (OLD.status IN ('warning', 'suspended') AND NEW.status = 'active')
                OR (OLD.status = 'active' AND NEW.status = 'warning')
                OR (OLD.status IN ('active', 'warning') AND NEW.status = 'suspended')
                OR NEW.status = 'delisted'))
            OR (NEW.status = 'active' AND OLD.status <> 'active' AND (
                provider.uuid IS NULL OR provider.initiated_by_id IS DISTINCT FROM actor.id
                OR provider.status <> 'passed' OR provider.purpose <> 'activation' OR provider.completed_at IS NULL
                OR provider.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision
                OR provider.requested_name IS DISTINCT FROM OLD.name OR provider.requested_acn IS DISTINCT FROM OLD.acn
                OR provider.requested_abn IS DISTINCT FROM OLD.abn
                OR OLD.registry_status <> 'passed' OR OLD.registry_purpose <> 'activation'
                OR OLD.registry_checked_at IS NULL OR OLD.registry_revision IS DISTINCT FROM OLD.lifecycle_revision
                OR (NOT EXISTS (SELECT 1 FROM companies_companyregistrycheck receipt
                    WHERE receipt.company_id = OLD.uuid AND receipt.applied_at IS NOT NULL
                        AND receipt.initiating_appointment_id IS NOT NULL)
                    AND (OLD.officeholder_attested_by_id IS NULL OR OLD.officeholder_attested_at IS NULL
                        OR OLD.declarant_name = '' OR OLD.board_resolution_reference = ''))))
        THEN RAISE EXCEPTION 'Retain technical company recovery and its current provider safeguards'
            USING ERRCODE = '23514'; END IF;
    ELSE RAISE EXCEPTION 'Use a bounded company command' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_document_administration()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issuer_id uuid;
    actor authentication_customuser;
    principal bigint;
    operation text;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    issuer_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF current_user <> @OPERATOR_ROLE@ OR principal IS NULL
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
                    || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](pdf|png|jpg|jpeg)$')
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
$function$;

CREATE OR REPLACE FUNCTION public.companies_lock_document_command()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation text;
    issuer_id uuid;
    admitted boolean;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN RETURN NULL; END IF;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF TG_TABLE_NAME = 'offerings_offering_documents' AND operation <> 'document_delete' THEN RETURN NULL; END IF;
    issuer_id := NULLIF(current_setting('app.company_id', true), '')::uuid;
    IF current_user <> @OPERATOR_ROLE@ OR NULLIF(current_setting('app.user_id', true), '')::bigint IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_document_removal()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issuer_id uuid;
    published boolean;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN RETURN OLD; END IF;
    IF COALESCE(current_setting('app.company_operation', true), '') <> 'document_delete' THEN RETURN OLD; END IF;
    SELECT company_id INTO issuer_id FROM companies_companydocument WHERE uuid = OLD.companydocument_id;
    IF current_user <> @OPERATOR_ROLE@
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM issuer_id
        OR NOT companies_locked_administration(issuer_id)
    THEN RAISE EXCEPTION 'Document removal requires its exact current company administrator' USING ERRCODE = '23514'; END IF;
    SELECT status IN ('approved', 'closed') INTO published FROM offerings_offering WHERE uuid = OLD.offering_id FOR SHARE;
    IF published OR NOT companies_locked_administration(issuer_id) THEN
        RAISE EXCEPTION 'Retain published documents and current administration after offering locks' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_canonical_name(value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
DECLARE
    casefold_map CONSTANT jsonb := E'{"65":"a","66":"b","67":"c","68":"d","69":"e","70":"f","71":"g","72":"h","73":"i","74":"j","75":"k","76":"l","77":"m","78":"n","79":"o","80":"p","81":"q","82":"r","83":"s","84":"t","85":"u","86":"v","87":"w","88":"x","89":"y","90":"z","181":"\\u03bc","192":"\\u00e0","193":"\\u00e1","194":"\\u00e2","195":"\\u00e3","196":"\\u00e4","197":"\\u00e5","198":"\\u00e6","199":"\\u00e7","200":"\\u00e8","201":"\\u00e9","202":"\\u00ea","203":"\\u00eb","204":"\\u00ec","205":"\\u00ed","206":"\\u00ee","207":"\\u00ef","208":"\\u00f0","209":"\\u00f1","210":"\\u00f2","211":"\\u00f3","212":"\\u00f4","213":"\\u00f5","214":"\\u00f6","216":"\\u00f8","217":"\\u00f9","218":"\\u00fa","219":"\\u00fb","220":"\\u00fc","221":"\\u00fd","222":"\\u00fe","223":"ss","256":"\\u0101","258":"\\u0103","260":"\\u0105","262":"\\u0107","264":"\\u0109","266":"\\u010b","268":"\\u010d","270":"\\u010f","272":"\\u0111","274":"\\u0113","276":"\\u0115","278":"\\u0117","280":"\\u0119","282":"\\u011b","284":"\\u011d","286":"\\u011f","288":"\\u0121","290":"\\u0123","292":"\\u0125","294":"\\u0127","296":"\\u0129","298":"\\u012b","300":"\\u012d","302":"\\u012f","304":"i\\u0307","306":"\\u0133","308":"\\u0135","310":"\\u0137","313":"\\u013a","315":"\\u013c","317":"\\u013e","319":"\\u0140","321":"\\u0142","323":"\\u0144","325":"\\u0146","327":"\\u0148","329":"\\u02bcn","330":"\\u014b","332":"\\u014d","334":"\\u014f","336":"\\u0151","338":"\\u0153","340":"\\u0155","342":"\\u0157","344":"\\u0159","346":"\\u015b","348":"\\u015d","350":"\\u015f","352":"\\u0161","354":"\\u0163","356":"\\u0165","358":"\\u0167","360":"\\u0169","362":"\\u016b","364":"\\u016d","366":"\\u016f","368":"\\u0171","370":"\\u0173","372":"\\u0175","374":"\\u0177","376":"\\u00ff","377":"\\u017a","379":"\\u017c","381":"\\u017e","383":"s","385":"\\u0253","386":"\\u0183","388":"\\u0185","390":"\\u0254","391":"\\u0188","393":"\\u0256","394":"\\u0257","395":"\\u018c","398":"\\u01dd","399":"\\u0259","400":"\\u025b","401":"\\u0192","403":"\\u0260","404":"\\u0263","406":"\\u0269","407":"\\u0268","408":"\\u0199","412":"\\u026f","413":"\\u0272","415":"\\u0275","416":"\\u01a1","418":"\\u01a3","420":"\\u01a5","422":"\\u0280","423":"\\u01a8","425":"\\u0283","428":"\\u01ad","430":"\\u0288","431":"\\u01b0","433":"\\u028a","434":"\\u028b","435":"\\u01b4","437":"\\u01b6","439":"\\u0292","440":"\\u01b9","444":"\\u01bd","452":"\\u01c6","453":"\\u01c6","455":"\\u01c9","456":"\\u01c9","458":"\\u01cc","459":"\\u01cc","461":"\\u01ce","463":"\\u01d0","465":"\\u01d2","467":"\\u01d4","469":"\\u01d6","471":"\\u01d8","473":"\\u01da","475":"\\u01dc","478":"\\u01df","480":"\\u01e1","482":"\\u01e3","484":"\\u01e5","486":"\\u01e7","488":"\\u01e9","490":"\\u01eb","492":"\\u01ed","494":"\\u01ef","496":"j\\u030c","497":"\\u01f3","498":"\\u01f3","500":"\\u01f5","502":"\\u0195","503":"\\u01bf","504":"\\u01f9","506":"\\u01fb","508":"\\u01fd","510":"\\u01ff","512":"\\u0201","514":"\\u0203","516":"\\u0205","518":"\\u0207","520":"\\u0209","522":"\\u020b","524":"\\u020d","526":"\\u020f","528":"\\u0211","530":"\\u0213","532":"\\u0215","534":"\\u0217","536":"\\u0219","538":"\\u021b","540":"\\u021d","542":"\\u021f","544":"\\u019e","546":"\\u0223","548":"\\u0225","550":"\\u0227","552":"\\u0229","554":"\\u022b","556":"\\u022d","558":"\\u022f","560":"\\u0231","562":"\\u0233","570":"\\u2c65","571":"\\u023c","573":"\\u019a","574":"\\u2c66","577":"\\u0242","579":"\\u0180","580":"\\u0289","581":"\\u028c","582":"\\u0247","584":"\\u0249","586":"\\u024b","588":"\\u024d","590":"\\u024f","837":"\\u03b9","880":"\\u0371","882":"\\u0373","886":"\\u0377","895":"\\u03f3","902":"\\u03ac","904":"\\u03ad","905":"\\u03ae","906":"\\u03af","908":"\\u03cc","910":"\\u03cd","911":"\\u03ce","912":"\\u03b9\\u0308\\u0301","913":"\\u03b1","914":"\\u03b2","915":"\\u03b3","916":"\\u03b4","917":"\\u03b5","918":"\\u03b6","919":"\\u03b7","920":"\\u03b8","921":"\\u03b9","922":"\\u03ba","923":"\\u03bb","924":"\\u03bc","925":"\\u03bd","926":"\\u03be","927":"\\u03bf","928":"\\u03c0","929":"\\u03c1","931":"\\u03c3","932":"\\u03c4","933":"\\u03c5","934":"\\u03c6","935":"\\u03c7","936":"\\u03c8","937":"\\u03c9","938":"\\u03ca","939":"\\u03cb","944":"\\u03c5\\u0308\\u0301","962":"\\u03c3","975":"\\u03d7","976":"\\u03b2","977":"\\u03b8","981":"\\u03c6","982":"\\u03c0","984":"\\u03d9","986":"\\u03db","988":"\\u03dd","990":"\\u03df","992":"\\u03e1","994":"\\u03e3","996":"\\u03e5","998":"\\u03e7","1000":"\\u03e9","1002":"\\u03eb","1004":"\\u03ed","1006":"\\u03ef","1008":"\\u03ba","1009":"\\u03c1","1012":"\\u03b8","1013":"\\u03b5","1015":"\\u03f8","1017":"\\u03f2","1018":"\\u03fb","1021":"\\u037b","1022":"\\u037c","1023":"\\u037d","1024":"\\u0450","1025":"\\u0451","1026":"\\u0452","1027":"\\u0453","1028":"\\u0454","1029":"\\u0455","1030":"\\u0456","1031":"\\u0457","1032":"\\u0458","1033":"\\u0459","1034":"\\u045a","1035":"\\u045b","1036":"\\u045c","1037":"\\u045d","1038":"\\u045e","1039":"\\u045f","1040":"\\u0430","1041":"\\u0431","1042":"\\u0432","1043":"\\u0433","1044":"\\u0434","1045":"\\u0435","1046":"\\u0436","1047":"\\u0437","1048":"\\u0438","1049":"\\u0439","1050":"\\u043a","1051":"\\u043b","1052":"\\u043c","1053":"\\u043d","1054":"\\u043e","1055":"\\u043f","1056":"\\u0440","1057":"\\u0441","1058":"\\u0442","1059":"\\u0443","1060":"\\u0444","1061":"\\u0445","1062":"\\u0446","1063":"\\u0447","1064":"\\u0448","1065":"\\u0449","1066":"\\u044a","1067":"\\u044b","1068":"\\u044c","1069":"\\u044d","1070":"\\u044e","1071":"\\u044f","1120":"\\u0461","1122":"\\u0463","1124":"\\u0465","1126":"\\u0467","1128":"\\u0469","1130":"\\u046b","1132":"\\u046d","1134":"\\u046f","1136":"\\u0471","1138":"\\u0473","1140":"\\u0475","1142":"\\u0477","1144":"\\u0479","1146":"\\u047b","1148":"\\u047d","1150":"\\u047f","1152":"\\u0481","1162":"\\u048b","1164":"\\u048d","1166":"\\u048f","1168":"\\u0491","1170":"\\u0493","1172":"\\u0495","1174":"\\u0497","1176":"\\u0499","1178":"\\u049b","1180":"\\u049d","1182":"\\u049f","1184":"\\u04a1","1186":"\\u04a3","1188":"\\u04a5","1190":"\\u04a7","1192":"\\u04a9","1194":"\\u04ab","1196":"\\u04ad","1198":"\\u04af","1200":"\\u04b1","1202":"\\u04b3","1204":"\\u04b5","1206":"\\u04b7","1208":"\\u04b9","1210":"\\u04bb","1212":"\\u04bd","1214":"\\u04bf","1216":"\\u04cf","1217":"\\u04c2","1219":"\\u04c4","1221":"\\u04c6","1223":"\\u04c8","1225":"\\u04ca","1227":"\\u04cc","1229":"\\u04ce","1232":"\\u04d1","1234":"\\u04d3","1236":"\\u04d5","1238":"\\u04d7","1240":"\\u04d9","1242":"\\u04db","1244":"\\u04dd","1246":"\\u04df","1248":"\\u04e1","1250":"\\u04e3","1252":"\\u04e5","1254":"\\u04e7","1256":"\\u04e9","1258":"\\u04eb","1260":"\\u04ed","1262":"\\u04ef","1264":"\\u04f1","1266":"\\u04f3","1268":"\\u04f5","1270":"\\u04f7","1272":"\\u04f9","1274":"\\u04fb","1276":"\\u04fd","1278":"\\u04ff","1280":"\\u0501","1282":"\\u0503","1284":"\\u0505","1286":"\\u0507","1288":"\\u0509","1290":"\\u050b","1292":"\\u050d","1294":"\\u050f","1296":"\\u0511","1298":"\\u0513","1300":"\\u0515","1302":"\\u0517","1304":"\\u0519","1306":"\\u051b","1308":"\\u051d","1310":"\\u051f","1312":"\\u0521","1314":"\\u0523","1316":"\\u0525","1318":"\\u0527","1320":"\\u0529","1322":"\\u052b","1324":"\\u052d","1326":"\\u052f","1329":"\\u0561","1330":"\\u0562","1331":"\\u0563","1332":"\\u0564","1333":"\\u0565","1334":"\\u0566","1335":"\\u0567","1336":"\\u0568","1337":"\\u0569","1338":"\\u056a","1339":"\\u056b","1340":"\\u056c","1341":"\\u056d","1342":"\\u056e","1343":"\\u056f","1344":"\\u0570","1345":"\\u0571","1346":"\\u0572","1347":"\\u0573","1348":"\\u0574","1349":"\\u0575","1350":"\\u0576","1351":"\\u0577","1352":"\\u0578","1353":"\\u0579","1354":"\\u057a","1355":"\\u057b","1356":"\\u057c","1357":"\\u057d","1358":"\\u057e","1359":"\\u057f","1360":"\\u0580","1361":"\\u0581","1362":"\\u0582","1363":"\\u0583","1364":"\\u0584","1365":"\\u0585","1366":"\\u0586","1415":"\\u0565\\u0582","4256":"\\u2d00","4257":"\\u2d01","4258":"\\u2d02","4259":"\\u2d03","4260":"\\u2d04","4261":"\\u2d05","4262":"\\u2d06","4263":"\\u2d07","4264":"\\u2d08","4265":"\\u2d09","4266":"\\u2d0a","4267":"\\u2d0b","4268":"\\u2d0c","4269":"\\u2d0d","4270":"\\u2d0e","4271":"\\u2d0f","4272":"\\u2d10","4273":"\\u2d11","4274":"\\u2d12","4275":"\\u2d13","4276":"\\u2d14","4277":"\\u2d15","4278":"\\u2d16","4279":"\\u2d17","4280":"\\u2d18","4281":"\\u2d19","4282":"\\u2d1a","4283":"\\u2d1b","4284":"\\u2d1c","4285":"\\u2d1d","4286":"\\u2d1e","4287":"\\u2d1f","4288":"\\u2d20","4289":"\\u2d21","4290":"\\u2d22","4291":"\\u2d23","4292":"\\u2d24","4293":"\\u2d25","4295":"\\u2d27","4301":"\\u2d2d","5112":"\\u13f0","5113":"\\u13f1","5114":"\\u13f2","5115":"\\u13f3","5116":"\\u13f4","5117":"\\u13f5","7296":"\\u0432","7297":"\\u0434","7298":"\\u043e","7299":"\\u0441","7300":"\\u0442","7301":"\\u0442","7302":"\\u044a","7303":"\\u0463","7304":"\\ua64b","7312":"\\u10d0","7313":"\\u10d1","7314":"\\u10d2","7315":"\\u10d3","7316":"\\u10d4","7317":"\\u10d5","7318":"\\u10d6","7319":"\\u10d7","7320":"\\u10d8","7321":"\\u10d9","7322":"\\u10da","7323":"\\u10db","7324":"\\u10dc","7325":"\\u10dd","7326":"\\u10de","7327":"\\u10df","7328":"\\u10e0","7329":"\\u10e1","7330":"\\u10e2","7331":"\\u10e3","7332":"\\u10e4","7333":"\\u10e5","7334":"\\u10e6","7335":"\\u10e7","7336":"\\u10e8","7337":"\\u10e9","7338":"\\u10ea","7339":"\\u10eb","7340":"\\u10ec","7341":"\\u10ed","7342":"\\u10ee","7343":"\\u10ef","7344":"\\u10f0","7345":"\\u10f1","7346":"\\u10f2","7347":"\\u10f3","7348":"\\u10f4","7349":"\\u10f5","7350":"\\u10f6","7351":"\\u10f7","7352":"\\u10f8","7353":"\\u10f9","7354":"\\u10fa","7357":"\\u10fd","7358":"\\u10fe","7359":"\\u10ff","7680":"\\u1e01","7682":"\\u1e03","7684":"\\u1e05","7686":"\\u1e07","7688":"\\u1e09","7690":"\\u1e0b","7692":"\\u1e0d","7694":"\\u1e0f","7696":"\\u1e11","7698":"\\u1e13","7700":"\\u1e15","7702":"\\u1e17","7704":"\\u1e19","7706":"\\u1e1b","7708":"\\u1e1d","7710":"\\u1e1f","7712":"\\u1e21","7714":"\\u1e23","7716":"\\u1e25","7718":"\\u1e27","7720":"\\u1e29","7722":"\\u1e2b","7724":"\\u1e2d","7726":"\\u1e2f","7728":"\\u1e31","7730":"\\u1e33","7732":"\\u1e35","7734":"\\u1e37","7736":"\\u1e39","7738":"\\u1e3b","7740":"\\u1e3d","7742":"\\u1e3f","7744":"\\u1e41","7746":"\\u1e43","7748":"\\u1e45","7750":"\\u1e47","7752":"\\u1e49","7754":"\\u1e4b","7756":"\\u1e4d","7758":"\\u1e4f","7760":"\\u1e51","7762":"\\u1e53","7764":"\\u1e55","7766":"\\u1e57","7768":"\\u1e59","7770":"\\u1e5b","7772":"\\u1e5d","7774":"\\u1e5f","7776":"\\u1e61","7778":"\\u1e63","7780":"\\u1e65","7782":"\\u1e67","7784":"\\u1e69","7786":"\\u1e6b","7788":"\\u1e6d","7790":"\\u1e6f","7792":"\\u1e71","7794":"\\u1e73","7796":"\\u1e75","7798":"\\u1e77","7800":"\\u1e79","7802":"\\u1e7b","7804":"\\u1e7d","7806":"\\u1e7f","7808":"\\u1e81","7810":"\\u1e83","7812":"\\u1e85","7814":"\\u1e87","7816":"\\u1e89","7818":"\\u1e8b","7820":"\\u1e8d","7822":"\\u1e8f","7824":"\\u1e91","7826":"\\u1e93","7828":"\\u1e95","7830":"h\\u0331","7831":"t\\u0308","7832":"w\\u030a","7833":"y\\u030a","7834":"a\\u02be","7835":"\\u1e61","7838":"ss","7840":"\\u1ea1","7842":"\\u1ea3","7844":"\\u1ea5","7846":"\\u1ea7","7848":"\\u1ea9","7850":"\\u1eab","7852":"\\u1ead","7854":"\\u1eaf","7856":"\\u1eb1","7858":"\\u1eb3","7860":"\\u1eb5","7862":"\\u1eb7","7864":"\\u1eb9","7866":"\\u1ebb","7868":"\\u1ebd","7870":"\\u1ebf","7872":"\\u1ec1","7874":"\\u1ec3","7876":"\\u1ec5","7878":"\\u1ec7","7880":"\\u1ec9","7882":"\\u1ecb","7884":"\\u1ecd","7886":"\\u1ecf","7888":"\\u1ed1","7890":"\\u1ed3","7892":"\\u1ed5","7894":"\\u1ed7","7896":"\\u1ed9","7898":"\\u1edb","7900":"\\u1edd","7902":"\\u1edf","7904":"\\u1ee1","7906":"\\u1ee3","7908":"\\u1ee5","7910":"\\u1ee7","7912":"\\u1ee9","7914":"\\u1eeb","7916":"\\u1eed","7918":"\\u1eef","7920":"\\u1ef1","7922":"\\u1ef3","7924":"\\u1ef5","7926":"\\u1ef7","7928":"\\u1ef9","7930":"\\u1efb","7932":"\\u1efd","7934":"\\u1eff","7944":"\\u1f00","7945":"\\u1f01","7946":"\\u1f02","7947":"\\u1f03","7948":"\\u1f04","7949":"\\u1f05","7950":"\\u1f06","7951":"\\u1f07","7960":"\\u1f10","7961":"\\u1f11","7962":"\\u1f12","7963":"\\u1f13","7964":"\\u1f14","7965":"\\u1f15","7976":"\\u1f20","7977":"\\u1f21","7978":"\\u1f22","7979":"\\u1f23","7980":"\\u1f24","7981":"\\u1f25","7982":"\\u1f26","7983":"\\u1f27","7992":"\\u1f30","7993":"\\u1f31","7994":"\\u1f32","7995":"\\u1f33","7996":"\\u1f34","7997":"\\u1f35","7998":"\\u1f36","7999":"\\u1f37","8008":"\\u1f40","8009":"\\u1f41","8010":"\\u1f42","8011":"\\u1f43","8012":"\\u1f44","8013":"\\u1f45","8016":"\\u03c5\\u0313","8018":"\\u03c5\\u0313\\u0300","8020":"\\u03c5\\u0313\\u0301","8022":"\\u03c5\\u0313\\u0342","8025":"\\u1f51","8027":"\\u1f53","8029":"\\u1f55","8031":"\\u1f57","8040":"\\u1f60","8041":"\\u1f61","8042":"\\u1f62","8043":"\\u1f63","8044":"\\u1f64","8045":"\\u1f65","8046":"\\u1f66","8047":"\\u1f67","8064":"\\u1f00\\u03b9","8065":"\\u1f01\\u03b9","8066":"\\u1f02\\u03b9","8067":"\\u1f03\\u03b9","8068":"\\u1f04\\u03b9","8069":"\\u1f05\\u03b9","8070":"\\u1f06\\u03b9","8071":"\\u1f07\\u03b9","8072":"\\u1f00\\u03b9","8073":"\\u1f01\\u03b9","8074":"\\u1f02\\u03b9","8075":"\\u1f03\\u03b9","8076":"\\u1f04\\u03b9","8077":"\\u1f05\\u03b9","8078":"\\u1f06\\u03b9","8079":"\\u1f07\\u03b9","8080":"\\u1f20\\u03b9","8081":"\\u1f21\\u03b9","8082":"\\u1f22\\u03b9","8083":"\\u1f23\\u03b9","8084":"\\u1f24\\u03b9","8085":"\\u1f25\\u03b9","8086":"\\u1f26\\u03b9","8087":"\\u1f27\\u03b9","8088":"\\u1f20\\u03b9","8089":"\\u1f21\\u03b9","8090":"\\u1f22\\u03b9","8091":"\\u1f23\\u03b9","8092":"\\u1f24\\u03b9","8093":"\\u1f25\\u03b9","8094":"\\u1f26\\u03b9","8095":"\\u1f27\\u03b9","8096":"\\u1f60\\u03b9","8097":"\\u1f61\\u03b9","8098":"\\u1f62\\u03b9","8099":"\\u1f63\\u03b9","8100":"\\u1f64\\u03b9","8101":"\\u1f65\\u03b9","8102":"\\u1f66\\u03b9","8103":"\\u1f67\\u03b9","8104":"\\u1f60\\u03b9","8105":"\\u1f61\\u03b9","8106":"\\u1f62\\u03b9","8107":"\\u1f63\\u03b9","8108":"\\u1f64\\u03b9","8109":"\\u1f65\\u03b9","8110":"\\u1f66\\u03b9","8111":"\\u1f67\\u03b9","8114":"\\u1f70\\u03b9","8115":"\\u03b1\\u03b9","8116":"\\u03ac\\u03b9","8118":"\\u03b1\\u0342","8119":"\\u03b1\\u0342\\u03b9","8120":"\\u1fb0","8121":"\\u1fb1","8122":"\\u1f70","8123":"\\u1f71","8124":"\\u03b1\\u03b9","8126":"\\u03b9","8130":"\\u1f74\\u03b9","8131":"\\u03b7\\u03b9","8132":"\\u03ae\\u03b9","8134":"\\u03b7\\u0342","8135":"\\u03b7\\u0342\\u03b9","8136":"\\u1f72","8137":"\\u1f73","8138":"\\u1f74","8139":"\\u1f75","8140":"\\u03b7\\u03b9","8146":"\\u03b9\\u0308\\u0300","8147":"\\u03b9\\u0308\\u0301","8150":"\\u03b9\\u0342","8151":"\\u03b9\\u0308\\u0342","8152":"\\u1fd0","8153":"\\u1fd1","8154":"\\u1f76","8155":"\\u1f77","8162":"\\u03c5\\u0308\\u0300","8163":"\\u03c5\\u0308\\u0301","8164":"\\u03c1\\u0313","8166":"\\u03c5\\u0342","8167":"\\u03c5\\u0308\\u0342","8168":"\\u1fe0","8169":"\\u1fe1","8170":"\\u1f7a","8171":"\\u1f7b","8172":"\\u1fe5","8178":"\\u1f7c\\u03b9","8179":"\\u03c9\\u03b9","8180":"\\u03ce\\u03b9","8182":"\\u03c9\\u0342","8183":"\\u03c9\\u0342\\u03b9","8184":"\\u1f78","8185":"\\u1f79","8186":"\\u1f7c","8187":"\\u1f7d","8188":"\\u03c9\\u03b9","8486":"\\u03c9","8490":"k","8491":"\\u00e5","8498":"\\u214e","8544":"\\u2170","8545":"\\u2171","8546":"\\u2172","8547":"\\u2173","8548":"\\u2174","8549":"\\u2175","8550":"\\u2176","8551":"\\u2177","8552":"\\u2178","8553":"\\u2179","8554":"\\u217a","8555":"\\u217b","8556":"\\u217c","8557":"\\u217d","8558":"\\u217e","8559":"\\u217f","8579":"\\u2184","9398":"\\u24d0","9399":"\\u24d1","9400":"\\u24d2","9401":"\\u24d3","9402":"\\u24d4","9403":"\\u24d5","9404":"\\u24d6","9405":"\\u24d7","9406":"\\u24d8","9407":"\\u24d9","9408":"\\u24da","9409":"\\u24db","9410":"\\u24dc","9411":"\\u24dd","9412":"\\u24de","9413":"\\u24df","9414":"\\u24e0","9415":"\\u24e1","9416":"\\u24e2","9417":"\\u24e3","9418":"\\u24e4","9419":"\\u24e5","9420":"\\u24e6","9421":"\\u24e7","9422":"\\u24e8","9423":"\\u24e9","11264":"\\u2c30","11265":"\\u2c31","11266":"\\u2c32","11267":"\\u2c33","11268":"\\u2c34","11269":"\\u2c35","11270":"\\u2c36","11271":"\\u2c37","11272":"\\u2c38","11273":"\\u2c39","11274":"\\u2c3a","11275":"\\u2c3b","11276":"\\u2c3c","11277":"\\u2c3d","11278":"\\u2c3e","11279":"\\u2c3f","11280":"\\u2c40","11281":"\\u2c41","11282":"\\u2c42","11283":"\\u2c43","11284":"\\u2c44","11285":"\\u2c45","11286":"\\u2c46","11287":"\\u2c47","11288":"\\u2c48","11289":"\\u2c49","11290":"\\u2c4a","11291":"\\u2c4b","11292":"\\u2c4c","11293":"\\u2c4d","11294":"\\u2c4e","11295":"\\u2c4f","11296":"\\u2c50","11297":"\\u2c51","11298":"\\u2c52","11299":"\\u2c53","11300":"\\u2c54","11301":"\\u2c55","11302":"\\u2c56","11303":"\\u2c57","11304":"\\u2c58","11305":"\\u2c59","11306":"\\u2c5a","11307":"\\u2c5b","11308":"\\u2c5c","11309":"\\u2c5d","11310":"\\u2c5e","11311":"\\u2c5f","11360":"\\u2c61","11362":"\\u026b","11363":"\\u1d7d","11364":"\\u027d","11367":"\\u2c68","11369":"\\u2c6a","11371":"\\u2c6c","11373":"\\u0251","11374":"\\u0271","11375":"\\u0250","11376":"\\u0252","11378":"\\u2c73","11381":"\\u2c76","11390":"\\u023f","11391":"\\u0240","11392":"\\u2c81","11394":"\\u2c83","11396":"\\u2c85","11398":"\\u2c87","11400":"\\u2c89","11402":"\\u2c8b","11404":"\\u2c8d","11406":"\\u2c8f","11408":"\\u2c91","11410":"\\u2c93","11412":"\\u2c95","11414":"\\u2c97","11416":"\\u2c99","11418":"\\u2c9b","11420":"\\u2c9d","11422":"\\u2c9f","11424":"\\u2ca1","11426":"\\u2ca3","11428":"\\u2ca5","11430":"\\u2ca7","11432":"\\u2ca9","11434":"\\u2cab","11436":"\\u2cad","11438":"\\u2caf","11440":"\\u2cb1","11442":"\\u2cb3","11444":"\\u2cb5","11446":"\\u2cb7","11448":"\\u2cb9","11450":"\\u2cbb","11452":"\\u2cbd","11454":"\\u2cbf","11456":"\\u2cc1","11458":"\\u2cc3","11460":"\\u2cc5","11462":"\\u2cc7","11464":"\\u2cc9","11466":"\\u2ccb","11468":"\\u2ccd","11470":"\\u2ccf","11472":"\\u2cd1","11474":"\\u2cd3","11476":"\\u2cd5","11478":"\\u2cd7","11480":"\\u2cd9","11482":"\\u2cdb","11484":"\\u2cdd","11486":"\\u2cdf","11488":"\\u2ce1","11490":"\\u2ce3","11499":"\\u2cec","11501":"\\u2cee","11506":"\\u2cf3","42560":"\\ua641","42562":"\\ua643","42564":"\\ua645","42566":"\\ua647","42568":"\\ua649","42570":"\\ua64b","42572":"\\ua64d","42574":"\\ua64f","42576":"\\ua651","42578":"\\ua653","42580":"\\ua655","42582":"\\ua657","42584":"\\ua659","42586":"\\ua65b","42588":"\\ua65d","42590":"\\ua65f","42592":"\\ua661","42594":"\\ua663","42596":"\\ua665","42598":"\\ua667","42600":"\\ua669","42602":"\\ua66b","42604":"\\ua66d","42624":"\\ua681","42626":"\\ua683","42628":"\\ua685","42630":"\\ua687","42632":"\\ua689","42634":"\\ua68b","42636":"\\ua68d","42638":"\\ua68f","42640":"\\ua691","42642":"\\ua693","42644":"\\ua695","42646":"\\ua697","42648":"\\ua699","42650":"\\ua69b","42786":"\\ua723","42788":"\\ua725","42790":"\\ua727","42792":"\\ua729","42794":"\\ua72b","42796":"\\ua72d","42798":"\\ua72f","42802":"\\ua733","42804":"\\ua735","42806":"\\ua737","42808":"\\ua739","42810":"\\ua73b","42812":"\\ua73d","42814":"\\ua73f","42816":"\\ua741","42818":"\\ua743","42820":"\\ua745","42822":"\\ua747","42824":"\\ua749","42826":"\\ua74b","42828":"\\ua74d","42830":"\\ua74f","42832":"\\ua751","42834":"\\ua753","42836":"\\ua755","42838":"\\ua757","42840":"\\ua759","42842":"\\ua75b","42844":"\\ua75d","42846":"\\ua75f","42848":"\\ua761","42850":"\\ua763","42852":"\\ua765","42854":"\\ua767","42856":"\\ua769","42858":"\\ua76b","42860":"\\ua76d","42862":"\\ua76f","42873":"\\ua77a","42875":"\\ua77c","42877":"\\u1d79","42878":"\\ua77f","42880":"\\ua781","42882":"\\ua783","42884":"\\ua785","42886":"\\ua787","42891":"\\ua78c","42893":"\\u0265","42896":"\\ua791","42898":"\\ua793","42902":"\\ua797","42904":"\\ua799","42906":"\\ua79b","42908":"\\ua79d","42910":"\\ua79f","42912":"\\ua7a1","42914":"\\ua7a3","42916":"\\ua7a5","42918":"\\ua7a7","42920":"\\ua7a9","42922":"\\u0266","42923":"\\u025c","42924":"\\u0261","42925":"\\u026c","42926":"\\u026a","42928":"\\u029e","42929":"\\u0287","42930":"\\u029d","42931":"\\uab53","42932":"\\ua7b5","42934":"\\ua7b7","42936":"\\ua7b9","42938":"\\ua7bb","42940":"\\ua7bd","42942":"\\ua7bf","42944":"\\ua7c1","42946":"\\ua7c3","42948":"\\ua794","42949":"\\u0282","42950":"\\u1d8e","42951":"\\ua7c8","42953":"\\ua7ca","42960":"\\ua7d1","42966":"\\ua7d7","42968":"\\ua7d9","42997":"\\ua7f6","43888":"\\u13a0","43889":"\\u13a1","43890":"\\u13a2","43891":"\\u13a3","43892":"\\u13a4","43893":"\\u13a5","43894":"\\u13a6","43895":"\\u13a7","43896":"\\u13a8","43897":"\\u13a9","43898":"\\u13aa","43899":"\\u13ab","43900":"\\u13ac","43901":"\\u13ad","43902":"\\u13ae","43903":"\\u13af","43904":"\\u13b0","43905":"\\u13b1","43906":"\\u13b2","43907":"\\u13b3","43908":"\\u13b4","43909":"\\u13b5","43910":"\\u13b6","43911":"\\u13b7","43912":"\\u13b8","43913":"\\u13b9","43914":"\\u13ba","43915":"\\u13bb","43916":"\\u13bc","43917":"\\u13bd","43918":"\\u13be","43919":"\\u13bf","43920":"\\u13c0","43921":"\\u13c1","43922":"\\u13c2","43923":"\\u13c3","43924":"\\u13c4","43925":"\\u13c5","43926":"\\u13c6","43927":"\\u13c7","43928":"\\u13c8","43929":"\\u13c9","43930":"\\u13ca","43931":"\\u13cb","43932":"\\u13cc","43933":"\\u13cd","43934":"\\u13ce","43935":"\\u13cf","43936":"\\u13d0","43937":"\\u13d1","43938":"\\u13d2","43939":"\\u13d3","43940":"\\u13d4","43941":"\\u13d5","43942":"\\u13d6","43943":"\\u13d7","43944":"\\u13d8","43945":"\\u13d9","43946":"\\u13da","43947":"\\u13db","43948":"\\u13dc","43949":"\\u13dd","43950":"\\u13de","43951":"\\u13df","43952":"\\u13e0","43953":"\\u13e1","43954":"\\u13e2","43955":"\\u13e3","43956":"\\u13e4","43957":"\\u13e5","43958":"\\u13e6","43959":"\\u13e7","43960":"\\u13e8","43961":"\\u13e9","43962":"\\u13ea","43963":"\\u13eb","43964":"\\u13ec","43965":"\\u13ed","43966":"\\u13ee","43967":"\\u13ef","64256":"ff","64257":"fi","64258":"fl","64259":"ffi","64260":"ffl","64261":"st","64262":"st","64275":"\\u0574\\u0576","64276":"\\u0574\\u0565","64277":"\\u0574\\u056b","64278":"\\u057e\\u0576","64279":"\\u0574\\u056d","65313":"\\uff41","65314":"\\uff42","65315":"\\uff43","65316":"\\uff44","65317":"\\uff45","65318":"\\uff46","65319":"\\uff47","65320":"\\uff48","65321":"\\uff49","65322":"\\uff4a","65323":"\\uff4b","65324":"\\uff4c","65325":"\\uff4d","65326":"\\uff4e","65327":"\\uff4f","65328":"\\uff50","65329":"\\uff51","65330":"\\uff52","65331":"\\uff53","65332":"\\uff54","65333":"\\uff55","65334":"\\uff56","65335":"\\uff57","65336":"\\uff58","65337":"\\uff59","65338":"\\uff5a","66560":"\\ud801\\udc28","66561":"\\ud801\\udc29","66562":"\\ud801\\udc2a","66563":"\\ud801\\udc2b","66564":"\\ud801\\udc2c","66565":"\\ud801\\udc2d","66566":"\\ud801\\udc2e","66567":"\\ud801\\udc2f","66568":"\\ud801\\udc30","66569":"\\ud801\\udc31","66570":"\\ud801\\udc32","66571":"\\ud801\\udc33","66572":"\\ud801\\udc34","66573":"\\ud801\\udc35","66574":"\\ud801\\udc36","66575":"\\ud801\\udc37","66576":"\\ud801\\udc38","66577":"\\ud801\\udc39","66578":"\\ud801\\udc3a","66579":"\\ud801\\udc3b","66580":"\\ud801\\udc3c","66581":"\\ud801\\udc3d","66582":"\\ud801\\udc3e","66583":"\\ud801\\udc3f","66584":"\\ud801\\udc40","66585":"\\ud801\\udc41","66586":"\\ud801\\udc42","66587":"\\ud801\\udc43","66588":"\\ud801\\udc44","66589":"\\ud801\\udc45","66590":"\\ud801\\udc46","66591":"\\ud801\\udc47","66592":"\\ud801\\udc48","66593":"\\ud801\\udc49","66594":"\\ud801\\udc4a","66595":"\\ud801\\udc4b","66596":"\\ud801\\udc4c","66597":"\\ud801\\udc4d","66598":"\\ud801\\udc4e","66599":"\\ud801\\udc4f","66736":"\\ud801\\udcd8","66737":"\\ud801\\udcd9","66738":"\\ud801\\udcda","66739":"\\ud801\\udcdb","66740":"\\ud801\\udcdc","66741":"\\ud801\\udcdd","66742":"\\ud801\\udcde","66743":"\\ud801\\udcdf","66744":"\\ud801\\udce0","66745":"\\ud801\\udce1","66746":"\\ud801\\udce2","66747":"\\ud801\\udce3","66748":"\\ud801\\udce4","66749":"\\ud801\\udce5","66750":"\\ud801\\udce6","66751":"\\ud801\\udce7","66752":"\\ud801\\udce8","66753":"\\ud801\\udce9","66754":"\\ud801\\udcea","66755":"\\ud801\\udceb","66756":"\\ud801\\udcec","66757":"\\ud801\\udced","66758":"\\ud801\\udcee","66759":"\\ud801\\udcef","66760":"\\ud801\\udcf0","66761":"\\ud801\\udcf1","66762":"\\ud801\\udcf2","66763":"\\ud801\\udcf3","66764":"\\ud801\\udcf4","66765":"\\ud801\\udcf5","66766":"\\ud801\\udcf6","66767":"\\ud801\\udcf7","66768":"\\ud801\\udcf8","66769":"\\ud801\\udcf9","66770":"\\ud801\\udcfa","66771":"\\ud801\\udcfb","66928":"\\ud801\\udd97","66929":"\\ud801\\udd98","66930":"\\ud801\\udd99","66931":"\\ud801\\udd9a","66932":"\\ud801\\udd9b","66933":"\\ud801\\udd9c","66934":"\\ud801\\udd9d","66935":"\\ud801\\udd9e","66936":"\\ud801\\udd9f","66937":"\\ud801\\udda0","66938":"\\ud801\\udda1","66940":"\\ud801\\udda3","66941":"\\ud801\\udda4","66942":"\\ud801\\udda5","66943":"\\ud801\\udda6","66944":"\\ud801\\udda7","66945":"\\ud801\\udda8","66946":"\\ud801\\udda9","66947":"\\ud801\\uddaa","66948":"\\ud801\\uddab","66949":"\\ud801\\uddac","66950":"\\ud801\\uddad","66951":"\\ud801\\uddae","66952":"\\ud801\\uddaf","66953":"\\ud801\\uddb0","66954":"\\ud801\\uddb1","66956":"\\ud801\\uddb3","66957":"\\ud801\\uddb4","66958":"\\ud801\\uddb5","66959":"\\ud801\\uddb6","66960":"\\ud801\\uddb7","66961":"\\ud801\\uddb8","66962":"\\ud801\\uddb9","66964":"\\ud801\\uddbb","66965":"\\ud801\\uddbc","68736":"\\ud803\\udcc0","68737":"\\ud803\\udcc1","68738":"\\ud803\\udcc2","68739":"\\ud803\\udcc3","68740":"\\ud803\\udcc4","68741":"\\ud803\\udcc5","68742":"\\ud803\\udcc6","68743":"\\ud803\\udcc7","68744":"\\ud803\\udcc8","68745":"\\ud803\\udcc9","68746":"\\ud803\\udcca","68747":"\\ud803\\udccb","68748":"\\ud803\\udccc","68749":"\\ud803\\udccd","68750":"\\ud803\\udcce","68751":"\\ud803\\udccf","68752":"\\ud803\\udcd0","68753":"\\ud803\\udcd1","68754":"\\ud803\\udcd2","68755":"\\ud803\\udcd3","68756":"\\ud803\\udcd4","68757":"\\ud803\\udcd5","68758":"\\ud803\\udcd6","68759":"\\ud803\\udcd7","68760":"\\ud803\\udcd8","68761":"\\ud803\\udcd9","68762":"\\ud803\\udcda","68763":"\\ud803\\udcdb","68764":"\\ud803\\udcdc","68765":"\\ud803\\udcdd","68766":"\\ud803\\udcde","68767":"\\ud803\\udcdf","68768":"\\ud803\\udce0","68769":"\\ud803\\udce1","68770":"\\ud803\\udce2","68771":"\\ud803\\udce3","68772":"\\ud803\\udce4","68773":"\\ud803\\udce5","68774":"\\ud803\\udce6","68775":"\\ud803\\udce7","68776":"\\ud803\\udce8","68777":"\\ud803\\udce9","68778":"\\ud803\\udcea","68779":"\\ud803\\udceb","68780":"\\ud803\\udcec","68781":"\\ud803\\udced","68782":"\\ud803\\udcee","68783":"\\ud803\\udcef","68784":"\\ud803\\udcf0","68785":"\\ud803\\udcf1","68786":"\\ud803\\udcf2","71840":"\\ud806\\udcc0","71841":"\\ud806\\udcc1","71842":"\\ud806\\udcc2","71843":"\\ud806\\udcc3","71844":"\\ud806\\udcc4","71845":"\\ud806\\udcc5","71846":"\\ud806\\udcc6","71847":"\\ud806\\udcc7","71848":"\\ud806\\udcc8","71849":"\\ud806\\udcc9","71850":"\\ud806\\udcca","71851":"\\ud806\\udccb","71852":"\\ud806\\udccc","71853":"\\ud806\\udccd","71854":"\\ud806\\udcce","71855":"\\ud806\\udccf","71856":"\\ud806\\udcd0","71857":"\\ud806\\udcd1","71858":"\\ud806\\udcd2","71859":"\\ud806\\udcd3","71860":"\\ud806\\udcd4","71861":"\\ud806\\udcd5","71862":"\\ud806\\udcd6","71863":"\\ud806\\udcd7","71864":"\\ud806\\udcd8","71865":"\\ud806\\udcd9","71866":"\\ud806\\udcda","71867":"\\ud806\\udcdb","71868":"\\ud806\\udcdc","71869":"\\ud806\\udcdd","71870":"\\ud806\\udcde","71871":"\\ud806\\udcdf","93760":"\\ud81b\\ude60","93761":"\\ud81b\\ude61","93762":"\\ud81b\\ude62","93763":"\\ud81b\\ude63","93764":"\\ud81b\\ude64","93765":"\\ud81b\\ude65","93766":"\\ud81b\\ude66","93767":"\\ud81b\\ude67","93768":"\\ud81b\\ude68","93769":"\\ud81b\\ude69","93770":"\\ud81b\\ude6a","93771":"\\ud81b\\ude6b","93772":"\\ud81b\\ude6c","93773":"\\ud81b\\ude6d","93774":"\\ud81b\\ude6e","93775":"\\ud81b\\ude6f","93776":"\\ud81b\\ude70","93777":"\\ud81b\\ude71","93778":"\\ud81b\\ude72","93779":"\\ud81b\\ude73","93780":"\\ud81b\\ude74","93781":"\\ud81b\\ude75","93782":"\\ud81b\\ude76","93783":"\\ud81b\\ude77","93784":"\\ud81b\\ude78","93785":"\\ud81b\\ude79","93786":"\\ud81b\\ude7a","93787":"\\ud81b\\ude7b","93788":"\\ud81b\\ude7c","93789":"\\ud81b\\ude7d","93790":"\\ud81b\\ude7e","93791":"\\ud81b\\ude7f","125184":"\\ud83a\\udd22","125185":"\\ud83a\\udd23","125186":"\\ud83a\\udd24","125187":"\\ud83a\\udd25","125188":"\\ud83a\\udd26","125189":"\\ud83a\\udd27","125190":"\\ud83a\\udd28","125191":"\\ud83a\\udd29","125192":"\\ud83a\\udd2a","125193":"\\ud83a\\udd2b","125194":"\\ud83a\\udd2c","125195":"\\ud83a\\udd2d","125196":"\\ud83a\\udd2e","125197":"\\ud83a\\udd2f","125198":"\\ud83a\\udd30","125199":"\\ud83a\\udd31","125200":"\\ud83a\\udd32","125201":"\\ud83a\\udd33","125202":"\\ud83a\\udd34","125203":"\\ud83a\\udd35","125204":"\\ud83a\\udd36","125205":"\\ud83a\\udd37","125206":"\\ud83a\\udd38","125207":"\\ud83a\\udd39","125208":"\\ud83a\\udd3a","125209":"\\ud83a\\udd3b","125210":"\\ud83a\\udd3c","125211":"\\ud83a\\udd3d","125212":"\\ud83a\\udd3e","125213":"\\ud83a\\udd3f","125214":"\\ud83a\\udd40","125215":"\\ud83a\\udd41","125216":"\\ud83a\\udd42","125217":"\\ud83a\\udd43"}'::jsonb;
    whitespace CONSTANT integer[] := ARRAY[9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 5760,
        8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288];
    normalized text := normalize(value, NFKC);
    folded text := '';
    result text := '';
    scalar text;
    position integer;
    pending_space boolean := false;
BEGIN
    FOR position IN 1..char_length(normalized) LOOP
        scalar := substr(normalized, position, 1);
        folded := folded || COALESCE(casefold_map->>ascii(scalar)::text, scalar);
    END LOOP;
    FOR position IN 1..char_length(folded) LOOP
        scalar := substr(folded, position, 1);
        IF ascii(scalar) = ANY(whitespace) THEN
            pending_space := result <> '';
        ELSE
            IF pending_space THEN result := result || ' '; END IF;
            result := result || scalar;
            pending_space := false;
        END IF;
    END LOOP;
    RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_current_activation_source(receipt companies_companyregistrycheck)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
    issuer companies_company;
    actor authentication_customuser;
    profile users_userprofile;
    appointment companies_companyappointment;
    identity_required boolean;
    principal bigint;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO issuer FROM companies_company WHERE uuid = receipt.company_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    SELECT * INTO profile FROM users_userprofile WHERE user_id = principal FOR SHARE;
    SELECT issuer_kyc_required INTO identity_required FROM operators_operator WHERE id = 1 FOR SHARE;
    PERFORM 1 FROM companies_companyappointment WHERE company_id = issuer.uuid AND appointee_id = principal
        ORDER BY uuid FOR SHARE;
    SELECT * INTO appointment FROM companies_companyappointment WHERE uuid = receipt.initiating_appointment_id;
    RETURN actor.id IS NOT NULL AND actor.is_active AND actor.is_email_verified
        AND profile.uuid IS NOT NULL AND profile.user_id = actor.id
        AND appointment.uuid IS NOT NULL AND appointment.company_id = issuer.uuid AND appointment.appointee_id = actor.id
        AND appointment.appointee_profile_id = profile.uuid AND appointment.capabilities @> '["admin"]'::jsonb
        AND (appointment.expires_at IS NULL OR appointment.expires_at > clock_timestamp())
        AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation WHERE appointment_id = appointment.uuid)
        AND receipt.initiated_by_id = actor.id AND receipt.purpose = 'activation'
        AND receipt.idempotency_key IS NOT NULL AND receipt.lifecycle_revision = issuer.lifecycle_revision
        AND receipt.requested_name = issuer.name AND receipt.requested_acn = issuer.acn AND receipt.requested_abn = issuer.abn
        AND receipt.identity IS NOT DISTINCT FROM jsonb_build_object('name', companies_canonical_name(issuer.name),
            'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
        AND receipt.issuer_identity_required IS NOT DISTINCT FROM identity_required
        AND (NOT COALESCE(identity_required, false) OR profile.is_id_verified)
        AND receipt.declaration_version = '2026-10-04' AND receipt.declaration_text = 'I am authorised to act for this company. The company is responsible for the company and share information it provides, its ASIC filings and legal obligations.'
        AND (receipt.person_identity->>'verified_at')::timestamptz IS NOT DISTINCT FROM profile.verified_at
        AND receipt.person_identity - 'verified_at' = jsonb_build_object(
            'user_id', actor.id, 'profile_uuid', profile.uuid::text, 'email', actor.email,
            'full_name', COALESCE(profile.full_name, ''), 'is_id_verified', profile.is_id_verified,
            'kyc_provider', profile.kyc_provider, 'kycaid_applicant_id', profile.kycaid_applicant_id,
            'sumsub_applicant_id', profile.sumsub_applicant_id, 'verification_status', profile.verification_status,
            'review_result', profile.review_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_lock_registry_company()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    declared_company uuid;
    principal bigint;
    operation text;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN RETURN NULL; END IF;
    declared_company := NULLIF(current_setting('app.company_id', true), '')::uuid;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF current_user <> @OPERATOR_ROLE@ OR principal IS NULL OR declared_company IS NULL
        OR operation NOT IN ('registry', 'registry_result', 'activation')
    THEN RAISE EXCEPTION 'Registry statements require their exact declared company and actor command'
        USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM companies_company WHERE uuid = declared_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Registry statements require their existing declared company'
        USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_registry_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issuer companies_company;
    actor authentication_customuser;
    operation text;
    principal bigint;
    allowed text[];
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_operation', true), '');
    IF TG_OP = 'DELETE' OR current_user <> @OPERATOR_ROLE@ OR principal IS NULL
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM NEW.company_id
    THEN RAISE EXCEPTION 'Retain actor-bound registry checks and provider receipts' USING ERRCODE = '23514'; END IF;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    IF TG_OP = 'INSERT' THEN
        IF operation <> 'registry' OR actor.id IS NULL OR NOT actor.is_active OR NEW.initiated_by_id IS DISTINCT FROM actor.id
            OR NEW.company_id IS DISTINCT FROM issuer.uuid OR NEW.lifecycle_revision IS DISTINCT FROM issuer.lifecycle_revision
            OR NEW.requested_name IS DISTINCT FROM issuer.name OR NEW.requested_acn IS DISTINCT FROM issuer.acn
            OR NEW.requested_abn IS DISTINCT FROM issuer.abn
            OR NEW.identity IS DISTINCT FROM jsonb_build_object('name', companies_canonical_name(issuer.name),
                'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
            OR NEW.completed_at IS NOT NULL OR NEW.applied_at IS NOT NULL OR NEW.status <> 'pending' OR NEW.reason <> ''
            OR NEW.registry_abn <> '' OR NEW.registry_acn <> '' OR NEW.entity_name <> '' OR NEW.entity_type <> ''
            OR NEW.entity_status <> '' OR NEW.retrieved_at <> '' OR NEW.effective_from IS NOT NULL OR NEW.register_updated_at IS NOT NULL
            OR (NEW.initiating_appointment_id IS NOT NULL AND NOT COALESCE(companies_current_activation_source(NEW), false))
            OR (NEW.initiating_appointment_id IS NULL AND NOT (
                (NEW.purpose = 'authority' AND actor.is_email_verified AND issuer.owner_id = actor.id AND issuer.status = 'draft')
                OR (NEW.purpose IN ('retry', 'activation') AND actor.is_staff AND issuer.status IN ('active', 'warning', 'suspended'))))
        THEN RAISE EXCEPTION 'Registry admission requires the exact current company actor and pending provenance'
            USING ERRCODE = '23514'; END IF;
    ELSIF operation = 'activation' THEN
        IF to_jsonb(NEW) - ARRAY['applied_at', 'updated_at'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['applied_at', 'updated_at']
            OR OLD.applied_at IS NOT NULL OR NEW.applied_at IS NULL
            OR NEW.applied_at < transaction_timestamp() OR NEW.applied_at > clock_timestamp()
            OR issuer.registry_check_id IS DISTINCT FROM OLD.uuid OR issuer.activated_at IS NOT NULL
            OR issuer.status NOT IN ('draft', 'submitted', 'review', 'info_required', 'approved', 'rejected', 'withdrawn')
            OR OLD.status <> 'passed' OR OLD.completed_at IS NULL
            OR NOT COALESCE(companies_current_activation_source(OLD), false)
        THEN RAISE EXCEPTION 'An activation effect requires its exact current personal appointment and passed check'
            USING ERRCODE = '23514'; END IF;
    ELSE
        allowed := ARRAY['completed_at', 'status', 'reason', 'registry_abn', 'registry_acn', 'entity_name', 'entity_type',
            'entity_status', 'effective_from', 'retrieved_at', 'register_updated_at', 'updated_at'];
        IF operation <> 'registry_result' OR principal IS DISTINCT FROM OLD.initiated_by_id
            OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
            OR NEW.completed_at < transaction_timestamp() OR NEW.completed_at > clock_timestamp()
            OR to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed
            OR NEW.status NOT IN ('pending', 'failed', 'passed')
            OR (NEW.status = 'passed' AND (NEW.reason <> 'matched' OR NEW.registry_acn <> NEW.identity->>'acn'
                OR NEW.registry_abn = '' OR (NEW.identity->>'abn' <> '' AND NEW.registry_abn <> NEW.identity->>'abn')
                OR NEW.entity_name = ''
                OR companies_canonical_name(NEW.entity_name) IS DISTINCT FROM OLD.identity->>'name'
                OR lower(NEW.entity_status) <> 'active'
                OR NEW.entity_type <> CASE NEW.identity->>'company_type' WHEN 'pty' THEN 'PRV' ELSE 'PUB' END))
        THEN RAISE EXCEPTION 'Provider results require an immutable pending check and matching observed identifiers'
            USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.companies_guard_activation_effect()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issuer companies_company;
BEGIN
    IF NEW.applied_at IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id;
    IF issuer.activated_at IS DISTINCT FROM NEW.applied_at
        OR issuer.lifecycle_revision < NEW.lifecycle_revision + 1
        OR issuer.status NOT IN ('active', 'warning', 'suspended', 'delisted')
    THEN RAISE EXCEPTION 'Retain the single exact company activation effect with its receipt'
        USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER companies_document_verification BEFORE INSERT OR UPDATE ON companies_companydocument FOR EACH ROW EXECUTE FUNCTION companies_guard_document_verification();

CREATE TRIGGER companies_identity_document_verification AFTER UPDATE OF name, acn, abn, company_type, owner_id ON companies_company FOR EACH ROW EXECUTE FUNCTION companies_revoke_document_verification();

CREATE TRIGGER companies_authority_request_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyauthorityrequest FOR EACH ROW EXECUTE FUNCTION companies_guard_authority_request();

CREATE TRIGGER companies_authority_request_withdrawal_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyauthorityrequestwithdrawal FOR EACH ROW EXECUTE FUNCTION companies_guard_authority_request_withdrawal();

CREATE TRIGGER companies_initial_appointment_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyappointment FOR EACH ROW EXECUTE FUNCTION companies_guard_initial_appointment();

CREATE TRIGGER companies_appointment_revocation_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyappointmentrevocation FOR EACH ROW EXECUTE FUNCTION companies_guard_appointment_revocation();

CREATE TRIGGER companies_team_invitation_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyteaminvitation FOR EACH ROW EXECUTE FUNCTION companies_guard_team_invitation();

CREATE TRIGGER companies_legacy_owner_source_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companylegacyownersource FOR EACH ROW EXECUTE FUNCTION companies_guard_legacy_owner_source();

CREATE TRIGGER companies_administration BEFORE INSERT OR DELETE OR UPDATE ON companies_company FOR EACH ROW EXECUTE FUNCTION companies_guard_administration();

CREATE TRIGGER companies_document_administration BEFORE INSERT OR DELETE OR UPDATE ON companies_companydocument FOR EACH ROW EXECUTE FUNCTION companies_guard_document_administration();

CREATE TRIGGER companies_document_command_locks BEFORE DELETE OR UPDATE ON companies_companydocument FOR EACH STATEMENT EXECUTE FUNCTION companies_lock_document_command();

CREATE TRIGGER companies_document_removal_locks BEFORE DELETE ON offerings_offering_documents FOR EACH STATEMENT EXECUTE FUNCTION companies_lock_document_command();

CREATE TRIGGER companies_document_removal_authority BEFORE DELETE ON offerings_offering_documents FOR EACH ROW EXECUTE FUNCTION companies_guard_document_removal();

CREATE TRIGGER companies_registry_company_lock BEFORE INSERT OR DELETE OR UPDATE ON companies_companyregistrycheck FOR EACH STATEMENT EXECUTE FUNCTION companies_lock_registry_company();

CREATE TRIGGER companies_registry_receipt BEFORE INSERT OR DELETE OR UPDATE ON companies_companyregistrycheck FOR EACH ROW EXECUTE FUNCTION companies_guard_registry_receipt();

CREATE CONSTRAINT TRIGGER companies_activation_effect AFTER INSERT OR UPDATE ON companies_companyregistrycheck DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION companies_guard_activation_effect();
