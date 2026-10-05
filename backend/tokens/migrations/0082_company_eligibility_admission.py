import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

SQL = """
CREATE FUNCTION public.tokens_trading_command() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    keys text[];
    item record;
BEGIN
    IF current_user <> __OPERATOR__ THEN
        RAISE EXCEPTION 'New trading effects require the operator command' USING ERRCODE = '23514';
    END IF;
    BEGIN
        command := NULLIF(current_setting('app.trading_admission', true), '')::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Bind the exact trading command' USING ERRCODE = '23514';
    END;
    IF command IS NULL OR jsonb_typeof(command) IS DISTINCT FROM 'object'
        OR command->'version' IS DISTINCT FROM '1'::jsonb OR command->>'version' IS DISTINCT FROM '1'
        OR jsonb_typeof(command->'operation') IS DISTINCT FROM 'string'
        OR command->>'operation' NOT IN ('create_order', 'modify_order', 'first_signature')
    THEN RAISE EXCEPTION 'Bind the exact trading command' USING ERRCODE = '23514'; END IF;
    keys := ARRAY['version', 'operation', 'actor_id', 'company_uuid', 'token_uuid', 'owner_account_uuid',
        'wallet_uuid', 'profile_uuid', 'source_uuid', 'request_uuid', 'decision_uuid', 'request_digest',
        'decision_digest', 'target_uuid'];
    IF command->>'operation' = 'create_order' THEN
        keys := keys || ARRAY['submission_uuid', 'submission_id', 'challenge_uuid', 'payment_asset_uuid'];
    ELSIF command->>'operation' = 'modify_order' THEN
        keys := keys || ARRAY['action_uuid', 'action_id', 'challenge_uuid', 'payment_asset_uuid'];
    ELSE
        keys := keys || ARRAY['participant', 'settlement_digest', 'signature'];
    END IF;
    IF NOT command ?& keys OR command - keys <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Bind only the exact trading command keys' USING ERRCODE = '23514';
    END IF;
    FOR item IN SELECT * FROM jsonb_each(command) LOOP
        IF item.key = 'version' THEN CONTINUE; END IF;
        IF item.key = 'payment_asset_uuid' AND item.value = 'null'::jsonb THEN CONTINUE; END IF;
        IF jsonb_typeof(item.value) IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Bind typed trading command values' USING ERRCODE = '23514';
        END IF;
        IF (item.key LIKE '%_uuid' OR item.key IN ('submission_id', 'action_id'))
            AND command->>item.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN RAISE EXCEPTION 'Bind canonical trading identifiers' USING ERRCODE = '23514'; END IF;
    END LOOP;
    IF command->>'actor_id' !~ '^[1-9][0-9]*$' OR length(command->>'actor_id') > 19 THEN
        RAISE EXCEPTION 'Bind a canonical trading principal' USING ERRCODE = '23514';
    END IF;
    IF (command->>'actor_id')::numeric > 9223372036854775807
        OR command->>'actor_id' IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')
        OR command->>'request_digest' !~ '^[0-9a-f]{64}$'
        OR command->>'decision_digest' !~ '^[0-9a-f]{64}$'
        OR (command->>'operation' = 'first_signature' AND (
            command->>'participant' NOT IN ('seller', 'buyer')
            OR command->>'settlement_digest' !~ '^0x[0-9a-f]{64}$'
            OR command->>'signature' !~ '^0x[0-9a-fA-F]{130}$'))
    THEN RAISE EXCEPTION 'Bind the actual participant and decision digests' USING ERRCODE = '23514'; END IF;
    RETURN command;
END;
$$;
CREATE FUNCTION public.tokens_trading_binding(command jsonb) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT COALESCE((SELECT token.company_id = (command->>'company_uuid')::uuid
        AND wallet.user_account_id = account.uuid AND account.uuid = (command->>'owner_account_uuid')::uuid
        AND wallet.uuid = (command->>'wallet_uuid')::uuid
        AND account.user_profile_id = profile.uuid AND profile.uuid = (command->>'profile_uuid')::uuid
        AND profile.user_id = (command->>'actor_id')::bigint
        AND wallet.chain IN ('ethereum', 'base') AND wallet.verification_status = 'VERIFIED'
        AND proposal.uuid = (command->>'request_uuid')::uuid
        AND proposal.source_id = (command->>'source_uuid')::uuid
        AND proposal.user_account_id = account.uuid AND proposal.company_id = token.company_id
        AND proposal.submitted_by_id = profile.user_id
        AND proposal.digest = command->>'request_digest'
        AND decision.uuid = (command->>'decision_uuid')::uuid AND decision.request_id = proposal.uuid
        AND decision.digest = command->>'decision_digest' AND decision.request_digest = proposal.digest
        FROM public.tokens_sharetoken token JOIN public.wallets wallet ON wallet.uuid = (command->>'wallet_uuid')::uuid
        JOIN public.customer_accounts_account account ON account.uuid = wallet.user_account_id
        JOIN public.users_userprofile profile ON profile.uuid = account.user_profile_id
        JOIN public.users_companyeligibilityrequest proposal ON proposal.uuid = (command->>'request_uuid')::uuid
        JOIN public.users_companyeligibilitydecision decision ON decision.uuid = (command->>'decision_uuid')::uuid
        WHERE token.uuid = (command->>'token_uuid')::uuid), false);
$$;
CREATE FUNCTION public.tokens_lock_trading_admission(command jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    actual jsonb;
    target public.tokens_transferorder;
    action public.tokens_orderactionsubmission;
    submission public.tokens_ordersubmission;
    swap public.tokens_swaporder;
    event_decision public.users_companyeligibilitydecision;
    event_request public.users_companyeligibilityrequest;
BEGIN
    actual := public.tokens_trading_command();
    IF command IS DISTINCT FROM actual THEN
        RAISE EXCEPTION 'Use the installed exact trading command' USING ERRCODE = '23514';
    END IF;
    IF command->>'operation' = 'modify_order' THEN
        SELECT * INTO target FROM public.tokens_transferorder WHERE uuid = (command->>'target_uuid')::uuid;
        IF target.last_modification_action_id = (command->>'action_uuid')::uuid
            AND target.last_modification_eligibility_decision_id IS NOT NULL THEN
            SELECT * INTO event_decision FROM public.users_companyeligibilitydecision
                WHERE uuid = target.last_modification_eligibility_decision_id;
            SELECT * INTO event_request FROM public.users_companyeligibilityrequest WHERE uuid = event_decision.request_id;
            IF ROW(target.last_modification_eligibility_decision_id, event_request.uuid, event_request.source_id,
                    event_request.digest, event_decision.digest)
                IS DISTINCT FROM ROW((command->>'decision_uuid')::uuid, (command->>'request_uuid')::uuid,
                    (command->>'source_uuid')::uuid, command->>'request_digest', command->>'decision_digest')
            THEN RAISE EXCEPTION 'Retain the actual modification event decision' USING ERRCODE = '23514'; END IF;
        END IF;
    END IF;
    PERFORM 1 FROM public.tokens_sharetoken WHERE uuid = (command->>'token_uuid')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.tokens_sharetoken WHERE uuid = (command->>'token_uuid')::uuid
        AND company_id = (command->>'company_uuid')::uuid)
    THEN RAISE EXCEPTION 'Retain the actual trading issuer' USING ERRCODE = '23514'; END IF;
    IF command->>'operation' = 'create_order' THEN
        SELECT * INTO submission FROM public.tokens_ordersubmission
            WHERE uuid = (command->>'submission_uuid')::uuid FOR UPDATE;
        IF submission.uuid IS NULL OR ROW(submission.submission_id, submission.token_id, submission.owner_account_id,
                submission.wallet_id, submission.initiated_by_id)
            IS DISTINCT FROM ROW((command->>'submission_id')::uuid, (command->>'token_uuid')::uuid,
                (command->>'owner_account_uuid')::uuid, (command->>'wallet_uuid')::uuid, (command->>'actor_id')::bigint)
        THEN RAISE EXCEPTION 'Retain the actual order submission' USING ERRCODE = '23514'; END IF;
    ELSIF command->>'operation' = 'modify_order' THEN
        SELECT * INTO action FROM public.tokens_orderactionsubmission
            WHERE uuid = (command->>'action_uuid')::uuid FOR UPDATE;
        IF action.uuid IS NULL OR action.purpose <> 'modify' OR ROW(action.action_id, action.order_id, action.token_id,
                action.owner_account_id, action.wallet_id, action.initiated_by_id)
            IS DISTINCT FROM ROW((command->>'action_id')::uuid, (command->>'target_uuid')::uuid,
                (command->>'token_uuid')::uuid, (command->>'owner_account_uuid')::uuid,
                (command->>'wallet_uuid')::uuid, (command->>'actor_id')::bigint)
        THEN RAISE EXCEPTION 'Retain the actual modification action' USING ERRCODE = '23514'; END IF;
    END IF;
    PERFORM 1 FROM public.wallets WHERE uuid = (command->>'wallet_uuid')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE uuid = (command->>'wallet_uuid')::uuid
        AND user_account_id = (command->>'owner_account_uuid')::uuid)
    THEN RAISE EXCEPTION 'The trading wallet changed account' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.customer_accounts_account WHERE uuid = (command->>'owner_account_uuid')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.customer_accounts_account WHERE uuid = (command->>'owner_account_uuid')::uuid
        AND user_profile_id = (command->>'profile_uuid')::uuid)
    THEN RAISE EXCEPTION 'The trading account changed profile' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.authentication_customuser WHERE id = (command->>'actor_id')::bigint FOR NO KEY UPDATE;
    PERFORM 1 FROM public.users_userprofile WHERE uuid = (command->>'profile_uuid')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.users_userprofile WHERE uuid = (command->>'profile_uuid')::uuid
        AND user_id = (command->>'actor_id')::bigint)
    THEN RAISE EXCEPTION 'The trading profile changed holder' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.operators_operator WHERE id = 1 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Trading configuration is missing' USING ERRCODE = '55000'; END IF;
    PERFORM 1 FROM public.users_investorclassification WHERE uuid = (command->>'source_uuid')::uuid FOR NO KEY UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.users_investorclassification WHERE uuid = (command->>'source_uuid')::uuid
        AND user_account_id = (command->>'owner_account_uuid')::uuid)
    THEN RAISE EXCEPTION 'The trading source changed account' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM public.documents WHERE classification_id = (command->>'source_uuid')::uuid ORDER BY uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM public.users_companyeligibilityrequest WHERE uuid = (command->>'request_uuid')::uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM public.users_companyeligibilitydecision WHERE uuid = (command->>'decision_uuid')::uuid FOR NO KEY UPDATE;
    IF NOT public.tokens_trading_binding(command) THEN
        RAISE EXCEPTION 'The exact trading decision changed context' USING ERRCODE = '23514';
    END IF;
    IF command->>'operation' = 'create_order' THEN
        PERFORM 1 FROM public.signing_challenges WHERE uuid = (command->>'challenge_uuid')::uuid FOR UPDATE;
    ELSIF command->>'operation' = 'modify_order' THEN
        PERFORM 1 FROM public.tokens_transferorder WHERE uuid = (command->>'target_uuid')::uuid FOR UPDATE;
        PERFORM 1 FROM public.signing_challenges WHERE uuid = (command->>'challenge_uuid')::uuid FOR UPDATE;
    ELSE
        SELECT * INTO swap FROM public.tokens_swaporder WHERE uuid = (command->>'target_uuid')::uuid;
        IF swap.uuid IS NULL OR swap.share_token_id IS DISTINCT FROM (command->>'token_uuid')::uuid THEN
            RAISE EXCEPTION 'Retain the actual swap' USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM public.tokens_transferorder WHERE uuid IN (swap.sell_order_id, swap.buy_order_id) ORDER BY uuid FOR UPDATE;
        PERFORM 1 FROM public.tokens_swaporder WHERE uuid = swap.uuid FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM public.tokens_swaporder current_swap WHERE current_swap.uuid = swap.uuid
            AND ROW(current_swap.sell_order_id, current_swap.buy_order_id, current_swap.share_token_id,
                current_swap.seller_wallet_id, current_swap.buyer_wallet_id, current_swap.settlement_digest)
                IS NOT DISTINCT FROM ROW(swap.sell_order_id, swap.buy_order_id, swap.share_token_id,
                swap.seller_wallet_id, swap.buyer_wallet_id, swap.settlement_digest))
        THEN RAISE EXCEPTION 'The swap changed before its target locks' USING ERRCODE = '23514'; END IF;
    END IF;
END;
$$;
CREATE FUNCTION public.tokens_begin_trading_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF current_user <> __MIGRATE__ AND NULLIF(current_setting('app.trading_admission', true), '') IS NOT NULL THEN
        PERFORM public.tokens_lock_trading_admission(public.tokens_trading_command());
    END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION public.tokens_trading_current(command jsonb, checked_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT public.tokens_trading_binding(command) THEN
        RAISE EXCEPTION 'Bind the actual trading decision' USING ERRCODE = '23514';
    END IF;
    IF NOT public.users_company_eligibility_decision_current((command->>'decision_uuid')::uuid,
        (command->>'owner_account_uuid')::uuid, (command->>'company_uuid')::uuid, 'secondary', NULL, NULL, checked_at)
    THEN RAISE EXCEPTION 'The trading decision is no longer current' USING ERRCODE = '23514',
        CONSTRAINT = 'tokens_trading_eligibility_current'; END IF;
END;
$$;
CREATE FUNCTION public.tokens_guard_trading_order() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    submission public.tokens_ordersubmission;
    action public.tokens_orderactionsubmission;
    challenge public.signing_challenges;
    checked_at timestamptz;
BEGIN
    IF current_user = __MIGRATE__ THEN
        IF (TG_OP = 'INSERT' AND (NEW.eligibility_decision_id IS NOT NULL OR NEW.creation_submission_id IS NOT NULL
            OR NEW.last_modification_action_id IS NOT NULL OR NEW.last_modification_eligibility_decision_id IS NOT NULL))
            OR (TG_OP = 'UPDATE' AND ROW(NEW.eligibility_decision_id, NEW.creation_submission_id,
                NEW.last_modification_action_id, NEW.last_modification_eligibility_decision_id)
                IS DISTINCT FROM ROW(OLD.eligibility_decision_id, OLD.creation_submission_id,
                OLD.last_modification_action_id, OLD.last_modification_eligibility_decision_id))
        THEN RAISE EXCEPTION 'Maintenance cannot manufacture trading admission' USING ERRCODE = '23514'; END IF;
        IF TG_OP = 'INSERT' OR (OLD.eligibility_decision_id IS NULL AND OLD.last_modification_eligibility_decision_id IS NULL)
        THEN RETURN NEW; END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.uuid, NEW.token_id, NEW.owner_account_id, NEW.wallet_id, NEW.wallet_address,
        NEW.order_type, NEW.created_at, NEW.creation_submission_id, NEW.eligibility_decision_id)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.token_id, OLD.owner_account_id, OLD.wallet_id, OLD.wallet_address,
        OLD.order_type, OLD.created_at, OLD.creation_submission_id, OLD.eligibility_decision_id)
    THEN RAISE EXCEPTION 'Retain immutable trading birth evidence' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.payment_asset_id IS DISTINCT FROM OLD.payment_asset_id
        AND NOT (current_user = __MIGRATE__ AND NEW.payment_asset_id IS NULL)
    THEN RAISE EXCEPTION 'Retain the original trading payment asset' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.quantity, NEW.min_quantity, NEW.price_per_share, NEW.current_signature,
        NEW.modification_count, NEW.last_modified_at, NEW.original_quantity, NEW.original_price,
        NEW.last_modification_action_id, NEW.last_modification_eligibility_decision_id)
        IS NOT DISTINCT FROM ROW(OLD.quantity, OLD.min_quantity, OLD.price_per_share, OLD.current_signature,
        OLD.modification_count, OLD.last_modified_at, OLD.original_quantity, OLD.original_price,
        OLD.last_modification_action_id, OLD.last_modification_eligibility_decision_id)
    THEN RETURN NEW; END IF;
    command := public.tokens_trading_command();
    IF ROW(NEW.uuid, NEW.token_id, NEW.owner_account_id, NEW.wallet_id)
        IS DISTINCT FROM ROW((command->>'target_uuid')::uuid, (command->>'token_uuid')::uuid,
        (command->>'owner_account_uuid')::uuid, (command->>'wallet_uuid')::uuid)
        OR NEW.payment_asset_id IS DISTINCT FROM (command->>'payment_asset_uuid')::uuid
        OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE uuid = NEW.wallet_id AND lower(address) = lower(NEW.wallet_address))
    THEN RAISE EXCEPTION 'Bind the actual order identity and asset' USING ERRCODE = '23514'; END IF;
    SELECT * INTO challenge FROM public.signing_challenges WHERE uuid = (command->>'challenge_uuid')::uuid;
    IF challenge.uuid IS NULL OR challenge.wallet_id IS DISTINCT FROM NEW.wallet_id
        OR lower(challenge.wallet_address) IS DISTINCT FROM lower(NEW.wallet_address)
        OR challenge.consumed_at IS NULL OR challenge.consumed_signature = ''
        OR challenge.consumed_at >= challenge.expires_at
    THEN RAISE EXCEPTION 'Use the actual spent trading challenge' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO submission FROM public.tokens_ordersubmission WHERE uuid = (command->>'submission_uuid')::uuid;
        IF command->>'operation' IS DISTINCT FROM 'create_order' OR submission.status IS DISTINCT FROM 'pending'
            OR submission.eligibility_decision_id IS NOT NULL
            OR NEW.creation_submission_id IS DISTINCT FROM submission.uuid
            OR NEW.eligibility_decision_id IS DISTINCT FROM (command->>'decision_uuid')::uuid
            OR ROW(NEW.wallet_address, NEW.order_type, NEW.quantity, NEW.min_quantity, NEW.price_per_share)
                IS DISTINCT FROM ROW(submission.wallet_address, submission.order_type, submission.quantity,
                    submission.min_quantity, submission.price_per_share)
            OR NEW.filled_quantity <> 0 OR NEW.modification_count <> 0 OR NEW.status <> 'open'
            OR NEW.original_quantity IS NOT NULL OR NEW.original_price IS NOT NULL OR NEW.last_modified_at IS NOT NULL
            OR NEW.current_signature <> '' OR NEW.last_modification_action_id IS NOT NULL
            OR NEW.last_modification_eligibility_decision_id IS NOT NULL
            OR challenge.purpose <> 'order_create' OR challenge.submission_id IS DISTINCT FROM submission.uuid
            OR challenge.chain_id IS DISTINCT FROM submission.chain_id
            OR lower(challenge.verifying_contract) IS DISTINCT FROM lower(submission.verifying_contract)
            OR NOT EXISTS (SELECT 1 FROM public.tokens_sharetoken token WHERE token.uuid = NEW.token_id
                AND token.status = 'deployed' AND lower(token.contract_address) = lower(submission.verifying_contract))
            OR (SELECT array_agg(DISTINCT asset.uuid ORDER BY asset.uuid)
                FROM public.operators_operator configuration
                JOIN public.operators_operator_supported_settlement_assets supported ON supported.operator_id = configuration.id
                JOIN public.assets_asset asset ON asset.uuid = supported.asset_id
                JOIN public.asset_chain_deployments deployment ON deployment.asset_id = asset.uuid
                WHERE configuration.id = 1 AND asset.is_active AND deployment.is_active
                    AND deployment.chain = configuration.receiving_wallet_chain
                    AND deployment.contract_address IS NOT NULL AND deployment.contract_address <> '')
                IS DISTINCT FROM ARRAY[NEW.payment_asset_id]
        THEN RAISE EXCEPTION 'Create only the genuine pending order intent' USING ERRCODE = '23514'; END IF;
        checked_at := clock_timestamp();
        IF checked_at >= challenge.expires_at THEN
            RAISE EXCEPTION 'The creation challenge expired' USING ERRCODE = '23514';
        END IF;
        PERFORM public.tokens_trading_current(command, checked_at);
        NEW.created_at := checked_at;
    ELSE
        SELECT * INTO action FROM public.tokens_orderactionsubmission WHERE uuid = (command->>'action_uuid')::uuid;
        IF command->>'operation' IS DISTINCT FROM 'modify_order' OR action.status IS DISTINCT FROM 'pending'
            OR action.purpose IS DISTINCT FROM 'modify' OR action.eligibility_decision_id IS NOT NULL
            OR NEW.last_modification_action_id IS DISTINCT FROM action.uuid
            OR NEW.last_modification_eligibility_decision_id IS DISTINCT FROM (command->>'decision_uuid')::uuid
            OR action.order_id IS DISTINCT FROM NEW.uuid
            OR ROW(NEW.quantity, NEW.min_quantity, NEW.price_per_share)
                IS DISTINCT FROM ROW(action.new_quantity, action.new_min_quantity, action.new_price_per_share)
            OR NEW.modification_count IS DISTINCT FROM OLD.modification_count + 1
            OR NEW.current_signature IS DISTINCT FROM challenge.consumed_signature
            OR NEW.original_quantity IS DISTINCT FROM (CASE WHEN OLD.original_quantity IS NULL THEN OLD.quantity ELSE OLD.original_quantity END)
            OR NEW.original_price IS DISTINCT FROM (CASE WHEN OLD.original_price IS NULL THEN OLD.price_per_share ELSE OLD.original_price END)
            OR challenge.purpose <> 'order_modify' OR challenge.action_id IS DISTINCT FROM action.uuid
            OR challenge.order_id IS DISTINCT FROM NEW.uuid
            OR challenge.chain_id IS DISTINCT FROM action.chain_id
            OR lower(challenge.verifying_contract) IS DISTINCT FROM lower(action.verifying_contract)
            OR NOT EXISTS (SELECT 1 FROM public.tokens_sharetoken token WHERE token.uuid = NEW.token_id
                AND token.status = 'deployed' AND lower(token.contract_address) = lower(action.verifying_contract))
        THEN RAISE EXCEPTION 'Apply only the genuine signed modification event' USING ERRCODE = '23514'; END IF;
        checked_at := clock_timestamp();
        IF checked_at >= challenge.expires_at THEN
            RAISE EXCEPTION 'The modification challenge expired' USING ERRCODE = '23514';
        END IF;
        PERFORM public.tokens_trading_current(command, checked_at);
        NEW.last_modified_at := checked_at;
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.tokens_guard_trading_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    target public.tokens_transferorder;
BEGIN
    IF current_user = __MIGRATE__ THEN
        IF (TG_OP = 'INSERT' AND NEW.eligibility_decision_id IS NOT NULL)
            OR (TG_OP = 'UPDATE' AND NEW.eligibility_decision_id IS DISTINCT FROM OLD.eligibility_decision_id)
        THEN RAISE EXCEPTION 'Maintenance cannot manufacture order admission' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.eligibility_decision_id IS NOT NULL THEN
            RAISE EXCEPTION 'Pending submissions have no admitted basis' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'pending' THEN
        IF NEW.eligibility_decision_id IS DISTINCT FROM OLD.eligibility_decision_id THEN
            RAISE EXCEPTION 'Retain terminal order admission evidence' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status <> 'created' THEN
        IF NEW.eligibility_decision_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only genuine created submissions retain admission' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    command := public.tokens_trading_command();
    SELECT * INTO target FROM public.tokens_transferorder WHERE uuid = NEW.order_id;
    IF command->>'operation' IS DISTINCT FROM 'create_order'
        OR NEW.uuid IS DISTINCT FROM (command->>'submission_uuid')::uuid
        OR NEW.order_id IS DISTINCT FROM (command->>'target_uuid')::uuid
        OR NEW.initiated_by_id IS DISTINCT FROM (command->>'actor_id')::bigint
        OR NEW.eligibility_decision_id IS DISTINCT FROM (command->>'decision_uuid')::uuid
        OR target.creation_submission_id IS DISTINCT FROM NEW.uuid
        OR target.eligibility_decision_id IS DISTINCT FROM NEW.eligibility_decision_id
        OR NEW.executed_challenge_id IS DISTINCT FROM (command->>'challenge_uuid')::uuid
        OR NOT public.tokens_trading_binding(command)
    THEN RAISE EXCEPTION 'Resolve the actual admitted order birth' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.tokens_guard_trading_action() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    target public.tokens_transferorder;
BEGIN
    IF current_user = __MIGRATE__ THEN
        IF (TG_OP = 'INSERT' AND (NEW.eligibility_decision_id IS NOT NULL OR NEW.eligibility_admitted_at IS NOT NULL))
            OR (TG_OP = 'UPDATE' AND ROW(NEW.eligibility_decision_id, NEW.eligibility_admitted_at)
                IS DISTINCT FROM ROW(OLD.eligibility_decision_id, OLD.eligibility_admitted_at))
        THEN RAISE EXCEPTION 'Maintenance cannot manufacture action admission' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' THEN
        IF ROW(NEW.eligibility_decision_id, NEW.eligibility_admitted_at)
            IS DISTINCT FROM ROW(OLD.eligibility_decision_id, OLD.eligibility_admitted_at)
        THEN RAISE EXCEPTION 'Retain terminal action admission evidence' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' OR NEW.status <> 'applied' OR NEW.purpose <> 'modify' THEN
        IF NEW.eligibility_decision_id IS NOT NULL OR NEW.eligibility_admitted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Only an applied modification retains its actual event admission' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    command := public.tokens_trading_command();
    SELECT * INTO target FROM public.tokens_transferorder WHERE uuid = NEW.order_id;
    IF command->>'operation' IS DISTINCT FROM 'modify_order'
        OR NEW.uuid IS DISTINCT FROM (command->>'action_uuid')::uuid
        OR NEW.order_id IS DISTINCT FROM (command->>'target_uuid')::uuid
        OR NEW.executed_by_id IS DISTINCT FROM (command->>'actor_id')::bigint
        OR NEW.initiated_by_id IS DISTINCT FROM NEW.executed_by_id
        OR NEW.executed_challenge_id IS DISTINCT FROM (command->>'challenge_uuid')::uuid
        OR target.last_modification_action_id IS DISTINCT FROM NEW.uuid
        OR target.last_modification_eligibility_decision_id IS DISTINCT FROM (command->>'decision_uuid')::uuid
        OR NEW.eligibility_decision_id IS DISTINCT FROM target.last_modification_eligibility_decision_id
        OR target.last_modified_at IS NULL
        OR NEW.result->>'modification_count' IS DISTINCT FROM target.modification_count::text
        OR NOT public.tokens_trading_binding(command)
    THEN RAISE EXCEPTION 'Resolve the exact admitted modification event decision' USING ERRCODE = '23514'; END IF;
    NEW.eligibility_admitted_at := target.last_modified_at;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.tokens_modification_changes(
    old_quantity bigint, old_minimum bigint, old_price numeric, new_quantity bigint, new_minimum bigint, new_price numeric
) RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('field', field, 'old', old_value, 'new', new_value) ORDER BY position), '[]'::jsonb)
    FROM (VALUES (1, 'quantity', old_quantity::text, new_quantity::text),
                 (2, 'min_quantity', old_minimum::text, new_minimum::text),
                 (3, 'price_per_share', old_price::text, new_price::text)) changes(position, field, old_value, new_value)
    WHERE old_value IS DISTINCT FROM new_value;
$$;
CREATE FUNCTION public.tokens_check_trading_birth() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    submission public.tokens_ordersubmission;
    challenge public.signing_challenges;
BEGIN
    IF NEW.creation_submission_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO submission FROM public.tokens_ordersubmission WHERE uuid = NEW.creation_submission_id;
    SELECT * INTO challenge FROM public.signing_challenges WHERE uuid = submission.executed_challenge_id;
    IF submission.status IS DISTINCT FROM 'created' OR submission.order_id IS DISTINCT FROM NEW.uuid
        OR submission.eligibility_decision_id IS DISTINCT FROM NEW.eligibility_decision_id
        OR ROW(submission.owner_account_id, submission.wallet_id, submission.token_id, submission.wallet_address,
            submission.order_type, submission.quantity, submission.min_quantity, submission.price_per_share)
        IS DISTINCT FROM ROW(NEW.owner_account_id, NEW.wallet_id, NEW.token_id, NEW.wallet_address,
            NEW.order_type, NEW.quantity, NEW.min_quantity, NEW.price_per_share)
        OR challenge.submission_id IS DISTINCT FROM submission.uuid OR challenge.purpose IS DISTINCT FROM 'order_create'
        OR challenge.consumed_at IS NULL OR challenge.consumed_signature = ''
        OR challenge.consumed_at > NEW.created_at
    THEN RAISE EXCEPTION 'Complete the actual reciprocal order birth' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION public.tokens_check_trading_modification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    action public.tokens_orderactionsubmission;
    challenge public.signing_challenges;
    changes jsonb;
BEGIN
    IF NEW.last_modification_action_id IS NULL OR NEW.modification_count IS NOT DISTINCT FROM OLD.modification_count THEN
        RETURN NULL;
    END IF;
    SELECT * INTO action FROM public.tokens_orderactionsubmission WHERE uuid = NEW.last_modification_action_id;
    SELECT * INTO challenge FROM public.signing_challenges WHERE uuid = action.executed_challenge_id;
    changes := public.tokens_modification_changes(OLD.quantity, OLD.min_quantity, OLD.price_per_share,
        NEW.quantity, NEW.min_quantity, NEW.price_per_share);
    IF action.status IS DISTINCT FROM 'applied' OR action.purpose IS DISTINCT FROM 'modify'
        OR ROW(action.order_id, action.owner_account_id, action.wallet_id, action.token_id,
            action.eligibility_decision_id, action.eligibility_admitted_at,
            action.new_quantity, action.new_min_quantity, action.new_price_per_share)
        IS DISTINCT FROM ROW(NEW.uuid, NEW.owner_account_id, NEW.wallet_id, NEW.token_id,
            NEW.last_modification_eligibility_decision_id, NEW.last_modified_at,
            NEW.quantity, NEW.min_quantity, NEW.price_per_share)
        OR action.initiated_by_id IS DISTINCT FROM action.executed_by_id
        OR action.result IS DISTINCT FROM jsonb_build_object('kind', 'modify',
            'modification_count', NEW.modification_count, 'changes', changes)
        OR challenge.action_id IS DISTINCT FROM action.uuid OR challenge.order_id IS DISTINCT FROM NEW.uuid
        OR challenge.purpose IS DISTINCT FROM 'order_modify' OR challenge.wallet_id IS DISTINCT FROM NEW.wallet_id
        OR challenge.consumed_at IS NULL OR challenge.consumed_at > NEW.last_modified_at
        OR challenge.consumed_signature IS DISTINCT FROM NEW.current_signature
        OR (SELECT count(*) FROM public.tokens_ordermodificationlog WHERE order_id = NEW.uuid AND challenge_id = challenge.uuid)
            IS DISTINCT FROM jsonb_array_length(changes)::bigint
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(changes) change WHERE (
            SELECT count(*) FROM public.tokens_ordermodificationlog log WHERE log.order_id = NEW.uuid
                AND log.challenge_id = challenge.uuid AND log.field_name = change->>'field'
                AND log.old_value = change->>'old' AND log.new_value = change->>'new'
                AND log.signature = NEW.current_signature AND lower(log.signer_address) = lower(NEW.wallet_address)) <> 1)
    THEN RAISE EXCEPTION 'Complete the actual immutable modification event and exact logs' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION public.tokens_guard_trading_log() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    action public.tokens_orderactionsubmission;
    target public.tokens_transferorder;
    challenge public.signing_challenges;
BEGIN
    IF current_user = __MIGRATE__ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM public.signing_challenges issued
            JOIN public.tokens_orderactionsubmission linked ON linked.uuid = issued.action_id
            JOIN public.tokens_transferorder retained_order ON retained_order.uuid = linked.order_id
            WHERE issued.uuid = OLD.challenge_id AND (linked.eligibility_decision_id IS NOT NULL
                OR (retained_order.last_modification_action_id = linked.uuid
                    AND retained_order.last_modification_eligibility_decision_id IS NOT NULL)))
            OR (TG_OP = 'UPDATE' AND ROW(NEW.order_id, NEW.challenge_id) IS DISTINCT FROM ROW(OLD.order_id, OLD.challenge_id))
        THEN RAISE EXCEPTION 'Retain completed modification logs and their association' USING ERRCODE = '23514'; END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    command := public.tokens_trading_command();
    SELECT * INTO action FROM public.tokens_orderactionsubmission WHERE uuid = (command->>'action_uuid')::uuid;
    SELECT * INTO target FROM public.tokens_transferorder WHERE uuid = NEW.order_id;
    SELECT * INTO challenge FROM public.signing_challenges WHERE uuid = NEW.challenge_id;
    IF command->>'operation' IS DISTINCT FROM 'modify_order' OR action.status IS DISTINCT FROM 'pending'
        OR action.eligibility_decision_id IS NOT NULL OR action.eligibility_admitted_at IS NOT NULL
        OR action.order_id IS DISTINCT FROM NEW.order_id OR target.last_modification_action_id IS DISTINCT FROM action.uuid
        OR target.last_modification_eligibility_decision_id IS DISTINCT FROM (command->>'decision_uuid')::uuid
        OR target.last_modified_at IS NULL OR challenge.uuid IS DISTINCT FROM (command->>'challenge_uuid')::uuid
        OR challenge.action_id IS DISTINCT FROM action.uuid OR challenge.consumed_at IS NULL
        OR NEW.signature IS DISTINCT FROM target.current_signature
        OR NEW.signature IS DISTINCT FROM challenge.consumed_signature
        OR lower(NEW.signer_address) IS DISTINCT FROM lower(target.wallet_address)
        OR NOT public.tokens_trading_binding(command)
    THEN RAISE EXCEPTION 'Append logs only within the genuine pending modification event' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.tokens_guard_trading_swap() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    target public.tokens_transferorder;
    seller boolean;
    checked_at timestamptz;
BEGIN
    IF current_user = __MIGRATE__ THEN
        IF (TG_OP = 'INSERT' AND (NEW.seller_eligibility_decision_id IS NOT NULL OR NEW.buyer_eligibility_decision_id IS NOT NULL
            OR NEW.seller_eligibility_admitted_at IS NOT NULL OR NEW.buyer_eligibility_admitted_at IS NOT NULL))
            OR (TG_OP = 'UPDATE' AND ROW(NEW.seller_eligibility_decision_id, NEW.buyer_eligibility_decision_id,
                NEW.seller_eligibility_admitted_at, NEW.buyer_eligibility_admitted_at)
                IS DISTINCT FROM ROW(OLD.seller_eligibility_decision_id, OLD.buyer_eligibility_decision_id,
                OLD.seller_eligibility_admitted_at, OLD.buyer_eligibility_admitted_at))
        THEN RAISE EXCEPTION 'Maintenance cannot manufacture party admission' USING ERRCODE = '23514'; END IF;
        IF TG_OP = 'INSERT' OR (OLD.seller_eligibility_decision_id IS NULL AND OLD.buyer_eligibility_decision_id IS NULL)
        THEN RETURN NEW; END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.seller_signature <> '' OR NEW.buyer_signature <> '' OR NEW.seller_eligibility_decision_id IS NOT NULL
            OR NEW.buyer_eligibility_decision_id IS NOT NULL OR NEW.seller_eligibility_admitted_at IS NOT NULL
            OR NEW.buyer_eligibility_admitted_at IS NOT NULL
        THEN RAISE EXCEPTION 'New swaps start without party signatures or admission' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF ROW(NEW.seller_signature, NEW.buyer_signature, NEW.seller_eligibility_decision_id, NEW.buyer_eligibility_decision_id,
            NEW.seller_eligibility_admitted_at, NEW.buyer_eligibility_admitted_at)
        IS NOT DISTINCT FROM ROW(OLD.seller_signature, OLD.buyer_signature, OLD.seller_eligibility_decision_id,
            OLD.buyer_eligibility_decision_id, OLD.seller_eligibility_admitted_at, OLD.buyer_eligibility_admitted_at)
    THEN RETURN NEW; END IF;
    seller := OLD.seller_signature = '' AND NEW.seller_signature <> '';
    IF (seller AND (OLD.buyer_signature IS DISTINCT FROM NEW.buyer_signature
        OR ROW(NEW.buyer_eligibility_decision_id, NEW.buyer_eligibility_admitted_at)
            IS DISTINCT FROM ROW(OLD.buyer_eligibility_decision_id, OLD.buyer_eligibility_admitted_at)
        OR OLD.seller_eligibility_decision_id IS NOT NULL OR OLD.seller_eligibility_admitted_at IS NOT NULL))
        OR (NOT seller AND (OLD.buyer_signature <> '' OR NEW.buyer_signature = ''
            OR OLD.seller_signature IS DISTINCT FROM NEW.seller_signature
            OR ROW(NEW.seller_eligibility_decision_id, NEW.seller_eligibility_admitted_at)
                IS DISTINCT FROM ROW(OLD.seller_eligibility_decision_id, OLD.seller_eligibility_admitted_at)
            OR OLD.buyer_eligibility_decision_id IS NOT NULL OR OLD.buyer_eligibility_admitted_at IS NOT NULL))
    THEN RAISE EXCEPTION 'Retain party signatures and admit only one genuine first signature' USING ERRCODE = '23514'; END IF;
    command := public.tokens_trading_command();
    SELECT * INTO target FROM public.tokens_transferorder WHERE uuid = CASE WHEN seller THEN NEW.sell_order_id ELSE NEW.buy_order_id END;
    IF command->>'operation' IS DISTINCT FROM 'first_signature'
        OR command->>'participant' IS DISTINCT FROM (CASE WHEN seller THEN 'seller' ELSE 'buyer' END)
        OR ROW(NEW.uuid, NEW.share_token_id, target.owner_account_id, target.wallet_id)
            IS DISTINCT FROM ROW((command->>'target_uuid')::uuid, (command->>'token_uuid')::uuid,
                (command->>'owner_account_uuid')::uuid, (command->>'wallet_uuid')::uuid)
        OR target.token_id IS DISTINCT FROM NEW.share_token_id
        OR (CASE WHEN seller THEN NEW.seller_wallet_id ELSE NEW.buyer_wallet_id END) IS DISTINCT FROM target.wallet_id
        OR lower(CASE WHEN seller THEN NEW.seller_address ELSE NEW.buyer_address END) IS DISTINCT FROM lower(target.wallet_address)
        OR NOT EXISTS (SELECT 1 FROM public.wallets WHERE uuid = target.wallet_id
            AND lower(address) = lower(target.wallet_address))
        OR (CASE WHEN seller THEN NEW.seller_signature ELSE NEW.buyer_signature END) IS DISTINCT FROM command->>'signature'
        OR (CASE WHEN seller THEN NEW.seller_eligibility_decision_id ELSE NEW.buyer_eligibility_decision_id END)
            IS DISTINCT FROM (command->>'decision_uuid')::uuid
        OR OLD.status NOT IN ('created', CASE WHEN seller THEN 'buyer_signed' ELSE 'seller_signed' END)
        OR OLD.transaction_id IS NOT NULL OR NEW.transaction_id IS NOT NULL OR OLD.tx_hash <> '' OR NEW.tx_hash <> ''
        OR ROW(NEW.settlement_protocol_version, NEW.settlement_context, NEW.settlement_digest, NEW.expires_at,
            NEW.sell_order_id, NEW.buy_order_id, NEW.seller_wallet_id, NEW.buyer_wallet_id,
            NEW.share_token_id, NEW.payment_asset_id, NEW.share_amount, NEW.payment_amount, NEW.seller_address, NEW.buyer_address)
            IS DISTINCT FROM ROW(OLD.settlement_protocol_version, OLD.settlement_context, OLD.settlement_digest, OLD.expires_at,
            OLD.sell_order_id, OLD.buy_order_id, OLD.seller_wallet_id, OLD.buyer_wallet_id,
            OLD.share_token_id, OLD.payment_asset_id, OLD.share_amount, OLD.payment_amount, OLD.seller_address, OLD.buyer_address)
        OR NEW.settlement_protocol_version <> 1 OR NEW.settlement_digest IS DISTINCT FROM command->>'settlement_digest'
        OR NEW.status IS DISTINCT FROM (CASE WHEN NEW.seller_signature <> '' AND NEW.buyer_signature <> '' THEN 'ready'
            WHEN seller THEN 'seller_signed' ELSE 'buyer_signed' END)
    THEN RAISE EXCEPTION 'Bind the actual first party signature and retained settlement terms' USING ERRCODE = '23514'; END IF;
    checked_at := clock_timestamp();
    IF checked_at >= NEW.expires_at THEN RAISE EXCEPTION 'The swap signature deadline passed' USING ERRCODE = '23514'; END IF;
    PERFORM public.tokens_trading_current(command, checked_at);
    IF seller THEN NEW.seller_eligibility_admitted_at := checked_at;
    ELSE NEW.buyer_eligibility_admitted_at := checked_at; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.tokens_keep_trading_issuer() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF current_user <> __MIGRATE__ AND NEW.company_id IS DISTINCT FROM OLD.company_id
        AND current_user <> __OPERATOR__ THEN
        RAISE EXCEPTION 'Issuer changes require the bounded operator boundary' USING ERRCODE = '23514';
    END IF;
    IF current_user <> __MIGRATE__ AND NEW.company_id IS DISTINCT FROM OLD.company_id AND (
        EXISTS (SELECT 1 FROM public.tokens_ordersubmission WHERE token_id = OLD.uuid)
        OR EXISTS (SELECT 1 FROM public.tokens_orderactionsubmission WHERE token_id = OLD.uuid)
        OR EXISTS (SELECT 1 FROM public.tokens_transferorder WHERE token_id = OLD.uuid)
        OR EXISTS (SELECT 1 FROM public.tokens_swaporder WHERE share_token_id = OLD.uuid))
    THEN RAISE EXCEPTION 'Retain the issuer of actual trading history' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.tokens_lock_pending_trading_token() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF current_user <> __MIGRATE__ THEN
        PERFORM 1 FROM public.tokens_sharetoken WHERE uuid = NEW.token_id FOR NO KEY UPDATE;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_trading_order_begin BEFORE INSERT OR UPDATE ON public.tokens_transferorder
FOR EACH STATEMENT EXECUTE FUNCTION public.tokens_begin_trading_admission();
CREATE TRIGGER tokens_trading_submission_begin BEFORE UPDATE ON public.tokens_ordersubmission
FOR EACH STATEMENT EXECUTE FUNCTION public.tokens_begin_trading_admission();
CREATE TRIGGER tokens_trading_action_begin BEFORE UPDATE ON public.tokens_orderactionsubmission
FOR EACH STATEMENT EXECUTE FUNCTION public.tokens_begin_trading_admission();
CREATE TRIGGER tokens_trading_swap_begin BEFORE UPDATE ON public.tokens_swaporder
FOR EACH STATEMENT EXECUTE FUNCTION public.tokens_begin_trading_admission();
CREATE TRIGGER tokens_trading_order_guard BEFORE INSERT OR UPDATE ON public.tokens_transferorder
FOR EACH ROW EXECUTE FUNCTION public.tokens_guard_trading_order();
CREATE TRIGGER tokens_trading_submission_guard BEFORE INSERT OR UPDATE ON public.tokens_ordersubmission
FOR EACH ROW EXECUTE FUNCTION public.tokens_guard_trading_submission();
CREATE TRIGGER tokens_trading_action_guard BEFORE INSERT OR UPDATE ON public.tokens_orderactionsubmission
FOR EACH ROW EXECUTE FUNCTION public.tokens_guard_trading_action();
CREATE TRIGGER tokens_trading_swap_guard BEFORE INSERT OR UPDATE ON public.tokens_swaporder
FOR EACH ROW EXECUTE FUNCTION public.tokens_guard_trading_swap();
CREATE TRIGGER tokens_trading_log_guard BEFORE INSERT OR UPDATE OR DELETE ON public.tokens_ordermodificationlog
FOR EACH ROW EXECUTE FUNCTION public.tokens_guard_trading_log();
CREATE TRIGGER tokens_trading_issuer_guard BEFORE UPDATE OF company_id ON public.tokens_sharetoken
FOR EACH ROW EXECUTE FUNCTION public.tokens_keep_trading_issuer();
CREATE TRIGGER tokens_trading_pending_submission_token BEFORE INSERT ON public.tokens_ordersubmission
FOR EACH ROW EXECUTE FUNCTION public.tokens_lock_pending_trading_token();
CREATE TRIGGER tokens_trading_pending_action_token BEFORE INSERT ON public.tokens_orderactionsubmission
FOR EACH ROW EXECUTE FUNCTION public.tokens_lock_pending_trading_token();
CREATE CONSTRAINT TRIGGER tokens_trading_birth_complete AFTER INSERT ON public.tokens_transferorder
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tokens_check_trading_birth();
CREATE CONSTRAINT TRIGGER tokens_trading_modification_complete AFTER UPDATE ON public.tokens_transferorder
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tokens_check_trading_modification();
"""


