CREATE OR REPLACE FUNCTION public.offerings_begin_subscription_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user <> __MIGRATE__ AND NULLIF(current_setting('app.subscription_admission_command', true), '') IS NOT NULL THEN
        PERFORM public.offerings_lock_subscription_admission();
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_guard_subscription_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    command jsonb;
    operation text;
    checked_at timestamptz;
BEGIN
    IF current_user = __MIGRATE__ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.submitted_at IS NOT NULL OR OLD.eligibility_decision_id IS NOT NULL OR OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Retain subscription admission and recovery history' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    command := NULLIF(current_setting('app.subscription_admission_command', true), '')::jsonb;
    operation := command->>'operation';
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.offering_id, NEW.company_id, NEW.user_account_id, NEW.wallet_id,
            NEW.quantity, NEW.price_per_share, NEW.currency, NEW.amount_due, NEW.company_name, NEW.token_name, NEW.token_symbol)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.offering_id, OLD.company_id, OLD.user_account_id, OLD.wallet_id,
                OLD.quantity, OLD.price_per_share, OLD.currency, OLD.amount_due, OLD.company_name, OLD.token_name, OLD.token_symbol)
        THEN RAISE EXCEPTION 'Retain the exact subscription applicant and frozen economics' USING ERRCODE = '23514'; END IF;
        IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'submitted', 'withdrawn', 'rejected')
            OR OLD.status = 'submitted' AND NEW.status NOT IN ('submitted', 'accepted', 'withdrawn', 'rejected')
            OR NEW.status = 'draft' AND OLD.status <> 'draft'
            OR NEW.status = 'submitted' AND OLD.status NOT IN ('draft', 'submitted')
            OR NEW.status = 'accepted' AND OLD.status NOT IN ('submitted', 'accepted')
        THEN RAISE EXCEPTION 'A new admission cannot skip or replay a subscription transition' USING ERRCODE = '23514'; END IF;
        IF NOT (OLD.status = 'draft' AND NEW.status = 'submitted') THEN
            IF ROW(NEW.eligibility_decision_id, NEW.submitted_by_id, NEW.submitted_at)
                IS DISTINCT FROM ROW(OLD.eligibility_decision_id, OLD.submitted_by_id, OLD.submitted_at)
            THEN RAISE EXCEPTION 'Retain the original subscription eligibility basis and holder' USING ERRCODE = '23514'; END IF;
        END IF;
        IF NOT (OLD.status = 'submitted' AND NEW.status = 'accepted') AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
            RAISE EXCEPTION 'Retain the original subscription acceptance clock' USING ERRCODE = '23514';
        END IF;
        IF NOT (OLD.status = 'draft' AND NEW.status = 'submitted' OR OLD.status = 'submitted' AND NEW.status = 'accepted') THEN
            RETURN NEW;
        END IF;
        IF to_jsonb(NEW) - ARRAY['status', 'eligibility_decision_id', 'submitted_by_id', 'submitted_at', 'accepted_at', 'updated_at']
            IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'eligibility_decision_id', 'submitted_by_id', 'submitted_at', 'accepted_at', 'updated_at']
        THEN RAISE EXCEPTION 'Subscription admission changes only its exact retained effect' USING ERRCODE = '23514'; END IF;
    END IF;
    checked_at := clock_timestamp();
    IF current_user <> __OPERATOR__ OR command IS NULL
        OR (command->>'subscription')::uuid IS DISTINCT FROM NEW.uuid
        OR ROW(NEW.company_id, NEW.offering_id, NEW.wallet_id, NEW.user_account_id, NEW.quantity, NEW.price_per_share, NEW.currency, NEW.amount_due)
            IS DISTINCT FROM ROW((command->>'company')::uuid, (command->>'offering')::uuid, (command->>'wallet')::uuid,
                (command->>'account')::uuid, (command->>'quantity')::integer, (command->>'price_per_share')::numeric,
                command->>'currency', (command->>'amount_due')::numeric)
        OR NOT public.offerings_subscription_admission_facts_current(command, checked_at)
    THEN RAISE EXCEPTION 'Subscription admission requires the exact bounded current command' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'INSERT' THEN
        IF operation IS DISTINCT FROM 'draft' OR NEW.status <> 'draft' OR NEW.eligibility_decision_id IS NOT NULL
            OR NEW.submitted_at IS NOT NULL OR NEW.accepted_at IS NOT NULL OR NEW.submitted_by_id IS DISTINCT FROM (command->>'holder')::bigint
            OR NEW.allotted_at IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.issuance_request_id IS NOT NULL
            OR NEW.reference <> '' OR NEW.payment_instruction_issued_at IS NOT NULL OR NEW.payment_due_at IS NOT NULL
            OR NEW.amount_received IS NOT NULL OR NEW.payment_confirmed_at IS NOT NULL OR NEW.payment_confirmed_by_id IS NOT NULL
            OR NEW.payment_received_on IS NOT NULL OR NEW.payment_reference_seen <> '' OR NEW.payment_tx_hash <> ''
            OR NEW.payment_notes <> '' OR NEW.settlement_rail <> 'bank_transfer' OR NEW.settlement_asset_id IS NOT NULL OR NEW.settlement_amount IS NOT NULL
            OR NEW.refund_amount IS NOT NULL OR NEW.refunded_at IS NOT NULL OR NEW.refund_reference <> '' OR NEW.allotted_quantity IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM public.offerings_offering product JOIN public.tokens_sharetoken token ON token.uuid = product.token_id
                JOIN public.companies_company issuer ON issuer.uuid = token.company_id
                WHERE product.uuid = NEW.offering_id AND NEW.token_name = token.name AND NEW.token_symbol = token.symbol
                    AND NEW.company_name = COALESCE(NULLIF(issuer.trading_name, ''), issuer.name))
        THEN RAISE EXCEPTION 'A new subscription starts as a truthful unsubmitted draft' USING ERRCODE = '23514'; END IF;
        NEW.created_at := checked_at;
    ELSIF OLD.status = 'draft' AND NEW.status = 'submitted' THEN
        IF operation IS DISTINCT FROM 'submit' OR OLD.eligibility_decision_id IS NOT NULL OR OLD.submitted_at IS NOT NULL
            OR NEW.eligibility_decision_id IS DISTINCT FROM (command->>'decision')::uuid
            OR NEW.submitted_by_id IS DISTINCT FROM (command->>'holder')::bigint OR NEW.accepted_at IS NOT NULL
        THEN RAISE EXCEPTION 'First submission retains its actual holder and exact decision' USING ERRCODE = '23514'; END IF;
        NEW.submitted_at := checked_at;
    ELSE
        IF operation IS DISTINCT FROM 'accept' OR NOT public.offerings_subscription_eligibility_current(OLD.uuid, OLD.eligibility_decision_id, checked_at) THEN
            RAISE EXCEPTION 'Technical acceptance rechecks the original submitted decision' USING ERRCODE = '23514';
        END IF;
        NEW.accepted_at := checked_at;
    END IF;
    NEW.updated_at := checked_at;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_keep_offered_document_company()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND EXISTS (
        SELECT 1 FROM offerings_offering_documents attached
        JOIN offerings_offering published ON published.uuid = attached.offering_id
        WHERE attached.companydocument_id = OLD.uuid AND published.status IN ('approved', 'closed')
    ) THEN
        RAISE EXCEPTION 'A document attached to an approved or closed offering keeps its company'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_keep_published_documents()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF (TG_OP = 'DELETE'
        OR ROW(NEW.offering_id, NEW.companydocument_id) IS DISTINCT FROM ROW(OLD.offering_id, OLD.companydocument_id))
        AND EXISTS (
            SELECT 1 FROM offerings_offering published
            WHERE published.uuid = OLD.offering_id AND published.status IN ('approved', 'closed')
        )
    THEN
        RAISE EXCEPTION 'A document attached to an approved or closed offering stays attached'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_lock_subscription_admission()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    command jsonb;
    principal bigint;
    operation text;
    account_ids uuid[];
    profile_ids uuid[];
    actor_ids bigint[];
    application public.offerings_subscription;
    checked_at timestamptz;
