CREATE OR REPLACE FUNCTION public.users_keep_first_activation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.activation_date := LEAST(OLD.activation_date, NEW.activation_date);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_profile_save()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    saver text := NULLIF(current_setting('app.profile_save', true), '');
BEGIN
    IF saver IS NOT NULL AND (TG_OP <> 'UPDATE' OR NEW.user_id::text IS DISTINCT FROM saver
        OR OLD.user_id IS DISTINCT FROM NEW.user_id)
    THEN
        RAISE EXCEPTION 'A profile save changes only the saving person''s own profile' USING ERRCODE = '23514';
    END IF;
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
        AND account.account_status IN ('active', 'pending') AND issuer.status = 'active'
        FROM customer_accounts_account account
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        JOIN authentication_customuser actor ON actor.id = profile.user_id
        JOIN companies_company issuer ON issuer.uuid = issuer_id WHERE account.uuid = account_id), false);
$function$;

CREATE TRIGGER users_keep_first_activation BEFORE UPDATE OF activation_date ON customer_accounts_account FOR EACH ROW EXECUTE FUNCTION users_keep_first_activation();

CREATE TRIGGER users_profile_save BEFORE INSERT OR UPDATE ON users_userprofile FOR EACH ROW EXECUTE FUNCTION users_guard_profile_save();

CREATE TRIGGER users_account_standing BEFORE INSERT OR UPDATE ON customer_accounts_account FOR EACH ROW EXECUTE FUNCTION users_guard_account_standing();