def install_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator, migrate = cursor.fetchone()
        cursor.execute(SQL.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_transferorder, tokens_ordersubmission, tokens_orderactionsubmission, tokens_swaporder IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_transferorder WHERE eligibility_decision_id IS NOT NULL OR last_modification_eligibility_decision_id IS NOT NULL) OR EXISTS (SELECT 1 FROM tokens_swaporder WHERE seller_eligibility_decision_id IS NOT NULL OR buyer_eligibility_decision_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain actual trading admission evidence and its guards.")
        for table, names in {
            "tokens_transferorder": [
                "tokens_trading_order_begin",
                "tokens_trading_order_guard",
                "tokens_trading_birth_complete",
                "tokens_trading_modification_complete",
            ],
            "tokens_ordersubmission": [
                "tokens_trading_submission_begin",
                "tokens_trading_submission_guard",
                "tokens_trading_pending_submission_token",
            ],
            "tokens_orderactionsubmission": [
                "tokens_trading_action_begin",
                "tokens_trading_action_guard",
                "tokens_trading_pending_action_token",
            ],
            "tokens_swaporder": ["tokens_trading_swap_begin", "tokens_trading_swap_guard"],
            "tokens_ordermodificationlog": ["tokens_trading_log_guard"],
            "tokens_sharetoken": ["tokens_trading_issuer_guard"],
        }.items():
            for name in names:
                cursor.execute(f"DROP TRIGGER {name} ON {table}")
        for signature in [
            "tokens_lock_pending_trading_token()",
            "tokens_keep_trading_issuer()",
            "tokens_guard_trading_swap()",
            "tokens_guard_trading_log()",
            "tokens_check_trading_modification()",
            "tokens_check_trading_birth()",
            "tokens_modification_changes(bigint,bigint,numeric,bigint,bigint,numeric)",
            "tokens_guard_trading_action()",
            "tokens_guard_trading_submission()",
            "tokens_guard_trading_order()",
            "tokens_trading_current(jsonb,timestamptz)",
            "tokens_begin_trading_admission()",
            "tokens_lock_trading_admission(jsonb)",
            "tokens_trading_binding(jsonb)",
            "tokens_trading_command()",
        ]:
            cursor.execute(f"DROP FUNCTION public.{signature}")


class Migration(migrations.Migration):

    dependencies = [
        ("assets", "0014_native_chain_deployments"),
        ("blockchain", "0008_fresh_signer_bootstrap"),
        ("tokens", "0081_held_orders_and_retired_statuses"),
        ("users", "0034_company_eligibility_consumption"),
        ("wallets", "0023_transaction_market_value_aud"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="orderactionsubmission",
            name="order_action_outcome_shape",
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="eligibility_admitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="orderactionsubmission",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="ordersubmission",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="buyer_eligibility_admitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="buyer_eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="seller_eligibility_admitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="swaporder",
            name="seller_eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="creation_submission",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.ordersubmission",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="last_modification_action",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.orderactionsubmission",
            ),
        ),
        migrations.AddField(
            model_name="transferorder",
            name="last_modification_eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("eligibility_admitted_at__isnull", True), ("eligibility_decision__isnull", True)),
                    models.Q(
                        ("eligibility_admitted_at__isnull", False),
                        ("eligibility_decision__isnull", False),
                        ("purpose", "modify"),
                        ("status", "applied"),
                    ),
                    _connector="OR",
                ),
                name="order_action_eligibility_modify_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="orderactionsubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("executed_by__isnull", True),
                        ("executed_challenge__isnull", True),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("refusal_status__isnull", True),
                        ("resolved_at__isnull", True),
                        ("result__isnull", True),
                        ("status", "pending"),
                    ),
                    models.Q(
                        ("executed_by__isnull", False),
                        ("executed_challenge__isnull", False),
                        ("refusal_code", ""),
                        ("refusal_detail", ""),
                        ("refusal_status__isnull", True),
                        ("resolved_at__isnull", False),
                        ("result__isnull", False),
                        ("status", "applied"),
                    ),
                    models.Q(
                        ("executed_by__isnull", False),
                        ("executed_challenge__isnull", False),
                        ("refusal_status__isnull", False),
                        ("resolved_at__isnull", False),
                        ("result__isnull", True),
                        ("status", "refused"),
                        models.Q(("refusal_detail", ""), _negated=True),
                        models.Q(
                            models.Q(
                                ("purpose", "cancel"),
                                ("refusal_code", "order_cancellation_failed"),
                                ("refusal_status", 400),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "order_modification_failed"),
                                ("refusal_status", 400),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "order_modification_conflict"),
                                ("refusal_status", 409),
                            ),
                            models.Q(
                                ("purpose", "modify"),
                                ("refusal_code", "investor_not_eligible"),
                                ("refusal_status", 403),
                            ),
                            _connector="OR",
                        ),
                    ),
                    _connector="OR",
                ),
                name="order_action_outcome_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="ordersubmission",
            constraint=models.CheckConstraint(
                condition=models.Q(("status", "created"), ("eligibility_decision__isnull", True), _connector="OR"),
                name="order_submission_eligibility_created_only",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("seller_eligibility_admitted_at__isnull", True), ("seller_eligibility_decision__isnull", True)
                    ),
                    models.Q(
                        ("seller_eligibility_admitted_at__isnull", False),
                        ("seller_eligibility_decision__isnull", False),
                        models.Q(("seller_signature", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="swap_seller_eligibility_signature_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="swaporder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("buyer_eligibility_admitted_at__isnull", True), ("buyer_eligibility_decision__isnull", True)
                    ),
                    models.Q(
                        ("buyer_eligibility_admitted_at__isnull", False),
                        ("buyer_eligibility_decision__isnull", False),
                        models.Q(("buyer_signature", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="swap_buyer_eligibility_signature_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("creation_submission__isnull", True), ("eligibility_decision__isnull", True)),
                    models.Q(("creation_submission__isnull", False), ("eligibility_decision__isnull", False)),
                    _connector="OR",
                ),
                name="transfer_order_eligibility_birth_pair",
            ),
        ),
        migrations.AddConstraint(
            model_name="transferorder",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("last_modification_action__isnull", True),
                        ("last_modification_eligibility_decision__isnull", True),
                    ),
                    models.Q(
                        ("last_modification_action__isnull", False),
                        ("last_modification_eligibility_decision__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="transfer_order_modification_eligibility_pair",
            ),
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
