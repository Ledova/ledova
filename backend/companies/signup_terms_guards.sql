CREATE FUNCTION companies_guard_signup_terms_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    actor authentication_customuser;
    profile users_userprofile;
    issuer companies_company;
    source companies_companyappointment;
    principal bigint;
    requires_identity boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company signup Terms acceptance' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.accepted_by_id FOR UPDATE;
    SELECT * INTO profile FROM users_userprofile WHERE uuid = NEW.accepted_profile_id FOR UPDATE;
    SELECT * INTO source FROM companies_companyappointment WHERE uuid = NEW.appointment_id FOR UPDATE;
    SELECT issuer_kyc_required INTO requires_identity FROM operators_operator WHERE id = 1 FOR SHARE;
    IF current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@)
        OR principal IS DISTINCT FROM NEW.accepted_by_id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR profile.user_id IS DISTINCT FROM actor.id OR issuer.uuid IS NULL
        OR source.uuid IS NULL OR source.company_id IS DISTINCT FROM issuer.uuid
        OR source.appointee_id IS DISTINCT FROM actor.id OR source.appointee_profile_id IS DISTINCT FROM profile.uuid
        OR NOT source.capabilities @> '["admin"]'::jsonb
        OR source.expires_at <= clock_timestamp()
        OR EXISTS (SELECT 1 FROM companies_companyappointmentrevocation WHERE appointment_id = source.uuid)
        OR COALESCE(requires_identity, false) AND NOT profile.is_id_verified
        OR NEW.declaration_version IS DISTINCT FROM '2026-10-14'
        OR NEW.declaration_text IS DISTINCT FROM 'I am authorised to set up and administer this company’s workspace, including managing its users, and I accept the Terms of Service (version 2026-10-14) on the company’s behalf. The company is responsible for the company and share information it provides, its ASIC filings and legal obligations.'
        OR source.request_id IS NOT NULL AND source.declaration_version = NEW.declaration_version
            AND source.declaration_text = NEW.declaration_text
    THEN
        RAISE EXCEPTION 'Signup Terms require the exact active appointee, company and current administration'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_signup_terms_identity BEFORE INSERT OR UPDATE OR DELETE
    ON companies_companysignuptermsacceptance FOR EACH ROW EXECUTE FUNCTION companies_guard_signup_terms_acceptance();
CREATE CONSTRAINT TRIGGER companies_signup_terms_current AFTER INSERT ON companies_companysignuptermsacceptance
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION companies_guard_signup_terms_acceptance();