BEGIN
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) THEN
        RAISE EXCEPTION 'Subscription admission uses its bounded operator command' USING ERRCODE = '23514';
    END IF;
    command := NULLIF(current_setting('app.subscription_admission_command', true), '')::jsonb;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF command IS NULL OR jsonb_typeof(command) <> 'object' OR principal IS NULL
        OR command - ARRAY['operation', 'subscription', 'company', 'token', 'offering', 'wallet', 'account',
            'profile', 'holder', 'decision', 'request', 'source', 'quantity', 'price_per_share', 'currency', 'amount_due'] <> '{}'::jsonb
        OR NOT command ?& ARRAY['operation', 'subscription', 'company', 'token', 'offering', 'wallet', 'account',
            'profile', 'holder', 'decision', 'request', 'source', 'quantity', 'price_per_share', 'currency', 'amount_due']
        OR jsonb_typeof(command->'quantity') <> 'number' OR command->>'quantity' !~ '^[1-9][0-9]*$'
        OR EXISTS (SELECT 1 FROM jsonb_each(command) entry WHERE entry.value = 'null'::jsonb)
        OR command->>'operation' NOT IN ('draft', 'submit', 'accept')
    THEN RAISE EXCEPTION 'Bind the exact subscription admission and actual principal' USING ERRCODE = '23514'; END IF;
    operation := command->>'operation';
    PERFORM 1 FROM public.companies_company WHERE uuid = (command->>'company')::uuid FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Retain the captured subscription company' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.tokens_sharetoken WHERE uuid = (command->>'token')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.tokens_sharetoken WHERE uuid = (command->>'token')::uuid
        AND company_id = (command->>'company')::uuid)
    THEN RAISE EXCEPTION 'The captured subscription token changed company' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.offerings_offering WHERE uuid = (command->>'offering')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.offerings_offering WHERE uuid = (command->>'offering')::uuid
        AND token_id = (command->>'token')::uuid AND company_id = (command->>'company')::uuid)
    THEN RAISE EXCEPTION 'The captured subscription offering changed parent' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.wallets WHERE uuid = (command->>'wallet')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE uuid = (command->>'wallet')::uuid AND user_account_id = (command->>'account')::uuid)
    THEN RAISE EXCEPTION 'The captured subscription wallet changed account' USING ERRCODE = '23514'; END IF;
    SELECT array_agg(uuid ORDER BY uuid) INTO account_ids FROM public.customer_accounts_account
        WHERE uuid = (command->>'account')::uuid OR user_profile_id IN (SELECT uuid FROM public.users_userprofile WHERE user_id = principal);
    PERFORM 1 FROM public.customer_accounts_account WHERE uuid = ANY(account_ids) ORDER BY uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.customer_accounts_account WHERE uuid = (command->>'account')::uuid
        AND user_profile_id = (command->>'profile')::uuid)
    THEN RAISE EXCEPTION 'The captured subscription account changed profile' USING ERRCODE = '23514'; END IF;
    SELECT array_agg(uuid ORDER BY uuid), array_agg(DISTINCT user_id ORDER BY user_id) INTO profile_ids, actor_ids
        FROM public.users_userprofile WHERE uuid IN (SELECT user_profile_id FROM public.customer_accounts_account WHERE uuid = ANY(account_ids))
            OR user_id = principal;
    IF NOT EXISTS (SELECT 1 FROM public.users_userprofile WHERE uuid = (command->>'profile')::uuid AND user_id = (command->>'holder')::bigint)
    THEN RAISE EXCEPTION 'The captured subscription holder changed' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.authentication_customuser WHERE id = principal OR id = ANY(actor_ids) ORDER BY id FOR NO KEY UPDATE;
    PERFORM 1 FROM public.users_userprofile WHERE uuid = ANY(profile_ids) ORDER BY uuid FOR NO KEY UPDATE;
    IF (SELECT array_agg(DISTINCT user_id ORDER BY user_id) FROM public.users_userprofile WHERE uuid = ANY(profile_ids)) IS DISTINCT FROM actor_ids
        OR NOT EXISTS (SELECT 1 FROM public.users_userprofile WHERE uuid = (command->>'profile')::uuid AND user_id = (command->>'holder')::bigint)
    THEN RAISE EXCEPTION 'The captured subscription identities changed' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.operators_operator WHERE id = 1 FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Company eligibility configuration is missing' USING ERRCODE = '55000'; END IF;
    PERFORM 1 FROM public.users_investorclassification WHERE uuid = (command->>'source')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.users_investorclassification WHERE uuid = (command->>'source')::uuid
        AND user_account_id = (command->>'account')::uuid)
    THEN RAISE EXCEPTION 'The captured subscription evidence changed account' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.documents WHERE classification_id = (command->>'source')::uuid ORDER BY uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM public.users_companyeligibilityrequest WHERE uuid = (command->>'request')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.users_companyeligibilityrequest WHERE uuid = (command->>'request')::uuid
        AND source_id = (command->>'source')::uuid AND user_account_id = (command->>'account')::uuid
        AND company_id = (command->>'company')::uuid)
    THEN RAISE EXCEPTION 'The captured subscription request changed context' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.users_companyeligibilitydecision WHERE uuid = (command->>'decision')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.users_companyeligibilitydecision WHERE uuid = (command->>'decision')::uuid
        AND request_id = (command->>'request')::uuid)
    THEN RAISE EXCEPTION 'Retain the exact subscription decision' USING ERRCODE = '23514'; END IF;
    SELECT * INTO application FROM public.offerings_subscription WHERE uuid = (command->>'subscription')::uuid FOR NO KEY UPDATE;
    IF operation = 'draft' THEN
        IF application.uuid IS NOT NULL THEN
            RAISE EXCEPTION 'A new subscription draft requires a fresh identifier' USING ERRCODE = '23514';
        END IF;
    ELSIF application.uuid IS NULL OR ROW(application.company_id, application.offering_id, application.wallet_id,
        application.user_account_id, application.quantity, application.price_per_share, application.currency, application.amount_due)
        IS DISTINCT FROM ROW((command->>'company')::uuid, (command->>'offering')::uuid, (command->>'wallet')::uuid,
            (command->>'account')::uuid, (command->>'quantity')::integer, (command->>'price_per_share')::numeric,
            command->>'currency', (command->>'amount_due')::numeric)
        OR (operation = 'submit' AND (application.status <> 'draft' OR application.eligibility_decision_id IS NOT NULL))
        OR (operation = 'accept' AND (application.status <> 'submitted'
            OR application.eligibility_decision_id IS DISTINCT FROM (command->>'decision')::uuid))
    THEN RAISE EXCEPTION 'Retain the original subscription status, economics and decision' USING ERRCODE = '23514'; END IF;
    checked_at := clock_timestamp();
    IF NOT public.offerings_subscription_admission_facts_current(command, checked_at)
        OR (operation = 'accept' AND NOT public.offerings_subscription_eligibility_current(application.uuid, application.eligibility_decision_id, checked_at))
    THEN RAISE EXCEPTION 'The exact subscription no longer has current admission' USING ERRCODE = '23514'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_offering_company_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_company_id tokens_sharetoken.company_id%TYPE;
