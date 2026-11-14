CREATE OR REPLACE FUNCTION public.companies_guard_activation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' AND current_user = @MIGRATE_ROLE@ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Activation receipts are retained history; no new receipt is recorded' USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER companies_activation_receipt BEFORE INSERT OR DELETE OR UPDATE ON companies_companyactivation FOR EACH ROW EXECUTE FUNCTION companies_guard_activation();
