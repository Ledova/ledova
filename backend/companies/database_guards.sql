CREATE OR REPLACE FUNCTION public.companies_guard_appointment_revocation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    actor authentication_customuser;
    appointment companies_companyappointment;
    principal bigint;
BEGIN
    IF TG_OP = 'DELETE' AND current_user = @MIGRATE_ROLE@ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
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
    IF TG_OP = 'DELETE' AND current_user = @MIGRATE_ROLE@ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
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
        OR candidate.request_id IS NOT NULL
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
    IF TG_OP = 'DELETE' AND current_user = @MIGRATE_ROLE@ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
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
    operation text;
    principal bigint;
    allowed text[];
    reviewed boolean;
    wallet wallets;
    wallet_account customer_accounts_account;
    wallet_profile users_userprofile;
BEGIN
    IF TG_OP = 'DELETE' AND current_user = @MIGRATE_ROLE@ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
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
            OR NEW.lifecycle_revision <> 0 OR NEW.activated_at IS NOT NULL
            OR NEW.warning_issued_at IS NOT NULL OR NEW.warning_reason <> ''
            OR NEW.suspended_at IS NOT NULL OR NEW.suspension_reason <> ''
            OR NEW.delisted_at IS NOT NULL OR NEW.delisting_reason <> ''
            OR NEW.declarant_name <> '' OR NEW.board_resolution_reference <> ''
            OR NEW.officeholder_attested_by_id IS NOT NULL OR NEW.officeholder_attested_at IS NOT NULL
            OR NEW.officeholder_attestation <> '{}'::jsonb OR NEW.operator_wallet_id IS NOT NULL
            OR NEW.share_ownership_with_members OR NEW.ownership_sharing_changed_by_id IS NOT NULL
            OR NEW.ownership_sharing_changed_at IS NOT NULL
        THEN RAISE EXCEPTION 'Registration records only the exact active owner draft' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF operation = 'edit' THEN
        IF NOT companies_locked_administration(OLD.uuid) THEN
            RAISE EXCEPTION 'Current personal company administration is required' USING ERRCODE = '23514';
        END IF;
        allowed := ARRAY['name', 'trading_name', 'company_type', 'acn', 'abn', 'declarant_name',
            'board_resolution_reference', 'phone', 'address_line_1', 'address_line_2', 'city', 'state', 'postcode',
            'country', 'description', 'industry', 'founded_year', 'operator_wallet_id',
            'share_ownership_with_members', 'ownership_sharing_changed_by_id', 'ownership_sharing_changed_at',
            'updated_at', 'lifecycle_revision'];
        IF NEW.share_ownership_with_members IS DISTINCT FROM OLD.share_ownership_with_members THEN
            IF NOT EXISTS (SELECT 1 FROM companies_companyappointment appointment
                WHERE appointment.company_id = OLD.uuid AND appointment.appointee_id = principal
                    AND tokens_register_appointment_current(appointment.uuid, OLD.uuid, principal, 'admin', clock_timestamp()))
            THEN RAISE EXCEPTION 'Ownership sharing needs current personal company administration' USING ERRCODE = '23514'; END IF;
            NEW.ownership_sharing_changed_by_id := principal;
            NEW.ownership_sharing_changed_at := clock_timestamp();
        ELSIF ROW(NEW.ownership_sharing_changed_by_id, NEW.ownership_sharing_changed_at)
            IS DISTINCT FROM ROW(OLD.ownership_sharing_changed_by_id, OLD.ownership_sharing_changed_at)
        THEN RAISE EXCEPTION 'Ownership sharing attribution follows the company choice' USING ERRCODE = '23514'; END IF;
        IF to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed
            OR (ROW(NEW.acn, NEW.abn) IS DISTINCT FROM ROW(OLD.acn, OLD.abn)
                AND NOT companies_valid_identifiers(NEW.acn, NEW.abn))
            OR NEW.company_type NOT IN ('pty', 'public', 'unlisted') OR NEW.name = ''
        THEN RAISE EXCEPTION 'Retain protected company fields and valid identifiers' USING ERRCODE = '23514'; END IF;
        reviewed := ROW(NEW.name, NEW.acn, NEW.abn, NEW.company_type, NEW.declarant_name, NEW.board_resolution_reference)
            IS DISTINCT FROM ROW(OLD.name, OLD.acn, OLD.abn, OLD.company_type, OLD.declarant_name, OLD.board_resolution_reference);
        IF (reviewed AND NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1)
            OR (NOT reviewed AND NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision)
        THEN RAISE EXCEPTION 'Identity edits must advance the company revision' USING ERRCODE = '23514'; END IF;
        IF NEW.operator_wallet_id IS DISTINCT FROM OLD.operator_wallet_id AND NEW.operator_wallet_id IS NOT NULL THEN
            IF wallet.uuid IS NULL OR wallet.verification_status <> 'VERIFIED' OR wallet.chain NOT IN ('base', 'ethereum')
                OR wallet_account.uuid IS NULL OR wallet_profile.uuid IS NULL OR wallet_profile.user_id IS DISTINCT FROM actor.id
            THEN RAISE EXCEPTION 'Select the actors current verified EVM wallet' USING ERRCODE = '23514'; END IF;
            IF NOT companies_locked_administration(OLD.uuid) THEN
                RAISE EXCEPTION 'Current administration must remain effective after wallet locks' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF operation = 'admission' THEN
        IF to_jsonb(NEW) - ARRAY['status', 'activated_at', 'lifecycle_revision', 'updated_at']
                IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'activated_at', 'lifecycle_revision', 'updated_at']
            OR OLD.status IS DISTINCT FROM 'draft' OR OLD.activated_at IS NOT NULL OR NEW.status IS DISTINCT FROM 'active'
            OR NEW.lifecycle_revision IS DISTINCT FROM OLD.lifecycle_revision + 1 OR OLD.owner_id IS DISTINCT FROM principal
            OR NEW.activated_at IS NULL OR NEW.activated_at < transaction_timestamp() OR NEW.activated_at > clock_timestamp()
            OR NOT EXISTS (SELECT 1 FROM companies_companyappointment appointment
                WHERE appointment.company_id = OLD.uuid AND appointment.appointee_id = principal
                    AND appointment.request_id IS NOT NULL
                    AND tokens_register_appointment_current(appointment.uuid, OLD.uuid, principal, 'admin', clock_timestamp()))
        THEN RAISE EXCEPTION 'Signup admission activates only the admitted owner draft' USING ERRCODE = '23514'; END IF;
    ELSIF operation = 'admin_workflow' THEN
        IF NOT (actor.is_superuser OR EXISTS (SELECT 1 FROM auth_permission permission
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
            OR (NEW.status = 'active' AND OLD.status <> 'active' AND OLD.activated_at IS NULL
                AND (OLD.officeholder_attested_by_id IS NULL OR OLD.officeholder_attested_at IS NULL
                    OR OLD.declarant_name = '' OR OLD.board_resolution_reference = ''))
        THEN RAISE EXCEPTION 'Retain technical company recovery and its safeguards'
            USING ERRCODE = '23514'; END IF;
    ELSE RAISE EXCEPTION 'Use a bounded company command' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER companies_authority_request_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyauthorityrequest FOR EACH ROW EXECUTE FUNCTION companies_guard_authority_request();

CREATE TRIGGER companies_authority_request_withdrawal_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyauthorityrequestwithdrawal FOR EACH ROW EXECUTE FUNCTION companies_guard_authority_request_withdrawal();

CREATE TRIGGER companies_initial_appointment_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyappointment FOR EACH ROW EXECUTE FUNCTION companies_guard_initial_appointment();

CREATE TRIGGER companies_appointment_revocation_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyappointmentrevocation FOR EACH ROW EXECUTE FUNCTION companies_guard_appointment_revocation();

CREATE TRIGGER companies_team_invitation_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companyteaminvitation FOR EACH ROW EXECUTE FUNCTION companies_guard_team_invitation();

CREATE TRIGGER companies_legacy_owner_source_identity BEFORE INSERT OR DELETE OR UPDATE ON companies_companylegacyownersource FOR EACH ROW EXECUTE FUNCTION companies_guard_legacy_owner_source();

CREATE TRIGGER companies_administration BEFORE INSERT OR DELETE OR UPDATE ON companies_company FOR EACH ROW EXECUTE FUNCTION companies_guard_administration();
