CREATE OR REPLACE FUNCTION public.users_keep_first_activation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.activation_date := LEAST(OLD.activation_date, NEW.activation_date);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_provider_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    saver text := NULLIF(current_setting('app.profile_save', true), '');
BEGIN
    IF current_user <> @APP_ROLE@ AND saver IS NULL THEN
        RETURN NEW;
    END IF;
    IF saver IS NOT NULL THEN
        IF TG_OP <> 'UPDATE' THEN
            RAISE EXCEPTION 'A profile save changes only the saving person''s own profile' USING ERRCODE = '23514';
        END IF;
        IF NEW.user_id::text IS DISTINCT FROM saver OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN
            RAISE EXCEPTION 'A profile save changes only the saving person''s own profile' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_id_verified OR NEW.verified_at IS NOT NULL OR NEW.review_result IS NOT NULL
            OR NEW.verification_status IS NOT NULL OR NEW.rejection_labels IS NOT NULL
            OR NEW.kyc_provider IS DISTINCT FROM 'kycaid' OR NEW.kycaid_applicant_id IS NOT NULL
            OR NEW.sumsub_applicant_id IS NOT NULL OR NEW.sumsub_verification_status IS NOT NULL
        THEN
            RAISE EXCEPTION 'Provider identity results are recorded by the bounded verification service'
                USING ERRCODE = '23514';
        END IF;
    ELSIF ROW(NEW.is_id_verified, NEW.verified_at, NEW.review_result, NEW.verification_status,
        NEW.rejection_labels, NEW.kyc_provider, NEW.kycaid_applicant_id, NEW.sumsub_applicant_id,
        NEW.sumsub_verification_status) IS DISTINCT FROM ROW(OLD.is_id_verified, OLD.verified_at,
        OLD.review_result, OLD.verification_status, OLD.rejection_labels, OLD.kyc_provider,
        OLD.kycaid_applicant_id, OLD.sumsub_applicant_id, OLD.sumsub_verification_status)
    THEN
        RAISE EXCEPTION 'Provider identity results are recorded by the bounded verification service'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operators_guard_issuer_identity_policy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF current_user = @APP_ROLE@ THEN
        IF TG_OP = 'DELETE' OR (TG_OP = 'INSERT' AND (
            NEW.issuer_kyc_required IS DISTINCT FROM false OR NEW.investor_kyc_required IS DISTINCT FROM true))
            OR (TG_OP = 'UPDATE' AND ROW(NEW.issuer_kyc_required, NEW.investor_kyc_required)
                IS DISTINCT FROM ROW(OLD.issuer_kyc_required, OLD.investor_kyc_required))
        THEN RAISE EXCEPTION 'Only platform configuration can change required identity policies'
            USING ERRCODE = '23514'; END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_account_standing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user = @APP_ROLE@ AND (
        (TG_OP = 'INSERT' AND NEW.account_status IS DISTINCT FROM 'pending')
        OR (TG_OP = 'UPDATE' AND NEW.account_status IS DISTINCT FROM OLD.account_status))
    THEN RAISE EXCEPTION 'Account standing changes require the bounded technical operation' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_participant_current(account_id uuid, issuer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT actor.is_active AND actor.is_email_verified AND account.role IN ('investor', 'both')
        AND (account.account_status = 'active' OR (NOT configuration.investor_kyc_required AND account.account_status = 'pending'))
        AND (NOT configuration.investor_kyc_required OR profile.is_id_verified) AND issuer.status = 'active'
        FROM customer_accounts_account account
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        JOIN authentication_customuser actor ON actor.id = profile.user_id
        JOIN operators_operator configuration ON configuration.id = 1
        JOIN companies_company issuer ON issuer.uuid = issuer_id WHERE account.uuid = account_id), false);
$function$;

CREATE TRIGGER users_keep_first_activation BEFORE UPDATE OF activation_date ON customer_accounts_account FOR EACH ROW EXECUTE FUNCTION users_keep_first_activation();

CREATE TRIGGER users_provider_identity BEFORE INSERT OR UPDATE ON users_userprofile FOR EACH ROW EXECUTE FUNCTION users_guard_provider_identity();

CREATE TRIGGER users_account_standing BEFORE INSERT OR UPDATE ON customer_accounts_account FOR EACH ROW EXECUTE FUNCTION users_guard_account_standing();

CREATE TRIGGER operators_issuer_identity_policy BEFORE INSERT OR DELETE OR UPDATE ON operators_operator FOR EACH ROW EXECUTE FUNCTION operators_guard_issuer_identity_policy();