BEGIN
    SELECT parent.company_id INTO parent_company_id
    FROM tokens_sharetoken AS parent
    WHERE parent.uuid = NEW.token_id;

    IF parent_company_id IS NULL THEN
        RAISE EXCEPTION 'offerings_offering.company_id cannot be derived: token_id % has no company', NEW.token_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.token_id IS DISTINCT FROM OLD.token_id
           AND parent_company_id IS DISTINCT FROM OLD.company_id THEN
            RAISE EXCEPTION 'offerings_offering.token_id cannot move this row to another company, from % to %',
                OLD.company_id, parent_company_id;
        END IF;

        IF NEW.company_id IS NULL OR NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_offering.company_id cannot be moved to %: token_id % names %',
                NEW.company_id, NEW.token_id, parent_company_id;
        END IF;
    ELSE
        IF NEW.company_id IS NULL THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_offering.company_id % does not match its parent %', NEW.company_id, parent_company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_subscription_acceptance_authorized(actor_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__)
        OR actor_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::bigint
    THEN RETURN false; END IF;
    RETURN COALESCE((SELECT actor.is_active AND actor.is_staff AND (
        actor.is_superuser OR EXISTS (
            SELECT 1 FROM public.auth_permission permission JOIN public.django_content_type content ON content.id = permission.content_type_id
            WHERE content.app_label = 'offerings' AND content.model = 'subscription'
                AND permission.codename = 'change_subscription' AND (
                    EXISTS (SELECT 1 FROM public.authentication_customuser_user_permissions direct
                        WHERE direct.customuser_id = actor.id AND direct.permission_id = permission.id)
                    OR EXISTS (SELECT 1 FROM public.authentication_customuser_groups membership
                        JOIN public.auth_group_permissions granted ON granted.group_id = membership.group_id
                        WHERE membership.customuser_id = actor.id AND granted.permission_id = permission.id))))
        FROM public.authentication_customuser actor WHERE actor.id = actor_id), false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_subscription_admission_facts_current(command jsonb, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE(current_user IN (__OPERATOR__, __MIGRATE__) AND (SELECT
        command->>'operation' IN ('draft', 'submit', 'accept')
        AND product.uuid = (command->>'offering')::uuid AND product.company_id = (command->>'company')::uuid
        AND token.uuid = (command->>'token')::uuid AND token.company_id = product.company_id
        AND token.status = 'deployed' AND length(token.contract_address) > 0
        AND issuer.status = 'active' AND issuer.is_open_to_investors
        AND product.status = 'approved' AND product.opens_at <= at_time
        AND (product.closes_at IS NULL OR product.closes_at > at_time)
        AND (command->>'quantity')::integer >= product.minimum_shares
        AND (product.maximum_shares IS NULL OR (command->>'quantity')::integer <= product.maximum_shares)
        AND (command->>'quantity')::integer <= product.cap_shares AND product.price_per_share > 0
        AND (command->>'price_per_share')::numeric = product.price_per_share
        AND command->>'currency' = product.price_currency
        AND (command->>'amount_due')::numeric = round(product.price_per_share * (command->>'quantity')::integer, 2)
        AND wallet.uuid = (command->>'wallet')::uuid AND wallet.user_account_id = account.uuid
        AND wallet.chain = 'base' AND wallet.verification_status = 'VERIFIED'
        AND account.uuid = (command->>'account')::uuid AND account.user_profile_id = (command->>'profile')::uuid
        AND profile.user_id = (command->>'holder')::bigint
        AND source.uuid = (command->>'source')::uuid AND source.user_account_id = account.uuid
        AND proposal.uuid = (command->>'request')::uuid AND proposal.source_id = source.uuid
        AND proposal.user_account_id = account.uuid AND proposal.company_id = product.company_id
        AND proposal.submitted_by_id = profile.user_id AND decision.uuid = (command->>'decision')::uuid
        AND CASE WHEN command->>'operation' = 'accept' THEN
            public.offerings_subscription_acceptance_authorized(NULLIF(current_setting('app.user_id', true), '')::bigint)
        ELSE profile.user_id = NULLIF(current_setting('app.user_id', true), '')::bigint END
        AND public.users_company_eligibility_decision_facts_current(
            decision.uuid, account.uuid, product.company_id, 'primary', product.uuid, (command->>'quantity')::integer, at_time)
        FROM public.offerings_offering product JOIN public.tokens_sharetoken token ON token.uuid = product.token_id
        JOIN public.companies_company issuer ON issuer.uuid = product.company_id
        JOIN public.wallets wallet ON wallet.uuid = (command->>'wallet')::uuid
        JOIN public.customer_accounts_account account ON account.uuid = wallet.user_account_id
        JOIN public.users_userprofile profile ON profile.uuid = account.user_profile_id
        JOIN public.users_investorclassification source ON source.uuid = (command->>'source')::uuid
        JOIN public.users_companyeligibilityrequest proposal ON proposal.uuid = (command->>'request')::uuid
        JOIN public.users_companyeligibilitydecision decision ON decision.request_id = proposal.uuid
        WHERE product.uuid = (command->>'offering')::uuid), false);
$function$;

CREATE OR REPLACE FUNCTION public.offerings_subscription_company_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_company_id offerings_offering.company_id%TYPE;
BEGIN
    SELECT parent.company_id INTO parent_company_id
    FROM offerings_offering AS parent
    WHERE parent.uuid = NEW.offering_id;

    IF parent_company_id IS NULL AND TG_OP = 'UPDATE'
       AND OLD.company_id IS NOT NULL
       AND NEW.offering_id IS NOT DISTINCT FROM OLD.offering_id
       AND NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
        RETURN NEW;
    END IF;

    IF parent_company_id IS NULL THEN
        RAISE EXCEPTION 'offerings_subscription.company_id cannot be derived: offering_id % has no company', NEW.offering_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.offering_id IS DISTINCT FROM OLD.offering_id
           AND parent_company_id IS DISTINCT FROM OLD.company_id THEN
            RAISE EXCEPTION 'offerings_subscription.offering_id cannot move this row to another company, from % to %',
                OLD.company_id, parent_company_id;
        END IF;

        IF NEW.company_id IS NULL OR NEW.company_id IS NOT DISTINCT FROM OLD.company_id THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_subscription.company_id cannot be moved to %: offering_id % names %',
                NEW.company_id, NEW.offering_id, parent_company_id;
        END IF;
    ELSE
        IF NEW.company_id IS NULL THEN
            NEW.company_id := parent_company_id;
        ELSIF NEW.company_id <> parent_company_id THEN
            RAISE EXCEPTION 'offerings_subscription.company_id % does not match its parent %', NEW.company_id, parent_company_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.offerings_subscription_eligibility_current(subscription_id uuid, decision_id uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    command jsonb;
    application public.offerings_subscription;
BEGIN
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) THEN RETURN false; END IF;
    command := NULLIF(current_setting('app.subscription_admission_command', true), '')::jsonb;
    IF command IS NULL OR command->>'operation' IS DISTINCT FROM 'accept'
        OR (command->>'subscription')::uuid IS DISTINCT FROM subscription_id
        OR (command->>'decision')::uuid IS DISTINCT FROM decision_id
    THEN RETURN false; END IF;
    SELECT * INTO application FROM public.offerings_subscription WHERE uuid = subscription_id;
    RETURN application.uuid IS NOT NULL AND application.status = 'submitted'
        AND application.eligibility_decision_id = decision_id
        AND ROW(application.company_id, application.offering_id, application.wallet_id, application.user_account_id,
                application.quantity, application.price_per_share, application.currency, application.amount_due)
            IS NOT DISTINCT FROM ROW((command->>'company')::uuid, (command->>'offering')::uuid,
                (command->>'wallet')::uuid, (command->>'account')::uuid, (command->>'quantity')::integer,
                (command->>'price_per_share')::numeric, command->>'currency', (command->>'amount_due')::numeric)
        AND application.submitted_by_id = (command->>'holder')::bigint
        AND application.submitted_at IS NOT NULL
        AND public.offerings_subscription_admission_facts_current(command, GREATEST(at_time, clock_timestamp()));
END;
$function$;

CREATE TRIGGER offerings_keep_offered_document_company BEFORE UPDATE OF company_id ON companies_companydocument FOR EACH ROW EXECUTE FUNCTION offerings_keep_offered_document_company();

CREATE TRIGGER offerings_offering_company_is_derived BEFORE INSERT OR UPDATE ON offerings_offering FOR EACH ROW EXECUTE FUNCTION offerings_offering_company_is_derived();

CREATE TRIGGER offerings_keep_published_documents BEFORE DELETE OR UPDATE ON offerings_offering_documents FOR EACH ROW EXECUTE FUNCTION offerings_keep_published_documents();

CREATE TRIGGER offerings_subscription_admission_begin BEFORE INSERT OR DELETE OR UPDATE ON offerings_subscription FOR EACH STATEMENT EXECUTE FUNCTION offerings_begin_subscription_admission();

CREATE TRIGGER offerings_subscription_admission_guard BEFORE INSERT OR DELETE OR UPDATE ON offerings_subscription FOR EACH ROW EXECUTE FUNCTION offerings_guard_subscription_admission();

CREATE TRIGGER offerings_subscription_company_is_derived BEFORE INSERT OR UPDATE ON offerings_subscription FOR EACH ROW EXECUTE FUNCTION offerings_subscription_company_is_derived();
