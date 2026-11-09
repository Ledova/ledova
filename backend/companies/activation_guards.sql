CREATE OR REPLACE FUNCTION public.companies_current_activation_source(receipt companies_companyactivation)
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
    SELECT * INTO appointment FROM companies_companyappointment WHERE uuid = receipt.appointment_id;
    RETURN actor.id IS NOT NULL AND actor.is_active AND actor.is_email_verified
        AND profile.uuid IS NOT NULL AND profile.user_id = actor.id
        AND appointment.uuid IS NOT NULL AND appointment.company_id = issuer.uuid AND appointment.appointee_id = actor.id
        AND appointment.appointee_profile_id = profile.uuid AND appointment.capabilities @> '["admin"]'::jsonb
        AND (appointment.expires_at IS NULL OR appointment.expires_at > clock_timestamp())
        AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation WHERE appointment_id = appointment.uuid)
        AND receipt.activated_by_id = actor.id AND receipt.lifecycle_revision = issuer.lifecycle_revision
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

CREATE OR REPLACE FUNCTION public.companies_guard_activation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issuer companies_company;
BEGIN
    IF TG_OP = 'DELETE' AND current_user = @MIGRATE_ROLE@ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' OR current_user <> @OPERATOR_ROLE@
        OR COALESCE(current_setting('app.company_operation', true), '') <> 'activation'
        OR NULLIF(current_setting('app.user_id', true), '')::bigint IS DISTINCT FROM NEW.activated_by_id
        OR NULLIF(current_setting('app.company_id', true), '')::uuid IS DISTINCT FROM NEW.company_id
    THEN RAISE EXCEPTION 'Retain the actor-bound company activation receipt' USING ERRCODE = '23514'; END IF;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF issuer.uuid IS NULL OR issuer.activated_at IS NOT NULL
        OR issuer.status NOT IN ('draft', 'submitted', 'review', 'info_required', 'approved', 'rejected', 'withdrawn')
        OR NEW.lifecycle_revision IS DISTINCT FROM issuer.lifecycle_revision
        OR NEW.activated_at < transaction_timestamp() OR NEW.activated_at > clock_timestamp()
        OR NOT COALESCE(companies_current_activation_source(NEW), false)
    THEN RAISE EXCEPTION 'Activation requires the exact current personal appointment and declaration'
        USING ERRCODE = '23514'; END IF;
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
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id;
    IF issuer.activated_at IS DISTINCT FROM NEW.activated_at
        OR issuer.lifecycle_revision < NEW.lifecycle_revision + 1
        OR issuer.status NOT IN ('active', 'warning', 'suspended', 'delisted')
    THEN RAISE EXCEPTION 'Retain the single exact company activation effect with its receipt'
        USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER companies_activation_receipt BEFORE INSERT OR DELETE OR UPDATE ON companies_companyactivation FOR EACH ROW EXECUTE FUNCTION companies_guard_activation();

CREATE CONSTRAINT TRIGGER companies_activation_effect AFTER INSERT ON companies_companyactivation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION companies_guard_activation_effect();
