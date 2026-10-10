CREATE TABLE public.tokens_stablecoin_fold_grant (asset_id varchar(36) PRIMARY KEY);

CREATE UNIQUE INDEX tokens_registermemberwallet_company_address_ci ON public.tokens_registermemberwallet USING btree (company_id, lower((address)::text));

ALTER TABLE public.tokens_swaporder DROP CONSTRAINT tokens_swaporder_buy_order_id_5999ca66_fk_tokens_tr;
ALTER TABLE public.tokens_swaporder ADD CONSTRAINT tokens_swaporder_buy_order_id_5999ca66_fk_tokens_tr FOREIGN KEY (buy_order_id) REFERENCES tokens_transferorder(uuid) ON DELETE RESTRICT;

ALTER TABLE public.tokens_swaporder DROP CONSTRAINT tokens_swaporder_sell_order_id_7764b7a1_fk_tokens_tr;
ALTER TABLE public.tokens_swaporder ADD CONSTRAINT tokens_swaporder_sell_order_id_7764b7a1_fk_tokens_tr FOREIGN KEY (sell_order_id) REFERENCES tokens_transferorder(uuid) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.hold_legacy_swap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.settlement_protocol_version = 0 THEN
        RAISE EXCEPTION 'Legacy swap history is held for operator attribution' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_capital_execution()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    request tokens_capitalincreaserequest%ROWTYPE;
    token tokens_sharetoken%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted capital execution history cannot be deleted';
    END IF;
    SELECT * INTO request FROM tokens_capitalincreaserequest WHERE uuid = NEW.request_id;
    IF NOT FOUND OR request.dispatch_id IS DISTINCT FROM NEW.uuid
        OR request.token_id IS DISTINCT FROM NEW.token_id OR request.company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'Capital execution must retain its original request identity';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF request.status <> 'approved' OR NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
            OR NEW.retry_of IS NOT NULL OR NEW.attribution_evidence IS NOT NULL OR NEW.projected_at IS NOT NULL THEN
            RAISE EXCEPTION 'Capital admission requires an approved request without an execution outcome';
        END IF;
        SELECT * INTO token FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        IF NOT FOUND OR token.company_id IS DISTINCT FROM NEW.company_id
            OR NEW.intent->>'to' IS DISTINCT FROM lower(token.contract_address)
            OR NEW.intent->>'token_chain' IS DISTINCT FROM token.chain
            OR NEW.intent->>'prior_authorized_total' IS DISTINCT FROM token.total_supply::numeric::text THEN
            RAISE EXCEPTION 'Capital admission must capture the current token identity and cap';
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NOT (NEW.intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'token_chain',
                                   'prior_authorized_total', 'new_authorized_total', 'additional_shares'])
        OR NEW.intent->>'value' IS DISTINCT FROM '0'
        OR NEW.intent->>'new_authorized_total' IS DISTINCT FROM request.new_authorized_total::text
        OR NEW.intent->>'additional_shares' IS DISTINCT FROM request.additional_shares::text THEN
        RAISE EXCEPTION 'Capital admission requires immutable approved cap terms';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.request_id, NEW.token_id, NEW.company_id, NEW.executed_by_id, NEW.intent)
            IS DISTINCT FROM
            ROW(OLD.uuid, OLD.created_at, OLD.request_id, OLD.token_id, OLD.company_id, OLD.executed_by_id, OLD.intent) THEN
            RAISE EXCEPTION 'Capital execution intent and authority are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'Capital execution retains its original outgoing operation';
        END IF;
        IF OLD.attribution_evidence IS NOT NULL
            AND NEW.attribution_evidence IS DISTINCT FROM OLD.attribution_evidence THEN
            RAISE EXCEPTION 'Capital attribution evidence cannot be cleared or replaced';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.transaction_id;
            IF NEW.transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'An unresolved capital transaction cannot be replaced';
            END IF;
        END IF;
    END IF;
    IF NEW.attribution_evidence IS NOT NULL AND (
        jsonb_typeof(NEW.attribution_evidence) IS DISTINCT FROM 'object'
        OR NOT (NEW.attribution_evidence ?& ARRAY['reason', 'source', 'expected', 'observed', 'observed_at'])
        OR NEW.projected_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'A capital attribution hold requires retained structured evidence';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'capital-increase:' || NEW.request_id::text || ':' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.intent->'chain_id', 'sender', NEW.intent->'sender', 'to', NEW.intent->'to',
                'value', NEW.intent->'value', 'data', NEW.intent->'data'
            ) THEN
            RAISE EXCEPTION 'Capital execution must reference its own immutable operation';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF NOT FOUND OR projected.related_model IS DISTINCT FROM 'tokens.CapitalIncreaseRequest'
                OR projected.related_uuid IS DISTINCT FROM NEW.request_id
                OR projected.function_name IS DISTINCT FROM 'setAuthorizedShares'
                OR lower(projected.from_address) IS DISTINCT FROM NEW.intent->>'sender'
                OR lower(projected.to_address) IS DISTINCT FROM NEW.intent->>'to'
                OR projected.function_args->>'newAuthorizedShares' IS DISTINCT FROM NEW.intent->>'new_authorized_total'
            THEN
                RAISE EXCEPTION 'Capital projection must identify its original request and approved terms';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Capital projection must identify the original signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a retained revert can precede an unsigned capital retry';
            END IF;
        END IF;
        IF NEW.projected_at IS NOT NULL AND (
            operation.status NOT IN ('confirmed', 'failed', 'reverted')
            OR NEW.retry_of IS NOT DISTINCT FROM operation.claim_id
            OR (operation.status = 'confirmed' AND projected.status IS DISTINCT FROM 'confirmed')
            OR (operation.status = 'reverted' AND projected.status IS DISTINCT FROM 'reverted')
        ) THEN
            RAISE EXCEPTION 'Capital projection requires an attributable terminal operation without a pending retry';
        END IF;
    ELSIF NEW.transaction_id IS NOT NULL OR NEW.retry_of IS NOT NULL OR (
        NEW.projected_at IS NOT NULL AND (
            (NEW.intent->>'new_authorized_total')::numeric > (NEW.intent->>'prior_authorized_total')::numeric
            OR NEW.attribution_evidence IS NOT NULL
        )
    ) THEN
        RAISE EXCEPTION 'Capital execution outcomes require their original operation';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.retry_of IS DISTINCT FROM OLD.retry_of AND (
            NEW.retry_of IS DISTINCT FROM operation.claim_id OR operation.status NOT IN ('failed', 'reverted')
            OR OLD.projected_at IS NULL OR NEW.projected_at IS NOT NULL OR request.status <> 'failed'
            OR NEW.attribution_evidence IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'A capital retry must authorize the exact projected failed claim';
        END IF;
        IF OLD.projected_at IS NOT NULL AND NEW.projected_at IS DISTINCT FROM OLD.projected_at AND (
            NEW.projected_at IS NOT NULL OR NEW.retry_of IS NOT DISTINCT FROM OLD.retry_of
        ) THEN
            RAISE EXCEPTION 'A capital projection can reopen only with explicit retry admission';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_capital_request()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    execution tokens_capitalincreaseexecution%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Only draft capital requests can be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.dispatch_id, NEW.token_id, NEW.company_id)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.dispatch_id, OLD.token_id, OLD.company_id) THEN
            RAISE EXCEPTION 'Capital request identity cannot be changed or backfilled';
        END IF;
        IF OLD.status <> 'draft' AND ROW(NEW.additional_shares, NEW.new_authorized_total, NEW.purpose,
            NEW.board_resolution_reference, NEW.shareholder_approval_reference)
            IS DISTINCT FROM ROW(OLD.additional_shares, OLD.new_authorized_total, OLD.purpose,
            OLD.board_resolution_reference, OLD.shareholder_approval_reference) THEN
            RAISE EXCEPTION 'Only draft capital request terms can be edited';
        END IF;
        IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Submitted capital requests cannot return to draft';
        END IF;
    END IF;
    IF NEW.dispatch_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('executing', 'executed', 'failed') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('executing', 'executed', 'failed', 'superseded')
        AND NEW.status NOT IN ('executing', 'executed', 'failed', 'superseded') THEN
        RETURN NEW;
    END IF;
    SELECT * INTO execution FROM tokens_capitalincreaseexecution WHERE request_id = NEW.uuid;
    IF NOT FOUND THEN
        IF NEW.status IN ('executing', 'executed', 'failed') THEN
            RAISE EXCEPTION 'New capital execution requires its admitted private record';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.dispatch_id IS DISTINCT FROM execution.uuid THEN
        RAISE EXCEPTION 'A capital request retains its original execution identity';
    END IF;
    IF execution.projected_at IS NULL THEN
        IF NEW.status <> 'executing' OR NEW.executed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Unresolved capital execution must retain its in-flight slot';
        END IF;
    ELSE
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = execution.operation_id;
        IF execution.operation_id IS NULL THEN
            IF NEW.status <> 'superseded' OR NEW.executed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Unsigned capital retirement must retain its superseded outcome';
            END IF;
        ELSIF operation.status = 'confirmed' THEN
            IF NEW.status <> 'executed' OR NEW.executed_at IS NULL THEN
                RAISE EXCEPTION 'Confirmed capital execution retains its completed outcome';
            END IF;
        ELSIF operation.status IN ('failed', 'reverted') THEN
            IF NEW.status NOT IN ('failed', 'superseded') OR NEW.executed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Failed capital execution requires explicit retry admission';
            END IF;
        ELSE
            RAISE EXCEPTION 'Capital execution cannot release unresolved signed work';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_capital_token()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF ROW(NEW.uuid, NEW.company_id, NEW.contract_address, NEW.chain, NEW.total_supply, NEW.decimals)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.company_id, OLD.contract_address, OLD.chain, OLD.total_supply, OLD.decimals)
        AND EXISTS (
            SELECT 1 FROM tokens_capitalincreaserequest
            WHERE token_id = OLD.uuid AND dispatch_id IS NOT NULL AND status = 'executing'
        ) THEN
        RAISE EXCEPTION 'A token retains its identity and cap while capital execution is unresolved';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_issuance_execution()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    request tokens_shareissuancerequest%ROWTYPE;
    token tokens_sharetoken%ROWTYPE;
    subscription offerings_subscription%ROWTYPE;
    issuance tokens_shareissuance%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted issuance history cannot be deleted';
    END IF;
    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'failed' AND NEW.status = 'queued'))
        AND EXISTS (SELECT 1 FROM tokens_registerimport i
        JOIN tokens_shareregister r ON r.token_id = i.token_id
        JOIN tokens_registerentry e ON e.register_id = r.uuid AND e.operation_id = i.uuid AND e.kind = 'opening'
        WHERE i.status = 'applied' AND i.token_id = NEW.token_id) THEN
        RAISE EXCEPTION 'Imported registers require attributed issuance execution' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO request FROM tokens_shareissuancerequest WHERE uuid = NEW.request_id;
    IF NOT FOUND OR request.dispatch_id IS DISTINCT FROM NEW.uuid
        OR request.token_id IS DISTINCT FROM NEW.token_id OR request.company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'Issuance execution must retain its original request identity';
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NOT (NEW.intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'token_chain', 'recipient', 'amount'])
        OR NEW.intent->>'value' IS DISTINCT FROM '0'
        OR NEW.intent->>'amount' IS DISTINCT FROM request.amount::text
        OR NEW.intent->>'recipient' IS DISTINCT FROM lower(request.recipient_address)
        OR NEW.status NOT IN ('queued', 'executing', 'executed', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Issuance admission requires immutable approved mint terms';
    END IF;
    IF NEW.subscription_id IS NOT NULL THEN
        SELECT * INTO subscription FROM offerings_subscription WHERE uuid = NEW.subscription_id;
        IF NOT FOUND OR subscription.issuance_request_id IS DISTINCT FROM request.uuid
            OR (NEW.authority <> 'offerings.change_subscription' AND NOT (NEW.authority = 'company' AND NEW.source_instruction_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Allotment must retain its original subscription and authority';
        END IF;
    ELSIF NEW.authority <> 'tokens.change_shareissuancerequest' AND NOT (NEW.authority = 'company' AND NEW.source_instruction_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Issuance requires its original operator authority';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF request.status <> 'approved' OR NEW.status <> 'queued' OR NEW.issuance_id IS NOT NULL
            OR NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL OR NEW.retry_of IS NOT NULL THEN
            RAISE EXCEPTION 'Issuance admission requires an approved request without an execution outcome';
        END IF;
        IF NEW.subscription_id IS NOT NULL AND (
            subscription.status <> 'paid'
            OR COALESCE(subscription.allotted_quantity, subscription.quantity) IS DISTINCT FROM request.amount
            OR subscription.refunded_at IS NOT NULL
            OR subscription.company_id IS DISTINCT FROM NEW.company_id
        ) THEN
            RAISE EXCEPTION 'Allotment admission requires its original paid allocation';
        END IF;
        SELECT * INTO token FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        IF NOT FOUND OR token.company_id IS DISTINCT FROM NEW.company_id
            OR NEW.intent->>'to' IS DISTINCT FROM lower(token.contract_address)
            OR NEW.intent->>'token_chain' IS DISTINCT FROM token.chain OR token.decimals <> 0 THEN
            RAISE EXCEPTION 'Issuance admission must capture the current token identity';
        END IF;
    ELSE
        IF ROW(NEW.uuid, NEW.created_at, NEW.request_id, NEW.token_id, NEW.company_id, NEW.subscription_id,
               NEW.executed_by_id, NEW.authority, NEW.intent)
            IS DISTINCT FROM
            ROW(OLD.uuid, OLD.created_at, OLD.request_id, OLD.token_id, OLD.company_id, OLD.subscription_id,
                OLD.executed_by_id, OLD.authority, OLD.intent) THEN
            RAISE EXCEPTION 'Issuance execution intent and authority are immutable';
        END IF;
        IF (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id)
            OR (OLD.issuance_id IS NOT NULL AND NEW.issuance_id IS DISTINCT FROM OLD.issuance_id) THEN
            RAISE EXCEPTION 'Issuance execution retains its original operation and public issuance';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.transaction_id;
            IF NEW.transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'An unresolved issuance transaction cannot be replaced';
            END IF;
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
            (OLD.status = 'queued' AND NEW.status IN ('executing', 'cancelled'))
            OR (OLD.status = 'executing' AND NEW.status IN ('executed', 'failed'))
            OR (OLD.status = 'failed' AND NEW.status IN ('queued', 'cancelled'))
        ) THEN
            RAISE EXCEPTION 'Issuance execution cannot reopen a cancelled or completed outcome';
        END IF;
    END IF;
    IF NEW.issuance_id IS NOT NULL THEN
        SELECT * INTO issuance FROM tokens_shareissuance WHERE uuid = NEW.issuance_id;
        IF NOT FOUND OR issuance.idempotency_key IS DISTINCT FROM 'issuance-request:' || NEW.request_id::text
            OR issuance.token_id IS DISTINCT FROM NEW.token_id OR issuance.mint_journal IS NOT NULL
            OR lower(issuance.recipient_address) IS DISTINCT FROM NEW.intent->>'recipient'
            OR issuance.amount IS DISTINCT FROM NEW.intent->>'amount' THEN
            RAISE EXCEPTION 'Issuance execution must retain its original public mint identity';
        END IF;
    ELSIF NEW.status IN ('executing', 'executed', 'failed') OR NEW.operation_id IS NOT NULL THEN
        RAISE EXCEPTION 'Claimed issuance must retain its public mint identity';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'share-issuance:' || NEW.request_id::text || ':' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.intent->'chain_id', 'sender', NEW.intent->'sender', 'to', NEW.intent->'to',
                'value', NEW.intent->'value', 'data', NEW.intent->'data'
            ) THEN
            RAISE EXCEPTION 'Issuance execution must reference its own immutable operation';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF NOT FOUND OR projected.related_model IS DISTINCT FROM 'tokens.ShareIssuanceRequest'
                OR projected.related_uuid IS DISTINCT FROM NEW.request_id OR projected.function_name <> 'mint'
                OR lower(projected.from_address) IS DISTINCT FROM NEW.intent->>'sender'
                OR lower(projected.to_address) IS DISTINCT FROM NEW.intent->>'to'
                OR projected.function_args IS DISTINCT FROM jsonb_build_object(
                    'recipient', NEW.intent->'recipient', 'amount', NEW.intent->'amount'
                ) THEN
                RAISE EXCEPTION 'Issuance transaction must identify its original request and approved mint';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Issuance transaction must identify the original signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a retained revert can precede an unsigned issuance retry';
            END IF;
        END IF;
        IF NEW.status = 'executed' AND (
            operation.status <> 'confirmed' OR projected.status IS DISTINCT FROM 'confirmed'
            OR NEW.retry_of IS NOT DISTINCT FROM operation.claim_id
        ) THEN
            RAISE EXCEPTION 'Completed issuance requires its original confirmed transaction';
        END IF;
        IF NEW.status IN ('failed', 'cancelled', 'queued') AND (
            operation.status NOT IN ('failed', 'reverted')
            OR (operation.status = 'reverted' AND projected.status IS DISTINCT FROM 'reverted')
            OR (NEW.status = 'failed' AND NEW.retry_of IS NOT DISTINCT FROM operation.claim_id)
        ) THEN
            RAISE EXCEPTION 'Unsigned or reverted issuance outcomes must precede release or retry';
        END IF;
    ELSIF NEW.transaction_id IS NOT NULL OR NEW.retry_of IS NOT NULL OR NEW.status IN ('executed', 'failed') THEN
        RAISE EXCEPTION 'Issuance outcomes require their original operation';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.retry_of IS DISTINCT FROM OLD.retry_of AND (
            NEW.retry_of IS DISTINCT FROM operation.claim_id OR operation.status NOT IN ('failed', 'reverted')
            OR OLD.status <> 'failed' OR NEW.status <> 'queued' OR request.status <> 'failed'
        ) THEN
            RAISE EXCEPTION 'An issuance retry must authorize the exact projected failed claim';
        END IF;
        IF OLD.status = 'failed' AND NEW.status = 'queued' AND NEW.retry_of IS NOT DISTINCT FROM OLD.retry_of THEN
            RAISE EXCEPTION 'A failed issuance requires explicit retry admission';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_issuance_projection()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    request tokens_shareissuancerequest%ROWTYPE;
    execution tokens_shareissuanceexecution%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) - 'initiated_by_id' - 'updated_at'
        IS NOT DISTINCT FROM to_jsonb(OLD) - 'initiated_by_id' - 'updated_at' THEN
        RETURN NEW;
    END IF;
    SELECT * INTO request FROM tokens_shareissuancerequest
        WHERE 'issuance-request:' || uuid::text = CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.idempotency_key
            ELSE NEW.idempotency_key END;
    IF NOT FOUND OR request.dispatch_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE request_id = request.uuid;
    IF NOT FOUND OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'New issuance must retain its admitted execution and public record';
    END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.uuid, NEW.created_at, NEW.token_id, NEW.recipient_address,
        NEW.recipient_name, NEW.recipient_residential_address, NEW.identity_stamped_at,
        NEW.amount, NEW.issuance_type, NEW.reason, NEW.idempotency_key, NEW.mint_journal)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.token_id, OLD.recipient_address,
        OLD.recipient_name, OLD.recipient_residential_address, OLD.identity_stamped_at,
        OLD.amount, OLD.issuance_type, OLD.reason, OLD.idempotency_key, OLD.mint_journal) THEN
        RAISE EXCEPTION 'Admitted issuance terms and stamped holder identity are immutable';
    END IF;
    IF NEW.token_id IS DISTINCT FROM execution.token_id OR NEW.amount IS DISTINCT FROM execution.intent->>'amount'
        OR lower(NEW.recipient_address) IS DISTINCT FROM execution.intent->>'recipient'
        OR NEW.mint_journal IS NOT NULL OR NEW.transaction_id IS DISTINCT FROM execution.transaction_id THEN
        RAISE EXCEPTION 'Issuance projection must identify its original admitted mint';
    END IF;
    IF NEW.transaction_id IS NOT NULL THEN
        SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
        IF NEW.tx_hash IS DISTINCT FROM projected.tx_hash THEN
            RAISE EXCEPTION 'Issuance retains its original transaction hash';
        END IF;
    ELSIF NEW.tx_hash IS NOT NULL THEN
        RAISE EXCEPTION 'A new issuance hash requires its original transaction association';
    END IF;
    IF NEW.status = 'completed' AND execution.status <> 'executed' THEN
        RAISE EXCEPTION 'Issuance completion requires its confirmed execution';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND (
        NEW.status <> 'completed' OR ROW(NEW.completed_at, NEW.block_number, NEW.gas_used)
        IS DISTINCT FROM ROW(OLD.completed_at, OLD.block_number, OLD.gas_used)
    ) THEN
        RAISE EXCEPTION 'Completed issuance retains its original outcome';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_issuance_request()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    execution tokens_shareissuanceexecution%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status NOT IN ('draft', 'submitted') THEN
            RAISE EXCEPTION 'Only unreviewed issuance requests can be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.dispatch_id, NEW.token_id, NEW.company_id)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.dispatch_id, OLD.token_id, OLD.company_id) THEN
            RAISE EXCEPTION 'Issuance request identity cannot be changed or backfilled';
        END IF;
        IF OLD.status NOT IN ('draft', 'submitted') AND ROW(NEW.amount, NEW.recipient_address,
            NEW.recipient_name, NEW.issuance_type, NEW.reason)
            IS DISTINCT FROM ROW(OLD.amount, OLD.recipient_address, OLD.recipient_name, OLD.issuance_type, OLD.reason) THEN
            RAISE EXCEPTION 'Reviewed issuance terms cannot be edited';
        END IF;
        IF OLD.status NOT IN ('draft', 'submitted') AND NEW.status IN ('draft', 'submitted', 'under_review')
            AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Reviewed issuance requests cannot return to review';
        END IF;
        IF OLD.status = 'rejected' AND NEW.status <> 'rejected' THEN
            RAISE EXCEPTION 'Rejected issuance requests cannot be reopened';
        END IF;
    END IF;
    IF NEW.dispatch_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.status <> 'executed' AND (NEW.executed_at IS NOT NULL OR NEW.executed_issuance_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Unexecuted issuance cannot claim a completed projection';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('executing', 'executed', 'failed') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status
        AND NEW.status NOT IN ('executing', 'executed', 'failed') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('draft', 'submitted', 'under_review')
        AND NEW.status IN ('submitted', 'under_review', 'approved', 'rejected') THEN
        RETURN NEW;
    END IF;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE request_id = NEW.uuid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'New issuance execution requires its admitted private record';
    END IF;
    IF NEW.status IS DISTINCT FROM (CASE execution.status
        WHEN 'queued' THEN 'approved' WHEN 'executing' THEN 'executing' WHEN 'executed' THEN 'executed'
        WHEN 'failed' THEN 'failed' WHEN 'cancelled' THEN 'rejected' END) THEN
        RAISE EXCEPTION 'Issuance request state must follow its original admitted execution';
    END IF;
    IF execution.status = 'executed' THEN
        IF NEW.executed_at IS NULL OR NEW.executed_issuance_id IS DISTINCT FROM execution.issuance_id THEN
            RAISE EXCEPTION 'Executed issuance retains its original public projection';
        END IF;
    ELSIF NEW.executed_at IS NOT NULL OR NEW.executed_issuance_id IS NOT NULL THEN
        RAISE EXCEPTION 'Unexecuted issuance cannot claim a completed projection';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_issuance_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    request tokens_shareissuancerequest%ROWTYPE;
    execution tokens_shareissuanceexecution%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.issuance_request_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.issuance_request_id IS NULL))
        AND NEW.issuance_request_id IS NOT NULL THEN
        SELECT * INTO request FROM tokens_shareissuancerequest WHERE uuid = NEW.issuance_request_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Allotment requires its original accessible request';
        END IF;
        IF request.dispatch_id IS NOT NULL THEN
            SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE request_id = request.uuid;
            IF FOUND AND execution.subscription_id IS DISTINCT FROM NEW.uuid THEN
                RAISE EXCEPTION 'An admitted mint cannot acquire a different subscription';
            END IF;
            IF request.status <> 'approved' OR NEW.status <> 'paid'
                OR request.amount IS DISTINCT FROM COALESCE(NEW.allotted_quantity, NEW.quantity)
                OR request.token_id IS DISTINCT FROM (SELECT token_id FROM offerings_offering WHERE uuid = NEW.offering_id)
                OR lower(request.recipient_address) IS DISTINCT FROM (SELECT lower(address) FROM wallets WHERE uuid = NEW.wallet_id)
            THEN
                RAISE EXCEPTION 'Allotment requires the original paid subscription terms';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO request FROM tokens_shareissuancerequest WHERE uuid = OLD.issuance_request_id;
    IF NOT FOUND OR request.dispatch_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted allotment history cannot be deleted';
    END IF;
    IF ROW(NEW.uuid, NEW.created_at, NEW.offering_id, NEW.company_id, NEW.user_account_id, NEW.wallet_id,
        NEW.quantity, NEW.allotted_quantity, NEW.price_per_share, NEW.amount_due, NEW.amount_received,
        NEW.payment_received_on, NEW.payment_reference_seen, NEW.payment_tx_hash, NEW.issuance_request_id,
        NEW.settlement_rail, NEW.settlement_asset_id, NEW.settlement_amount, NEW.reference)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.offering_id, OLD.company_id, OLD.user_account_id,
        OLD.wallet_id, OLD.quantity, OLD.allotted_quantity, OLD.price_per_share, OLD.amount_due, OLD.amount_received,
        OLD.payment_received_on, OLD.payment_reference_seen, OLD.payment_tx_hash, OLD.issuance_request_id,
        OLD.settlement_rail, OLD.settlement_asset_id, OLD.settlement_amount, OLD.reference) THEN
        RAISE EXCEPTION 'Admitted allotment retains its original subscription, payment and allocation';
    END IF;
    IF request.status IN ('approved', 'executing', 'failed') AND (NEW.status <> 'paid'
        OR ROW(NEW.refund_amount, NEW.refunded_at) IS DISTINCT FROM ROW(OLD.refund_amount, OLD.refunded_at)) THEN
        RAISE EXCEPTION 'An executing allotment must resolve before refund';
    END IF;
    IF request.status = 'rejected' AND NEW.status NOT IN ('refunded', 'rejected', 'withdrawn') THEN
        RAISE EXCEPTION 'Cancelled allotment cannot restore an allocation';
    END IF;
    IF OLD.refunded_at IS NOT NULL AND (
        NEW.refunded_at IS NULL OR NEW.refund_amount IS NULL OR NEW.refund_amount < OLD.refund_amount
    ) THEN
        RAISE EXCEPTION 'Recorded allotment refunds cannot be cleared or reduced';
    END IF;
    IF request.status <> 'executed' AND (
        NEW.status = 'allotted' OR (NEW.refunded_at IS DISTINCT FROM OLD.refunded_at AND request.status <> 'rejected')
    ) THEN
        RAISE EXCEPTION 'Allotment and refund must follow the original issuance outcome';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_issuance_token()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF ROW(NEW.uuid, NEW.company_id, NEW.contract_address, NEW.chain, NEW.decimals)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.company_id, OLD.contract_address, OLD.chain, OLD.decimals)
        AND EXISTS (SELECT 1 FROM tokens_shareissuancerequest
            WHERE token_id = OLD.uuid AND dispatch_id IS NOT NULL AND status IN ('approved', 'executing', 'failed')) THEN
        RAISE EXCEPTION 'A token retains its identity while admitted issuance can execute';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_mint_request_operation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.execution_intent IS NOT NULL THEN
            RAISE EXCEPTION 'Admitted mint requests cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.dispatch_id IS DISTINCT FROM NEW.dispatch_id THEN
            RAISE EXCEPTION 'Mint dispatch identity cannot be changed or backfilled';
        END IF;
        IF OLD.execution_intent IS NOT NULL THEN
            IF ROW(NEW.uuid, NEW.execution_intent, NEW.settlement_asset_id, NEW.yield_token_id,
                   NEW.recipient_address, NEW.recipient_name, NEW.amount, NEW.deposit_reference,
                   NEW.deposit_date, NEW.requested_by_id, NEW.executed_by_id)
               IS DISTINCT FROM
               ROW(OLD.uuid, OLD.execution_intent, OLD.settlement_asset_id, OLD.yield_token_id,
                   OLD.recipient_address, OLD.recipient_name, OLD.amount, OLD.deposit_reference,
                   OLD.deposit_date, OLD.requested_by_id, OLD.executed_by_id) THEN
                RAISE EXCEPTION 'Admitted mint intent and authority are immutable';
            END IF;
            IF NEW.status NOT IN ('executing', 'failed', 'executed')
                OR (OLD.status = 'executed' AND NEW.status <> 'executed') THEN
                RAISE EXCEPTION 'The admitted mint outcome cannot be discarded';
            END IF;
        END IF;
        IF OLD.operation_id IS NOT NULL AND OLD.operation_id IS DISTINCT FROM NEW.operation_id THEN
            RAISE EXCEPTION 'A mint operation association is immutable';
        END IF;
    END IF;
    IF NEW.execution_intent IS NOT NULL AND (
        NEW.dispatch_id IS NULL OR NEW.executed_by_id IS NULL
        OR jsonb_typeof(NEW.execution_intent) <> 'object'
        OR NOT (NEW.execution_intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'recipient', 'amount'])
        OR NEW.execution_intent->>'recipient' IS DISTINCT FROM lower(NEW.recipient_address)
        OR NEW.execution_intent->>'amount' IS DISTINCT FROM NEW.amount::text
    ) THEN
        RAISE EXCEPTION 'A mint admission requires attributable request intent and authority';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR NEW.execution_intent IS NULL
            OR operation.operation_key <> 'mint-request:' || NEW.uuid::text || ':' || NEW.dispatch_id::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.execution_intent->'chain_id', 'sender', NEW.execution_intent->'sender',
                'to', NEW.execution_intent->'to', 'value', NEW.execution_intent->'value',
                'data', NEW.execution_intent->'data'
            ) THEN
            RAISE EXCEPTION 'A mint must reference its own immutable outgoing operation';
        END IF;
        IF NEW.status = 'executed' AND (operation.status <> 'confirmed' OR NEW.transaction_id IS NULL) THEN
            RAISE EXCEPTION 'A mint requires a confirmed original operation before completion';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'An uncertain signed mint cannot be recorded as failed';
        END IF;
        IF NEW.transaction_id IS NOT NULL AND NEW.status = 'executed' THEN
            SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash
                OR projected.related_uuid IS DISTINCT FROM NEW.uuid
                OR projected.related_model IS DISTINCT FROM 'tokens.MintRequest' THEN
                RAISE EXCEPTION 'Mint completion must name the original signed transaction';
            END IF;
        END IF;
    ELSIF NEW.dispatch_id IS NOT NULL AND NEW.status = 'executed' THEN
        RAISE EXCEPTION 'A new mint requires a durable operation before completion';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_nav_operation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    command tokens_navupdate%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.operation_key LIKE 'nav-update:%' THEN
            SELECT * INTO command FROM tokens_navupdate
                WHERE 'nav-update:' || uuid::text = NEW.operation_key FOR UPDATE;
            IF NOT FOUND OR command.mode <> 'chain' OR command.status <> 'executing'
                OR command.completed_at IS NOT NULL OR NEW.intent IS DISTINCT FROM command.intent - ARRAY[
                    'token_id', 'symbol', 'decimals', 'contract_address', 'asset_id', 'nav_raw', 'reserve_raw'] THEN
                RAISE EXCEPTION 'Only executing chain NAV work admits its original operation';
            END IF;
        END IF;
    ELSIF NEW.claim_id IS DISTINCT FROM OLD.claim_id AND OLD.operation_key LIKE 'nav-update:%' THEN
        RAISE EXCEPTION 'A new NAV attempt requires a new submission';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_nav_target()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    command tokens_navupdate%ROWTYPE;
BEGIN
    IF ROW(NEW.symbol, NEW.decimals, lower(NEW.contract_address), NEW.nav_per_token,
        NEW.total_reserve_value, NEW.last_nav_update)
        IS NOT DISTINCT FROM ROW(OLD.symbol, OLD.decimals, lower(OLD.contract_address), OLD.nav_per_token,
        OLD.total_reserve_value, OLD.last_nav_update) THEN
        RETURN NEW;
    END IF;
    IF NOT has_table_privilege(current_user, 'tokens_navupdate', 'SELECT') THEN
        RAISE EXCEPTION 'NAV target changes require operator authority';
    END IF;
    SELECT * INTO command FROM tokens_navupdate WHERE yield_token_id = OLD.uuid
        AND mode IN ('local', 'chain') AND completed_at IS NULL;
    IF FOUND THEN
        IF ROW(NEW.symbol, NEW.decimals, lower(NEW.contract_address))
            IS DISTINCT FROM ROW(OLD.symbol, OLD.decimals, lower(OLD.contract_address)) THEN
            RAISE EXCEPTION 'An unresolved NAV submission reserves its original target';
        END IF;
        IF command.status NOT IN ('applied', 'confirmed')
            OR NEW.nav_per_token IS DISTINCT FROM command.new_nav_per_token
            OR NEW.total_reserve_value IS DISTINCT FROM command.total_reserve_value
            OR NEW.last_nav_update IS NULL THEN
            RAISE EXCEPTION 'Only the original resolved NAV outcome can update its valuation';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_nav_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    target tokens_yieldtoken%ROWTYPE;
    transaction_intent jsonb;
    value numeric;
    remaining numeric;
    hexadecimal text;
    calldata text := '0xd0e82bd5';
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'NAV submission history cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.yield_token_id, NEW.updated_by_id, NEW.mode, NEW.intent,
            NEW.old_nav_per_token, NEW.new_nav_per_token, NEW.total_reserve_value,
            NEW.custodian_report_ref, NEW.notes, NEW.transaction_id)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.yield_token_id, OLD.updated_by_id, OLD.mode, OLD.intent,
            OLD.old_nav_per_token, OLD.new_nav_per_token, OLD.total_reserve_value,
            OLD.custodian_report_ref, OLD.notes, OLD.transaction_id) THEN
            RAISE EXCEPTION 'NAV identity, authority, valuation and intent are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'NAV submissions retain their original operation';
        END IF;
        IF OLD.event IS NOT NULL AND NEW.event IS DISTINCT FROM OLD.event THEN
            RAISE EXCEPTION 'NAV submissions retain their original event';
        END IF;
        IF OLD.completed_at IS NOT NULL AND ROW(NEW.status, NEW.operation_id, NEW.event, NEW.completed_at)
            IS DISTINCT FROM ROW(OLD.status, OLD.operation_id, OLD.event, OLD.completed_at) THEN
            RAISE EXCEPTION 'Completed NAV outcomes cannot be replaced';
        END IF;
        IF NEW.status <> OLD.status AND NOT (
            (OLD.status = 'queued' AND NEW.status = 'failed')
            OR (OLD.status = 'queued' AND NEW.mode = 'local' AND NEW.status = 'applied')
            OR (OLD.status = 'queued' AND NEW.mode = 'chain' AND NEW.status = 'executing')
            OR (OLD.status = 'executing' AND NEW.mode = 'chain' AND NEW.status IN ('confirmed', 'failed'))
        ) THEN
            RAISE EXCEPTION 'A NAV outcome cannot be reopened or replaced';
        END IF;
    END IF;
    IF NEW.mode = 'historical' THEN
        IF NEW.status <> 'historical' OR NEW.intent IS NOT NULL OR NEW.operation_id IS NOT NULL
            OR NEW.event IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Historical NAV rows have no admitted execution authority';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.mode NOT IN ('local', 'chain') OR NEW.status NOT IN ('queued', 'executing', 'confirmed', 'applied', 'failed')
        OR NEW.transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'Admitted NAV work uses the original outgoing journal';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.operation_id IS NOT NULL OR NEW.event IS NOT NULL OR NOT (
            (NEW.status = 'queued' AND NEW.completed_at IS NULL)
            OR (NEW.status = 'failed' AND NEW.completed_at IS NOT NULL)
        ) THEN
            RAISE EXCEPTION 'NAV admission starts queued or with a completed unsigned refusal';
        END IF;
        SELECT * INTO target FROM tokens_yieldtoken WHERE uuid = NEW.yield_token_id FOR UPDATE;
        IF NOT FOUND OR NOT target.is_active OR NEW.intent->>'token_id' IS DISTINCT FROM target.uuid::text
            OR NEW.intent->>'symbol' IS DISTINCT FROM target.symbol
            OR NEW.intent->'decimals' IS DISTINCT FROM to_jsonb(target.decimals)
            OR NEW.intent->>'contract_address' IS DISTINCT FROM lower(target.contract_address)
            OR NEW.old_nav_per_token IS DISTINCT FROM coalesce(target.nav_per_token, 0) THEN
            RAISE EXCEPTION 'NAV admission requires the current target identity and valuation';
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NOT (NEW.intent ?& ARRAY['token_id', 'symbol', 'decimals', 'contract_address', 'asset_id'])
        OR NEW.intent->>'token_id' IS DISTINCT FROM NEW.yield_token_id::text
        OR coalesce(NEW.intent->>'decimals', '') !~ '^[0-9]+$'
        OR (NEW.intent->>'decimals')::integer NOT BETWEEN 0 AND 77
        OR NEW.new_nav_per_token <= 0 OR NEW.total_reserve_value < 0 THEN
        RAISE EXCEPTION 'NAV admission requires exact supported values and target identity';
    END IF;
    IF NEW.mode = 'local' THEN
        IF NEW.status NOT IN ('queued', 'applied', 'failed') OR NEW.operation_id IS NOT NULL OR NEW.event IS NOT NULL
            OR (NEW.intent - ARRAY['token_id', 'symbol', 'decimals', 'contract_address', 'asset_id']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Local NAV work cannot admit a chain transaction';
        END IF;
    ELSE
        IF NEW.status = 'applied' OR NEW.intent->>'to' IS DISTINCT FROM NEW.intent->>'contract_address'
            OR coalesce(NEW.intent->>'sender', '') !~ '^0x[0-9a-f]{40}$'
            OR coalesce(NEW.intent->>'to', '') !~ '^0x[0-9a-f]{40}$'
            OR NEW.intent->>'to' = '0x0000000000000000000000000000000000000000'
            OR coalesce(NEW.intent->>'chain_id', '') !~ '^[1-9][0-9]*$'
            OR jsonb_typeof(NEW.intent->'chain_id') IS DISTINCT FROM 'number'
            OR NEW.intent->'value' IS DISTINCT FROM '"0"'::jsonb
            OR coalesce(NEW.intent->>'nav_raw', '') !~ '^[0-9]+$'
            OR coalesce(NEW.intent->>'reserve_raw', '') !~ '^[0-9]+$'
            OR (NEW.intent->>'nav_raw')::numeric <> NEW.new_nav_per_token * power(10::numeric, (NEW.intent->>'decimals')::integer)
            OR (NEW.intent->>'reserve_raw')::numeric <> NEW.total_reserve_value * power(10::numeric, (NEW.intent->>'decimals')::integer)
            OR (NEW.intent - ARRAY['token_id', 'symbol', 'decimals', 'contract_address', 'asset_id',
                'chain_id', 'sender', 'to', 'value', 'data', 'nav_raw', 'reserve_raw']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'NAV chain instructions must match the exact admitted valuation';
        END IF;
        FOREACH value IN ARRAY ARRAY[(NEW.intent->>'nav_raw')::numeric, (NEW.intent->>'reserve_raw')::numeric] LOOP
            IF value >= power(2::numeric, 256) THEN
                RAISE EXCEPTION 'NAV chain values exceed their unsigned transaction units';
            END IF;
            remaining := value;
            hexadecimal := '';
            WHILE remaining > 0 LOOP
                hexadecimal := substr('0123456789abcdef', mod(remaining, 16)::integer + 1, 1) || hexadecimal;
                remaining := div(remaining, 16);
            END LOOP;
            calldata := calldata || lpad(hexadecimal, 64, '0');
        END LOOP;
        IF NEW.intent->>'data' IS DISTINCT FROM calldata THEN
            RAISE EXCEPTION 'NAV calldata must match its exact admitted values';
        END IF;
    END IF;
    transaction_intent := NEW.intent - ARRAY['token_id', 'symbol', 'decimals', 'contract_address',
        'asset_id', 'nav_raw', 'reserve_raw'];
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'nav-update:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM transaction_intent OR NEW.status = 'queued' THEN
            RAISE EXCEPTION 'A NAV submission must name its original outgoing operation';
        END IF;
        IF NEW.status = 'confirmed' AND (operation.status <> 'confirmed' OR operation.current_attempt_id IS NULL) THEN
            RAISE EXCEPTION 'NAV confirmation requires its original confirmed transaction';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'A NAV failure requires its original failed operation';
        END IF;
    ELSIF NEW.status = 'confirmed' OR (NEW.status = 'failed' AND (
        (TG_OP = 'UPDATE' AND OLD.status NOT IN ('queued', 'failed'))
        OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key = 'nav-update:' || NEW.uuid::text)
    )) THEN
        RAISE EXCEPTION 'Signed NAV outcomes require their original operation';
    END IF;
    IF NEW.status = 'confirmed' THEN
        IF jsonb_typeof(NEW.event) IS DISTINCT FROM 'object'
            OR NEW.event->'newNav' IS DISTINCT FROM NEW.intent->'nav_raw'
            OR NEW.event->'reserveValue' IS DISTINCT FROM NEW.intent->'reserve_raw'
            OR coalesce(NEW.event->>'oldNav', '') !~ '^[0-9]+$'
            OR coalesce(NEW.event->>'timestamp', '') !~ '^[0-9]+$'
            OR (NEW.event - ARRAY['oldNav', 'newNav', 'reserveValue', 'timestamp']) <> '{}'::jsonb THEN
            RAISE EXCEPTION 'NAV confirmation requires its matching original event';
        END IF;
    ELSIF NEW.event IS NOT NULL THEN
        RAISE EXCEPTION 'Only confirmed NAV work carries an event';
    END IF;
    IF NEW.completed_at IS NOT NULL THEN
        IF NEW.status NOT IN ('applied', 'confirmed', 'failed') THEN
            RAISE EXCEPTION 'Only resolved NAV outcomes release the next submission';
        END IF;
        IF NEW.status <> 'failed' AND (TG_OP = 'INSERT' OR OLD.completed_at IS NULL) THEN
            SELECT * INTO target FROM tokens_yieldtoken WHERE uuid = NEW.yield_token_id;
            IF ROW(target.nav_per_token, target.total_reserve_value, target.last_nav_update)
                IS DISTINCT FROM ROW(NEW.new_nav_per_token, NEW.total_reserve_value, NEW.completed_at) THEN
                RAISE EXCEPTION 'NAV completion requires its original valuation projection';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_pause_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Pause submission history cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.operation_id IS NOT NULL OR NEW.observation IS NOT NULL
        OR NOT ((NEW.status = 'pending' AND NEW.completed_at IS NULL)
            OR (NEW.status = 'failed' AND NEW.completed_at IS NOT NULL))) THEN
        RAISE EXCEPTION 'Pause admission starts pending or with a completed unsigned refusal';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.token_id, NEW.company_id, NEW.initiated_by_id,
            NEW.authority, NEW.paused, NEW.chain_id, NEW.contract_address, NEW.intent)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.token_id, OLD.company_id, OLD.initiated_by_id,
            OLD.authority, OLD.paused, OLD.chain_id, OLD.contract_address, OLD.intent) THEN
            RAISE EXCEPTION 'Pause identity, authority and intent are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'Pause submissions retain their original operation';
        END IF;
        IF OLD.observation IS NOT NULL AND NEW.observation IS DISTINCT FROM OLD.observation THEN
            RAISE EXCEPTION 'Pause submissions retain their original observation';
        END IF;
        IF OLD.completed_at IS NOT NULL AND ROW(NEW.status, NEW.operation_id, NEW.observation, NEW.completed_at)
            IS DISTINCT FROM ROW(OLD.status, OLD.operation_id, OLD.observation, OLD.completed_at) THEN
            RAISE EXCEPTION 'Completed pause outcomes cannot be replaced';
        END IF;
        IF NEW.status <> OLD.status AND NOT (
            (OLD.status = 'pending' AND NEW.status IN ('executing', 'observed', 'failed'))
            OR (OLD.status = 'executing' AND NEW.status IN ('confirmed', 'failed'))
        ) THEN
            RAISE EXCEPTION 'A pause outcome cannot be reopened or replaced';
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NEW.intent IS DISTINCT FROM jsonb_build_object(
            'chain_id', NEW.chain_id, 'sender', NEW.intent->'sender', 'to', NEW.contract_address,
            'value', '0', 'data', CASE WHEN NEW.paused THEN '0x8456cb59' ELSE '0x3f4ba83a' END
        ) OR coalesce(NEW.intent->>'sender', '') !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'Pause admission requires its exact chain, signer, contract and action';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'token-pause:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM NEW.intent THEN
            RAISE EXCEPTION 'A pause submission must name its original outgoing operation';
        END IF;
        IF NEW.status IN ('pending', 'observed') THEN
            RAISE EXCEPTION 'A pause observation cannot replace signing admission';
        END IF;
        IF NEW.status = 'confirmed' AND (operation.status <> 'confirmed' OR operation.current_attempt_id IS NULL) THEN
            RAISE EXCEPTION 'Pause confirmation requires its original confirmed transaction';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'A pause failure requires its original failed operation';
        END IF;
    ELSIF NEW.status = 'confirmed' OR (NEW.status = 'failed' AND (
        (TG_OP = 'UPDATE' AND OLD.status NOT IN ('pending', 'failed'))
        OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key = 'token-pause:' || NEW.uuid::text)
    )) THEN
        RAISE EXCEPTION 'Signed pause outcomes require their original operation';
    END IF;
    IF NEW.status = 'observed' THEN
        IF NEW.observation IS NULL OR jsonb_typeof(NEW.observation) IS DISTINCT FROM 'object'
            OR NOT (NEW.observation ?& ARRAY['block_number', 'block_hash', 'observed_at'])
            OR coalesce(NEW.observation->>'block_number', '') !~ '^[0-9]+$'
            OR coalesce(NEW.observation->>'block_hash', '') !~ '^0x[0-9a-f]{64}$'
            OR coalesce(NEW.observation->>'observed_at', '') = ''
            OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation
                WHERE operation_key = 'token-pause:' || NEW.uuid::text) THEN
            RAISE EXCEPTION 'Observed pause outcomes require initial evidence without an outgoing operation';
        END IF;
    ELSIF NEW.observation IS NOT NULL THEN
        RAISE EXCEPTION 'Only observed pause outcomes carry observation evidence';
    END IF;
    IF NEW.completed_at IS NOT NULL AND NEW.status NOT IN ('observed', 'confirmed', 'failed') THEN
        RAISE EXCEPTION 'Only resolved pause outcomes release the next submission';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_pause_operation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    command tokens_pausechange%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.operation_key LIKE 'token-pause:%' THEN
            SELECT * INTO command FROM tokens_pausechange
                WHERE 'token-pause:' || uuid::text = NEW.operation_key FOR UPDATE;
            IF NOT FOUND OR command.status <> 'executing' OR command.completed_at IS NOT NULL
                OR NEW.intent IS DISTINCT FROM command.intent THEN
                RAISE EXCEPTION 'Only an executing pause submission admits its original operation';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.claim_id IS DISTINCT FROM OLD.claim_id AND EXISTS (
        SELECT 1 FROM tokens_pausechange WHERE 'token-pause:' || uuid::text = OLD.operation_key
    ) THEN
        RAISE EXCEPTION 'A new pause attempt requires a new submission';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_swap_approval()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.approval_outcome <> '' OR NEW.approval_intent IS NOT NULL
            OR NEW.approval_operation_id IS NOT NULL OR NEW.approval_transaction_id IS NOT NULL
            OR NEW.approval_retry_of IS NOT NULL OR NEW.approval_observation IS NOT NULL THEN
            RAISE EXCEPTION 'Swap approval can only be admitted with deployment projection';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.approval_outcome = '' AND NEW.approval_outcome <> '' THEN
        IF OLD.projected_at IS NOT NULL OR NEW.projected_at IS NULL
            OR NEW.approval_outcome NOT IN ('pending', 'not_configured') THEN
            RAISE EXCEPTION 'Historical deployments cannot acquire approval authority';
        END IF;
    ELSIF ROW(NEW.approval_intent, NEW.approval_observation)
        IS DISTINCT FROM ROW(OLD.approval_intent, OLD.approval_observation)
        AND NOT (OLD.approval_outcome = 'pending' AND NEW.approval_outcome = 'observed_approved'
            AND NEW.approval_intent IS NOT DISTINCT FROM OLD.approval_intent) THEN
        RAISE EXCEPTION 'Admitted approval intent and observation are immutable';
    END IF;
    IF OLD.projected_at IS NULL AND NEW.projected_at IS NOT NULL AND NEW.approval_outcome = '' THEN
        RAISE EXCEPTION 'Deployment completion must retain its approval disposition';
    END IF;
    IF NEW.approval_outcome = '' OR NEW.approval_outcome = 'not_configured' THEN
        IF NEW.approval_intent IS NOT NULL OR NEW.approval_operation_id IS NOT NULL
            OR NEW.approval_transaction_id IS NOT NULL OR NEW.approval_retry_of IS NOT NULL
            OR NEW.approval_observation IS NOT NULL THEN
            RAISE EXCEPTION 'Unadmitted approval cannot retain execution authority';
        END IF;
    ELSE
        IF NEW.projected_at IS NULL OR NEW.attribution_required
            OR jsonb_typeof(NEW.approval_intent) IS DISTINCT FROM 'object'
            OR NOT (NEW.approval_intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'token'])
            OR NEW.approval_intent->'chain_id' IS DISTINCT FROM NEW.intent->'chain_id'
            OR NEW.approval_intent->'sender' IS DISTINCT FROM NEW.intent->'sender'
            OR NEW.approval_intent->>'value' IS DISTINCT FROM '0'
            OR NEW.approval_intent->>'token' IS DISTINCT FROM lower(NEW.contract_address)
            OR jsonb_typeof(NEW.approval_intent->'to') IS DISTINCT FROM 'string'
            OR NEW.approval_intent->>'to' !~ '^0x[0-9a-f]{40}$'
            OR NEW.approval_intent->>'to' = '0x0000000000000000000000000000000000000000'
            OR NEW.approval_intent->>'data' IS DISTINCT FROM '0xebbb1961' || repeat('0', 24)
                || substring(lower(NEW.contract_address) from 3) || repeat('0', 63) || '1' THEN
            RAISE EXCEPTION 'Swap approval requires the original deployed token and immutable call';
        END IF;
    END IF;
    IF NEW.approval_outcome IS DISTINCT FROM OLD.approval_outcome AND NOT (
        (OLD.approval_outcome = '' AND NEW.approval_outcome IN ('pending', 'not_configured'))
        OR (OLD.approval_outcome = 'pending' AND NEW.approval_outcome IN ('executing', 'observed_approved'))
        OR (OLD.approval_outcome = 'executing' AND NEW.approval_outcome IN ('confirmed', 'failed'))
        OR (OLD.approval_outcome = 'failed' AND NEW.approval_outcome = 'executing')
    ) THEN
        RAISE EXCEPTION 'Approval cannot replace a completed disposition';
    END IF;
    IF OLD.approval_operation_id IS NOT NULL
        AND NEW.approval_operation_id IS DISTINCT FROM OLD.approval_operation_id THEN
        RAISE EXCEPTION 'Approval retains its original outgoing operation';
    END IF;
    IF OLD.approval_transaction_id IS NOT NULL
        AND NEW.approval_transaction_id IS DISTINCT FROM OLD.approval_transaction_id THEN
        SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.approval_transaction_id;
        IF NEW.approval_transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted'
            OR previous.block_number IS NULL OR previous.block_hash = '' OR previous.gas_used IS NULL THEN
            RAISE EXCEPTION 'Approval must retain the previous reverted receipt before replacement';
        END IF;
    END IF;
    IF NEW.approval_outcome = 'observed_approved' THEN
        IF NEW.approval_operation_id IS NOT NULL OR NEW.approval_transaction_id IS NOT NULL
            OR NEW.approval_retry_of IS NOT NULL
            OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key = 'swap-approval:' || NEW.uuid::text)
            OR jsonb_typeof(NEW.approval_observation) IS DISTINCT FROM 'object'
            OR NOT (NEW.approval_observation ?& ARRAY['block_number', 'block_hash', 'observed_at'])
            OR jsonb_typeof(NEW.approval_observation->'block_number') IS DISTINCT FROM 'number'
            OR NEW.approval_observation->>'block_number' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(NEW.approval_observation->'block_hash') IS DISTINCT FROM 'string'
            OR NEW.approval_observation->>'block_hash' !~ '^0x[0-9a-f]{64}$'
            OR jsonb_typeof(NEW.approval_observation->'observed_at') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Observed approval requires its evidence and no outgoing operation';
        END IF;
    ELSIF NEW.approval_observation IS NOT NULL THEN
        RAISE EXCEPTION 'A transaction outcome cannot be replaced by an observation';
    END IF;
    IF NEW.approval_operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.approval_operation_id;
        IF NOT FOUND OR operation.operation_key <> 'swap-approval:' || NEW.uuid::text
            OR NEW.approval_outcome NOT IN ('executing', 'confirmed', 'failed')
            OR operation.intent IS DISTINCT FROM NEW.approval_intent - 'token' THEN
            RAISE EXCEPTION 'Approval must reference its own original operation';
        END IF;
        IF NEW.approval_transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.approval_transaction_id;
            IF NOT FOUND OR projected.related_model IS DISTINCT FROM 'tokens.TokenDeployment'
                OR projected.related_uuid IS DISTINCT FROM NEW.uuid
                OR projected.function_name IS DISTINCT FROM 'setShareTokenApproval'
                OR lower(projected.from_address) IS DISTINCT FROM NEW.approval_intent->>'sender'
                OR lower(projected.to_address) IS DISTINCT FROM NEW.approval_intent->>'to'
                OR projected.function_args IS DISTINCT FROM jsonb_build_object(
                    'token', NEW.approval_intent->'token', 'approved', true
                ) THEN
                RAISE EXCEPTION 'Approval transaction must identify the original approval call';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Approval transaction must identify its current signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a retained reverted approval can precede an unsigned retry';
            END IF;
        ELSIF operation.current_attempt_id IS NOT NULL THEN
            RAISE EXCEPTION 'A signed approval requires its transaction association';
        END IF;
        IF NEW.approval_outcome = 'confirmed' AND (
            operation.status <> 'confirmed' OR projected.status IS DISTINCT FROM 'confirmed'
            OR NEW.approval_retry_of IS NOT DISTINCT FROM operation.claim_id
        ) THEN
            RAISE EXCEPTION 'Approval completion requires its original confirmed transaction';
        END IF;
        IF NEW.approval_outcome = 'failed' AND (
            operation.status NOT IN ('failed', 'reverted')
            OR (operation.status = 'reverted' AND (projected.status IS DISTINCT FROM 'reverted'
                OR projected.block_hash IS DISTINCT FROM operation.block_hash
                OR projected.block_number IS DISTINCT FROM operation.block_number
                OR projected.gas_used IS DISTINCT FROM operation.gas_used))
            OR NEW.approval_retry_of IS NOT DISTINCT FROM operation.claim_id
        ) THEN
            RAISE EXCEPTION 'Approval failure requires its retained terminal outcome';
        END IF;
    ELSIF NEW.approval_transaction_id IS NOT NULL OR NEW.approval_retry_of IS NOT NULL
        OR NEW.approval_outcome IN ('confirmed', 'failed') THEN
        RAISE EXCEPTION 'Approval outcomes require their original operation';
    END IF;
    IF NEW.approval_retry_of IS DISTINCT FROM OLD.approval_retry_of AND (
        OLD.approval_outcome <> 'failed' OR NEW.approval_outcome <> 'executing'
        OR NEW.approval_retry_of IS DISTINCT FROM operation.claim_id OR operation.status NOT IN ('failed', 'reverted')
    ) THEN
        RAISE EXCEPTION 'Approval retry must authorize the exact completed failed claim';
    END IF;
    IF OLD.approval_outcome = 'failed' AND NEW.approval_outcome = 'executing'
        AND NEW.approval_retry_of IS NOT DISTINCT FROM OLD.approval_retry_of THEN
        RAISE EXCEPTION 'Failed approval requires explicit retry admission';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_swap_approval_submission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    swap tokens_swaporder%ROWTYPE;
    party jsonb;
    token text;
    mutable text[] := ARRAY['last_attempt_at', 'acknowledged_at', 'last_error', 'outcome',
        'block_number', 'block_hash', 'gas_used', 'confirmed_at', 'updated_at'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Participant approval submissions cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF to_jsonb(NEW) - mutable IS DISTINCT FROM to_jsonb(OLD) - mutable THEN
            RAISE EXCEPTION 'Participant approval submission identity cannot be changed';
        END IF;
        IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
            RAISE EXCEPTION 'A participant approval acknowledgement cannot be changed';
        END IF;
        IF OLD.last_attempt_at IS NOT NULL
            AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < OLD.last_attempt_at) THEN
            RAISE EXCEPTION 'A participant approval attempt cannot be rewound';
        END IF;
        IF OLD.outcome <> 'pending'
            AND ROW(NEW.outcome, NEW.block_number, NEW.block_hash, NEW.gas_used, NEW.confirmed_at)
            IS DISTINCT FROM ROW(OLD.outcome, OLD.block_number, OLD.block_hash, OLD.gas_used, OLD.confirmed_at) THEN
            RAISE EXCEPTION 'A participant approval outcome is written once';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO swap FROM tokens_swaporder WHERE uuid = NEW.swap_id FOR UPDATE;
    IF NOT FOUND OR swap.settlement_protocol_version <> 1 THEN
        RAISE EXCEPTION 'Participant approval requires its V1 swap';
    END IF;
    IF swap.status NOT IN ('created', 'seller_signed', 'buyer_signed', 'ready')
        OR swap.transaction_id IS NOT NULL OR swap.tx_hash <> '' THEN
        RAISE EXCEPTION 'Participant approval requires a pending swap';
    END IF;
    party := swap.settlement_context->NEW.participant;
    IF NEW.participant = 'seller' THEN
        token := swap.settlement_context->'share_token'->>'address';
    ELSE
        token := swap.settlement_context->'payment_asset'->>'deployment_address';
    END IF;
    IF NEW.outcome <> 'pending' OR NEW.acknowledged_at IS NOT NULL OR NEW.last_attempt_at IS NOT NULL
        OR NEW.settlement_digest IS DISTINCT FROM swap.settlement_digest
        OR NEW.chain_id::text IS DISTINCT FROM swap.settlement_context->'typed_data'->'domain'->>'chainId'
        OR NEW.sender_address IS DISTINCT FROM lower(party->>'address')
        OR NEW.owner_account_id::text IS DISTINCT FROM party->>'owner_account_uuid'
        OR NEW.wallet_id::text IS DISTINCT FROM party->>'wallet_uuid'
        OR NEW.token_address IS DISTINCT FROM lower(token)
        OR NEW.spender_address IS DISTINCT FROM
            lower(swap.settlement_context->'typed_data'->'domain'->>'verifyingContract')
        OR NEW.intent->>'to' IS DISTINCT FROM NEW.token_address
        OR NEW.intent->>'value' IS DISTINCT FROM '0'
        OR NEW.intent->>'data' IS DISTINCT FROM
            '0x095ea7b3' || repeat('0', 24) || substr(NEW.spender_address, 3) || repeat('f', 64)
        OR octet_length(NEW.raw_transaction) = 0 THEN
        RAISE EXCEPTION 'Participant approval must match its recorded settlement party';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_swap_execution()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'created' OR NEW.seller_signature <> '' OR NEW.buyer_signature <> ''
            OR NEW.transaction_id IS NOT NULL OR NEW.tx_hash <> '' OR NEW.completed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh swaps start without signatures or execution claims';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.transaction_id IS NOT NULL AND ROW(NEW.transaction_id, NEW.seller_signature, NEW.buyer_signature)
        IS DISTINCT FROM ROW(OLD.transaction_id, OLD.seller_signature, OLD.buyer_signature) THEN
        RAISE EXCEPTION 'Claimed swaps retain their original journal and signatures';
    END IF;
    IF OLD.tx_hash <> '' AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
        RAISE EXCEPTION 'Swaps retain their original execution hash';
    END IF;
    IF NEW.transaction_id IS NULL THEN
        IF ROW(NEW.status, NEW.tx_hash, NEW.completed_at, NEW.expiry_release_eligible)
            IS DISTINCT FROM ROW(OLD.status, OLD.tx_hash, OLD.completed_at, OLD.expiry_release_eligible)
            AND (NEW.status IN ('executing', 'completed') OR NEW.tx_hash <> '' OR NEW.completed_at IS NOT NULL) THEN
            RAISE EXCEPTION 'Swap execution requires an admitted journal';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO journal FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap execution requires its original transaction';
    END IF;
    IF NOT coalesce(journal.function_args ? 'admission', false) THEN
        IF OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
            OR ROW(NEW.status, NEW.tx_hash, NEW.completed_at, NEW.expiry_release_eligible)
                IS DISTINCT FROM ROW(OLD.status, OLD.tx_hash, OLD.completed_at, OLD.expiry_release_eligible) THEN
            RAISE EXCEPTION 'Historical swap execution cannot be adopted or released';
        END IF;
        RETURN NEW;
    END IF;
    IF journal.related_uuid IS DISTINCT FROM NEW.uuid OR journal.related_model <> 'tokens.SwapOrder'
        OR (NEW.completed_at IS NOT NULL) <> (NEW.status = 'completed')
        OR NEW.tx_hash IS DISTINCT FROM coalesce(journal.tx_hash, '')
        OR NEW.seller_signature IS DISTINCT FROM journal.function_args->>'sellerSignature'
        OR NEW.buyer_signature IS DISTINCT FROM journal.function_args->>'buyerSignature'
        OR (OLD.transaction_id IS NULL AND (OLD.status <> 'ready' OR NEW.status <> 'executing')) THEN
        RAISE EXCEPTION 'Swap execution must retain its exact admitted state';
    END IF;
    IF OLD.status IN ('completed', 'failed') THEN
        IF ROW(NEW.status, NEW.completed_at) IS DISTINCT FROM ROW(OLD.status, OLD.completed_at) THEN
            RAISE EXCEPTION 'Settled swaps are terminal';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = 'completed' THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = journal.outgoing_operation_id;
        IF NOT FOUND OR journal.status <> 'confirmed' OR journal.tx_hash IS NULL
            OR operation.status <> 'confirmed' OR NEW.tx_hash <> journal.tx_hash THEN
            RAISE EXCEPTION 'Swap completion requires its confirmed original receipt';
        END IF;
    ELSIF NEW.status = 'failed' THEN
        IF NOT (journal.status = 'reverted' OR (journal.status = 'failed' AND journal.tx_hash IS NULL)) THEN
            RAISE EXCEPTION 'Signed swaps remain held until finality; only unsigned failure or a reverted receipt releases';
        END IF;
    ELSIF NEW.status <> 'executing' THEN
        RAISE EXCEPTION 'Admitted swaps move only from executing to completed or failed';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_swap_finalized_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    evidence jsonb;
    policy jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.finalized_receipt IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh swaps cannot claim finalized receipt evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status IN ('completed', 'failed') OR OLD.finalized_receipt IS NOT NULL THEN
        IF NEW.finalized_receipt IS DISTINCT FROM OLD.finalized_receipt THEN
            RAISE EXCEPTION 'Settled swaps retain their recorded finality evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.finalized_receipt IS NULL AND (
        OLD.status <> 'executing' OR NEW.status NOT IN ('completed', 'failed') OR NEW.transaction_id IS NULL
    ) THEN
        RETURN NEW;
    END IF;
    SELECT * INTO journal FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
    IF NEW.finalized_receipt IS NULL THEN
        IF OLD.status = 'executing' AND NEW.status IN ('completed', 'failed')
            AND coalesce(journal.function_args ? 'admission', false)
            AND journal.status IN ('confirmed', 'reverted') THEN
            RAISE EXCEPTION 'Signed settlement requires finalized receipt evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'executing' OR NEW.status NOT IN ('completed', 'failed')
        OR journal.uuid IS NULL OR NOT coalesce(journal.function_args ? 'admission', false)
        OR journal.related_uuid IS DISTINCT FROM NEW.uuid
        OR journal.tx_hash IS DISTINCT FROM NEW.tx_hash
        OR (NEW.status = 'completed' AND journal.status <> 'confirmed')
        OR (NEW.status = 'failed' AND journal.status <> 'reverted') THEN
        RAISE EXCEPTION 'Finality evidence belongs to the original signed settlement transition';
    END IF;
    evidence := NEW.finalized_receipt;
    IF jsonb_typeof(evidence) IS DISTINCT FROM 'object'
        OR NOT (evidence ?& ARRAY['block_number', 'block_hash', 'gas_used', 'policy'])
        OR evidence - ARRAY['block_number', 'block_hash', 'gas_used', 'policy', 'transaction_index'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires its exact block, gas and policy';
    END IF;
    IF jsonb_typeof(evidence->'block_number') IS DISTINCT FROM 'number'
        OR evidence->>'block_number' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'gas_used') IS DISTINCT FROM 'number'
        OR evidence->>'gas_used' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'block_hash') IS DISTINCT FROM 'string'
        OR evidence->>'block_hash' !~ '^0x[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires exact nonnegative quantities and a block hash';
    END IF;
    IF (evidence->>'block_number')::numeric > 2147483647 OR (evidence->>'gas_used')::numeric > 2147483647 THEN
        RAISE EXCEPTION 'Finalized receipt quantities exceed the supported range';
    END IF;
    IF evidence ? 'transaction_index' AND (
        jsonb_typeof(evidence->'transaction_index') IS DISTINCT FROM 'number'
        OR evidence->>'transaction_index' !~ '^(0|[1-9][0-9]{0,6})$') THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires an exact transaction index';
    END IF;
    policy := evidence->'policy';
    IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR policy->'version' IS DISTINCT FROM '1'::jsonb
        OR NOT (policy ? 'mode') THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires an approved policy shape';
    END IF;
    IF policy->>'mode' = 'finalized' THEN
        IF policy - ARRAY['version', 'mode'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Finalized receipt evidence requires an exact finalized policy';
        END IF;
    ELSIF policy->>'mode' = 'depth' THEN
        IF jsonb_typeof(policy->'depth') IS DISTINCT FROM 'number'
            OR policy->>'depth' !~ '^[1-9][0-9]*$'
            OR policy - ARRAY['version', 'mode', 'depth'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Finalized receipt evidence requires an exact positive depth policy';
        END IF;
        IF (policy->>'depth')::numeric > 2147483647 THEN
            RAISE EXCEPTION 'Finalized receipt depth exceeds the supported range';
        END IF;
    ELSE
        RAISE EXCEPTION 'Finalized receipt evidence requires an approved policy mode';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_swap_outgoing()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    swap tokens_swaporder%ROWTYPE;
BEGIN
    IF NEW.operation_key NOT LIKE 'swap-execution:%' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM blockchain_outgoingoperation
            WHERE operation_key = NEW.operation_key AND intent = NEW.intent) THEN
            RETURN NEW;
        END IF;
        SELECT * INTO journal FROM blockchain_blockchaintransaction
            WHERE 'swap-execution:' || uuid::text = NEW.operation_key FOR UPDATE;
        IF EXISTS (SELECT 1 FROM blockchain_outgoingoperation
            WHERE operation_key = NEW.operation_key AND intent = NEW.intent) THEN
            RETURN NEW;
        END IF;
    ELSE
        SELECT * INTO journal FROM blockchain_blockchaintransaction
            WHERE 'swap-execution:' || uuid::text = NEW.operation_key;
    END IF;
    IF NOT FOUND OR NOT coalesce(journal.function_args ? 'admission', false)
        OR NEW.intent IS DISTINCT FROM tokens_swap_execution_intent(journal)
        OR NEW.intent->>'chain_id' IS DISTINCT FROM journal.function_args->'settlement'->'domain'->>'chainId' THEN
        RAISE EXCEPTION 'Swap operations require their original admitted transaction and full intent';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF journal.status <> 'pending' OR journal.outgoing_operation_id IS NOT NULL OR journal.tx_hash IS NOT NULL
            OR NEW.status <> 'preparing' OR NEW.current_attempt_id IS NOT NULL OR NEW.acknowledged_at IS NOT NULL
            OR NEW.block_number IS NOT NULL OR NEW.block_hash <> '' OR NEW.gas_used IS NOT NULL THEN
            RAISE EXCEPTION 'Swap operations start preparing before any signature or outcome';
        END IF;
    ELSE
        IF NEW.claim_id IS DISTINCT FROM OLD.claim_id OR NEW.uuid IS DISTINCT FROM OLD.uuid
            OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'A swap execution operation cannot restart or replace its identity';
        END IF;
        IF OLD.status IN ('confirmed', 'reverted')
            AND ROW(NEW.status, NEW.block_number, NEW.block_hash, NEW.gas_used)
                IS DISTINCT FROM ROW(OLD.status, OLD.block_number, OLD.block_hash, OLD.gas_used) THEN
            RAISE EXCEPTION 'Swap operations retain their first receipt summary';
        END IF;
    END IF;
    IF NEW.status IN ('confirmed', 'reverted') THEN
        IF NEW.block_number IS NULL OR NEW.gas_used IS NULL OR NEW.block_hash !~ '^0x[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'Swap receipt outcomes require a complete original summary';
        END IF;
    ELSIF NEW.block_number IS NOT NULL OR NEW.gas_used IS NOT NULL OR NEW.block_hash <> '' THEN
        RAISE EXCEPTION 'Unresolved swap operations cannot claim receipt evidence';
    END IF;
    IF TG_OP = 'INSERT' OR (OLD.status = 'preparing' AND NEW.status = 'signed') THEN
        SELECT * INTO swap FROM tokens_swaporder WHERE uuid = journal.related_uuid;
        IF NOT FOUND OR swap.transaction_id IS DISTINCT FROM journal.uuid OR swap.status <> 'executing'
            OR (TG_OP = 'UPDATE' AND journal.outgoing_operation_id IS DISTINCT FROM NEW.uuid) THEN
            RAISE EXCEPTION 'Swap signing requires the original admitted public association';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_swap_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    selected boolean;
    admitted boolean;
    swap tokens_swaporder%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    expected jsonb;
    admission jsonb;
    party jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.tx_type = 'atomic_swap' OR OLD.related_model = 'tokens.SwapOrder'
            OR OLD.outgoing_operation_id IS NOT NULL THEN
            RAISE EXCEPTION 'Swap transaction history cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    selected := NEW.tx_type = 'atomic_swap' OR coalesce(NEW.related_model = 'tokens.SwapOrder', false)
        OR NEW.outgoing_operation_id IS NOT NULL;
    IF TG_OP = 'UPDATE' THEN
        selected := selected OR OLD.tx_type = 'atomic_swap' OR coalesce(OLD.related_model = 'tokens.SwapOrder', false)
            OR OLD.outgoing_operation_id IS NOT NULL;
    END IF;
    IF NOT selected THEN
        RETURN NEW;
    END IF;
    admitted := coalesce(NEW.function_args ? 'admission', false);
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.tx_type, NEW.from_address, NEW.to_address, NEW.value,
            NEW.function_name, NEW.function_args, NEW.related_model, NEW.related_uuid, NEW.gas_limit, NEW.gas_price)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.tx_type, OLD.from_address, OLD.to_address, OLD.value,
            OLD.function_name, OLD.function_args, OLD.related_model, OLD.related_uuid, OLD.gas_limit, OLD.gas_price) THEN
            RAISE EXCEPTION 'Swap transaction identity, admission and arguments are immutable';
        END IF;
        IF OLD.outgoing_operation_id IS NOT NULL
            AND NEW.outgoing_operation_id IS DISTINCT FROM OLD.outgoing_operation_id THEN
            RAISE EXCEPTION 'Swap transactions retain their original outgoing operation';
        END IF;
        IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
            RAISE EXCEPTION 'Swap transactions retain their original hash';
        END IF;
        IF OLD.status IN ('confirmed', 'reverted', 'failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Swap transaction outcomes cannot restart';
        END IF;
        IF (OLD.status IN ('confirmed', 'reverted') OR OLD.block_number IS NOT NULL
            OR OLD.block_hash IS NOT NULL OR OLD.gas_used IS NOT NULL OR OLD.confirmed_at IS NOT NULL)
            AND ROW(NEW.block_number, NEW.block_hash, NEW.gas_used, NEW.confirmed_at)
            IS DISTINCT FROM ROW(OLD.block_number, OLD.block_hash, OLD.gas_used, OLD.confirmed_at) THEN
            RAISE EXCEPTION 'Swap transactions retain their first receipt summary';
        END IF;
        IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
            RAISE EXCEPTION 'Swap transactions retain their first submission time';
        END IF;
        IF OLD.nonce IS NOT NULL AND NEW.nonce IS DISTINCT FROM OLD.nonce THEN
            RAISE EXCEPTION 'Swap transactions retain their original nonce';
        END IF;
        IF NOT admitted THEN
            IF NEW.outgoing_operation_id IS NOT NULL OR NEW.tx_hash IS DISTINCT FROM OLD.tx_hash
                OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    OLD.status IN ('pending', 'submitted') AND OLD.tx_hash IS NOT NULL
                    AND NEW.status IN ('confirmed', 'reverted'))) THEN
                RAISE EXCEPTION 'Historical swap transactions have no new signing authority';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
            (OLD.status = 'pending' AND NEW.status IN ('submitted', 'failed'))
            OR (OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'reverted'))
        ) THEN
            RAISE EXCEPTION 'Swap transaction projections cannot skip or reverse signing';
        END IF;
    END IF;
    IF NOT admitted OR NEW.tx_type <> 'atomic_swap' OR NEW.function_name IS DISTINCT FROM 'executeSwap'
        OR NEW.related_model IS DISTINCT FROM 'tokens.SwapOrder' OR NEW.related_uuid IS NULL
        OR NEW.value <> 0 OR NEW.retry_count <> 0
        OR coalesce(NEW.from_address, '') !~ '^0x[0-9A-Fa-f]{40}$'
        OR coalesce(NEW.to_address, '') !~ '^0x[0-9A-Fa-f]{40}$' THEN
        RAISE EXCEPTION 'Fresh swap transactions require exact execution admission';
    END IF;
    admission := NEW.function_args->'admission';
    IF jsonb_typeof(admission) IS DISTINCT FROM 'object'
        OR admission IS DISTINCT FROM jsonb_build_object('version', 1, 'actor_id', admission->'actor_id',
            'participant', admission->'participant')
        OR admission->>'version' IS DISTINCT FROM '1'
        OR jsonb_typeof(admission->'actor_id') IS DISTINCT FROM 'string'
        OR coalesce(admission->>'actor_id', '') !~ '^[1-9][0-9]{0,18}$'
        OR (admission->>'actor_id')::numeric > 9223372036854775807
        OR coalesce(admission->>'participant', '') NOT IN ('seller', 'buyer') THEN
        RAISE EXCEPTION 'Swap admission requires its original actor and participant';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO swap FROM tokens_swaporder WHERE uuid = NEW.related_uuid FOR UPDATE;
    ELSE
        SELECT * INTO swap FROM tokens_swaporder WHERE uuid = NEW.related_uuid;
    END IF;
    IF NOT FOUND OR swap.settlement_protocol_version <> 1 THEN
        RAISE EXCEPTION 'Swap execution requires its original V1 order';
    END IF;
    expected := swap.settlement_context->'typed_data'->'message' || jsonb_build_object(
        'sellerSignature', swap.seller_signature, 'buyerSignature', swap.buyer_signature,
        'settlement', jsonb_build_object('protocol_version', 1, 'swap_uuid', swap.uuid::text,
            'digest', swap.settlement_digest, 'domain', swap.settlement_context->'typed_data'->'domain'),
        'admission', admission);
    IF NEW.function_args IS DISTINCT FROM expected
        OR lower(NEW.to_address) IS DISTINCT FROM lower(swap.settlement_context->'typed_data'->'domain'->>'verifyingContract')
        OR coalesce(swap.seller_signature, '') !~ '^(0x)?[0-9A-Fa-f]{130}$'
        OR coalesce(swap.buyer_signature, '') !~ '^(0x)?[0-9A-Fa-f]{130}$' THEN
        RAISE EXCEPTION 'Swap execution arguments must equal the original settlement and signatures';
    END IF;
    PERFORM tokens_swap_execution_intent(NEW);
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' OR NEW.tx_hash IS NOT NULL OR NEW.outgoing_operation_id IS NOT NULL
            OR NEW.nonce IS NOT NULL OR NEW.block_number IS NOT NULL OR NEW.block_hash IS NOT NULL
            OR NEW.gas_used IS NOT NULL OR NEW.gas_limit IS NOT NULL OR NEW.gas_price IS NOT NULL
            OR NEW.submitted_at IS NOT NULL OR NEW.confirmed_at IS NOT NULL
            OR swap.status <> 'ready' OR swap.transaction_id IS NOT NULL OR swap.tx_hash <> ''
            OR swap.completed_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM blockchain_blockchaintransaction
                WHERE (related_model = 'tokens.SwapOrder' OR tx_type = 'atomic_swap') AND related_uuid = swap.uuid)
            OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation
                WHERE operation_key = 'swap-execution:' || NEW.uuid::text) THEN
            RAISE EXCEPTION 'Swap admission requires an unclaimed ready order and an empty journal';
        END IF;
        party := swap.settlement_context->(admission->>'participant');
        IF NOT EXISTS (
            SELECT 1 FROM customer_accounts_account account
            JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
            JOIN wallets held ON held.user_account_id = account.uuid
            WHERE account.uuid::text = party->>'owner_account_uuid'
                AND held.uuid::text = party->>'wallet_uuid'
                AND profile.user_id::text = admission->>'actor_id'
                AND lower(held.address) = lower(party->>'address')
                AND held.verification_status = 'VERIFIED' AND held.chain IN ('ethereum', 'base')
        ) THEN
            RAISE EXCEPTION 'Swap admission requires the original current participant';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.outgoing_operation_id IS NULL THEN
        IF NEW.status <> 'pending' OR NEW.tx_hash IS NOT NULL OR NEW.nonce IS NOT NULL
            OR NEW.submitted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Swap signing and failure require the original outgoing operation';
        END IF;
    ELSE
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.outgoing_operation_id;
        IF NOT FOUND OR operation.operation_key <> 'swap-execution:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM tokens_swap_execution_intent(NEW) THEN
            RAISE EXCEPTION 'Swap transactions bind only their original operation and full intent';
        END IF;
        IF NEW.status = 'failed' THEN
            IF operation.status <> 'failed' OR operation.current_attempt_id IS NOT NULL OR NEW.tx_hash IS NOT NULL
                OR NEW.nonce IS NOT NULL OR NEW.submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Swap failure requires proof that the original operation never signed';
            END IF;
        ELSIF NEW.status = 'pending' THEN
            IF NEW.tx_hash IS NOT NULL OR NEW.nonce IS NOT NULL OR NEW.submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Pending swap transactions cannot claim signed evidence';
            END IF;
        ELSIF NEW.status IN ('submitted', 'confirmed', 'reverted') THEN
            SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
            IF NOT FOUND OR attempt.operation_id <> operation.uuid OR attempt.claim_id <> operation.claim_id
                OR NEW.tx_hash IS DISTINCT FROM attempt.tx_hash OR NEW.submitted_at IS NULL
                OR (NEW.nonce IS NOT NULL AND NEW.nonce IS DISTINCT FROM attempt.nonce)
                OR operation.status NOT IN ('signed', 'confirmed', 'reverted') THEN
                RAISE EXCEPTION 'Swap submission requires its original signed attempt';
            END IF;
        ELSE
            RAISE EXCEPTION 'Unknown admitted swap transaction state';
        END IF;
    END IF;
    IF NEW.status IN ('confirmed', 'reverted') THEN
        IF operation.status IS DISTINCT FROM NEW.status OR NEW.confirmed_at IS NULL
            OR ROW(NEW.block_number::bigint, NEW.block_hash, NEW.gas_used::bigint)
                IS DISTINCT FROM ROW(operation.block_number, operation.block_hash, operation.gas_used) THEN
            RAISE EXCEPTION 'Swap receipts must project the original outgoing summary';
        END IF;
    ELSIF NEW.block_number IS NOT NULL OR NEW.block_hash IS NOT NULL OR NEW.gas_used IS NOT NULL
        OR NEW.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Unresolved swap transactions cannot claim receipt evidence';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_token_deployment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted deployment history cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
        OR NEW.contract_address <> '' OR NEW.projected_at IS NOT NULL OR NEW.attribution_required) THEN
        RAISE EXCEPTION 'A deployment admission must start without a recorded outcome';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.source_deployment_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM tokens_registerdeployment proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        WHERE proposal.uuid = NEW.source_deployment_id AND proposal.status = 'applied'
            AND proposal.deployment_id = NEW.uuid AND token.deployment_id = NEW.uuid
            AND proposal.token_id = NEW.token_id AND proposal.company_id = NEW.company_id
            AND NEW.principal_id = proposal.reviewed_by_id AND NEW.intent = proposal.intent
    ) THEN RAISE EXCEPTION 'Deployment journals retain their original applied source' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'INSERT' AND NEW.source_deployment_id IS NULL AND EXISTS (
        SELECT 1 FROM tokens_registerdeployment WHERE deployment_id = NEW.uuid
    ) THEN RAISE EXCEPTION 'Company deployments retain their exact source' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.source_deployment_id IS DISTINCT FROM OLD.source_deployment_id THEN
        RAISE EXCEPTION 'Deployment source cannot be replaced or backfilled' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.token_id, NEW.company_id, NEW.principal_id, NEW.intent)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.token_id, OLD.company_id, OLD.principal_id, OLD.intent) THEN
            RAISE EXCEPTION 'Deployment submission identity, intent and authority are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'A deployment retains its original outgoing operation';
        END IF;
        IF OLD.contract_address <> '' AND NEW.contract_address IS DISTINCT FROM OLD.contract_address THEN
            RAISE EXCEPTION 'A deployment retains its original contract outcome';
        END IF;
        IF OLD.projected_at IS NOT NULL AND NEW.projected_at IS DISTINCT FROM OLD.projected_at THEN
            RAISE EXCEPTION 'A deployment retains its projection outcome';
        END IF;
        IF OLD.attribution_required AND NOT NEW.attribution_required THEN
            RAISE EXCEPTION 'Unattributed deployments require an explicit attribution workflow';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.transaction_id;
            IF NEW.transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'An unresolved deployment transaction cannot be replaced';
            END IF;
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) <> 'object'
        OR NOT (NEW.intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'name', 'symbol',
                                   'identifier', 'authorized_shares', 'issuer_wallet', 'decimals'])
        OR NEW.intent->>'value' IS DISTINCT FROM '0' THEN
        RAISE EXCEPTION 'Deployment admission requires immutable factory call terms';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'token-deployment:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.intent->'chain_id', 'sender', NEW.intent->'sender', 'to', NEW.intent->'to',
                'value', NEW.intent->'value', 'data', NEW.intent->'data'
            ) THEN
            RAISE EXCEPTION 'A deployment must reference its own immutable outgoing operation';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF projected.related_model IS DISTINCT FROM 'tokens.ShareToken'
                OR projected.related_uuid IS DISTINCT FROM NEW.token_id
                OR projected.tx_type IS DISTINCT FROM 'share_token_deploy' THEN
                RAISE EXCEPTION 'Deployment projection must name its original token';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Deployment projection must name its current signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a reverted deployment can precede an unsigned retry';
            END IF;
        END IF;
        IF NEW.contract_address <> '' AND (operation.status <> 'confirmed' OR NEW.transaction_id IS NULL) THEN
            RAISE EXCEPTION 'Deployment completion requires its confirmed original transaction';
        END IF;
    ELSIF NEW.transaction_id IS NOT NULL OR NEW.contract_address <> '' THEN
        RAISE EXCEPTION 'Deployment outcomes require their durable operation';
    END IF;
    IF NEW.projected_at IS NOT NULL AND NEW.contract_address = '' THEN
        RAISE EXCEPTION 'Deployment projection requires its attributed contract';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_token_deployment_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.deployment_id IS NOT NULL AND NEW.deployment_id IS DISTINCT FROM OLD.deployment_id THEN
        RAISE EXCEPTION 'The deployment submission identity cannot be replaced';
    END IF;
    IF OLD.deployment_id IS NULL AND NEW.deployment_id IS NOT NULL AND (
        OLD.status <> 'draft' OR NEW.status <> 'deploying'
        OR coalesce(OLD.deployment_tx_hash, '') <> '' OR OLD.deployment_transaction_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Historical deployments cannot acquire new submission authority';
    END IF;
    IF OLD.deployment_id IS NULL AND NEW.deployment_id IS NOT NULL THEN
        IF NOT EXISTS (
        SELECT 1 FROM tokens_registerdeployment proposal JOIN tokens_registerdeploymentdecision decision
            ON decision.register_deployment_id = proposal.uuid AND decision.kind = 'apply'
        WHERE proposal.token_id = NEW.uuid AND proposal.company_id = NEW.company_id AND proposal.status = 'submitted'
            AND current_user IN (__OPERATOR__, __MIGRATE__)
            AND current_setting('app.company_operation', true) = 'register_deployment_apply'
            AND current_setting('app.company_id', true) = NEW.company_id::text
            AND decision.decided_by_id::text = current_setting('app.user_id', true)
            AND tokens_register_deployment_ready(proposal, true)
            AND tokens_register_deployment_approved(proposal.uuid, clock_timestamp())
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, decision.decided_by_id, 'apply', clock_timestamp())
        ) THEN RAISE EXCEPTION 'New deployment admission requires its exact company decision' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.signing_challenges_bind_action()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    intent tokens_orderactionsubmission%ROWTYPE;
    expected_types jsonb;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.action_id IS DISTINCT FROM OLD.action_id THEN
        RAISE EXCEPTION 'An issued challenge cannot change action linkage' USING ERRCODE = '23514';
    END IF;
    IF NEW.action_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT * INTO intent FROM tokens_orderactionsubmission WHERE uuid = NEW.action_id;
    IF NOT FOUND OR NEW.submission_id IS NOT NULL
       OR NEW.purpose IS DISTINCT FROM ('order_' || intent.purpose)
       OR NEW.order_id IS DISTINCT FROM intent.order_id
       OR NEW.wallet_id IS DISTINCT FROM intent.wallet_id
       OR lower(NEW.wallet_address) IS DISTINCT FROM lower(intent.wallet_address)
       OR NEW.chain_id IS DISTINCT FROM intent.chain_id
       OR lower(NEW.verifying_contract) IS DISTINCT FROM lower(intent.verifying_contract)
       OR NEW.payload->'message'->>'actionId' IS DISTINCT FROM intent.action_id::text
       OR NEW.payload->'message'->>'protocolVersion' IS DISTINCT FROM intent.protocol_version::text
       OR NEW.payload->'message'->>'ownerAccountUuid' IS DISTINCT FROM intent.owner_account_id::text
       OR NEW.payload->'message'->>'walletUuid' IS DISTINCT FROM intent.wallet_id::text
       OR NEW.payload->'message'->>'tokenUuid' IS DISTINCT FROM intent.token_id::text
       OR NEW.payload->'message'->>'orderUuid' IS DISTINCT FROM intent.order_id::text
       OR lower(NEW.payload->'message'->>'wallet') IS DISTINCT FROM lower(intent.wallet_address)
       OR NEW.payload->'message'->>'nonce' IS DISTINCT FROM NEW.nonce::text
       OR NEW.payload->'message'->>'deadline' IS DISTINCT FROM floor(extract(epoch FROM NEW.expires_at))::bigint::text
       OR NEW.payload->'domain'->>'name' IS DISTINCT FROM 'Ledova Trading'
       OR NEW.payload->'domain'->>'version' IS DISTINCT FROM '1'
       OR NEW.payload->'domain'->>'chainId' IS DISTINCT FROM intent.chain_id::text
       OR lower(NEW.payload->'domain'->>'verifyingContract') IS DISTINCT FROM lower(intent.verifying_contract) THEN
        RAISE EXCEPTION 'An action challenge must bind its original action identity and domain' USING ERRCODE = '23514';
    END IF;
    IF intent.purpose = 'modify' AND (
        NEW.payload->'message'->>'newQuantity' IS DISTINCT FROM intent.new_quantity::text
        OR NEW.payload->'message'->>'newMinQuantity' IS DISTINCT FROM intent.new_min_quantity::text
        OR NEW.payload->'message'->>'newPricePerShare' IS DISTINCT FROM intent.new_price_per_share::text
    ) THEN
        RAISE EXCEPTION 'A modification challenge must bind all exact replacement values' USING ERRCODE = '23514';
    END IF;
    expected_types = CASE WHEN intent.purpose = 'cancel' THEN '{
    "OrderCancelV1": [
        {
            "name": "actionId",
            "type": "string"
        },
        {
            "name": "protocolVersion",
            "type": "uint256"
        },
        {
            "name": "ownerAccountUuid",
            "type": "string"
        },
        {
            "name": "walletUuid",
            "type": "string"
        },
        {
            "name": "tokenUuid",
            "type": "string"
        },
        {
            "name": "orderUuid",
            "type": "string"
        },
        {
            "name": "wallet",
            "type": "address"
        },
        {
            "name": "nonce",
            "type": "uint256"
        },
        {
            "name": "deadline",
            "type": "uint256"
        }
    ]
}'::jsonb ELSE '{
    "OrderModifyV1": [
        {
            "name": "actionId",
            "type": "string"
        },
        {
            "name": "protocolVersion",
            "type": "uint256"
        },
        {
            "name": "ownerAccountUuid",
            "type": "string"
        },
        {
            "name": "walletUuid",
            "type": "string"
        },
        {
            "name": "tokenUuid",
            "type": "string"
        },
        {
            "name": "orderUuid",
            "type": "string"
        },
        {
            "name": "newQuantity",
            "type": "uint256"
        },
        {
            "name": "newMinQuantity",
            "type": "uint256"
        },
        {
            "name": "newPricePerShare",
            "type": "string"
        },
        {
            "name": "wallet",
            "type": "address"
        },
        {
            "name": "nonce",
            "type": "uint256"
        },
        {
            "name": "deadline",
            "type": "uint256"
        }
    ]
}'::jsonb END;
    IF NEW.payload->'types' IS DISTINCT FROM expected_types THEN
        RAISE EXCEPTION 'An action challenge must sign every declared action field' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.signing_challenges_bind_submission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    intent tokens_ordersubmission%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
        RAISE EXCEPTION 'An issued challenge cannot change submission linkage' USING ERRCODE = '23514';
    END IF;
    IF NEW.submission_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT * INTO intent FROM tokens_ordersubmission WHERE uuid = NEW.submission_id;
    IF NOT FOUND OR NEW.purpose <> 'order_create' OR NEW.order_id IS NOT NULL
       OR NEW.wallet_id IS DISTINCT FROM intent.wallet_id
       OR NEW.wallet_address IS DISTINCT FROM intent.wallet_address
       OR NEW.chain_id IS DISTINCT FROM intent.chain_id
       OR lower(NEW.verifying_contract) IS DISTINCT FROM lower(intent.verifying_contract)
       OR NEW.payload->'message'->>'submissionId' IS DISTINCT FROM intent.submission_id::text
       OR NEW.payload->'message'->>'ownerAccountUuid' IS DISTINCT FROM intent.owner_account_id::text
       OR NEW.payload->'message'->>'walletUuid' IS DISTINCT FROM intent.wallet_id::text
       OR NEW.payload->'message'->>'tokenUuid' IS DISTINCT FROM intent.token_id::text
       OR NEW.payload->'message'->>'orderType' IS DISTINCT FROM intent.order_type
       OR NEW.payload->'message'->>'quantity' IS DISTINCT FROM intent.quantity::text
       OR NEW.payload->'message'->>'minQuantity' IS DISTINCT FROM intent.min_quantity::text
       OR NEW.payload->'message'->>'pricePerShare' IS DISTINCT FROM intent.price_per_share::text
       OR lower(NEW.payload->'message'->>'wallet') IS DISTINCT FROM lower(intent.wallet_address)
       OR NEW.payload->'domain'->>'chainId' IS DISTINCT FROM intent.chain_id::text
       OR lower(NEW.payload->'domain'->>'verifyingContract') IS DISTINCT FROM lower(intent.verifying_contract) THEN
        RAISE EXCEPTION 'A create challenge must bind its original submission intent' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.signing_challenges_preserve_issued_intent()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
        BEGIN
            IF ROW(NEW.uuid, NEW.purpose, NEW.wallet_id, NEW.wallet_address, NEW.order_id,
                   NEW.chain_id, NEW.verifying_contract, NEW.nonce, NEW.digest, NEW.payload,
                   NEW.expires_at, NEW.created_at)
               IS DISTINCT FROM
               ROW(OLD.uuid, OLD.purpose, OLD.wallet_id, OLD.wallet_address, OLD.order_id,
                   OLD.chain_id, OLD.verifying_contract, OLD.nonce, OLD.digest, OLD.payload,
                   OLD.expires_at, OLD.created_at) THEN
                RAISE EXCEPTION 'An issued signing challenge cannot change its intent'
                    USING ERRCODE = '23514';
            END IF;
            IF OLD.consumed_at IS NOT NULL AND
               ROW(NEW.consumed_at, NEW.consumed_signature)
               IS DISTINCT FROM ROW(OLD.consumed_at, OLD.consumed_signature) THEN
                RAISE EXCEPTION 'A consumed signing challenge cannot be reset or spent differently'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $function$;

CREATE OR REPLACE FUNCTION public.signing_challenges_wallet_is_checked()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    wallet_address_of_record text;
    order_wallet_id uuid;
BEGIN
    IF NEW.wallet_id IS NULL THEN
        RAISE EXCEPTION 'signing_challenges.wallet_id is required: the service holds the caller''s wallet and must supply it';
    END IF;

    SELECT parent.address INTO wallet_address_of_record
    FROM wallets AS parent
    WHERE parent.uuid = NEW.wallet_id;

    IF wallet_address_of_record IS NULL THEN
        RAISE EXCEPTION 'signing_challenges.wallet_id % names no wallet', NEW.wallet_id;
    END IF;

    IF lower(wallet_address_of_record) <> lower(NEW.wallet_address) THEN
        RAISE EXCEPTION 'signing_challenges.wallet_id % holds address % but the challenge names %',
            NEW.wallet_id, wallet_address_of_record, NEW.wallet_address;
    END IF;

    IF NEW.order_id IS NOT NULL THEN
        SELECT o.wallet_id INTO order_wallet_id
        FROM tokens_transferorder AS o
        WHERE o.uuid = NEW.order_id;

        IF order_wallet_id IS NOT NULL AND order_wallet_id <> NEW.wallet_id THEN
            RAISE EXCEPTION 'signing_challenges.wallet_id % is not the wallet that owns order %', NEW.wallet_id, NEW.order_id;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.wallet_id IS NOT NULL AND OLD.wallet_id <> NEW.wallet_id THEN
        RAISE EXCEPTION 'signing_challenges.wallet_id cannot change, from % to %', OLD.wallet_id, NEW.wallet_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.swaps_preserve_expiry_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
            BEGIN
                IF NEW.expiry_release_eligible IS DISTINCT FROM OLD.expiry_release_eligible THEN
                    RAISE EXCEPTION 'Swap expiry eligibility is fixed at creation'
                        USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            END;
            $function$;

CREATE OR REPLACE FUNCTION public.tokens_begin_trading_admission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user <> __MIGRATE__ AND NULLIF(current_setting('app.trading_admission', true), '') IS NOT NULL THEN
        PERFORM public.tokens_lock_trading_admission(public.tokens_trading_command());
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_capitalincreaserequest_company_id_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_owner_id uuid;
BEGIN
    SELECT parent.company_id INTO parent_owner_id
    FROM tokens_sharetoken AS parent
    WHERE parent.uuid = NEW.token_id;

    IF parent_owner_id IS NULL THEN
        RAISE EXCEPTION 'tokens_capitalincreaserequest.company_id cannot be derived: tokens_sharetoken % has no company_id', NEW.token_id;
    END IF;

    IF NEW.company_id IS NULL THEN
        NEW.company_id := parent_owner_id;
    ELSIF NEW.company_id <> parent_owner_id THEN
        RAISE EXCEPTION 'tokens_capitalincreaserequest.company_id % does not match tokens_sharetoken.company_id %',
            NEW.company_id, parent_owner_id;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL AND OLD.company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'tokens_capitalincreaserequest.company_id cannot change, from % to %', OLD.company_id, NEW.company_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_capital_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registercapitalincrease;
BEGIN
    SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE uuid = NEW.capital_increase_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,NEW.decided_by_id,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR (NEW.kind <> 'reject' AND NOT tokens_register_capital_ready(proposal))
        OR (NEW.kind = 'reject' AND (proposal.status <> 'rejected' OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR NOT EXISTS (SELECT 1 FROM tokens_capitalincreaserequest request WHERE request.uuid = proposal.request_id AND request.status = 'rejected' AND request.reviewed_by_id = NEW.decided_by_id AND request.reviewed_at = NEW.decided_at AND request.rejection_reason = NEW.reason)))
        OR (NEW.kind = 'apply' AND (NOT tokens_register_capital_source_current(proposal.uuid) OR NOT EXISTS (
            SELECT 1 FROM tokens_capitalincreaseexecution execution JOIN tokens_capitalincreaserequest request ON request.uuid = execution.request_id
            WHERE execution.source_increase_id = proposal.uuid AND execution.uuid = request.dispatch_id AND request.status = 'executing'
                AND execution.company_id = proposal.company_id AND execution.token_id = proposal.token_id AND execution.request_id = proposal.request_id
                AND execution.executed_by_id = NEW.decided_by_id AND execution.intent = proposal.intent))) THEN
        RAISE EXCEPTION 'Capital decisions commit with current authority and their exact atomic outcome' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_capital_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF (TG_OP = 'INSERT' OR NEW.retry_of IS DISTINCT FROM OLD.retry_of) AND NOT tokens_register_capital_source_current(NEW.source_increase_id) THEN
        RAISE EXCEPTION 'Fresh capital admission commits only with current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_capital_preparation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT tokens_register_capital_ready(NEW) OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,NEW.submitted_by_id,'prepare',clock_timestamp()) THEN
        RAISE EXCEPTION 'Capital preparation commits only with its current exact company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_capital_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'under_review' AND NOT EXISTS (SELECT 1 FROM tokens_registercapitalincrease proposal
        WHERE proposal.request_id = NEW.uuid AND tokens_register_capital_ready(proposal)
        AND tokens_register_appointment_current(proposal.preparing_appointment_id,proposal.company_id,proposal.submitted_by_id,'prepare',clock_timestamp())) THEN
        RAISE EXCEPTION 'Capital preparation retains its exact company source at commit' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review')) AND NOT EXISTS (
        SELECT 1 FROM tokens_registercapitalincrease proposal JOIN tokens_registercapitalincreasedecision decision ON decision.capital_increase_id = proposal.uuid AND decision.kind = 'apply'
        WHERE proposal.request_id = NEW.uuid AND proposal.status = 'applied' AND decision.decided_by_id = NEW.reviewed_by_id AND decision.decided_at = NEW.reviewed_at
            AND tokens_register_capital_source_current(proposal.uuid)) THEN
        RAISE EXCEPTION 'Fresh capital approval commits only with actual company application' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_capital_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE operation blockchain_outgoingoperation; execution tokens_capitalincreaseexecution;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    IF operation.operation_key NOT LIKE 'capital-increase:%' THEN RETURN NEW; END IF;
    SELECT * INTO execution FROM tokens_capitalincreaseexecution WHERE operation_id = NEW.operation_id;
    IF operation.operation_key LIKE 'capital-increase:%' AND execution.uuid IS NULL THEN
        RAISE EXCEPTION 'Fresh capital signatures require their original private journal' USING ERRCODE = '23514';
    END IF;
    IF execution.uuid IS NULL THEN RETURN NEW; END IF;
    IF NEW.claim_id IS DISTINCT FROM operation.claim_id OR NOT tokens_register_capital_source_current(execution.source_increase_id) THEN
        RAISE EXCEPTION 'Fresh capital signatures require the current consumed company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_issue_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerinstruction;
BEGIN
    SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = NEW.instruction_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id, CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, clock_timestamp())
        OR (NEW.kind = 'approve' AND (proposal.status <> 'submitted' OR NOT tokens_register_issue_ready(proposal)))
        OR (NEW.kind = 'reject' AND (proposal.status <> 'rejected' OR proposal.reviewed_by_id <> NEW.decided_by_id OR proposal.reviewed_at <> NEW.decided_at OR proposal.rejection_reason <> NEW.reason))
        OR (NEW.kind = 'apply' AND (NOT tokens_register_issue_source_current(proposal.uuid)
            OR proposal.reviewed_by_id <> NEW.decided_by_id OR proposal.reviewed_at <> NEW.decided_at OR NOT EXISTS (
                SELECT 1 FROM tokens_shareissuanceexecution execution WHERE execution.source_instruction_id = proposal.uuid AND execution.uuid = (
                    SELECT dispatch_id FROM tokens_shareissuancerequest WHERE uuid = proposal.request_id)
                    AND execution.request_id = proposal.request_id AND execution.company_id = proposal.company_id AND execution.token_id = proposal.token_id
                    AND execution.executed_by_id = NEW.decided_by_id AND execution.authority = 'company' AND execution.intent = proposal.intent))) THEN
        RAISE EXCEPTION 'Grant decisions retain current authority and their atomic original outcome at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_issue_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF (TG_OP = 'INSERT' OR (OLD.status = 'failed' AND NEW.status = 'queued'))
        AND NOT tokens_register_issue_source_current(NEW.source_instruction_id) THEN
        RAISE EXCEPTION 'Fresh issue admission and retry commit only with the original current company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_issue_preparation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.preparing_appointment_id IS NOT NULL AND (NOT tokens_register_issue_ready(NEW)
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, NEW.submitted_by_id, 'prepare', clock_timestamp())) THEN
        RAISE EXCEPTION 'Grant preparation commits only with its current exact company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_issue_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review'))
        AND NOT EXISTS (SELECT 1 FROM tokens_registerinstruction proposal JOIN tokens_registerinstructiondecision application
            ON application.instruction_id = proposal.uuid AND application.kind = 'apply'
            WHERE proposal.request_id = NEW.uuid AND proposal.preparing_appointment_id IS NOT NULL AND proposal.status = 'applied'
                AND application.decided_by_id = NEW.reviewed_by_id AND application.decided_at = NEW.reviewed_at
                AND tokens_register_issue_source_current(proposal.uuid))
 THEN
        RAISE EXCEPTION 'Fresh issuance approval requires its exact original company decision at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_issue_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE operation blockchain_outgoingoperation; execution tokens_shareissuanceexecution;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE operation_id = NEW.operation_id;
    IF operation.operation_key LIKE 'share-issuance:%' AND execution.uuid IS NULL THEN RAISE EXCEPTION 'A fresh issuance signature requires its genuine retained journal' USING ERRCODE = '23514'; END IF;
    IF execution.uuid IS NULL THEN RETURN NEW; END IF;
    IF execution.source_instruction_id IS NULL OR execution.authority <> 'company' OR NEW.claim_id IS DISTINCT FROM operation.claim_id
        OR NOT tokens_register_issue_source_current(execution.source_instruction_id) THEN
        RAISE EXCEPTION 'Fresh issuance signatures require the current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_pause_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerpausechange;
BEGIN
    SELECT * INTO proposal FROM tokens_registerpausechange WHERE uuid = NEW.pause_change_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,NEW.decided_by_id,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR (NEW.kind <> 'reject' AND NOT tokens_register_pause_ready(proposal))
        OR (NEW.kind = 'reject' AND (proposal.status <> 'rejected' OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at OR proposal.rejection_reason <> NEW.reason))
        OR (NEW.kind = 'apply' AND (NOT tokens_register_pause_source_current(proposal.uuid) OR NOT EXISTS (
            SELECT 1 FROM tokens_pausechange execution WHERE execution.source_pause_id = proposal.uuid AND execution.uuid = proposal.uuid
                AND execution.status = 'pending' AND execution.completed_at IS NULL AND execution.company_id = proposal.company_id
                AND execution.token_id = proposal.token_id AND execution.initiated_by_id = NEW.decided_by_id AND execution.intent = proposal.intent))) THEN
        RAISE EXCEPTION 'Pause decisions commit with current authority and their exact atomic outcome' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_pause_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF (TG_OP = 'INSERT' OR (NEW.source_pause_id IS NOT NULL AND OLD.status = 'pending' AND NEW.status IN ('executing','observed')))
        AND NOT tokens_register_pause_source_current(NEW.source_pause_id) THEN
        RAISE EXCEPTION 'Fresh pause admission commits only with current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_pause_preparation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT tokens_register_pause_ready(NEW) OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,NEW.submitted_by_id,'prepare',clock_timestamp()) THEN
        RAISE EXCEPTION 'Pause preparation commits only with its current exact company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_company_pause_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE operation blockchain_outgoingoperation; execution tokens_pausechange;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    IF operation.operation_key NOT LIKE 'token-pause:%' THEN RETURN NEW; END IF;
    SELECT * INTO execution FROM tokens_pausechange WHERE operation_id = NEW.operation_id;
    IF execution.uuid IS NULL OR NEW.claim_id IS DISTINCT FROM operation.claim_id OR execution.status <> 'executing'
        OR execution.intent IS DISTINCT FROM operation.intent OR NOT tokens_register_pause_source_current(execution.source_pause_id) THEN
        RAISE EXCEPTION 'Fresh pause signatures require their original journal and current consumed company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_correction_register_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registercorrection; decision tokens_registercorrectiondecision; token_uuid uuid; at_time timestamptz;
BEGIN
    IF NEW.kind <> 'correction' THEN RETURN NULL; END IF;
    SELECT token_id INTO token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    IF NOT EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
        WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL) THEN RETURN NULL; END IF;
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.operation_id;
    SELECT * INTO decision FROM tokens_registercorrectiondecision WHERE register_correction_id = proposal.uuid AND kind = 'apply';
    at_time := clock_timestamp();
    IF proposal.uuid IS NULL OR proposal.preparing_appointment_id IS NULL OR proposal.status <> 'applied'
        OR proposal.applied_entry_id IS DISTINCT FROM NEW.uuid OR proposal.register_id IS DISTINCT FROM NEW.register_id
        OR proposal.reviewed_by_id IS DISTINCT FROM NEW.recorded_by_id OR decision.decided_by_id IS DISTINCT FROM NEW.recorded_by_id
        OR decision.uuid IS NULL OR NOT tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
            decision.decided_by_id, 'apply', at_time) OR NOT tokens_register_correction_approved(proposal.uuid, at_time)
    THEN RAISE EXCEPTION 'A non-tokenised correction must retain current authority through its bounded command' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_deployment_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE journal tokens_tokendeployment; source tokens_registerdeployment; operation blockchain_outgoingoperation;
BEGIN
    SELECT * INTO journal FROM tokens_tokendeployment WHERE operation_id = NEW.operation_id;
    IF journal.uuid IS NULL AND EXISTS (SELECT 1 FROM blockchain_outgoingoperation
        WHERE uuid = NEW.operation_id AND operation_key LIKE 'token-deployment:%') THEN
        RAISE EXCEPTION 'Fresh deployments require their retained execution source' USING ERRCODE = '23514';
    END IF;
    IF journal.uuid IS NOT NULL THEN
        SELECT * INTO source FROM tokens_registerdeployment WHERE uuid = journal.source_deployment_id;
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF source.uuid IS NULL OR journal.uuid IS DISTINCT FROM source.deployment_id OR journal.intent IS DISTINCT FROM source.intent
            OR journal.token_id IS DISTINCT FROM source.token_id OR journal.company_id IS DISTINCT FROM source.company_id
            OR operation.claim_id IS DISTINCT FROM NEW.claim_id
            OR NOT tokens_register_deployment_source_current(source.uuid, clock_timestamp())
            OR NOT tokens_register_deployment_ready(source, false) THEN
            RAISE EXCEPTION 'A fresh deployment signature requires its original current company source' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution WHERE execution.operation_id = NEW.operation_id
        AND EXISTS (SELECT 1 FROM tokens_registerimport imported JOIN tokens_shareregister register ON register.token_id = imported.token_id
            JOIN tokens_registerentry entry ON entry.register_id = register.uuid AND entry.operation_id = imported.uuid AND entry.kind = 'opening'
            WHERE imported.status = 'applied' AND imported.token_id = execution.token_id)) THEN
        RAISE EXCEPTION 'Imported registers require attributed issuance before a fresh signature' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_paid_issue_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF NEW.status = 'rejected' AND EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution
        WHERE execution.request_id = NEW.uuid AND execution.source_instruction_id IS NOT NULL AND execution.subscription_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution JOIN offerings_subscription subscription ON subscription.uuid = execution.subscription_id
            WHERE execution.request_id = NEW.uuid AND execution.status = 'cancelled' AND subscription.issuance_request_id = NEW.uuid
                AND subscription.status = 'refunded' AND subscription.refunded_at IS NOT NULL
                AND subscription.refund_amount > 0 AND execution.source_instruction_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Paid financial cancellation commits only with its genuine original recorded refund' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_correction_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    proposal tokens_registercorrection;
BEGIN
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.register_correction_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register correction decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_deployment_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerdeployment; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registerdeployment WHERE uuid = NEW.register_deployment_id;
    at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'apply' AND (NOT tokens_register_deployment_source_current(proposal.uuid, at_time)
            OR NOT tokens_register_deployment_ready(proposal, false)))
        OR (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason))) THEN
        RAISE EXCEPTION 'Deployment decisions retain their exact current authority and atomic outcome' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_deployment_preparation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id,
            NEW.submitted_by_id, 'prepare', clock_timestamp()) OR NOT tokens_register_deployment_ready(NEW, true) THEN
        RAISE EXCEPTION 'Deployment preparation retains current authority and exact terms at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_grant_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registergrant; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.register_grant_id;
    at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'apply' AND NOT tokens_register_grant_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register grant authority and approval must remain current at commit' USING ERRCODE = '23514';
    END IF;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register grant decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_import_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    proposal tokens_registerimport;
BEGIN
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.register_import_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register import decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_link_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    proposal tokens_registerwalletlink;
BEGIN
    SELECT * INTO proposal FROM tokens_registerwalletlink WHERE uuid = NEW.register_wallet_link_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register wallet link decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_opening_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    proposal tokens_registeropening;
BEGIN
    SELECT * INTO proposal FROM tokens_registeropening WHERE uuid = NEW.register_opening_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register opening decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_particulars_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    proposal tokens_registerparticularschange;
BEGIN
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.register_particulars_change_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register particulars decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_transfer_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registertransfer; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id; at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
        CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time) OR (NEW.kind = 'apply' AND NOT tokens_register_transfer_approved(proposal.uuid, at_time))
    THEN RAISE EXCEPTION 'Register transfer authority must remain current at its deferred check' USING ERRCODE = '23514'; END IF;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted') OR (NEW.kind <> 'approve' AND
        (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
        OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN RAISE EXCEPTION 'A register transfer decision must carry exactly its own effect' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_trading_birth()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_check_trading_modification()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_formerholder_owner_id_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_owner_id companies_company.owner_id%TYPE;
BEGIN
    SELECT grandparent.owner_id INTO parent_owner_id
    FROM tokens_sharetoken AS parent
    JOIN companies_company AS grandparent ON grandparent.uuid = parent.company_id
    WHERE parent.uuid = NEW.token_id;

    IF parent_owner_id IS NULL THEN
        RAISE EXCEPTION 'tokens_formerholder.owner_id cannot be derived: tokens_sharetoken % has no owner', NEW.token_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.token_id IS DISTINCT FROM OLD.token_id
           AND parent_owner_id IS DISTINCT FROM OLD.owner_id THEN
            RAISE EXCEPTION 'tokens_formerholder cannot move this row to another owner, from % to %',
                OLD.owner_id, parent_owner_id;
        END IF;

        IF NEW.owner_id IS NULL OR NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
            NEW.owner_id := parent_owner_id;
        ELSIF NEW.owner_id <> parent_owner_id THEN
            RAISE EXCEPTION 'tokens_formerholder.owner_id cannot be moved to %: tokens_sharetoken % names %',
                NEW.owner_id, NEW.token_id, parent_owner_id;
        END IF;
    ELSE
        IF NEW.owner_id IS NULL THEN
            NEW.owner_id := parent_owner_id;
        ELSIF NEW.owner_id <> parent_owner_id THEN
            RAISE EXCEPTION 'tokens_formerholder.owner_id % does not match the owner of tokens_sharetoken %',
                NEW.owner_id, parent_owner_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_capital()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company capital sources' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR principal IS NULL OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Capital sources require a bounded current personal company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,principal,'prepare',clock_timestamp())
            OR NOT tokens_register_capital_ready(NEW)
            OR NOT EXISTS (SELECT 1 FROM tokens_capitalincreaserequest request WHERE request.uuid = NEW.request_id AND request.status = 'under_review' AND request.reviewed_by_id IS NULL AND request.reviewed_at IS NULL) THEN
            RAISE EXCEPTION 'Capital preparation binds its exact current terms and company evidence' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected') OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registercapitalincreasedecision decision WHERE decision.capital_increase_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_capital_approval(NEW.uuid,clock_timestamp()) OR NOT tokens_register_capital_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Capital source retains its exact immutable decision and outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_capital_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registercapitalincrease; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only capital decisions' USING ERRCODE = '23514'; END IF;
    SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE uuid = NEW.capital_increase_id FOR UPDATE;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR proposal.uuid IS NULL OR proposal.status <> 'submitted'
        OR NEW.decided_by_id IS DISTINCT FROM principal OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_' || NEW.kind
        OR NEW.kind NOT IN ('approve','apply','reject')
        OR NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,principal,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR NEW.digest IS DISTINCT FROM tokens_register_capital_decision_digest(proposal.uuid,NEW.kind,principal,NEW.appointment_id,NEW.reason)
        OR (NEW.kind = 'reject' AND NEW.reason !~ '[^[:space:]]')
        OR (NEW.kind <> 'reject' AND (NEW.reason <> '' OR NOT tokens_register_capital_ready(proposal)))
        OR (NEW.kind = 'approve' AND tokens_register_capital_approved(proposal.uuid,clock_timestamp()))
        OR (NEW.kind = 'apply' AND NOT tokens_register_capital_approved(proposal.uuid,clock_timestamp())) THEN
        RAISE EXCEPTION 'Capital decision requires its exact current personal mandate and terms' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_capital_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registercapitalincrease;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.source_increase_id IS DISTINCT FROM OLD.source_increase_id THEN
        RAISE EXCEPTION 'Retain the original capital source association' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' OR NEW.retry_of IS DISTINCT FROM OLD.retry_of THEN
        SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE uuid = NEW.source_increase_id;
        IF proposal.uuid IS NULL OR NOT tokens_register_capital_source_current(proposal.uuid)
            OR proposal.request_id IS DISTINCT FROM NEW.request_id OR proposal.token_id IS DISTINCT FROM NEW.token_id OR proposal.company_id IS DISTINCT FROM NEW.company_id
            OR proposal.intent IS DISTINCT FROM NEW.intent OR proposal.reviewed_by_id IS DISTINCT FROM NEW.executed_by_id
            OR (TG_OP = 'INSERT' AND (current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_apply'
                OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text OR current_setting('app.user_id',true) IS DISTINCT FROM proposal.reviewed_by_id::text)) THEN
            RAISE EXCEPTION 'Fresh capital admission and retries require the exact original company source' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_capital_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registercapitalincrease; principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) THEN
        RAISE EXCEPTION 'Fresh customer capital writes require the bounded company command' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE request_id = NEW.uuid;
    IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
        IF NEW.status <> 'under_review' OR current_user NOT IN (__OPERATOR__,__MIGRATE__) OR principal IS NULL
            OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh capital preparation requires a current company instruction' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF (proposal.uuid IS NOT NULL OR (TG_OP = 'INSERT' AND NEW.status = 'under_review')) AND NEW.executed_issuance_id IS NOT NULL THEN
        RAISE EXCEPTION 'Company capital raises only the authorised cap and retains no issue' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND proposal.uuid IS NOT NULL THEN
        IF ROW(NEW.submitted_by_id,NEW.submitted_at,NEW.dilution_percentage,NEW.review_notes) IS DISTINCT FROM ROW(OLD.submitted_by_id,OLD.submitted_at,OLD.dilution_percentage,OLD.review_notes) THEN
            RAISE EXCEPTION 'Retain the original company capital preparer and review terms' USING ERRCODE = '23514';
        END IF;
        IF ROW(NEW.reviewed_by_id,NEW.reviewed_at,NEW.rejection_reason) IS DISTINCT FROM ROW(OLD.reviewed_by_id,OLD.reviewed_at,OLD.rejection_reason)
            OR (OLD.status = 'under_review' AND NEW.status IS DISTINCT FROM OLD.status) THEN
            IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR NOT EXISTS (
                SELECT 1 FROM tokens_registercapitalincreasedecision decision WHERE decision.capital_increase_id = proposal.uuid
                AND decision.decided_by_id = NEW.reviewed_by_id AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'approved' THEN 'apply' WHEN 'rejected' THEN 'reject' ELSE '' END
                AND current_setting('app.company_operation',true) = 'register_capital_' || decision.kind AND principal = decision.decided_by_id
                AND (NEW.status <> 'rejected' OR NEW.rejection_reason = decision.reason)
                AND tokens_register_appointment_current(decision.appointment_id,proposal.company_id,decision.decided_by_id,CASE decision.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())) THEN
                RAISE EXCEPTION 'Capital review requires the exact current company decision' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' AND OLD.status IN ('draft','submitted','under_review') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Fresh owner and staff capital decisions are retired' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_issue()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.preparing_appointment_id IS NOT NULL THEN RAISE EXCEPTION 'Retain company grant sources' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF NEW.paid_subscription_id IS NOT NULL THEN
        principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.preparing_appointment_id IS NULL
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
            RAISE EXCEPTION 'Paid issues require the exact current personal company command' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'INSERT' THEN
            IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_paid_issue_prepare'
                OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted' OR NEW.request_id IS NOT NULL
                OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
                OR NEW.source_document IS NOT NULL OR NEW.rejection_reason <> ''
                OR NEW.snapshot->'private'->>'request' IS NULL OR NEW.snapshot->'private'->>'dispatch' IS NULL
                OR EXISTS (SELECT 1 FROM tokens_shareissuancerequest request WHERE request.uuid = (NEW.snapshot->'private'->>'request')::uuid)
                OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
                OR NOT tokens_register_paid_issue_ready(NEW) THEN
                RAISE EXCEPTION 'Paid preparation retains the genuine paid source without admission' USING ERRCODE = '23514';
            END IF;
        ELSE
            IF OLD.paid_subscription_id IS NULL OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected')
                OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
                OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_paid_issue_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
                OR (to_jsonb(NEW) - ARRAY['request_id','status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['request_id','status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                OR NOT EXISTS (SELECT 1 FROM tokens_registerinstructiondecision decision WHERE decision.instruction_id = NEW.uuid
                    AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                    AND decision.kind = (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END))
                OR (NEW.status = 'applied' AND (NEW.request_id::text IS DISTINCT FROM NEW.snapshot->'private'->>'request'
                    OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_issue_approval(NEW.uuid, clock_timestamp())
                    OR NOT tokens_register_paid_issue_ready(NEW) OR NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest request
                        WHERE request.uuid = NEW.request_id AND request.dispatch_id::text = NEW.snapshot->'private'->>'dispatch'
                            AND request.status = 'under_review' AND request.reviewed_by_id IS NULL AND request.reviewed_at IS NULL
                            AND request.submitted_by_id = principal AND request.submitted_at = NEW.reviewed_at
                            AND request.token_id = NEW.token_id AND request.company_id = NEW.company_id
                            AND request.amount::text = NEW.intent->>'amount' AND lower(request.recipient_address) = NEW.intent->>'recipient')))
                OR (NEW.status = 'rejected' AND (NEW.request_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
                RAISE EXCEPTION 'Paid issue retains its exact original company decision and late admission' USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.preparing_appointment_id IS NULL THEN
        IF NEW.paid_subscription_id IS NOT NULL OR NEW.member_id IS NOT NULL OR NEW.nomination_id IS NOT NULL OR NEW.wallet_approval_id IS NOT NULL OR NEW.request_id IS NOT NULL
            OR NEW.snapshot IS NOT NULL OR NEW.intent IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
            OR NEW.terms_on IS NOT NULL OR NEW.terms IS NOT NULL OR NEW.acceptance_required IS NOT NULL
            OR NEW.authority_evidence_id IS NOT NULL OR NEW.terms_evidence_id IS NOT NULL OR NEW.terms_fingerprint IS NOT NULL
            OR NEW.terms_snapshot IS NOT NULL OR NULLIF(NEW.terms_file, '') IS NOT NULL OR NEW.acceptance_evidence_id IS NOT NULL
            OR NEW.acceptance_fingerprint IS NOT NULL OR NEW.acceptance_snapshot IS NOT NULL OR NULLIF(NEW.acceptance_file, '') IS NOT NULL
            OR NEW.intent_digest IS NOT NULL THEN
            RAISE EXCEPTION 'Company issue provenance cannot be partial' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Company issues require a bounded current personal company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_issue_prepare' OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
            OR NEW.source_document IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest request WHERE request.uuid = NEW.request_id
                AND request.status = 'under_review' AND request.reviewed_by_id IS NULL AND request.reviewed_at IS NULL)
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NOT tokens_register_issue_ready(NEW) THEN
            RAISE EXCEPTION 'Company preparation binds exact current grant terms and sources' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.preparing_appointment_id IS NULL OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
            OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_issue_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registerinstructiondecision decision WHERE decision.instruction_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END))
            OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_issue_approval(NEW.uuid, clock_timestamp())
                OR NOT tokens_register_issue_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Company grant retains its exact immutable decision and outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_issue_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerinstruction; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Company grant decisions are append-only' USING ERRCODE = '23514'; END IF;
    SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = NEW.instruction_id;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.preparing_appointment_id IS NULL OR proposal.status <> 'submitted'
        OR NEW.decided_by_id IS DISTINCT FROM principal OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM (CASE WHEN proposal.paid_subscription_id IS NULL THEN 'register_issue_' ELSE 'register_paid_issue_' END) || NEW.kind
        OR NEW.kind NOT IN ('approve','apply','reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_issue_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal, CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, clock_timestamp())
        OR (NEW.kind <> 'reject' AND NOT tokens_register_issue_ready(proposal))
        OR (NEW.kind = 'approve' AND tokens_register_issue_approved(proposal.uuid, clock_timestamp()))
        OR (NEW.kind = 'apply' AND NOT tokens_register_issue_approved(proposal.uuid, clock_timestamp())) THEN
        RAISE EXCEPTION 'Grant decisions bind exact current personal authority and source' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_issue_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE execution tokens_shareissuanceexecution; proposal tokens_registerinstruction;
BEGIN
    IF NEW.kind <> 'issue' THEN RETURN NEW; END IF;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE issuance_id = NEW.operation_id AND source_instruction_id IS NOT NULL;
    IF execution.uuid IS NULL THEN RETURN NEW; END IF;
    IF execution.subscription_id IS NOT NULL THEN
        IF execution.status <> 'executed' OR NOT EXISTS (SELECT 1 FROM tokens_registerinstruction source
            JOIN offerings_subscription subscription ON subscription.uuid = source.paid_subscription_id
            JOIN tokens_registermemberwallet linked ON linked.company_id = source.company_id
            WHERE source.uuid = execution.source_instruction_id AND source.status = 'applied' AND source.request_id = execution.request_id
                AND source.paid_subscription_id = execution.subscription_id AND subscription.issuance_request_id = execution.request_id
                AND subscription.status = 'allotted' AND source.reviewed_by_id = NEW.recorded_by_id
                AND lower(linked.address) = execution.intent->>'recipient'
                AND NEW.changes = jsonb_build_array(jsonb_build_object('member', linked.member_id, 'shares', execution.intent->>'amount')))
            OR NEW.corrects_id IS NOT NULL OR execution.finalized_receipt IS NULL
            OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
            OR NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.uuid = NEW.register_id
                AND register.token_id = execution.token_id AND register.company_id = execution.company_id) THEN
            RAISE EXCEPTION 'Paid ISSUE retains its original subscription, actual member link and finalised mint' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = execution.source_instruction_id;
    IF execution.status <> 'executed' OR proposal.status <> 'applied' OR execution.finalized_receipt IS NULL
        OR NEW.recorded_by_id IS DISTINCT FROM proposal.reviewed_by_id OR NEW.corrects_id IS NOT NULL
        OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object('member', proposal.member_id, 'shares', execution.intent->>'amount'))
        OR NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.uuid = NEW.register_id AND register.token_id = execution.token_id
            AND register.company_id = execution.company_id AND register.uuid::text = proposal.snapshot->'register'->>'uuid') THEN
        RAISE EXCEPTION 'Finalised company issue retains its original member, journal and actual entry day' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_issue_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerinstruction;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.source_instruction_id IS DISTINCT FROM OLD.source_instruction_id THEN
        RAISE EXCEPTION 'Retain the original company issue execution source' USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'failed' AND NEW.status = 'queued') THEN
        PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
        PERFORM 1 FROM tokens_shareregister WHERE token_id = NEW.token_id FOR UPDATE;
        SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = NEW.source_instruction_id;
        IF proposal.uuid IS NULL OR NEW.authority <> 'company' OR NOT tokens_register_issue_source_current(proposal.uuid)
            OR proposal.paid_subscription_id IS DISTINCT FROM NEW.subscription_id OR proposal.request_id IS DISTINCT FROM NEW.request_id OR proposal.company_id IS DISTINCT FROM NEW.company_id
            OR proposal.token_id IS DISTINCT FROM NEW.token_id OR proposal.intent IS DISTINCT FROM NEW.intent OR proposal.reviewed_by_id IS DISTINCT FROM NEW.executed_by_id
            OR (TG_OP = 'INSERT' AND (current_setting('app.company_operation', true) IS DISTINCT FROM (CASE WHEN NEW.subscription_id IS NULL THEN 'register_issue_apply' ELSE 'register_paid_issue_apply' END)
                OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
                OR current_setting('app.user_id', true) IS DISTINCT FROM proposal.reviewed_by_id::text)) THEN
            RAISE EXCEPTION 'Fresh corporate issuance requires its exact current original company admission' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_pause()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company pause sources' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR principal IS NULL OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Pause sources require a bounded current personal company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,principal,'prepare',clock_timestamp())
            OR NOT tokens_register_pause_ready(NEW)
            OR EXISTS (SELECT 1 FROM tokens_pausechange WHERE uuid = NEW.uuid) THEN
            RAISE EXCEPTION 'Pause preparation binds its exact current terms and company evidence' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected') OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registerpausechangedecision decision WHERE decision.pause_change_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_pause_approval(NEW.uuid,clock_timestamp()) OR NOT tokens_register_pause_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Pause source retains its exact immutable decision and outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_pause_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerpausechange; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only pause decisions' USING ERRCODE = '23514'; END IF;
    SELECT * INTO proposal FROM tokens_registerpausechange WHERE uuid = NEW.pause_change_id FOR UPDATE;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR proposal.uuid IS NULL OR proposal.status <> 'submitted'
        OR NEW.decided_by_id IS DISTINCT FROM principal OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_' || NEW.kind
        OR NEW.digest IS DISTINCT FROM tokens_register_pause_decision_digest(proposal.uuid,NEW.kind,NEW.decided_by_id,NEW.appointment_id,NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,principal,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR (NEW.kind = 'reject' AND NEW.reason !~ '[^[:space:]]')
        OR (NEW.kind <> 'reject' AND (NEW.reason <> '' OR NOT tokens_register_pause_ready(proposal)))
        OR (NEW.kind = 'approve' AND tokens_register_pause_approved(proposal.uuid,clock_timestamp()))
        OR (NEW.kind = 'apply' AND NOT tokens_register_pause_approved(proposal.uuid,clock_timestamp())) THEN
        RAISE EXCEPTION 'Pause decision requires its exact current personal mandate and terms' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_company_pause_execution()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerpausechange;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.source_pause_id IS DISTINCT FROM OLD.source_pause_id THEN
        RAISE EXCEPTION 'Retain the original pause source association' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO proposal FROM tokens_registerpausechange WHERE uuid = NEW.source_pause_id;
        IF proposal.uuid IS NULL OR NOT tokens_register_pause_source_current(proposal.uuid)
            OR proposal.uuid IS DISTINCT FROM NEW.uuid OR proposal.token_id IS DISTINCT FROM NEW.token_id OR proposal.company_id IS DISTINCT FROM NEW.company_id
            OR NEW.authority <> 'company' OR proposal.paused IS DISTINCT FROM NEW.paused OR proposal.intent IS DISTINCT FROM NEW.intent
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.initiated_by_id OR NEW.status <> 'pending' OR NEW.completed_at IS NOT NULL
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_apply'
            OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text OR current_setting('app.user_id',true) IS DISTINCT FROM proposal.reviewed_by_id::text THEN
            RAISE EXCEPTION 'Fresh pause admission requires the exact original company source' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.source_pause_id IS NOT NULL AND OLD.status = 'pending' AND NEW.status IN ('executing','observed') AND NOT tokens_register_pause_source_current(NEW.source_pause_id) THEN
            RAISE EXCEPTION 'Unsigned pause observation or execution requires current company authority' USING ERRCODE = '23514';
        END IF;
        IF NEW.source_pause_id IS NOT NULL AND NEW.status = 'failed' AND OLD.status <> 'failed' AND NEW.operation_id IS NULL
            AND NOT tokens_register_pause_source_lapsed(NEW.source_pause_id) THEN
            RAISE EXCEPTION 'Unsigned source retirement requires actual consumed appointment revocation or expiry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_correction_register_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registercorrection; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    IF NEW.kind <> 'correction' THEN RETURN NEW; END IF;
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_apply'
        AND NOT EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL) THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.operation_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR proposal.company_id IS DISTINCT FROM issuer OR proposal.register_id IS DISTINCT FROM NEW.register_id
        OR proposal.status <> 'submitted' OR proposal.preparing_appointment_id IS NULL OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR NEW.corrects_id IS DISTINCT FROM proposal.corrects_id OR NEW.changes IS DISTINCT FROM proposal.changes
        OR NEW.effective_on IS DISTINCT FROM proposal.effective_on
        OR NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.uuid = NEW.register_id
            AND register.sequence = proposal.base_sequence AND register.head_hash = proposal.base_hash)
        OR NOT tokens_register_correction_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registercorrectiondecision decision WHERE decision.register_correction_id = proposal.uuid
            AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A non-tokenised correction entry needs its exact current company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_grant_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM tokens_registergrant proposal JOIN tokens_registergrantdecision decision ON decision.register_grant_id = proposal.uuid
        WHERE proposal.member = NEW.uuid AND proposal.new_member AND proposal.company_id = NEW.company_id
            AND proposal.status = 'submitted' AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND current_setting('app.company_id', true) = NEW.company_id::text
            AND tokens_register_grant_ready(proposal, true)
            AND tokens_register_grant_approved(proposal.uuid, clock_timestamp())
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A new grant member requires the exact company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_grant_register_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registergrant; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.operation_id;
    IF proposal.uuid IS NULL AND current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply'
        AND NOT (NEW.kind = 'issue' AND EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL)) THEN
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR proposal.company_id IS DISTINCT FROM issuer OR proposal.token_id IS DISTINCT FROM token_uuid OR proposal.status <> 'submitted'
        OR NEW.kind <> 'issue' OR NEW.recorded_by_id IS DISTINCT FROM principal OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object('member', proposal.member::text, 'shares', proposal.shares::text))
        OR NOT tokens_register_grant_ready(proposal, false) OR NOT tokens_register_grant_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision WHERE decision.register_grant_id = proposal.uuid
            AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN
        RAISE EXCEPTION 'A non-tokenised grant entry requires its exact current company application' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_issuance_finalized_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    evidence jsonb;
    policy jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.finalized_receipt IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh issuance executions cannot claim finalized receipt evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.finalized_receipt IS NOT NULL OR OLD.status = 'executed' THEN
        IF NEW.finalized_receipt IS DISTINCT FROM OLD.finalized_receipt THEN
            RAISE EXCEPTION 'Completed issuances retain their recorded finality evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status <> 'executed' THEN
        IF NEW.finalized_receipt IS NOT NULL THEN
            RAISE EXCEPTION 'Issuance finality evidence belongs to its completion';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.finalized_receipt IS NULL THEN
        RAISE EXCEPTION 'A completed issuance requires finalized receipt evidence';
    END IF;
    evidence := NEW.finalized_receipt;
    IF jsonb_typeof(evidence) IS DISTINCT FROM 'object'
        OR NOT (evidence ?& ARRAY['block_number', 'block_hash', 'gas_used', 'policy'])
        OR evidence - ARRAY['block_number', 'block_hash', 'gas_used', 'policy', 'transaction_index'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Issuance finality evidence requires its exact block, gas and policy';
    END IF;
    IF jsonb_typeof(evidence->'block_number') IS DISTINCT FROM 'number'
        OR evidence->>'block_number' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'gas_used') IS DISTINCT FROM 'number'
        OR evidence->>'gas_used' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'block_hash') IS DISTINCT FROM 'string'
        OR evidence->>'block_hash' !~ '^0x[0-9a-f]{64}$'
        OR (evidence->>'block_number')::numeric > 9223372036854775807
        OR (evidence->>'gas_used')::numeric > 9223372036854775807 THEN
        RAISE EXCEPTION 'Issuance finality evidence requires exact nonnegative quantities and a block hash';
    END IF;
    IF evidence ? 'transaction_index' AND (
        jsonb_typeof(evidence->'transaction_index') IS DISTINCT FROM 'number'
        OR evidence->>'transaction_index' !~ '^(0|[1-9][0-9]{0,6})$') THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires an exact transaction index';
    END IF;
    policy := evidence->'policy';
    IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR policy->'version' IS DISTINCT FROM '1'::jsonb
        OR NOT (policy ? 'mode') THEN
        RAISE EXCEPTION 'Issuance finality evidence requires an approved policy shape';
    END IF;
    IF policy->>'mode' = 'finalized' THEN
        IF policy - ARRAY['version', 'mode'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Issuance finality evidence requires an exact finalized policy';
        END IF;
    ELSIF policy->>'mode' = 'depth' THEN
        IF jsonb_typeof(policy->'depth') IS DISTINCT FROM 'number'
            OR policy->>'depth' !~ '^[1-9][0-9]*$'
            OR policy - ARRAY['version', 'mode', 'depth'] <> '{}'::jsonb
            OR (policy->>'depth')::numeric > 9223372036854775807 THEN
            RAISE EXCEPTION 'Issuance finality evidence requires an exact positive depth policy';
        END IF;
    ELSE
        RAISE EXCEPTION 'Issuance finality evidence requires an approved policy mode';
    END IF;
    SELECT * INTO journal FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
    IF OLD.status <> 'executing' OR NEW.transaction_id IS NULL OR journal.uuid IS NULL
        OR journal.related_model <> 'tokens.ShareIssuanceRequest'
        OR journal.related_uuid IS DISTINCT FROM NEW.request_id
        OR journal.tx_type <> 'token_mint' OR journal.status <> 'confirmed'
        OR coalesce(journal.tx_hash, '') = ''
        OR journal.block_number IS DISTINCT FROM (evidence->>'block_number')::bigint
        OR journal.gas_used IS DISTINCT FROM (evidence->>'gas_used')::bigint
        OR lower(coalesce(journal.block_hash, '')) IS DISTINCT FROM evidence->>'block_hash' THEN
        RAISE EXCEPTION 'Finality evidence belongs to the original confirmed mint journal';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_issuance_review()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM tokens_registerinstruction proposal WHERE proposal.request_id = NEW.uuid AND proposal.preparing_appointment_id IS NOT NULL) THEN
        IF NEW.status = 'rejected' AND EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution
            JOIN offerings_subscription subscription ON subscription.uuid = execution.subscription_id
            WHERE execution.request_id = NEW.uuid AND execution.status = 'cancelled'
                AND subscription.issuance_request_id = NEW.uuid AND execution.source_instruction_id IS NOT NULL
                AND OLD.status IN ('approved','failed')
                AND (to_jsonb(NEW) - ARRAY['status','rejection_reason','updated_at']) = (to_jsonb(OLD) - ARRAY['status','rejection_reason','updated_at'])
                AND NEW.rejection_reason = 'Cancelled by refund of subscription ' || COALESCE(NULLIF(subscription.reference, ''), subscription.uuid::text) || '.') THEN
            RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' AND ROW(NEW.uuid, NEW.created_at, NEW.dispatch_id, NEW.company_id, NEW.token_id, NEW.amount,
            NEW.recipient_address, NEW.recipient_name, NEW.issuance_type, NEW.reason, NEW.submitted_by_id, NEW.submitted_at,
            NEW.dilution_percentage, NEW.review_notes) IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.dispatch_id,
            OLD.company_id, OLD.token_id, OLD.amount, OLD.recipient_address, OLD.recipient_name, OLD.issuance_type, OLD.reason,
            OLD.submitted_by_id, OLD.submitted_at, OLD.dilution_percentage, OLD.review_notes) THEN
            RAISE EXCEPTION 'Prepared company grant request terms and original actor are immutable' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND (ROW(NEW.reviewed_by_id, NEW.reviewed_at, NEW.rejection_reason)
            IS DISTINCT FROM ROW(OLD.reviewed_by_id, OLD.reviewed_at, OLD.rejection_reason)
            OR (OLD.status = 'under_review' AND NEW.status IS DISTINCT FROM OLD.status)) AND NOT EXISTS (
            SELECT 1 FROM tokens_registerinstruction proposal JOIN tokens_registerinstructiondecision decision ON decision.instruction_id = proposal.uuid
            WHERE proposal.request_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = (CASE NEW.status WHEN 'approved' THEN 'apply' WHEN 'rejected' THEN 'reject' ELSE '' END)
                AND current_setting('app.company_operation', true) = (CASE WHEN proposal.paid_subscription_id IS NULL THEN 'register_issue_' ELSE 'register_paid_issue_' END) || decision.kind
                AND current_setting('app.user_id', true) = decision.decided_by_id::text
                AND (NEW.status <> 'rejected' OR NEW.rejection_reason = decision.reason)
                AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id,
                    CASE decision.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, clock_timestamp())) THEN
            RAISE EXCEPTION 'Request review requires its exact company grant decision' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review')) THEN
        RAISE EXCEPTION 'Fresh paid and nonpaid approval requires its retained company decision' USING ERRCODE = '23514';
    END IF;
    IF current_user = __APP__ AND (
        (TG_OP = 'INSERT' AND (NEW.status NOT IN ('draft', 'submitted') OR NEW.reviewed_by_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL OR NEW.review_notes <> '' OR NEW.rejection_reason <> ''))
        OR (TG_OP = 'UPDATE' AND (
            (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('under_review', 'approved', 'rejected'))
            OR ROW(NEW.reviewed_by_id, NEW.reviewed_at, NEW.review_notes, NEW.rejection_reason)
                IS DISTINCT FROM ROW(OLD.reviewed_by_id, OLD.reviewed_at, OLD.review_notes, OLD.rejection_reason)))
    ) THEN
        RAISE EXCEPTION 'Only operator review may decide an issuance request' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'submitted', 'under_review'))
        AND NOT EXISTS (SELECT 1 FROM authentication_customuser
            WHERE id = NEW.reviewed_by_id AND is_active AND is_staff) THEN
        RAISE EXCEPTION 'An issuance approval requires an active staff reviewer' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_member_cessation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE held numeric; delta numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.ceased_on >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 2557
            OR COALESCE(current_setting('app.company_operation', true), '') <> ''
            OR EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = OLD.member_id AND position.shares > 0)
        THEN RAISE EXCEPTION 'A member cessation must remain through its retention floor and continued membership' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR pg_trigger_depth() < 2
            OR OLD.returned_entry_id IS NOT NULL OR OLD.returned_on IS NOT NULL OR OLD.returned_at IS NOT NULL
            OR NEW.returned_entry_id IS NULL OR NEW.returned_at IS NULL
            OR NEW.returned_on IS DISTINCT FROM (NEW.returned_at AT TIME ZONE 'UTC')::date
            OR NEW.returned_at < statement_timestamp() OR NEW.returned_at > clock_timestamp()
            OR (to_jsonb(NEW) - ARRAY['returned_entry_id', 'returned_on', 'returned_at', 'updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['returned_entry_id', 'returned_on', 'returned_at', 'updated_at'])
            OR COALESCE((SELECT shares FROM tokens_registerposition WHERE register_id = OLD.register_id AND member_id = OLD.member_id), 0) <> 0
            OR NOT EXISTS (SELECT 1 FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
                WHERE entry.uuid = NEW.returned_entry_id AND entry.register_id = OLD.register_id
                    AND entry.sequence > (SELECT sequence FROM tokens_registerentry WHERE uuid = OLD.entry_id)
                    AND effect->>'member' = OLD.member_id::text AND (effect->>'shares')::numeric > 0)
        THEN RAISE EXCEPTION 'A cessation return is filled once by its exact zero-to-positive entry' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' OR current_user NOT IN (__OPERATOR__, __MIGRATE__) OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Only a genuine register entry records an immutable member cessation' USING ERRCODE = '23514';
    END IF;
    SELECT shares INTO held FROM tokens_registerposition WHERE register_id = NEW.register_id AND member_id = NEW.member_id;
    SELECT (effect->>'shares')::numeric INTO delta FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
        WHERE entry.uuid = NEW.entry_id AND effect->>'member' = NEW.member_id::text;
    IF held IS NULL OR held <= 0 OR held + delta IS DISTINCT FROM 0 OR NEW.shares_at_cessation IS DISTINCT FROM held
        OR NEW.particulars_snapshot IS DISTINCT FROM tokens_register_particulars_snapshot(NEW.member_id)
        OR NEW.name IS DISTINCT FROM NEW.particulars_snapshot->>'name' OR NEW.residential_address IS DISTINCT FROM NEW.particulars_snapshot->>'residential_address'
        OR NEW.created_at < statement_timestamp() OR NEW.created_at > clock_timestamp() OR NEW.updated_at IS DISTINCT FROM NEW.created_at
        OR NEW.ceased_on IS DISTINCT FROM (NEW.created_at AT TIME ZONE 'UTC')::date
        OR NEW.returned_entry_id IS NOT NULL OR NEW.returned_on IS NOT NULL OR NEW.returned_at IS NOT NULL
        OR NEW.identity_source <> 'particulars' OR NOT EXISTS (SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            JOIN tokens_registermember member ON member.uuid = NEW.member_id WHERE entry.uuid = NEW.entry_id AND register.uuid = NEW.register_id
                AND register.company_id = NEW.company_id AND member.company_id = NEW.company_id)
    THEN RAISE EXCEPTION 'A cessation must freeze the exact positive-to-zero entry and particulars' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_pause_projection()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    IF current_user IN (__OPERATOR__,__MIGRATE__) AND current_setting('app.company_operation',true) = 'register_pause_project' THEN
        IF OLD.status IS DISTINCT FROM NEW.status AND NOT EXISTS (SELECT 1 FROM tokens_pausechange execution
            WHERE execution.token_id = NEW.uuid AND execution.company_id = NEW.company_id
                AND execution.company_id::text = current_setting('app.company_id',true)
                AND execution.initiated_by_id::text = current_setting('app.user_id',true)
                AND execution.source_pause_id IS NOT NULL AND execution.authority = 'company'
                AND execution.chain_id IN (31337,84532) AND execution.contract_address = lower(NEW.contract_address)
                AND execution.completed_at IS NULL AND execution.status IN ('observed','confirmed')
                AND execution.paused = (NEW.status = 'paused') AND NEW.status IN ('deployed','paused')) THEN
            RAISE EXCEPTION 'Company pause projection requires its original observed or confirmed outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_acknowledgement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    acknowledged tokens_registerreconciliation;
    principal bigint;
    issuer uuid;
    at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain register acknowledgements as recorded' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT company_id INTO issuer FROM tokens_sharetoken WHERE uuid = NEW.token_id;
    PERFORM 1 FROM companies_company WHERE uuid = issuer FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
    SELECT * INTO acknowledged FROM tokens_registerreconciliation WHERE uuid = NEW.reconciliation_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__)
        OR NEW.acknowledged_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_discrepancy_acknowledge'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR NEW.idempotency_key IS NULL
        OR NOT tokens_register_appointment_current(NEW.appointment_id, issuer, principal, 'approve', at_time)
        OR EXISTS (SELECT 1 FROM tokens_registerreconciliation later
            WHERE later.token_id = acknowledged.token_id
                AND (later.created_at, later.uuid) > (acknowledged.created_at, acknowledged.uuid))
        OR acknowledged.token_id IS DISTINCT FROM NEW.token_id
        OR COALESCE(NEW.discrepancy->>'kind', '') NOT IN ('unrecognised_transfer', 'member', 'unlinked', 'supply')
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(acknowledged.discrepancies) item
            WHERE item = NEW.discrepancy)
        OR NEW.reason !~ '[^[:space:]]'
    THEN
        RAISE EXCEPTION 'A current company approver acknowledges one exact current discrepancy, with a reason'
            USING ERRCODE = '23514';
    END IF;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_correction()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    original tokens_registerentry;
    applied tokens_registerentry;
    head tokens_shareregister;
    principal bigint;
    at_time timestamptz;
    authority_copy tokens_registerevidence;
    inverse jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain correction proposals and their authority evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO authority_copy FROM tokens_registerevidence WHERE uuid = NEW.authority_evidence_id;
        SELECT * INTO head FROM tokens_shareregister WHERE uuid = NEW.register_id FOR UPDATE;
        SELECT * INTO original FROM tokens_registerentry WHERE uuid = NEW.corrects_id;
        SELECT jsonb_agg(jsonb_build_object('member', value->>'member',
            'shares', (-(value->>'shares')::numeric)::text) ORDER BY value->>'member')
            INTO inverse FROM jsonb_array_elements(original.changes);
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR head.company_id IS DISTINCT FROM NEW.company_id
            OR original.register_id IS DISTINCT FROM NEW.register_id
            OR NEW.base_sequence IS DISTINCT FROM head.sequence OR NEW.base_hash IS DISTINCT FROM head.head_hash
            OR inverse IS NULL OR NEW.changes IS DISTINCT FROM inverse
            OR EXISTS (SELECT 1 FROM tokens_registerentry WHERE corrects_id = NEW.corrects_id)
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.effective_on > current_date
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-corrections/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR authority_copy.uuid IS NULL OR authority_copy.company_id <> NEW.company_id
            OR authority_copy.kind <> 'authority' OR authority_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM authority_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(authority_copy)
        THEN
            RAISE EXCEPTION 'Correction preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
            OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'applied_entry_id', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'applied_entry_id', 'updated_at'])
            OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR NOT EXISTS (SELECT 1 FROM tokens_registercorrectiondecision decision
                WHERE decision.register_correction_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                    AND decision.decided_at = NEW.reviewed_at
                    AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                    AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        THEN
            RAISE EXCEPTION 'Only the exact company decision may decide an immutable correction'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            SELECT * INTO applied FROM tokens_registerentry WHERE uuid = NEW.applied_entry_id;
            IF applied.uuid IS NULL OR applied.register_id <> NEW.register_id OR applied.kind <> 'correction'
                OR applied.operation_id <> NEW.uuid OR applied.corrects_id IS DISTINCT FROM NEW.corrects_id
                OR applied.changes IS DISTINCT FROM NEW.changes OR applied.effective_on <> NEW.effective_on
                OR applied.recorded_by_id <> NEW.reviewed_by_id
                OR applied.previous_hash <> NEW.base_hash OR applied.sequence <> NEW.base_sequence + 1
                OR NEW.rejection_reason <> '' THEN
                RAISE EXCEPTION 'Application must record the matching compensating entry' USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.applied_entry_id IS NOT NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
            RAISE EXCEPTION 'Rejection requires a reason and no applied entry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_correction_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registercorrection;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register correction decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.register_correction_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.register_correction_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (length(btrim(NEW.reason)) > 0)
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_correction_decision_digest(proposal.uuid, NEW.kind,
            principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_correction_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_correction_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register correction decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_deployment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company deployment sources' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Deployment sources require a bounded current company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_deployment_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.rejection_reason <> ''
            OR NEW.approval_decision_id IS NOT NULL OR NEW.deployment_id IS NOT NULL
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NOT tokens_register_deployment_ready(NEW, true) THEN
            RAISE EXCEPTION 'Preparation requires exact empty-class terms and company authority' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected') OR NEW.reviewed_at IS NULL
            OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_deployment_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status', 'approval_decision_id', 'deployment_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'approval_decision_id', 'deployment_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registerdeploymentdecision decision WHERE decision.register_deployment_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
            OR (NEW.status = 'applied' AND (NEW.deployment_id IS NULL OR NEW.rejection_reason <> ''
                OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_deployment_approval(NEW.uuid, clock_timestamp())
                OR NOT tokens_register_deployment_ready(NEW, false)))
            OR (NEW.status = 'rejected' AND (NEW.deployment_id IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
                OR NEW.rejection_reason !~ '[^[:space:]]')) THEN
            RAISE EXCEPTION 'Deployment sources are immutable except for their exact company outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_deployment_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint; proposal tokens_registerdeployment; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Deployment decisions are append-only' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerdeployment WHERE uuid = NEW.register_deployment_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_deployment_' || NEW.kind
        OR NEW.decided_by_id IS DISTINCT FROM principal OR proposal.status <> 'submitted'
        OR NEW.kind NOT IN ('approve', 'apply', 'reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_deployment_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_deployment_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_deployment_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_deployment_ready(proposal, true)) THEN
        RAISE EXCEPTION 'Deployment decisions require exact current authority and frozen terms' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_entry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    head tokens_shareregister;
    original tokens_registerentry;
    deployment_source tokens_registerdeployment;
    deployment_journal tokens_tokendeployment;
    effect jsonb;
    selected_member uuid;
    delta numeric;
    held numeric;
    total numeric := 0;
    previous_member text := '';
    inverse jsonb;
    maximum numeric := 115792089237316195423570985008687907853269984665640564039457584007913129639935;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register entries cannot be rewritten or deleted' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO STRICT head FROM tokens_shareregister WHERE uuid = NEW.register_id FOR UPDATE;
    SELECT proposal.* INTO deployment_source FROM tokens_registerdeployment proposal JOIN tokens_sharetoken token
        ON token.uuid = proposal.token_id AND token.deployment_id = proposal.deployment_id
        WHERE token.uuid = head.token_id AND proposal.status = 'applied';
    IF deployment_source.uuid IS NOT NULL THEN
        SELECT journal.* INTO deployment_journal FROM tokens_tokendeployment journal
            JOIN tokens_sharetoken token ON token.uuid = journal.token_id
            JOIN blockchain_outgoingoperation operation ON operation.uuid = journal.operation_id
            JOIN blockchain_signedattempt attempt ON attempt.uuid = operation.current_attempt_id
            JOIN blockchain_blockchaintransaction transaction ON transaction.uuid = journal.transaction_id
            WHERE journal.source_deployment_id = deployment_source.uuid AND journal.uuid = deployment_source.deployment_id
                AND journal.token_id = head.token_id AND journal.company_id = head.company_id
                AND NOT journal.attribution_required AND journal.projected_at IS NOT NULL
                AND operation.status = 'confirmed' AND transaction.status = 'confirmed'
                AND transaction.uuid = token.deployment_transaction_id AND transaction.tx_hash = token.deployment_tx_hash
                AND attempt.tx_hash = transaction.tx_hash AND attempt.claim_id = operation.claim_id
                AND operation.block_number = transaction.block_number AND operation.block_hash = transaction.block_hash
                AND lower(journal.contract_address) = lower(token.contract_address) AND journal.contract_address <> '';
        IF deployment_journal.uuid IS NULL THEN
            RAISE EXCEPTION 'An admitted deployment freezes its empty register until original projection' USING ERRCODE = '23514';
        END IF;
        IF NEW.kind = 'opening' AND NOT EXISTS (
            SELECT 1 FROM tokens_registeropening opening JOIN tokens_registeropeningdecision decision
                ON decision.register_opening_id = opening.uuid AND decision.kind = 'apply'
            JOIN blockchain_blockchaintransaction transaction ON transaction.uuid = deployment_journal.transaction_id
            WHERE opening.uuid = NEW.operation_id AND opening.token_id = head.token_id AND opening.company_id = head.company_id
                AND opening.status = 'submitted' AND opening.preparing_appointment_id IS NOT NULL
                AND current_setting('app.company_operation', true) = 'register_opening_apply'
                AND current_setting('app.company_id', true) = head.company_id::text
                AND decision.decided_by_id = NEW.recorded_by_id
                AND decision.decided_by_id::text = current_setting('app.user_id', true)
                AND tokens_register_opening_approved(opening.uuid, clock_timestamp())
                AND tokens_register_appointment_current(decision.appointment_id, head.company_id, NEW.recorded_by_id, 'apply', clock_timestamp())
                AND opening.boundary->>'deployment' = deployment_journal.uuid::text
                AND lower(opening.boundary->>'contract_address') = lower(deployment_journal.contract_address)
                AND opening.boundary->>'deployment_transaction' = transaction.tx_hash
                AND (opening.boundary->>'deployment_block')::bigint = transaction.block_number
                AND opening.boundary->>'deployment_hash' = transaction.block_hash
                AND (opening.boundary->>'chain_id')::bigint = (deployment_journal.intent->>'chain_id')::bigint
        ) THEN RAISE EXCEPTION 'A company deployment requires its genuine original chain opening' USING ERRCODE = '23514'; END IF;
    END IF;
    IF NEW.kind NOT IN ('opening', 'issue', 'transfer', 'cessation', 'correction')
        OR (NEW.kind = 'opening') <> (head.sequence = 0)
        OR jsonb_typeof(NEW.changes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The register requires one opening followed by typed changes' USING ERRCODE = '23514';
    END IF;
    FOR effect IN SELECT value FROM jsonb_array_elements(NEW.changes) LOOP
        IF jsonb_typeof(effect) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Register changes require member and share fields' USING ERRCODE = '23514';
        END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(effect)) <> 2
            OR jsonb_typeof(effect->'member') IS DISTINCT FROM 'string'
            OR jsonb_typeof(effect->'shares') IS DISTINCT FROM 'string'
            OR (effect->>'shares') !~ '^-?[1-9][0-9]{0,77}$'
            OR (effect->>'member') <= previous_member THEN
            RAISE EXCEPTION 'Register changes must be distinct sorted members with exact nonzero shares' USING ERRCODE = '23514';
        END IF;
        selected_member := (effect->>'member')::uuid;
        IF selected_member::text <> effect->>'member' OR NOT EXISTS (
            SELECT 1 FROM tokens_registermember WHERE uuid = selected_member AND company_id = head.company_id
        ) THEN
            RAISE EXCEPTION 'A register member must belong to its company' USING ERRCODE = '23514';
        END IF;
        previous_member := effect->>'member';
        delta := (effect->>'shares')::numeric;
        held := COALESCE((SELECT shares FROM tokens_registerposition
            WHERE register_id = head.uuid AND tokens_registerposition.member_id = selected_member), 0);
        IF abs(delta) > maximum OR held + delta < 0 OR held + delta > maximum
            OR (NEW.kind IN ('opening', 'issue') AND delta < 0)
            OR (NEW.kind = 'cessation' AND (delta > 0 OR held + delta <> 0)) THEN
            RAISE EXCEPTION 'Register changes must preserve valid holdings' USING ERRCODE = '23514';
        END IF;
        total := total + delta;
    END LOOP;
    IF (NEW.kind <> 'opening' AND jsonb_array_length(NEW.changes) = 0)
        OR (NEW.kind IN ('issue', 'cessation') AND jsonb_array_length(NEW.changes) <> 1)
        OR (NEW.kind = 'transfer' AND (jsonb_array_length(NEW.changes) <> 2 OR total <> 0))
        OR head.issued_supply + total < 0 OR head.issued_supply + total > maximum THEN
        RAISE EXCEPTION 'The register change has an invalid shape or supply' USING ERRCODE = '23514';
    END IF;
    IF NEW.kind = 'correction' THEN
        SELECT * INTO original FROM tokens_registerentry
            WHERE uuid = NEW.corrects_id AND register_id = head.uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'A correction must identify an earlier entry in this register' USING ERRCODE = '23514';
        END IF;
        SELECT jsonb_agg(jsonb_build_object('member', value->>'member',
            'shares', (-(value->>'shares')::numeric)::text) ORDER BY value->>'member')
            INTO inverse FROM jsonb_array_elements(original.changes);
        IF NEW.changes IS DISTINCT FROM inverse THEN
            RAISE EXCEPTION 'A correction must compensate the original entry exactly' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.corrects_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only a correction can compensate an earlier entry' USING ERRCODE = '23514';
    END IF;
    NEW.sequence := head.sequence + 1;
    NEW.previous_hash := head.head_hash;
    NEW.entry_hash := tokens_register_entry_hash(NEW);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain company-provided register evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.uploaded_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_evidence'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NEW.kind NOT IN ('share_register', 'asic_extract', 'authority', 'supporting')
        OR NEW.sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.file_size <= 0 OR NEW.mime_type NOT IN ('application/pdf', 'image/png', 'image/jpeg')
        OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-evidence/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
        OR NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'prepare', at_time)
    THEN
        RAISE EXCEPTION 'Register evidence needs its uploader''s current preparation authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_export()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Register export records are retained as written' USING ERRCODE = '23514';
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_grant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register grants and their evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = NEW.token_id FOR UPDATE;
    IF TG_OP = 'INSERT' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR length(NEW.residential_address) > 1000 OR NEW.terms !~ '[^[:space:]]'
            OR NEW.authority_reference !~ '[^[:space:]]' OR NEW.reason !~ '[^[:space:]]'
            OR NEW.approving_director !~ '[^[:space:]]' OR NEW.terms_on > (clock_timestamp() AT TIME ZONE 'UTC')::date OR NEW.shares <= 0 OR NEW.shares >= 2::numeric^256
            OR NOT tokens_register_grant_ready(NEW, true)
            OR NOT tokens_register_grant_evidence_matches(NEW.authority_evidence_id, NEW.company_id, principal,
                'authority', NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, NEW.uuid)
            OR NOT tokens_register_grant_evidence_matches(NEW.terms_evidence_id, NEW.company_id, principal,
                'supporting', NEW.terms_fingerprint, NEW.terms_snapshot, NEW.terms_file, NEW.uuid)
            OR (NEW.acceptance_required AND NOT tokens_register_grant_evidence_matches(NEW.acceptance_evidence_id,
                NEW.company_id, principal, 'supporting', NEW.acceptance_fingerprint, NEW.acceptance_snapshot, NEW.acceptance_file, NEW.uuid))
            OR (NOT NEW.acceptance_required AND (NEW.acceptance_evidence_id IS NOT NULL OR NEW.acceptance_fingerprint <> ''
                OR NEW.acceptance_snapshot IS NOT NULL OR NEW.acceptance_file <> ''))
        THEN
            RAISE EXCEPTION 'Register grants require exact current authority, non-paid terms, identity and evidence' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted' OR principal IS NULL
        OR NEW.status NOT IN ('applied', 'rejected')
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
        OR (to_jsonb(NEW) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision WHERE decision.register_grant_id = NEW.uuid
            AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
            AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
            AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NOT EXISTS (
            SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            WHERE entry.uuid = NEW.register_entry_id AND register.token_id = NEW.token_id AND entry.operation_id = NEW.uuid
                AND entry.kind = 'issue' AND entry.recorded_by_id = principal AND entry.effective_on = (clock_timestamp() AT TIME ZONE 'UTC')::date
                AND entry.changes = jsonb_build_array(jsonb_build_object('member', NEW.member::text, 'shares', NEW.shares::text)))))
        OR (NEW.status = 'rejected' AND (NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]'))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable register grant' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_grant_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint; at_time timestamptz; proposal tokens_registergrant;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register grant decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.register_grant_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.register_grant_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal OR proposal.status <> 'submitted'
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR NEW.kind NOT IN ('approve', 'apply', 'reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_grant_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_grant_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_grant_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_grant_ready(proposal, true))
    THEN
        RAISE EXCEPTION 'Register grant decisions need exact current company authority and effect' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_import()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    register_copy tokens_registerevidence;
    asic_copy tokens_registerevidence;
    member_count bigint;
    imported_total numeric;
    opening tokens_registerentry;
    expected_changes jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register imports and their evidence' USING ERRCODE = '23514';
    END IF;
    SELECT e.* INTO opening FROM tokens_shareregister r JOIN tokens_registerentry e ON e.register_id = r.uuid
        WHERE r.token_id = NEW.token_id AND e.kind = 'opening';
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO register_copy FROM tokens_registerevidence WHERE uuid = NEW.register_evidence_id;
        SELECT * INTO asic_copy FROM tokens_registerevidence WHERE uuid = NEW.asic_evidence_id;
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR NEW.register_sequence IS NOT NULL
            OR NEW.source_document IS NOT NULL OR NEW.asic_document IS NOT NULL
            OR register_copy.uuid IS NULL OR register_copy.company_id <> NEW.company_id
            OR register_copy.kind <> 'share_register' OR register_copy.uploaded_by_id <> principal
            OR asic_copy.uuid IS NULL OR asic_copy.company_id <> NEW.company_id
            OR asic_copy.kind <> 'asic_extract' OR asic_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM register_copy.sha256
            OR NEW.asic_fingerprint IS DISTINCT FROM asic_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(register_copy)
            OR NEW.asic_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(asic_copy)
            OR NEW.asic_file IS NOT DISTINCT FROM NEW.file
            OR NEW.asic_file !~ ('^companies/' || NEW.company_id || '/register-imports/' || NEW.uuid
                || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken t WHERE t.uuid = NEW.token_id
                AND t.company_id = NEW.company_id)
            OR (opening.uuid IS NULL AND (EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.token_id = NEW.token_id AND r.status IN ('approved', 'executing', 'executed', 'failed'))
                OR EXISTS (SELECT 1 FROM tokens_registerinstruction i
                    WHERE i.token_id = NEW.token_id AND i.status = 'applied')))
            OR NEW.as_at > current_date
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$' OR NEW.asic_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-imports/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR jsonb_typeof(NEW.members) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.members) = 0
            OR jsonb_typeof(NEW.former_members) IS DISTINCT FROM 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM ARRAY['amount_paid', 'entered_on', 'member', 'name', 'residential_address', 'shares']
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string' OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '^[1-9][0-9]{0,77}$'
                OR jsonb_typeof(item->'entered_on') IS DISTINCT FROM 'string' OR item->>'entered_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                OR (item->>'entered_on')::date > NEW.as_at
                OR (jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'string'
                    AND jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'null')
                OR (jsonb_typeof(item->'amount_paid') = 'string' AND item->>'amount_paid' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$')
                OR EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid::text = item->>'member'
                    AND m.company_id <> NEW.company_id)
                OR (opening.uuid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tokens_registermember m
                    WHERE m.uuid::text = item->>'member' AND m.company_id = NEW.company_id)))
            OR (SELECT count(DISTINCT item->>'member') FROM jsonb_array_elements(NEW.members) item)
                <> jsonb_array_length(NEW.members)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.former_members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM ARRAY['ceased_on', 'name', 'residential_address', 'shares']
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '^[1-9][0-9]{0,77}$'
                OR jsonb_typeof(item->'ceased_on') IS DISTINCT FROM 'string' OR item->>'ceased_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                OR (item->>'ceased_on')::date > NEW.as_at
                OR (opening.uuid IS NOT NULL
                    AND ((item->>'ceased_on')::date < opening.effective_on) IS NOT TRUE))
            OR NEW.asic_issued_total IS DISTINCT FROM (SELECT sum((item->>'shares')::numeric)
                FROM jsonb_array_elements(NEW.members) item)
            OR NEW.asic_member_count IS DISTINCT FROM jsonb_array_length(NEW.members)
        THEN
            RAISE EXCEPTION 'Register imports require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
            'register_sequence', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
            'register_sequence', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision
            WHERE decision.register_import_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable register import'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        SELECT count(*), sum((item->>'shares')::numeric) INTO member_count, imported_total
            FROM jsonb_array_elements(NEW.members) item;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('member', item->>'member', 'shares', item->>'shares')
                ORDER BY item->>'member' COLLATE "C"), '[]'::jsonb)
            INTO expected_changes FROM jsonb_array_elements(NEW.members) item;
        IF opening.uuid IS NULL OR (opening.operation_id = NEW.uuid AND (opening.sequence <> 1
            OR opening.corrects_id IS NOT NULL OR opening.previous_hash <> repeat('0', 64)
            OR opening.changes IS DISTINCT FROM expected_changes OR opening.effective_on <> NEW.as_at
            OR opening.recorded_by_id IS DISTINCT FROM NEW.reviewed_by_id
            OR NEW.register_sequence IS DISTINCT FROM 1
            OR EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = opening.register_id
                AND e.uuid <> opening.uuid)
            OR (EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.token_id = NEW.token_id AND r.status IN ('approved', 'executing', 'executed', 'failed'))
                OR EXISTS (SELECT 1 FROM tokens_registerinstruction i
                    WHERE i.token_id = NEW.token_id AND i.status = 'applied'))))
        THEN
            RAISE EXCEPTION 'An opening import must record exactly the register''s only entry, with nothing approved'
                USING ERRCODE = '23514';
        END IF;
        IF opening.operation_id <> NEW.uuid AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.former_members) item
            WHERE (item->>'ceased_on')::date >= opening.effective_on)
        THEN
            RAISE EXCEPTION 'Imported former members must have ceased before the register''s opening'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.rejection_reason <> '' OR NEW.register_sequence IS NULL
            OR NEW.asic_issued_total IS DISTINCT FROM imported_total
            OR NEW.asic_member_count IS DISTINCT FROM member_count
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars p
                    LEFT JOIN tokens_registerimport source ON source.uuid = p.source_import_id
                    WHERE p.member_id::text = item->>'member' AND (p.source_import_id = NEW.uuid
                        OR (source.status = 'applied' AND source.as_at > NEW.as_at)
                        OR ((p.source_change_id IS NOT NULL OR p.source_grant_id IS NOT NULL OR p.source_transfer_id IS NOT NULL) AND p.as_at > NEW.as_at))))
        THEN
            RAISE EXCEPTION 'Application must match the ASIC figures and record every member''s particulars'
                USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 OR NEW.register_sequence IS NOT NULL THEN
        RAISE EXCEPTION 'Rejection requires a reason and records no register entry' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_import_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registerimport;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register import decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.register_import_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.register_import_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (length(btrim(NEW.reason)) > 0)
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_import_decision_digest(proposal.uuid, NEW.kind, principal,
            NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_import_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_import_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register import decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_instruction()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    owner bigint;
    item_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register instructions and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF NEW.preparing_appointment_id IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.kind = 'issue' AND (TG_OP = 'INSERT' OR (OLD.status = 'submitted' AND NEW.status = 'applied'))
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item WHERE item ? 'subscription' OR EXISTS (
            SELECT 1 FROM offerings_subscription subscription WHERE subscription.issuance_request_id::text = item->>'request')) THEN
        RAISE EXCEPTION 'Fresh paid ISSUE authority requires its genuine company decision' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.kind = 'issue' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.items) item JOIN tokens_shareissuancerequest request
            ON request.uuid::text = item->>'request' WHERE request.status IN ('draft','submitted','under_review')) THEN
        RAISE EXCEPTION 'New non-paid grants require their retained company decision' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Register instructions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT count(*) INTO item_count FROM jsonb_array_elements(NEW.items);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR owner IS DISTINCT FROM NEW.submitted_by_id OR NEW.kind NOT IN ('issue', 'transfer')
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken t WHERE t.uuid = NEW.token_id
                AND t.company_id = NEW.company_id)
            OR length(btrim(NEW.approving_director)) = 0
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-instructions/' || NEW.uuid
                || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
            OR item_count = 0
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
                WHERE NEW.kind = 'transfer' AND (jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
                OR jsonb_typeof(item->'settlement') IS DISTINCT FROM 'string'
                OR item->>'settlement' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR jsonb_typeof(item->'seller') IS DISTINCT FROM 'string'
                OR item->>'seller' !~ '^0x[0-9a-fA-F]{40}$'
                OR jsonb_typeof(item->'buyer') IS DISTINCT FROM 'string'
                OR item->>'buyer' !~ '^0x[0-9a-fA-F]{40}$'
                OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
                OR item->>'amount' !~ '^[1-9][0-9]{0,77}$'))
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
                WHERE NEW.kind = 'issue' AND (jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
                OR (item ? 'request') = (item ? 'subscription')
                OR jsonb_typeof(COALESCE(item->'request', item->'subscription')) IS DISTINCT FROM 'string'
                OR COALESCE(item->>'request', item->>'subscription')
                    !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR jsonb_typeof(item->'recipient') IS DISTINCT FROM 'string'
                OR item->>'recipient' !~ '^0x[0-9a-fA-F]{40}$'
                OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
                OR item->>'amount' !~ '^[1-9][0-9]{0,77}$'
                OR (item ? 'request' AND NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                    WHERE r.uuid = (item->>'request')::uuid AND r.token_id = NEW.token_id
                    AND r.company_id = NEW.company_id))
                OR (item ? 'subscription' AND NOT EXISTS (SELECT 1 FROM offerings_subscription s
                    JOIN offerings_offering o ON o.uuid = s.offering_id
                    WHERE s.uuid = (item->>'subscription')::uuid AND o.token_id = NEW.token_id
                    AND s.company_id = NEW.company_id))))
            OR item_count <> (SELECT count(DISTINCT
                COALESCE(item->>'request', item->>'subscription', item->>'settlement'))
                FROM jsonb_array_elements(NEW.items) item)
        THEN
            RAISE EXCEPTION 'Register instructions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user = __APP__ OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable register instruction' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' AND EXISTS (SELECT 1 FROM tokens_registerimport i
        JOIN tokens_shareregister r ON r.token_id = i.token_id
        JOIN tokens_registerentry e ON e.register_id = r.uuid AND e.operation_id = i.uuid AND e.kind = 'opening'
        WHERE i.status = 'applied' AND i.token_id = NEW.token_id) THEN
        RAISE EXCEPTION 'A share class opened by an import takes no register instruction until it is on chain'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
            WHERE item ? 'request' AND NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.uuid = (item->>'request')::uuid AND r.status IN ('approved', 'executing', 'executed', 'failed')))
        THEN
            RAISE EXCEPTION 'Application must approve every listed issuance request' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
            WHERE item ? 'settlement' AND (NOT EXISTS (SELECT 1 FROM tokens_swaporder s
                WHERE s.uuid = (item->>'settlement')::uuid AND s.share_token_id = NEW.token_id
                AND s.status = 'completed' AND lower(s.seller_address) = lower(item->>'seller')
                AND lower(s.buyer_address) = lower(item->>'buyer') AND s.share_amount = (item->>'amount')::numeric)
            OR EXISTS (SELECT 1 FROM tokens_registerinstruction other WHERE other.uuid <> NEW.uuid
                AND other.status = 'applied'
                AND other.items @> jsonb_build_array(jsonb_build_object('settlement', item->>'settlement')))))
        THEN
            RAISE EXCEPTION 'Application must cover completed settlements of the class on their terms, once'
                USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_link_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registerwalletlink;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register wallet link decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerwalletlink WHERE uuid = NEW.register_wallet_link_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerwalletlink WHERE uuid = NEW.register_wallet_link_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_link_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_link_decision_digest(proposal.uuid, NEW.kind, principal,
            NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_link_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_link_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register wallet link decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_member()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Register member references cannot be rewritten or deleted' USING ERRCODE = '23514';
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_member_particulars()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    proposal tokens_registerparticularschange;
    source tokens_registerimport;
BEGIN
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) THEN
        RAISE EXCEPTION 'Only the register''s own commands write member particulars' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(current_setting('app.company_operation', true), '') <> '' THEN
            RAISE EXCEPTION 'Only the retention purge removes member particulars' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = OLD.member_id AND position.shares > 0)
            OR tokens_register_member_left_on(OLD.member_id) IS NULL
            OR tokens_register_member_left_on(OLD.member_id) >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 2557 THEN
            RAISE EXCEPTION 'Member particulars retain the actual exit clock and continued membership' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD.member_id IS DISTINCT FROM NEW.member_id OR OLD.as_at > NEW.as_at) THEN
        RAISE EXCEPTION 'Member particulars stay with their member and never move to an earlier date'
            USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NEW.source_transfer_id IS NOT NULL THEN
        IF TG_OP <> 'INSERT' OR principal IS NULL OR NOT EXISTS (
            SELECT 1 FROM tokens_registertransfer transfer_record JOIN tokens_registertransferdecision decision ON decision.register_transfer_id = transfer_record.uuid
            WHERE transfer_record.uuid = NEW.source_transfer_id AND transfer_record.new_particulars AND transfer_record.status = 'submitted'
                AND transfer_record.to_member = NEW.member_id AND transfer_record.name = NEW.name AND transfer_record.residential_address = NEW.residential_address
                AND transfer_record.to_particulars IS NULL AND NEW.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date
                AND decision.kind = 'apply' AND decision.decided_by_id = principal
                AND current_setting('app.company_id', true) = transfer_record.company_id::text
                AND current_setting('app.company_operation', true) = 'register_transfer_apply'
                AND tokens_register_transfer_approved(transfer_record.uuid, clock_timestamp())
                AND tokens_register_appointment_current(decision.appointment_id, transfer_record.company_id, principal, 'apply', clock_timestamp()))
        THEN RAISE EXCEPTION 'Transfer particulars require the exact company application and original absence' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.source_grant_id IS NOT NULL THEN
        IF TG_OP <> 'INSERT' OR principal IS NULL OR NOT EXISTS (
            SELECT 1 FROM tokens_registergrant grant_record JOIN tokens_registergrantdecision decision ON decision.register_grant_id = grant_record.uuid
            WHERE grant_record.uuid = NEW.source_grant_id AND grant_record.new_member AND grant_record.status = 'submitted'
                AND grant_record.member = NEW.member_id AND grant_record.name = NEW.name AND grant_record.residential_address = NEW.residential_address
                AND NEW.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date AND decision.kind = 'apply' AND decision.decided_by_id = principal
                AND current_setting('app.company_id', true) = grant_record.company_id::text
                AND current_setting('app.company_operation', true) = 'register_grant_apply'
                AND tokens_register_grant_approved(grant_record.uuid, clock_timestamp())
                AND tokens_register_appointment_current(decision.appointment_id, grant_record.company_id, principal, 'apply', clock_timestamp()))
        THEN RAISE EXCEPTION 'Grant particulars require the exact company application' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.source_change_id IS NULL THEN
        SELECT * INTO source FROM tokens_registerimport WHERE uuid = NEW.source_import_id;
        IF principal IS NULL OR source.uuid IS NULL
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_apply'
            OR current_setting('app.company_id', true) IS DISTINCT FROM source.company_id::text
            OR source.status <> 'submitted' OR NEW.as_at IS DISTINCT FROM source.as_at
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(source.members) item
                WHERE item->>'member' = NEW.member_id::text AND item->>'name' = NEW.name
                    AND item->>'residential_address' = NEW.residential_address)
            OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision
                WHERE decision.register_import_id = source.uuid AND decision.kind = 'apply'
                    AND decision.decided_by_id = principal)
        THEN
            RAISE EXCEPTION 'Imported particulars come only from the company''s application of that import'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.source_change_id;
    IF principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted'
        OR NEW.member_id IS DISTINCT FROM proposal.member_id OR NEW.name IS DISTINCT FROM proposal.name
        OR NEW.residential_address IS DISTINCT FROM proposal.residential_address
        OR NEW.as_at IS DISTINCT FROM proposal.as_at
        OR NOT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
            WHERE decision.register_particulars_change_id = proposal.uuid AND decision.kind = 'apply'
                AND decision.decided_by_id = principal)
    THEN
        RAISE EXCEPTION 'Particulars from a change come only from the company''s application of that change'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_member_wallet()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register wallet links are immutable identity records' USING ERRCODE = '23514';
    END IF;
    IF NEW.address !~ '^0x[0-9a-fA-F]{40}$'
        OR NOT EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid = NEW.member_id
            AND m.company_id = NEW.company_id)
        OR EXISTS (SELECT 1 FROM tokens_registermemberwallet w WHERE w.company_id = NEW.company_id
            AND lower(w.address) = lower(NEW.address) AND w.uuid <> NEW.uuid)
    THEN
        RAISE EXCEPTION 'Register wallet links bind one member of the company to one address' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_opening()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    share_class tokens_sharetoken;
    head tokens_shareregister;
    applied tokens_registerentry;
    principal bigint;
    at_time timestamptz;
    authority_copy tokens_registerevidence;
    expected_changes jsonb;
    mapping_count bigint;
    holdings_count bigint;
    pair_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain opening proposals and their authority evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO authority_copy FROM tokens_registerevidence WHERE uuid = NEW.authority_evidence_id;
        SELECT * INTO share_class FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_opening_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> '' OR NEW.boundary IS NULL
            OR share_class.uuid IS NULL OR share_class.company_id IS DISTINCT FROM NEW.company_id
            OR share_class.status NOT IN ('deployed', 'paused')
            OR EXISTS (SELECT 1 FROM tokens_shareregister r WHERE r.token_id = NEW.token_id
                AND EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = r.uuid))
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-openings/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR authority_copy.uuid IS NULL OR authority_copy.company_id <> NEW.company_id
            OR authority_copy.kind <> 'authority' OR authority_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM authority_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(authority_copy)
            OR jsonb_typeof(NEW.mapping) <> 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'member')
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR mapping_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.mapping) item)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermember m ON m.uuid::text = item->>'member'
                WHERE m.company_id IS DISTINCT FROM NEW.company_id)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermemberwallet w ON w.company_id = NEW.company_id
                    AND lower(w.address) = lower(item->>'address')
                WHERE w.member_id::text IS DISTINCT FROM item->>'member')
        THEN
            RAISE EXCEPTION 'Opening preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.boundary) IS DISTINCT FROM 'object'
            OR EXISTS (SELECT 1 FROM (VALUES
                (ARRAY['version'], 'number'),
                (ARRAY['token'], 'string'),
                (ARRAY['company'], 'string'),
                (ARRAY['deployment'], 'string'),
                (ARRAY['chain_id'], 'number'),
                (ARRAY['contract_address'], 'string'),
                (ARRAY['deployment_transaction'], 'string'),
                (ARRAY['deployment_block'], 'number'),
                (ARRAY['deployment_hash'], 'string'),
                (ARRAY['block'], 'object'),
                (ARRAY['block', 'number'], 'number'),
                (ARRAY['block', 'hash'], 'string'),
                (ARRAY['block', 'timestamp'], 'number'),
                (ARRAY['block', 'date'], 'string'),
                (ARRAY['policy'], 'object'),
                (ARRAY['policy', 'version'], 'number'),
                (ARRAY['policy', 'mode'], 'string'),
                (ARRAY['authorized_supply'], 'string'),
                (ARRAY['issued_supply'], 'string'),
                (ARRAY['holdings'], 'array')
            ) AS required(path, kind)
                WHERE jsonb_typeof(NEW.boundary #> required.path) IS DISTINCT FROM required.kind)
        THEN
            RAISE EXCEPTION 'The captured boundary requires complete typed snapshot provenance'
                USING ERRCODE = '23514';
        END IF;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        SELECT count(*) INTO holdings_count FROM jsonb_array_elements(NEW.boundary->'holdings');
        SELECT count(*) INTO pair_count FROM jsonb_array_elements(NEW.mapping) m(item)
            JOIN jsonb_array_elements(NEW.boundary->'holdings') h(item)
            ON lower(h.item->>'address') = lower(m.item->>'address');
        IF COALESCE(NEW.boundary->>'version', '') <> '1'
            OR NEW.boundary->>'token' IS DISTINCT FROM NEW.token_id::text
            OR NEW.boundary->>'company' IS DISTINCT FROM NEW.company_id::text
            OR NEW.boundary->>'deployment' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR NEW.boundary->>'contract_address' !~ '^0x[0-9a-fA-F]{40}$'
            OR NEW.boundary->>'deployment_transaction' !~ '^0x[0-9a-f]{64}$'
            OR NEW.boundary->>'deployment_hash' !~ '^0x[0-9a-f]{64}$'
            OR NEW.boundary->>'deployment_block' !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->>'chain_id', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'number', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'hash', '') !~ '^0x[0-9a-f]{64}$'
            OR COALESCE(NEW.boundary->'block'->>'timestamp', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            OR NEW.boundary->'policy'->>'version' <> '1'
            OR COALESCE(NEW.boundary->'policy'->>'mode', '') NOT IN ('finalized', 'depth')
            OR (NEW.boundary->'policy'->>'mode' = 'depth') <> (NEW.boundary->'policy' ? 'depth')
            OR (NEW.boundary->'policy'->>'mode' = 'depth' AND (
                jsonb_typeof(NEW.boundary->'policy'->'depth') IS DISTINCT FROM 'number'
                OR COALESCE(NEW.boundary->'policy'->>'depth', '') !~ '^[1-9][0-9]*$'))
            OR COALESCE(NEW.boundary->>'authorized_supply', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->>'issued_supply', 'x') !~ '^[0-9]+$'
            OR (CASE WHEN COALESCE(NEW.boundary->>'issued_supply', '') ~ '^[0-9]+$'
                     AND COALESCE(NEW.boundary->>'authorized_supply', '') ~ '^[0-9]+$'
                THEN (NEW.boundary->>'issued_supply')::numeric > (NEW.boundary->>'authorized_supply')::numeric
                ELSE FALSE END)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.boundary->'holdings') item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string'
                OR COALESCE(item->>'address', '') !~ '^0x[0-9a-fA-F]{40}$'
                OR COALESCE(item->>'shares', '') !~ '^[1-9][0-9]*$')
            OR (CASE WHEN COALESCE(NEW.boundary->>'issued_supply', '') ~ '^[0-9]+$'
                THEN (SELECT COALESCE(sum((item->>'shares')::numeric), 0)
                    FROM jsonb_array_elements(NEW.boundary->'holdings') item)
                    IS DISTINCT FROM (NEW.boundary->>'issued_supply')::numeric
                ELSE FALSE END)
            OR holdings_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.boundary->'holdings') item)
            OR pair_count <> mapping_count OR pair_count <> holdings_count
        THEN
            RAISE EXCEPTION 'The captured boundary must bind this share class and its mapped holders exactly'
                USING ERRCODE = '23514';
        END IF;
        IF (NEW.boundary->>'chain_id')::numeric > 9223372036854775807
            OR (NEW.boundary->>'deployment_block')::numeric > (NEW.boundary->'block'->>'number')::numeric
            OR (NEW.boundary->'block'->>'number')::numeric > 9223372036854775807
            OR (NEW.boundary->'block'->>'timestamp')::numeric > 9223372036854775807
            OR (NEW.boundary->'policy'->>'depth')::numeric > 9223372036854775807
            OR (NEW.boundary->>'authorized_supply')::numeric >
                115792089237316195423570985008687907853269984665640564039457584007913129639935
            OR (NEW.boundary->'block'->>'date')::date IS DISTINCT FROM
                (to_timestamp((NEW.boundary->'block'->>'timestamp')::double precision) AT TIME ZONE 'UTC')::date
        THEN
            RAISE EXCEPTION 'The captured boundary must preserve valid chain quantities and its UTC date'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
            OR NEW.boundary IS DISTINCT FROM OLD.boundary
            OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
                'applied_entry_id', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
                'applied_entry_id', 'updated_at'])
            OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR NOT EXISTS (SELECT 1 FROM tokens_registeropeningdecision decision
                WHERE decision.register_opening_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                    AND decision.decided_at = NEW.reviewed_at
                    AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                    AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        THEN
            RAISE EXCEPTION 'Only the exact company decision may decide an immutable opening'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            SELECT * INTO head FROM tokens_shareregister WHERE token_id = NEW.token_id;
            SELECT * INTO applied FROM tokens_registerentry WHERE uuid = NEW.applied_entry_id;
            SELECT COALESCE(
                       jsonb_agg(jsonb_build_object('member', agg.member, 'shares', agg.total::text) ORDER BY agg.member),
                       '[]'::jsonb)
                INTO expected_changes
                FROM (SELECT m.item->>'member' AS member, sum((h.item->>'shares')::numeric) AS total
                    FROM jsonb_array_elements(NEW.mapping) m(item)
                    JOIN jsonb_array_elements(NEW.boundary->'holdings') h(item)
                    ON lower(h.item->>'address') = lower(m.item->>'address')
                    GROUP BY m.item->>'member') agg;
            IF NEW.boundary IS NULL OR head.uuid IS NULL OR applied.uuid IS NULL
                OR applied.register_id <> head.uuid OR head.company_id IS DISTINCT FROM NEW.company_id
                OR head.sequence <> 1 OR applied.sequence <> 1
                OR applied.kind <> 'opening' OR applied.operation_id <> NEW.uuid
                OR applied.corrects_id IS NOT NULL
                OR applied.changes IS DISTINCT FROM expected_changes
                OR applied.effective_on <> (NEW.boundary->'block'->>'date')::date
                OR applied.recorded_by_id <> NEW.reviewed_by_id
                OR applied.previous_hash <> repeat('0', 64)
                OR NEW.rejection_reason <> ''
                OR EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = head.uuid
                    AND e.uuid <> applied.uuid)
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                    WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet w
                        WHERE w.company_id = NEW.company_id AND lower(w.address) = lower(item->>'address')
                        AND w.member_id::text = item->>'member'))
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                    WHERE NOT EXISTS (SELECT 1 FROM tokens_registermember m2
                        WHERE m2.uuid::text = item->>'member' AND m2.company_id = NEW.company_id))
            THEN
                RAISE EXCEPTION 'Application must initialise the register from its captured boundary'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.applied_entry_id IS NOT NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
            RAISE EXCEPTION 'Rejection requires a reason and no applied entry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_opening_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registeropening;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register opening decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registeropening WHERE uuid = NEW.register_opening_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registeropening WHERE uuid = NEW.register_opening_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_opening_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (length(btrim(NEW.reason)) > 0)
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_opening_decision_digest(proposal.uuid, NEW.kind, principal,
            NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_opening_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_opening_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register opening decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_opening_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    history jsonb;
    entries bigint;
BEGIN
    IF NEW.boundary IS NULL
        OR (OLD.boundary IS NOT NULL AND (OLD.status <> 'submitted' OR NEW.status <> 'applied')) THEN
        RETURN NEW;
    END IF;
    history := NEW.boundary->'history';
    IF jsonb_typeof(history) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The captured boundary requires its canonical transfer history' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO entries FROM jsonb_array_elements(history);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(history) item
            WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
            OR jsonb_typeof(item->'block') IS DISTINCT FROM 'number'
            OR item->>'block' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(item->'block_hash') IS DISTINCT FROM 'string'
            OR item->>'block_hash' !~ '^0x[0-9a-f]{64}$'
            OR jsonb_typeof(item->'transaction') IS DISTINCT FROM 'string'
            OR item->>'transaction' !~ '^0x[0-9a-f]{64}$'
            OR (item->>'block')::numeric < (NEW.boundary->>'deployment_block')::numeric
            OR (item->>'block')::numeric > (NEW.boundary->'block'->>'number')::numeric
            OR ((item->>'block')::numeric = (NEW.boundary->>'deployment_block')::numeric
                AND item->>'block_hash' IS DISTINCT FROM NEW.boundary->>'deployment_hash')
            OR ((item->>'block')::numeric = (NEW.boundary->'block'->>'number')::numeric
                AND item->>'block_hash' IS DISTINCT FROM NEW.boundary->'block'->>'hash'))
        OR entries <> (SELECT count(DISTINCT (item->>'block') || ':' || (item->>'transaction'))
            FROM jsonb_array_elements(history) item)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(history) item
            GROUP BY item->>'block' HAVING count(DISTINCT item->>'block_hash') > 1)
    THEN
        RAISE EXCEPTION 'The captured boundary history requires exact canonical blocks and transactions'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_opening_mapping_values()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF jsonb_typeof(NEW.mapping) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
        WHERE jsonb_typeof(item) = 'object'
        AND (jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
            OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string'))
    THEN
        RAISE EXCEPTION 'Opening submissions require exact current intent and verified company evidence'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_particulars_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    supporting_copy tokens_registerevidence;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain particulars changes and their supporting evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO supporting_copy FROM tokens_registerevidence WHERE uuid = NEW.supporting_evidence_id;
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> ''
            OR NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = NEW.member_id
                AND member.company_id = NEW.company_id)
            OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR NEW.reason !~ '[^[:space:]]' OR NEW.as_at > current_date
            OR supporting_copy.uuid IS NULL OR supporting_copy.company_id <> NEW.company_id
            OR supporting_copy.kind <> 'supporting' OR supporting_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM supporting_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(supporting_copy)
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-particulars/' || NEW.uuid
                || '/[0-9a-f-]{36}[.]bin$')
        THEN
            RAISE EXCEPTION 'Particulars changes require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
            WHERE decision.register_particulars_change_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable particulars change'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars held
            WHERE held.member_id = NEW.member_id AND held.source_change_id = NEW.uuid AND held.name = NEW.name
                AND held.residential_address = NEW.residential_address AND held.as_at = NEW.as_at)
        THEN
            RAISE EXCEPTION 'Application must record the change''s particulars for its member'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.rejection_reason !~ '[^[:space:]]' THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_particulars_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registerparticularschange;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register particulars decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.register_particulars_change_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.register_particulars_change_id
        FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_particulars_decision_digest(proposal.uuid, NEW.kind,
            principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_particulars_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_particulars_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register particulars decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_position()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Only register entries may change holdings' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_reconciliation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain register reconciliations as recorded' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.discrepancies) IS DISTINCT FROM 'array'
        OR NEW.status NOT IN ('matched', 'discrepant', 'failed')
        OR (NEW.status IN ('matched', 'discrepant') AND (
            NEW.block_number IS NULL OR NEW.block_hash !~ '^0x[0-9a-f]{64}$' OR NEW.register_sequence IS NULL
            OR NEW.failure <> '' OR (jsonb_array_length(NEW.discrepancies) = 0) <> (NEW.status = 'matched')))
        OR (NEW.status = 'failed' AND (
            NEW.block_number IS NOT NULL OR NEW.block_hash <> '' OR jsonb_array_length(NEW.discrepancies) <> 0
            OR length(btrim(NEW.failure)) = 0))
    THEN
        RAISE EXCEPTION 'A register reconciliation records a result consistent with its status'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_transfer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Register transfers retain authority, instruments and history' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id AND company_id = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NOT FOUND
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'A register transfer requires its exact current company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.register_entry_id IS NOT NULL OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NEW.shares <= 0 OR NEW.shares <> trunc(NEW.shares) OR NEW.shares >= 2::numeric^256 OR NEW.from_member = NEW.to_member
            OR NEW.signed_on > NEW.lodged_on OR NEW.lodged_on > (clock_timestamp() AT TIME ZONE 'UTC')::date
            OR NEW.authority <> 'director_resolution' OR NEW.approving_director !~ '[^[:space:]]'
            OR NEW.name !~ '[^[:space:]]' OR NEW.from_name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR NEW.from_residential_address !~ '[^[:space:]]' OR length(NEW.residential_address) > 1000
            OR NEW.terms !~ '[^[:space:]]' OR NEW.authority_reference !~ '[^[:space:]]' OR NEW.reason !~ '[^[:space:]]'
            OR NEW.from_particulars IS NULL OR NEW.from_particulars->>'name' IS DISTINCT FROM NEW.from_name
            OR NEW.from_particulars->>'residential_address' IS DISTINCT FROM NEW.from_residential_address
            OR NEW.new_particulars IS DISTINCT FROM (NEW.to_particulars IS NULL) OR (NEW.new_member AND NOT NEW.new_particulars)
            OR (NOT NEW.new_particulars AND (NEW.to_particulars->>'name' IS DISTINCT FROM NEW.name OR NEW.to_particulars->>'residential_address' IS DISTINCT FROM NEW.residential_address))
            OR NOT tokens_register_transfer_ready(NEW, true)
            OR NOT tokens_register_transfer_evidence_matches(NEW.authority_evidence_id, NEW.company_id, principal, 'authority', NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, NEW.uuid)
            OR NOT tokens_register_transfer_evidence_matches(NEW.instrument_evidence_id, NEW.company_id, principal, 'supporting', NEW.instrument_fingerprint, NEW.instrument_snapshot, NEW.instrument_file, NEW.uuid)
        THEN RAISE EXCEPTION 'A direct transfer needs exact company identities, authority and signed instrument' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
        OR (to_jsonb(NEW) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
        OR NOT EXISTS (SELECT 1 FROM tokens_registertransferdecision decision WHERE decision.register_transfer_id = NEW.uuid
            AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
            AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal,
                CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'approve' END, clock_timestamp())
            AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NOT tokens_register_transfer_approved(NEW.uuid, clock_timestamp()) OR NOT EXISTS (
            SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            WHERE entry.uuid = NEW.register_entry_id AND register.token_id = NEW.token_id AND entry.operation_id = NEW.uuid
                AND entry.kind = 'transfer' AND entry.recorded_by_id = principal
                AND entry.effective_on = (entry.created_at AT TIME ZONE 'UTC')::date AND entry.changes = tokens_register_transfer_changes(NEW))))
        OR (NEW.status = 'rejected' AND (NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]'))
    THEN RAISE EXCEPTION 'Only its exact company decision may decide an immutable register transfer' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_transfer_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint; at_time timestamptz; proposal tokens_registertransfer;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Register transfer decisions are append-only' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint; at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal OR proposal.status <> 'submitted'
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR NEW.kind NOT IN ('approve', 'apply', 'reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_transfer_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal, CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_transfer_ready(proposal, true))
    THEN RAISE EXCEPTION 'Register transfer decisions need exact current company authority and effect' USING ERRCODE = '23514'; END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_wallet_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    authority_copy tokens_registerevidence;
    mapping_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain wallet link requests and their authority evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.mapping) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Wallet link preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO authority_copy FROM tokens_registerevidence WHERE uuid = NEW.authority_evidence_id;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_link_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> ''
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-links/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR authority_copy.uuid IS NULL OR authority_copy.company_id <> NEW.company_id
            OR authority_copy.kind <> 'authority' OR authority_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM authority_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(authority_copy)
            OR mapping_count = 0
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'member')
                OR jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string'
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR mapping_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.mapping) item)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermember m ON m.uuid::text = item->>'member'
                WHERE m.company_id IS DISTINCT FROM NEW.company_id)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermemberwallet w ON w.company_id = NEW.company_id
                    AND lower(w.address) = lower(item->>'address'))
        THEN
            RAISE EXCEPTION 'Wallet link preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerwalletlinkdecision decision
            WHERE decision.register_wallet_link_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable wallet link'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
            WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet w
                WHERE w.company_id = NEW.company_id AND lower(w.address) = lower(item->>'address')
                AND w.member_id::text = item->>'member')
            OR NOT EXISTS (SELECT 1 FROM tokens_registermember m
                WHERE m.uuid::text = item->>'member' AND m.company_id = NEW.company_id))
        THEN
            RAISE EXCEPTION 'Application must link every mapped wallet to its member' USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_registered_class()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
        AND EXISTS (SELECT 1 FROM tokens_shareregister WHERE token_id = OLD.uuid) THEN
        RAISE EXCEPTION 'A registered share class cannot move to another company' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_share_register()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id AND company_id = NEW.company_id FOR KEY SHARE;
        IF NOT FOUND OR NEW.sequence <> 0 OR NEW.issued_supply <> 0 OR NEW.head_hash <> repeat('0', 64) THEN
            RAISE EXCEPTION 'A register must start empty for its own company and share class' USING ERRCODE = '23514';
        END IF;
    ELSIF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Only register entries may advance the register' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_trading_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_trading_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_trading_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_trading_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_trading_swap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_transfer_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_apply' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM tokens_registertransfer proposal JOIN tokens_registertransferdecision decision ON decision.register_transfer_id = proposal.uuid
        WHERE proposal.to_member = NEW.uuid AND proposal.new_member AND proposal.company_id = NEW.company_id AND proposal.status = 'submitted'
            AND decision.kind = 'apply' AND decision.decided_by_id = principal AND current_setting('app.company_id', true) = NEW.company_id::text
            AND tokens_register_transfer_ready(proposal, true) AND tokens_register_transfer_approved(proposal.uuid, clock_timestamp())
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A new transfer member needs its exact company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_transfer_register_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registertransfer; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.operation_id;
    IF proposal.uuid IS NULL AND current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_apply'
        AND NOT (NEW.kind IN ('transfer', 'cessation') AND EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL)) THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text OR proposal.company_id IS DISTINCT FROM issuer
        OR proposal.token_id IS DISTINCT FROM token_uuid OR proposal.status <> 'submitted' OR NEW.kind <> 'transfer' OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR NEW.effective_on IS DISTINCT FROM (NEW.created_at AT TIME ZONE 'UTC')::date
        OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.changes IS DISTINCT FROM tokens_register_transfer_changes(proposal)
        OR NOT tokens_register_transfer_ready(proposal, false) OR NOT tokens_register_transfer_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registertransferdecision decision WHERE decision.register_transfer_id = proposal.uuid AND decision.kind = 'apply'
            AND decision.decided_by_id = principal AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A direct transfer entry needs its exact current company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_keep_trading_issuer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_lock_pending_trading_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user <> __MIGRATE__ THEN
        PERFORM 1 FROM public.tokens_sharetoken WHERE uuid = NEW.token_id FOR NO KEY UPDATE;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_lock_trading_admission(command jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_modification_changes(old_quantity bigint, old_minimum bigint, old_price numeric, new_quantity bigint, new_minimum bigint, new_price numeric)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('field', field, 'old', old_value, 'new', new_value) ORDER BY position), '[]'::jsonb)
    FROM (VALUES (1, 'quantity', old_quantity::text, new_quantity::text),
                 (2, 'min_quantity', old_minimum::text, new_minimum::text),
                 (3, 'price_per_share', old_price::text, new_price::text)) changes(position, field, old_value, new_value)
    WHERE old_value IS DISTINCT FROM new_value;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_order_action_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issued signing_challenges%ROWTYPE;
    target tokens_transferorder%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Order action identities cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
        RAISE EXCEPTION 'An order action must start pending' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.action_id, NEW.protocol_version, NEW.purpose, NEW.owner_account_id,
               NEW.order_id, NEW.wallet_id, NEW.token_id, NEW.initiated_by_id, NEW.wallet_address,
               NEW.chain_id, NEW.verifying_contract, NEW.token_metadata, NEW.review_values,
               NEW.new_quantity, NEW.new_min_quantity, NEW.new_price_per_share, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.uuid, OLD.action_id, OLD.protocol_version, OLD.purpose, OLD.owner_account_id,
               OLD.order_id, OLD.wallet_id, OLD.token_id, OLD.initiated_by_id, OLD.wallet_address,
               OLD.chain_id, OLD.verifying_contract, OLD.token_metadata, OLD.review_values,
               OLD.new_quantity, OLD.new_min_quantity, OLD.new_price_per_share, OLD.created_at) THEN
            RAISE EXCEPTION 'Order action intent cannot be rewritten' USING ERRCODE = '23514';
        END IF;
        IF OLD.status <> 'pending' AND
           ROW(NEW.status, NEW.executed_challenge_id, NEW.executed_by_id, NEW.result,
               NEW.refusal_code, NEW.refusal_detail, NEW.refusal_status, NEW.resolved_at)
           IS DISTINCT FROM
           ROW(OLD.status, OLD.executed_challenge_id, OLD.executed_by_id, OLD.result,
               OLD.refusal_code, OLD.refusal_detail, OLD.refusal_status, OLD.resolved_at) THEN
            RAISE EXCEPTION 'An order action outcome cannot be rewritten' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status <> 'pending') THEN
        SELECT * INTO target FROM tokens_transferorder WHERE uuid = NEW.order_id;
        IF NOT FOUND OR
           ROW(target.owner_account_id, target.wallet_id, target.token_id, lower(target.wallet_address))
           IS DISTINCT FROM
           ROW(NEW.owner_account_id, NEW.wallet_id, NEW.token_id, lower(NEW.wallet_address)) THEN
            RAISE EXCEPTION 'An order action must bind its owned order identity' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status <> 'pending' THEN
        SELECT * INTO issued FROM signing_challenges WHERE uuid = NEW.executed_challenge_id;
        IF NOT FOUND OR issued.action_id IS DISTINCT FROM NEW.uuid OR issued.consumed_at IS NULL
           OR issued.purpose IS DISTINCT FROM ('order_' || NEW.purpose) THEN
            RAISE EXCEPTION 'An order action outcome requires its spent challenge' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            IF jsonb_typeof(NEW.result) IS DISTINCT FROM 'object'
               OR NEW.result->>'kind' IS DISTINCT FROM NEW.purpose THEN
                RAISE EXCEPTION 'An applied action requires its original result' USING ERRCODE = '23514';
            END IF;
            IF NEW.purpose = 'cancel' AND (
                target.status <> 'cancelled' OR NEW.result->>'to_status' IS DISTINCT FROM 'cancelled'
                OR COALESCE(NEW.result->>'from_status', '') NOT IN ('open', 'partially_filled', 'held')
            ) THEN
                RAISE EXCEPTION 'A cancellation result requires the order transition' USING ERRCODE = '23514';
            END IF;
            IF NEW.purpose = 'modify' AND (
                ROW(target.quantity, target.min_quantity, target.price_per_share)
                IS DISTINCT FROM ROW(NEW.new_quantity, NEW.new_min_quantity, NEW.new_price_per_share)
                OR NEW.result->>'modification_count' IS DISTINCT FROM target.modification_count::text
                OR jsonb_typeof(NEW.result->'changes') IS DISTINCT FROM 'array'
            ) THEN
                RAISE EXCEPTION 'A modification result requires its exact replacement values' USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_order_owner_identity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF ROW(NEW.uuid, NEW.owner_account_id, NEW.wallet_id, lower(NEW.wallet_address))
       IS DISTINCT FROM ROW(OLD.uuid, OLD.owner_account_id, OLD.wallet_id, lower(OLD.wallet_address)) THEN
        RAISE EXCEPTION 'An order owner identity cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_order_submission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    issued signing_challenges%ROWTYPE;
    placed tokens_transferorder%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Order submission identities cannot be deleted' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status <> 'pending' THEN
        RAISE EXCEPTION 'An order submission must start pending' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.submission_id, NEW.owner_account_id, NEW.wallet_id, NEW.token_id,
               NEW.initiated_by_id, NEW.intent_version, NEW.wallet_address, NEW.order_type,
               NEW.quantity, NEW.min_quantity, NEW.price_per_share, NEW.chain_id,
               NEW.verifying_contract, NEW.token_metadata, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.uuid, OLD.submission_id, OLD.owner_account_id, OLD.wallet_id, OLD.token_id,
               OLD.initiated_by_id, OLD.intent_version, OLD.wallet_address, OLD.order_type,
               OLD.quantity, OLD.min_quantity, OLD.price_per_share, OLD.chain_id,
               OLD.verifying_contract, OLD.token_metadata, OLD.created_at) THEN
            RAISE EXCEPTION 'Order submission intent cannot be rewritten' USING ERRCODE = '23514';
        END IF;
        IF OLD.status <> 'pending' AND
           ROW(NEW.status, NEW.order_id, NEW.executed_challenge_id, NEW.initial_counter_order_id,
               NEW.initial_swap_id, NEW.refusal_code, NEW.refusal_detail, NEW.resolved_at)
           IS DISTINCT FROM
           ROW(OLD.status, OLD.order_id, OLD.executed_challenge_id, OLD.initial_counter_order_id,
               OLD.initial_swap_id, OLD.refusal_code, OLD.refusal_detail, OLD.resolved_at) THEN
            RAISE EXCEPTION 'A resolved order submission cannot change outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status <> 'pending' THEN
        SELECT * INTO issued FROM signing_challenges WHERE uuid = NEW.executed_challenge_id;
        IF NOT FOUND OR issued.submission_id IS DISTINCT FROM NEW.uuid
           OR issued.consumed_at IS NULL OR issued.purpose <> 'order_create' THEN
            RAISE EXCEPTION 'An order submission outcome requires its spent challenge' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'created' THEN
            SELECT * INTO placed FROM tokens_transferorder WHERE uuid = NEW.order_id;
            IF NOT FOUND OR
               ROW(placed.owner_account_id, placed.wallet_id, placed.token_id, placed.wallet_address,
                   placed.order_type, placed.quantity, placed.min_quantity, placed.price_per_share)
               IS DISTINCT FROM
               ROW(NEW.owner_account_id, NEW.wallet_id, NEW.token_id, NEW.wallet_address,
                   NEW.order_type, NEW.quantity, NEW.min_quantity, NEW.price_per_share) THEN
                RAISE EXCEPTION 'An order submission must resolve to its original order intent'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.initial_swap_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM tokens_swaporder
                 WHERE uuid = NEW.initial_swap_id
                   AND ((sell_order_id = NEW.order_id AND buy_order_id = NEW.initial_counter_order_id)
                     OR (buy_order_id = NEW.order_id AND sell_order_id = NEW.initial_counter_order_id))
            ) THEN
                RAISE EXCEPTION 'An order submission match must name its original order pair'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_project_register_entry()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    effect jsonb;
    delta numeric;
    total numeric := 0;
BEGIN
    FOR effect IN SELECT value FROM jsonb_array_elements(NEW.changes) LOOP
        delta := (effect->>'shares')::numeric;
        UPDATE tokens_registerposition SET shares = shares + delta,
            entered_on = CASE WHEN shares = 0 THEN NEW.effective_on ELSE entered_on END,
            last_entry_id = NEW.uuid, updated_at = NEW.created_at
            WHERE register_id = NEW.register_id AND member_id = (effect->>'member')::uuid;
        IF NOT FOUND THEN
            INSERT INTO tokens_registerposition
                (uuid, created_at, updated_at, register_id, member_id, shares, entered_on, last_entry_id)
            VALUES (gen_random_uuid(), NEW.created_at, NEW.created_at, NEW.register_id,
                (effect->>'member')::uuid, delta, NEW.effective_on, NEW.uuid);
        END IF;
        total := total + delta;
    END LOOP;
    UPDATE tokens_shareregister SET sequence = NEW.sequence, head_hash = NEW.entry_hash,
        issued_supply = issued_supply + total, updated_at = NEW.created_at WHERE uuid = NEW.register_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_record_member_cessations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE effect jsonb; held numeric; snapshot jsonb; issuer uuid; member_uuid uuid; at_time timestamptz;
BEGIN
    SELECT company_id INTO issuer FROM tokens_shareregister WHERE uuid = NEW.register_id;
    IF NOT EXISTS (SELECT 1 FROM tokens_shareregister register JOIN tokens_sharetoken token ON token.uuid = register.token_id
        WHERE register.uuid = NEW.register_id AND token.status = 'draft' AND NULLIF(token.contract_address, '') IS NULL
            AND token.deployment_id IS NULL AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL
            AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')) THEN RETURN NEW; END IF;
    at_time := clock_timestamp();
    FOR effect IN SELECT value FROM jsonb_array_elements(NEW.changes) LOOP
        member_uuid := (effect->>'member')::uuid;
        SELECT shares INTO held FROM tokens_registerposition WHERE register_id = NEW.register_id AND member_id = member_uuid;
        snapshot := tokens_register_particulars_snapshot(member_uuid);
        IF COALESCE(held, 0) = 0 AND (effect->>'shares')::numeric > 0 THEN
            UPDATE tokens_registermembercessation SET returned_entry_id = NEW.uuid, returned_on = (at_time AT TIME ZONE 'UTC')::date,
                returned_at = at_time, updated_at = at_time WHERE register_id = NEW.register_id AND member_id = member_uuid AND returned_entry_id IS NULL;
        END IF;
        IF held > 0 AND held + (effect->>'shares')::numeric = 0 AND snapshot IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = issuer AND wallet.member_id = member_uuid) THEN
            INSERT INTO tokens_registermembercessation(uuid, created_at, updated_at, company_id, register_id, member_id, entry_id,
                ceased_on, shares_at_cessation, name, residential_address, identity_source, particulars_snapshot)
            VALUES(gen_random_uuid(), at_time, at_time, issuer, NEW.register_id, member_uuid, NEW.uuid,
                (at_time AT TIME ZONE 'UTC')::date, held, snapshot->>'name', snapshot->>'residential_address', 'particulars', snapshot);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_appointment_current(appointment_uuid uuid, issuer uuid, actor bigint, capability text, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM companies_companyappointment appointment
        JOIN authentication_customuser person ON person.id = appointment.appointee_id
        JOIN users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
            AND profile.user_id = person.id
        JOIN operators_operator configuration ON configuration.id = 1
        WHERE appointment.uuid = appointment_uuid AND appointment.company_id = issuer
            AND appointment.appointee_id = actor AND person.is_active AND person.is_email_verified
            AND (appointment.expires_at IS NULL OR appointment.expires_at > at_time)
            AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation revocation
                WHERE revocation.appointment_id = appointment.uuid)
            AND (NOT configuration.issuer_kyc_required OR profile.is_id_verified)
            AND (appointment.capabilities @> jsonb_build_array('admin')
                OR appointment.capabilities @> jsonb_build_array(capability)));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_capital_approval(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT decision.uuid FROM tokens_registercapitalincreasedecision decision
    JOIN tokens_registercapitalincrease proposal ON proposal.uuid = decision.capital_increase_id
    WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
        AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id, 'approve', GREATEST(at_time, clock_timestamp()))
    ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_capital_approved(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_capital_approval(proposal_uuid, at_time) IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_capital_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('proposal',to_jsonb(proposal),'kind',decision_kind,'actor',actor,
        'appointment',appointment_uuid,'reason',decision_reason,'token',to_jsonb(token),'company',to_jsonb(company),
        'request',to_jsonb(request),'ready',tokens_register_capital_ready(proposal),
        'approval',tokens_register_capital_approval(proposal.uuid,clock_timestamp()))::text,'UTF8')),'hex')
    FROM tokens_registercapitalincrease proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
    JOIN companies_company company ON company.uuid = proposal.company_id JOIN tokens_capitalincreaserequest request ON request.uuid = proposal.request_id
    WHERE proposal.uuid = proposal_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_capital_ready(proposal tokens_registercapitalincrease)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT company.status = 'active' AND token.status IN ('deployed','paused') AND token.chain = 'base' AND token.decimals = 0
        AND token.total_supply ~ '^[0-9]+$' AND token.total_supply::numeric BETWEEN 0 AND 2147483647
        AND request.additional_shares BETWEEN 1 AND 2147483647 AND request.new_authorized_total BETWEEN 1 AND 2147483647
        AND request.new_authorized_total::numeric = token.total_supply::numeric + request.additional_shares
        AND request.company_id = company.uuid AND request.token_id = token.uuid
        AND request.submitted_by_id = proposal.submitted_by_id AND request.submitted_at IS NOT NULL AND request.executed_issuance_id IS NULL
        AND request.purpose ~ '[^[:space:]]' AND request.board_resolution_reference ~ '[^[:space:]]'
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply, 'decimals', token.decimals)
        AND proposal.snapshot->'capital' = jsonb_build_object('prior_authorized_total', token.total_supply,
            'additional_shares', request.additional_shares::text, 'new_authorized_total', request.new_authorized_total::text,
            'purpose', request.purpose, 'board_resolution_reference', request.board_resolution_reference,
            'shareholder_approval_reference', request.shareholder_approval_reference)
        AND proposal.intent->>'token_chain' = token.chain AND proposal.intent->>'to' = lower(token.contract_address)
        AND proposal.intent->>'prior_authorized_total' = token.total_supply
        AND proposal.intent->>'additional_shares' = request.additional_shares::text
        AND proposal.intent->>'new_authorized_total' = request.new_authorized_total::text
        AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$' AND proposal.intent->>'to' ~ '^0x[0-9a-f]{40}$'
        AND proposal.intent->>'value' = '0' AND (proposal.intent->>'chain_id')::bigint IN (31337,84532)
        AND proposal.intent->>'data' = '0xf778e828' || lpad(to_hex(request.new_authorized_total::bigint), 64, '0')
        AND proposal.snapshot->'transaction' = proposal.intent - ARRAY['token_chain','prior_authorized_total','new_authorized_total','additional_shares']
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND evidence.company_id = company.uuid AND evidence.uploaded_by_id = proposal.submitted_by_id AND evidence.kind = 'authority'
        AND evidence.sha256 = proposal.evidence_fingerprint
        AND proposal.evidence_snapshot = jsonb_build_object('provided_by','company','evidence',evidence.uuid,'company',company.uuid,
            'document_type',evidence.kind,'name',evidence.original_filename,'file_size',evidence.file_size,'mime_type',evidence.mime_type,'sha256',evidence.sha256)
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-capital-increases/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
        JOIN tokens_capitalincreaserequest request ON request.uuid = proposal.request_id
        JOIN tokens_registerevidence evidence ON evidence.uuid = proposal.authority_evidence_id
        WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_capital_source_current(proposal_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT proposal.status = 'applied' AND tokens_register_capital_ready(proposal)
        AND approval.capital_increase_id = proposal.uuid AND approval.kind = 'approve'
        AND application.decided_by_id = proposal.reviewed_by_id AND application.decided_at = proposal.reviewed_at
        AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', clock_timestamp())
        AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', clock_timestamp())
        FROM tokens_registercapitalincrease proposal JOIN tokens_registercapitalincreasedecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registercapitalincreasedecision application ON application.capital_increase_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid), false);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_correction_approved(correction_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registercorrectiondecision decision
        JOIN tokens_registercorrection proposal ON proposal.uuid = decision.register_correction_id
        WHERE decision.register_correction_id = correction_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_correction_decision_digest(correction_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'correction', correction_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'register', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('sequence', register.sequence,
            'head', register.head_hash) FROM tokens_shareregister register
            JOIN tokens_registercorrection proposal ON proposal.register_id = register.uuid
            WHERE proposal.uuid = correction_uuid) END)::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_deployment_approval(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT decision.uuid FROM tokens_registerdeploymentdecision decision
        JOIN tokens_registerdeployment proposal ON proposal.uuid = decision.register_deployment_id
        WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time)
        ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_deployment_approved(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_deployment_approval(proposal_uuid, at_time) IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_deployment_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'proposal', to_jsonb(proposal),
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'token', to_jsonb(token), 'company', to_jsonb(company), 'wallet', to_jsonb(wallet),
        'account', to_jsonb(account), 'profile', to_jsonb(profile), 'register', to_jsonb(register),
        'approval', tokens_register_deployment_approval(proposal.uuid, clock_timestamp()))::text, 'UTF8')), 'hex')
    FROM tokens_registerdeployment proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        JOIN companies_company company ON company.uuid = proposal.company_id
        LEFT JOIN wallets wallet ON wallet.uuid::text = proposal.snapshot->'issuer_wallet'->>'uuid'
        LEFT JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
        LEFT JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = proposal_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_deployment_ready(proposal tokens_registerdeployment, before_effect boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
        JOIN wallets wallet ON wallet.uuid::text = proposal.snapshot->'issuer_wallet'->>'uuid'
        JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id AND company.status = 'active'
            AND company.name = proposal.snapshot->'company'->>'name' AND company.acn = proposal.snapshot->'company'->>'acn'
            AND proposal.snapshot->'company'->>'uuid' = company.uuid::text
            AND proposal.snapshot->'token'->>'uuid' = token.uuid::text
            AND proposal.snapshot->'token'->>'name' = token.name AND proposal.intent->>'name' = token.name
            AND proposal.snapshot->'token'->>'symbol' = token.symbol AND proposal.intent->>'symbol' = token.symbol
            AND token.total_supply ~ '^[1-9][0-9]{0,77}$' AND token.total_supply::numeric < 2::numeric^256
            AND proposal.intent->>'authorized_shares' = token.total_supply
            AND proposal.snapshot->'token'->>'authorised_shares' = token.total_supply
            AND proposal.intent->>'identifier' = company.acn || ':' || token.symbol
            AND proposal.snapshot->'token'->>'identifier' = proposal.intent->>'identifier'
            AND token.decimals = 0 AND proposal.intent->>'decimals' = '0' AND proposal.snapshot->'token'->>'decimals' = '0'
            AND wallet.chain = 'base' AND wallet.chain = proposal.snapshot->'issuer_wallet'->>'chain'
            AND lower(wallet.address) = proposal.snapshot->'issuer_wallet'->>'address'
            AND proposal.intent->>'issuer_wallet' = lower(wallet.address)
            AND account.uuid::text = proposal.snapshot->'issuer_wallet'->>'account'
            AND profile.uuid::text = proposal.snapshot->'issuer_wallet'->>'profile'
            AND profile.user_id::text = proposal.snapshot->'issuer_wallet'->>'user'
            AND CASE proposal.snapshot->'issuer_wallet'->>'branch'
                WHEN 'operator' THEN company.operator_wallet_id = wallet.uuid
                WHEN 'owner' THEN company.operator_wallet_id IS NULL AND company.owner_id = profile.user_id
                    AND company.owner_id::text = proposal.snapshot->'company'->>'owner' AND wallet.verification_status = 'VERIFIED'
                ELSE false END
            AND CASE WHEN before_effect THEN token.status = 'draft' AND token.deployment_id IS NULL
                AND NULLIF(token.contract_address, '') IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
                AND token.deployment_transaction_id IS NULL AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL
                ELSE token.status = 'deploying' AND token.deployment_id = proposal.deployment_id END
            AND proposal.snapshot->'register' = CASE WHEN register.uuid IS NULL THEN
                jsonb_build_object('present', false, 'initialized', NULL, 'uuid', NULL, 'sequence', NULL, 'head_hash', NULL, 'issued_supply', NULL)
                ELSE jsonb_build_object('present', true, 'initialized', register.sequence > 0, 'uuid', register.uuid,
                    'sequence', register.sequence, 'head_hash', register.head_hash,
                    'issued_supply', CASE WHEN register.sequence > 0 THEN register.issued_supply::text ELSE NULL END) END
            AND (register.uuid IS NULL OR (register.sequence > 0 AND register.issued_supply = 0))
            AND proposal.intent->>'value' = '0' AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$'
            AND proposal.intent->>'to' ~ '^0x[0-9a-f]{40}$' AND proposal.intent->>'data' ~ '^0x[0-9a-f]+$'
            AND (proposal.intent->>'chain_id')::bigint IN (84532, 31337)
            AND proposal.snapshot->'transaction' = jsonb_build_object('chain_id', proposal.intent->'chain_id',
                'sender', proposal.intent->'sender', 'to', proposal.intent->'to', 'value', proposal.intent->'value', 'data', proposal.intent->'data')
            AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex'));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_deployment_source_current(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerdeployment proposal
        JOIN tokens_registerdeploymentdecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registerdeploymentdecision application ON application.register_deployment_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid AND proposal.status = 'applied'
            AND approval.register_deployment_id = proposal.uuid AND approval.kind = 'approve'
            AND application.decided_by_id = proposal.reviewed_by_id AND application.decided_at = proposal.reviewed_at
            AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', at_time)
            AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_entry_hash(entry tokens_registerentry)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        'ledova-register-v1', entry.uuid, entry.register_id, entry.operation_id,
        entry.sequence, entry.kind, to_char(entry.effective_on, 'YYYY-MM-DD'),
        entry.changes, entry.corrects_id, entry.recorded_by_id, entry.previous_hash,
        to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_entry_preimage(entry tokens_registerentry)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT jsonb_build_array(
        'ledova-register-v1', entry.uuid, entry.register_id, entry.operation_id,
        entry.sequence, entry.kind, to_char(entry.effective_on, 'YYYY-MM-DD'),
        entry.changes, entry.corrects_id, entry.recorded_by_id, entry.previous_hash,
        to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_evidence_snapshot(evidence tokens_registerevidence)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT jsonb_build_object('provided_by', 'company', 'evidence', evidence.uuid::text,
        'company', evidence.company_id::text, 'document_type', evidence.kind, 'name', evidence.original_filename,
        'file_size', evidence.file_size, 'mime_type', evidence.mime_type, 'sha256', evidence.sha256);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_grant_approved(grant_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision
        JOIN tokens_registergrant proposal ON proposal.uuid = decision.register_grant_id
        WHERE proposal.uuid = grant_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_grant_decision_digest(grant_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'grant', to_jsonb(proposal),
        'effective_on', (clock_timestamp() AT TIME ZONE 'UTC')::date,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply,
        'token_status', token.status, 'deployment', token.deployment_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'particulars', (SELECT to_jsonb(held) FROM tokens_registermemberparticulars held
            WHERE held.member_id = proposal.member))::text, 'UTF8')), 'hex')
    FROM tokens_registergrant proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = grant_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_grant_evidence_matches(evidence_uuid uuid, issuer uuid, actor bigint, evidence_kind text, fingerprint text, snapshot jsonb, retained_file text, grant_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerevidence evidence WHERE evidence.uuid = evidence_uuid
        AND evidence.company_id = issuer AND evidence.uploaded_by_id = actor AND evidence.kind = evidence_kind
        AND fingerprint = evidence.sha256 AND snapshot = tokens_register_evidence_snapshot(evidence)
        AND retained_file ~ ('^companies/' || issuer || '/register-grants/' || grant_uuid || '/[0-9a-f-]{36}[.]bin$'));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_grant_ready(proposal tokens_registergrant, before_effect boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id AND token.status = 'draft'
            AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL
            AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL AND register.sequence > 0
            AND token.total_supply ~ '^[1-9][0-9]{0,77}$'
            AND register.issued_supply + proposal.shares <= token.total_supply::numeric
            AND register.issued_supply + proposal.shares < 2::numeric^256
            AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')
            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry WHERE entry.register_id = register.uuid
                AND entry.sequence = register.sequence AND entry.effective_on > (clock_timestamp() AT TIME ZONE 'UTC')::date))
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.name, '[[:space:]]+', ' ', 'g')))
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = proposal.company_id AND wallet.member_id = proposal.member)
        AND CASE WHEN proposal.new_member AND before_effect THEN
            NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.member)
        ELSE EXISTS (SELECT 1 FROM tokens_registermember member JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
            WHERE member.uuid = proposal.member AND member.company_id = proposal.company_id
                AND held.name = proposal.name AND held.residential_address = proposal.residential_address
                AND (NOT proposal.new_member OR (held.source_grant_id = proposal.uuid
                    AND held.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date))) END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_import_approved(import_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision
        JOIN tokens_registerimport proposal ON proposal.uuid = decision.register_import_id
        WHERE decision.register_import_id = import_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_import_decision_digest(import_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'import', import_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'register', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('sequence', register.sequence,
            'head', register.head_hash) FROM tokens_shareregister register
            JOIN tokens_registerimport proposal ON proposal.token_id = register.token_id
            WHERE proposal.uuid = import_uuid) END)::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_issue_approval(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT decision.uuid FROM tokens_registerinstructiondecision decision
        JOIN tokens_registerinstruction proposal ON proposal.uuid = decision.instruction_id
        WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', GREATEST(at_time, clock_timestamp()))
        ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_issue_approved(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_issue_approval(proposal_uuid, at_time) IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_issue_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('proposal', to_jsonb(proposal), 'kind', decision_kind, 'actor', actor,
        'appointment', appointment_uuid, 'reason', decision_reason, 'head', to_jsonb(register),
        'ready', tokens_register_issue_ready(proposal), 'reserved', tokens_register_issue_reserved(proposal.token_id, proposal.request_id),
        'approval', tokens_register_issue_approval(proposal.uuid, clock_timestamp()))::text, 'UTF8')), 'hex')
    FROM tokens_registerinstruction proposal LEFT JOIN tokens_shareregister register ON register.token_id = proposal.token_id WHERE proposal.uuid = proposal_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_issue_ready(proposal tokens_registerinstruction)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT CASE WHEN proposal.paid_subscription_id IS NOT NULL THEN tokens_register_paid_issue_ready(proposal) ELSE COALESCE((SELECT proposal.kind = 'issue' AND proposal.preparing_appointment_id IS NOT NULL
        AND company.status = 'active' AND token.status = 'deployed' AND token.chain = 'base' AND token.decimals = 0
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply::text)
        AND register.sequence > 0 AND register.uuid::text = proposal.snapshot->'register'->>'uuid'
        AND opening.status = 'applied' AND opening.token_id = token.uuid AND opening.company_id = company.uuid
        AND opening.uuid::text = proposal.snapshot->'register'->>'opening' AND opening.applied_entry_id IN (
            SELECT uuid FROM tokens_registerentry WHERE register_id = register.uuid AND kind = 'opening')
        AND NOT EXISTS (SELECT 1 FROM tokens_registerimport imported JOIN tokens_registerentry entry
            ON entry.operation_id = imported.uuid WHERE imported.token_id = token.uuid AND imported.status = 'applied'
                AND entry.kind = 'opening' AND entry.register_id = register.uuid)
        AND nomination.company_id = company.uuid AND whitelist_wallet_nomination_current(nomination)
        AND nomination.snapshot = proposal.snapshot->'private'
        AND approval.company_id = company.uuid AND approval.action = 'add' AND approval.status IN ('confirmed', 'unchanged')
        AND approval.expires_at IS NOT NULL AND approval.expires_at > clock_timestamp()
        AND wallet_source.status = 'applied' AND wallet_source.action = 'add' AND wallet_source.company_id = company.uuid
        AND wallet_source.nomination_id = nomination.uuid AND wallet_source.change_id = approval.uuid
        AND ((proposal.snapshot->'wallet') - 'expires_at') = jsonb_build_object('nomination', nomination.uuid, 'approval', approval.uuid,
            'address', approval.address, 'registry_address', approval.registry_address, 'chain_id', approval.chain_id,
            'proof_completed_at', nomination.snapshot->>'proof_completed_at', 'eligibility_expires_at', nomination.snapshot->>'eligibility_expires_at')
        AND EXISTS (SELECT 1 FROM whitelist_whitelistapproval listed JOIN whitelist_whitelistentry entry ON entry.uuid = listed.entry_id
            WHERE listed.company_id = company.uuid AND entry.wallet_id = nomination.wallet_id
                AND listed.registry_address = approval.registry_address AND listed.status = 'active' AND listed.expires_at = approval.expires_at)
        AND (proposal.snapshot->'wallet'->>'expires_at')::timestamptz = approval.expires_at
        AND approval.address = nomination.snapshot->>'address'
        AND member.company_id = company.uuid AND member.uuid::text = proposal.snapshot->'member'->>'uuid'
        AND EXISTS (SELECT 1 FROM tokens_registermemberwallet linked WHERE linked.company_id = company.uuid
            AND linked.member_id = member.uuid AND lower(linked.address) = approval.address)
        AND proposal.snapshot->'member'->>'address' = approval.address
        AND proposal.snapshot->'member'->>'identity_source' = 'profile'
        AND proposal.snapshot->'member'->>'name' = COALESCE(NULLIF(regexp_replace(profile.full_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), actor.email)
        AND proposal.snapshot->'member'->>'residential_address' = regexp_replace(COALESCE(profile.residential_address, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')
        AND regexp_replace(COALESCE(profile.residential_address, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet linked WHERE linked.company_id = company.uuid
            AND linked.member_id = member.uuid AND (SELECT count(*) FROM whitelist_whitelistentry entry
                LEFT JOIN wallets registry_wallet ON registry_wallet.uuid = entry.wallet_id
                WHERE (entry.wallet_id IS NULL OR registry_wallet.chain = 'base')
                    AND lower(COALESCE(registry_wallet.address, entry.address)) = lower(linked.address)) > 1)
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet linked JOIN whitelist_whitelistentry entry ON lower(COALESCE((SELECT address FROM wallets WHERE uuid = entry.wallet_id), entry.address)) = lower(linked.address)
            LEFT JOIN wallets wallet ON wallet.uuid = entry.wallet_id LEFT JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
            LEFT JOIN users_userprofile other_profile ON other_profile.uuid = account.user_profile_id
            LEFT JOIN authentication_customuser other_actor ON other_actor.id = other_profile.user_id
            WHERE linked.company_id = company.uuid AND linked.member_id = member.uuid
                AND (entry.wallet_id IS NULL OR wallet.chain = 'base') AND (
                    wallet.uuid IS NULL OR (account.user_profile_id IS NOT NULL AND (
                        COALESCE(NULLIF(regexp_replace(other_profile.full_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), other_actor.email) IS DISTINCT FROM proposal.snapshot->'member'->>'name'
                        OR regexp_replace(COALESCE(other_profile.residential_address, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') IS DISTINCT FROM proposal.snapshot->'member'->>'residential_address'))))
        AND request.token_id = token.uuid AND request.company_id = company.uuid AND request.amount BETWEEN 1 AND 2147483647
        AND lower(request.recipient_address) = approval.address AND request.recipient_name = proposal.snapshot->'member'->>'name'
        AND proposal.items = jsonb_build_array(jsonb_build_object('request', request.uuid, 'recipient', approval.address, 'amount', request.amount::text))
        AND NOT EXISTS (SELECT 1 FROM offerings_subscription WHERE issuance_request_id = request.uuid)
        AND proposal.terms_on <= (clock_timestamp() AT TIME ZONE 'UTC')::date AND proposal.terms ~ '[^[:space:]]'
        AND proposal.approving_director ~ '[^[:space:]]' AND proposal.reason ~ '[^[:space:]]' AND proposal.authority_reference ~ '[^[:space:]]'
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.snapshot->'member'->>'name', '[[:space:]]+', ' ', 'g')))
        AND proposal.acceptance_required IS NOT NULL
        AND (proposal.acceptance_required = (proposal.acceptance_evidence_id IS NOT NULL))
        AND authority.company_id = company.uuid AND authority.uploaded_by_id = proposal.submitted_by_id AND authority.kind = 'authority'
        AND authority.sha256 = proposal.evidence_fingerprint AND proposal.evidence_snapshot->>'sha256' = authority.sha256
        AND terms.company_id = company.uuid AND terms.uploaded_by_id = proposal.submitted_by_id AND terms.kind = 'supporting'
        AND terms.sha256 = proposal.terms_fingerprint AND proposal.terms_snapshot->>'sha256' = terms.sha256
        AND (proposal.acceptance_required OR (proposal.acceptance_fingerprint IS NULL AND proposal.acceptance_snapshot IS NULL
            AND NULLIF(proposal.acceptance_file, '') IS NULL))
        AND (NOT proposal.acceptance_required OR (acceptance.company_id = company.uuid AND acceptance.uploaded_by_id = proposal.submitted_by_id
            AND acceptance.kind = 'supporting' AND acceptance.sha256 = proposal.acceptance_fingerprint
            AND proposal.acceptance_snapshot->>'sha256' = acceptance.sha256))
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        AND proposal.terms_file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        AND (NOT proposal.acceptance_required OR proposal.acceptance_file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$'))
        AND proposal.intent->>'amount' = request.amount::text AND proposal.intent->>'recipient' = approval.address
        AND proposal.intent->>'to' = lower(token.contract_address) AND proposal.intent->>'token_chain' = token.chain
        AND proposal.intent->>'value' = '0' AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$'
        AND (proposal.intent->>'chain_id')::bigint = approval.chain_id AND approval.chain_id IN (31337, 84532)
        AND proposal.intent->>'data' = '0x40c10f19' || lpad(substring(approval.address FROM 3), 64, '0') || lpad(to_hex(request.amount::bigint), 64, '0')
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND proposal.snapshot->'transaction' = proposal.intent - ARRAY['token_chain', 'recipient', 'amount']
        AND request.amount <= token.total_supply::numeric - register.issued_supply - tokens_register_issue_reserved(token.uuid, request.uuid)
      FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
      JOIN tokens_shareregister register ON register.token_id = token.uuid
      JOIN tokens_registeropening opening ON opening.uuid::text = proposal.snapshot->'register'->>'opening'
      JOIN tokens_shareissuancerequest request ON request.uuid = proposal.request_id
      JOIN tokens_registermember member ON member.uuid = proposal.member_id
      JOIN whitelist_companywalletnomination nomination ON nomination.uuid = proposal.nomination_id
      JOIN users_userprofile profile ON profile.uuid::text = nomination.snapshot->>'profile'
      JOIN authentication_customuser actor ON actor.id = profile.user_id
      JOIN whitelist_whitelistchange approval ON approval.uuid = proposal.wallet_approval_id
      JOIN whitelist_companywalletinstruction wallet_source ON wallet_source.uuid = approval.source_instruction_id
      JOIN tokens_registerevidence authority ON authority.uuid = proposal.authority_evidence_id
      JOIN tokens_registerevidence terms ON terms.uuid = proposal.terms_evidence_id
      LEFT JOIN tokens_registerevidence acceptance ON acceptance.uuid = proposal.acceptance_evidence_id
      WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false) END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_issue_reserved(token_uuid uuid, excluded_request uuid)
 RETURNS numeric
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE(sum(request.amount), 0) FROM tokens_shareissuancerequest request
    WHERE request.token_id = token_uuid AND request.uuid <> excluded_request AND (
        request.status IN ('approved', 'executing')
        OR (request.status = 'failed' AND request.dispatch_id IS NULL AND EXISTS (
            SELECT 1 FROM tokens_shareissuance issuance WHERE issuance.idempotency_key = 'issuance-request:' || request.uuid::text
                AND issuance.tx_hash IS NOT NULL AND issuance.tx_hash <> '' AND issuance.status <> 'completed'))
        OR EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution
            WHERE execution.request_id = request.uuid AND execution.status = 'executed'
                AND EXISTS (SELECT 1 FROM tokens_registeropening opening WHERE opening.token_id = token_uuid AND opening.status = 'applied'
                    AND (opening.boundary->'block'->>'number')::bigint < (execution.finalized_receipt->>'block_number')::bigint)
                AND NOT EXISTS (
                    SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
                    WHERE entry.operation_id = execution.issuance_id AND entry.kind = 'issue' AND register.token_id = token_uuid)));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_issue_source_current(proposal_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT proposal.status = 'applied' AND tokens_register_issue_ready(proposal)
        AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', clock_timestamp())
        AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', clock_timestamp())
        FROM tokens_registerinstruction proposal JOIN tokens_registerinstructiondecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registerinstructiondecision application ON application.instruction_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid AND approval.kind = 'approve' AND approval.instruction_id = proposal.uuid), false);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_link_approved(link_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerwalletlinkdecision decision
        JOIN tokens_registerwalletlink proposal ON proposal.uuid = decision.register_wallet_link_id
        WHERE decision.register_wallet_link_id = link_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_link_decision_digest(link_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'link', link_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'links', CASE WHEN decision_kind = 'apply' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'address', lower(wallet.address), 'member', wallet.member_id::text) ORDER BY lower(wallet.address)),
                '[]'::jsonb)
            FROM tokens_registerwalletlink proposal
            CROSS JOIN LATERAL jsonb_array_elements(proposal.mapping) item
            JOIN tokens_registermemberwallet wallet ON wallet.company_id = proposal.company_id
                AND lower(wallet.address) = lower(item->>'address')
            WHERE proposal.uuid = link_uuid) END)::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_member_left_on(member_uuid uuid)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT max(COALESCE(cessation.ceased_on, entry.effective_on)) FROM tokens_registerposition position
        JOIN tokens_registerentry entry ON entry.uuid = position.last_entry_id
        LEFT JOIN tokens_registermembercessation cessation ON cessation.entry_id = entry.uuid AND cessation.member_id = position.member_id
    WHERE position.member_id = member_uuid AND position.shares = 0;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_opening_approved(opening_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registeropeningdecision decision
        JOIN tokens_registeropening proposal ON proposal.uuid = decision.register_opening_id
        WHERE decision.register_opening_id = opening_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_opening_decision_digest(opening_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'opening', opening_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'boundary', (SELECT proposal.boundary->'block'->>'hash' FROM tokens_registeropening proposal
            WHERE proposal.uuid = opening_uuid),
        'register', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('sequence', register.sequence,
            'head', register.head_hash) FROM tokens_shareregister register
            JOIN tokens_registeropening proposal ON proposal.token_id = register.token_id
            WHERE proposal.uuid = opening_uuid) END)::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_paid_issue_approval(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_issue_approval(proposal_uuid, at_time);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_paid_issue_approved(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_issue_approved(proposal_uuid, at_time);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_paid_issue_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_issue_decision_digest(proposal_uuid, decision_kind, actor, appointment_uuid, decision_reason);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_paid_issue_ready(proposal tokens_registerinstruction)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT proposal.kind = 'issue' AND proposal.preparing_appointment_id IS NOT NULL
        AND company.status = 'active' AND token.status = 'deployed' AND token.chain = 'base' AND token.decimals = 0
        AND subscription.status = 'paid' AND subscription.refunded_at IS NULL AND wallet.chain = 'base'
        AND wallet.user_account_id = subscription.user_account_id
        AND subscription.amount_received >= COALESCE(subscription.allotted_quantity, subscription.quantity) * subscription.price_per_share
        AND COALESCE(subscription.allotted_quantity, subscription.quantity) BETWEEN 1 AND 2147483647
        AND (subscription.issuance_request_id IS NULL OR subscription.issuance_request_id = proposal.request_id)
        AND subscription.company_id = company.uuid AND offering.company_id = company.uuid AND token.company_id = company.uuid
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply::text)
        AND proposal.snapshot->'source'->>'subscription' = subscription.uuid::text
        AND proposal.snapshot->'source'->>'offering' = offering.uuid::text
        AND proposal.snapshot->'source'->>'company' = company.uuid::text AND proposal.snapshot->'source'->>'token' = token.uuid::text
        AND proposal.snapshot->'private'->>'wallet' = wallet.uuid::text AND proposal.snapshot->'private'->>'account' = subscription.user_account_id::text
        AND proposal.snapshot->'source'->>'recipient_address' = lower(wallet.address)
        AND proposal.snapshot->'source'->>'recipient_name' = (CASE WHEN (SELECT count(*) FROM wallets same
            WHERE same.chain = token.chain AND lower(same.address) = lower(wallet.address)) = 1 THEN
            COALESCE(NULLIF(regexp_replace(profile.full_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), actor.email, '') ELSE '' END)
        AND proposal.snapshot->'source'->>'shares' = COALESCE(subscription.allotted_quantity, subscription.quantity)::text
        AND proposal.snapshot->'source'->>'requested_shares' = subscription.quantity::text
        AND proposal.snapshot->'source'->>'currency' = subscription.currency
        AND (proposal.snapshot->'source'->>'price_per_share')::numeric = subscription.price_per_share
        AND (proposal.snapshot->'source'->>'amount_due')::numeric = subscription.amount_due
        AND (proposal.snapshot->'source'->>'amount_received')::numeric IS NOT DISTINCT FROM subscription.amount_received
        AND (proposal.snapshot->'source'->>'money_held')::numeric = COALESCE(subscription.amount_received, 0)
        AND (proposal.snapshot->'source'->>'payment_received_on')::date IS NOT DISTINCT FROM subscription.payment_received_on
        AND proposal.snapshot->'source'->>'payment_reference_seen' = COALESCE(subscription.payment_reference_seen, '')
        AND proposal.snapshot->'source'->>'payment_tx_hash' IS NOT DISTINCT FROM subscription.payment_tx_hash
        AND (proposal.snapshot->'source'->>'payment_confirmed_at')::timestamptz IS NOT DISTINCT FROM subscription.payment_confirmed_at
        AND (proposal.snapshot->'source'->>'refund_amount')::numeric IS NOT DISTINCT FROM subscription.refund_amount
        AND proposal.snapshot->'source'->>'refunded_at' IS NULL
        AND proposal.items = jsonb_build_array(jsonb_build_object('subscription', subscription.uuid,
            'recipient', lower(wallet.address), 'amount', COALESCE(subscription.allotted_quantity, subscription.quantity)::text))
        AND proposal.intent->>'recipient' = lower(wallet.address)
        AND proposal.intent->>'amount' = COALESCE(subscription.allotted_quantity, subscription.quantity)::text
        AND proposal.intent->>'to' = lower(token.contract_address) AND proposal.intent->>'token_chain' = token.chain
        AND proposal.intent->>'value' = '0' AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$'
        AND (proposal.intent->>'chain_id')::bigint IN (31337, 84532)
        AND proposal.intent->>'data' = '0x40c10f19' || lpad(substring(lower(wallet.address) FROM 3), 64, '0')
            || lpad(to_hex(COALESCE(subscription.allotted_quantity, subscription.quantity)::bigint), 64, '0')
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND proposal.snapshot->'transaction' = proposal.intent - ARRAY['token_chain', 'recipient', 'amount']
        AND proposal.approving_director ~ '[^[:space:]]' AND proposal.reason ~ '[^[:space:]]'
        AND proposal.authority_reference ~ '[^[:space:]]' AND length(proposal.reason) <= 1000
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.snapshot->'source'->>'recipient_name', '[[:space:]]+', ' ', 'g')))
        AND proposal.member_id IS NULL AND proposal.nomination_id IS NULL AND proposal.wallet_approval_id IS NULL
        AND proposal.terms_on IS NULL AND proposal.terms IS NULL AND proposal.acceptance_required IS NULL
        AND proposal.terms_evidence_id IS NULL AND proposal.acceptance_evidence_id IS NULL
        AND authority.company_id = company.uuid AND authority.kind = 'authority' AND authority.uploaded_by_id = proposal.submitted_by_id
        AND authority.sha256 = proposal.evidence_fingerprint AND proposal.evidence_snapshot->>'sha256' = authority.sha256
        AND proposal.evidence_snapshot->>'evidence' = authority.uuid::text
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        AND NOT EXISTS (SELECT 1 FROM tokens_registerimport imported JOIN tokens_registerentry entry ON entry.operation_id = imported.uuid
            WHERE imported.token_id = token.uuid AND imported.status = 'applied' AND entry.kind = 'opening')
        AND COALESCE(subscription.allotted_quantity, subscription.quantity) <= offering.cap_shares - COALESCE((
            SELECT sum(COALESCE(other.allotted_quantity, other.quantity)) FROM offerings_subscription other
            WHERE other.offering_id = offering.uuid AND other.uuid <> subscription.uuid AND other.status IN ('paid','allotted')
                AND other.issuance_request_id IS NOT NULL), 0)
        AND COALESCE(subscription.allotted_quantity, subscription.quantity) <= token.total_supply::numeric
            - GREATEST(COALESCE((proposal.snapshot->'chain_supply'->>1)::numeric, 0),
                COALESCE((SELECT issued_supply FROM tokens_shareregister WHERE token_id = token.uuid AND sequence > 0), 0))
            - COALESCE((SELECT sum(request.amount) FROM tokens_shareissuancerequest request
                WHERE request.token_id = token.uuid AND request.uuid IS DISTINCT FROM proposal.request_id AND (
                    request.status IN ('approved','executing') OR (request.status = 'failed' AND EXISTS (
                        SELECT 1 FROM tokens_shareissuance issuance WHERE issuance.idempotency_key = 'issuance-request:' || request.uuid::text
                            AND issuance.tx_hash IS NOT NULL AND issuance.status <> 'completed')) OR EXISTS (
                        SELECT 1 FROM tokens_shareissuanceexecution execution WHERE execution.request_id = request.uuid
                            AND execution.status = 'executed' AND request.executed_at >= (proposal.snapshot->>'observed_at')::timestamptz
                            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
                                WHERE entry.operation_id = execution.issuance_id AND entry.kind = 'issue' AND register.token_id = token.uuid)))), 0)
        FROM offerings_subscription subscription JOIN offerings_offering offering ON offering.uuid = subscription.offering_id
        JOIN tokens_sharetoken token ON token.uuid = offering.token_id JOIN companies_company company ON company.uuid = token.company_id
        JOIN wallets wallet ON wallet.uuid = subscription.wallet_id LEFT JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
        LEFT JOIN users_userprofile profile ON profile.uuid = account.user_profile_id LEFT JOIN authentication_customuser actor ON actor.id = profile.user_id
        JOIN tokens_registerevidence authority ON authority.uuid = proposal.authority_evidence_id
        WHERE subscription.uuid = proposal.paid_subscription_id AND token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_particulars_approved(change_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
        JOIN tokens_registerparticularschange proposal ON proposal.uuid = decision.register_particulars_change_id
        WHERE decision.register_particulars_change_id = change_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_particulars_decision_digest(change_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'change', change_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'particulars', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('name', held.name,
            'residential_address', held.residential_address, 'as_at', held.as_at,
            'source_import', held.source_import_id, 'source_change', held.source_change_id)
            FROM tokens_registermemberparticulars held
            JOIN tokens_registerparticularschange proposal ON proposal.member_id = held.member_id
            WHERE proposal.uuid = change_uuid) END)::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_particulars_snapshot(member_uuid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT jsonb_build_object('uuid', held.uuid, 'name', held.name, 'residential_address', held.residential_address,
        'as_at', to_char(held.as_at, 'YYYY-MM-DD'), 'source_import', held.source_import_id,
        'source_change', held.source_change_id, 'source_grant', held.source_grant_id, 'source_transfer', held.source_transfer_id)
    FROM tokens_registermemberparticulars held WHERE held.member_id = member_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_pause_approval(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT decision.uuid FROM tokens_registerpausechangedecision decision
    JOIN tokens_registerpausechange proposal ON proposal.uuid = decision.pause_change_id
    WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
        AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id, 'approve', GREATEST(at_time, clock_timestamp()))
    ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_pause_approved(proposal_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT tokens_register_pause_approval(proposal_uuid, at_time) IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_pause_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('proposal',to_jsonb(proposal),'kind',decision_kind,'actor',actor,
        'appointment',appointment_uuid,'reason',decision_reason,'token',to_jsonb(token),'company',to_jsonb(company),
        'ready',tokens_register_pause_ready(proposal),'approval',tokens_register_pause_approval(proposal.uuid,clock_timestamp()))::text,'UTF8')),'hex')
    FROM tokens_registerpausechange proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
    JOIN companies_company company ON company.uuid = proposal.company_id WHERE proposal.uuid = proposal_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_pause_ready(proposal tokens_registerpausechange)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT company.status = 'active' AND token.status IN ('deployed','paused') AND token.chain = 'base'
        AND proposal.reason ~ '[^[:space:]]' AND length(proposal.reason) <= 1000
        AND proposal.authority_reference ~ '[^[:space:]]' AND length(proposal.authority_reference) <= 255
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply, 'decimals', token.decimals)
        AND proposal.intent->>'to' = lower(token.contract_address)
        AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$' AND proposal.intent->>'to' ~ '^0x[0-9a-f]{40}$'
        AND proposal.intent->>'to' <> '0x0000000000000000000000000000000000000000'
        AND proposal.intent->>'value' = '0' AND (proposal.intent->>'chain_id')::bigint IN (31337,84532)
        AND proposal.intent->>'data' = CASE WHEN proposal.paused THEN '0x8456cb59' ELSE '0x3f4ba83a' END
        AND proposal.intent = jsonb_build_object('chain_id',(proposal.intent->>'chain_id')::bigint,'sender',proposal.intent->>'sender',
            'to',lower(token.contract_address),'value','0','data',CASE WHEN proposal.paused THEN '0x8456cb59' ELSE '0x3f4ba83a' END)
        AND proposal.snapshot->'transaction' = proposal.intent
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND evidence.company_id = company.uuid AND evidence.uploaded_by_id = proposal.submitted_by_id AND evidence.kind = 'authority'
        AND evidence.sha256 = proposal.evidence_fingerprint
        AND proposal.evidence_snapshot = jsonb_build_object('provided_by','company','evidence',evidence.uuid,'company',company.uuid,
            'document_type',evidence.kind,'name',evidence.original_filename,'file_size',evidence.file_size,'mime_type',evidence.mime_type,'sha256',evidence.sha256)
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-pause-changes/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
        JOIN tokens_registerevidence evidence ON evidence.uuid = proposal.authority_evidence_id
        WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_pause_source_current(proposal_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT proposal.status = 'applied' AND tokens_register_pause_ready(proposal)
        AND approval.pause_change_id = proposal.uuid AND approval.kind = 'approve'
        AND application.decided_by_id = proposal.reviewed_by_id AND application.decided_at = proposal.reviewed_at
        AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', clock_timestamp())
        AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', clock_timestamp())
        FROM tokens_registerpausechange proposal JOIN tokens_registerpausechangedecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registerpausechangedecision application ON application.pause_change_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid), false);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_pause_source_lapsed(proposal_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerpausechangedecision decision
        JOIN tokens_registerpausechange proposal ON proposal.uuid = decision.pause_change_id
        JOIN companies_companyappointment appointment ON appointment.uuid = decision.appointment_id
        LEFT JOIN companies_companyappointmentrevocation revocation ON revocation.appointment_id = appointment.uuid
        WHERE proposal.uuid = proposal_uuid AND (decision.uuid = proposal.approval_decision_id OR decision.kind = 'apply')
            AND (revocation.uuid IS NOT NULL OR appointment.expires_at <= clock_timestamp()));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_transfer_approved(transfer_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registertransferdecision decision JOIN tokens_registertransfer proposal ON proposal.uuid = decision.register_transfer_id
        WHERE proposal.uuid = transfer_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_transfer_changes(proposal tokens_registertransfer)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT jsonb_agg(jsonb_build_object('member', member::text, 'shares', shares::text) ORDER BY member::text)
    FROM (VALUES (proposal.from_member, -proposal.shares), (proposal.to_member, proposal.shares)) AS effects(member, shares);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_transfer_decision_digest(transfer_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'transfer', to_jsonb(proposal),
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply, 'token_status', token.status,
        'deployment', token.deployment_id, 'transaction', token.deployment_transaction_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'from_particulars', tokens_register_particulars_snapshot(proposal.from_member),
        'to_particulars', tokens_register_particulars_snapshot(proposal.to_member),
        'effective_on', (clock_timestamp() AT TIME ZONE 'UTC')::date)::text, 'UTF8')), 'hex')
    FROM tokens_registertransfer proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = transfer_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_transfer_evidence_matches(evidence_uuid uuid, issuer uuid, actor bigint, evidence_kind text, fingerprint text, snapshot jsonb, retained_file text, transfer_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerevidence evidence WHERE evidence.uuid = evidence_uuid AND evidence.company_id = issuer
        AND evidence.uploaded_by_id = actor AND evidence.kind = evidence_kind AND fingerprint = evidence.sha256
        AND snapshot = tokens_register_evidence_snapshot(evidence)
        AND retained_file ~ ('^companies/' || issuer || '/register-transfers/' || transfer_uuid || '/[0-9a-f-]{36}[.]bin$'));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_transfer_ready(proposal tokens_registertransfer, before_effect boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id AND token.status = 'draft'
            AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL AND token.deployment_transaction_id IS NULL
            AND NULLIF(token.deployment_tx_hash, '') IS NULL AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL
            AND register.sequence > 0 AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')
            AND COALESCE((SELECT shares FROM tokens_registerposition WHERE register_id = register.uuid AND member_id = proposal.from_member), 0) >= proposal.shares
            AND COALESCE((SELECT shares FROM tokens_registerposition WHERE register_id = register.uuid AND member_id = proposal.to_member), 0) + proposal.shares < 2::numeric^256
            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry WHERE entry.register_id = register.uuid AND entry.sequence = register.sequence
                AND entry.effective_on > (clock_timestamp() AT TIME ZONE 'UTC')::date))
        AND EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.from_member AND member.company_id = proposal.company_id)
        AND tokens_register_particulars_snapshot(proposal.from_member) IS NOT DISTINCT FROM proposal.from_particulars
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = proposal.company_id
            AND wallet.member_id IN (proposal.from_member, proposal.to_member))
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g'))) NOT IN
            (lower(btrim(regexp_replace(proposal.from_name, '[[:space:]]+', ' ', 'g'))), lower(btrim(regexp_replace(proposal.name, '[[:space:]]+', ' ', 'g'))))
        AND CASE WHEN proposal.new_member AND before_effect THEN
            NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.to_member)
        ELSE EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.to_member AND member.company_id = proposal.company_id) END
        AND CASE WHEN proposal.new_particulars AND NOT before_effect THEN
            EXISTS (SELECT 1 FROM tokens_registermemberparticulars held WHERE held.member_id = proposal.to_member
                AND held.source_transfer_id = proposal.uuid AND held.name = proposal.name AND held.residential_address = proposal.residential_address
                AND held.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date)
        ELSE tokens_register_particulars_snapshot(proposal.to_member) IS NOT DISTINCT FROM proposal.to_particulars END
        AND (NOT proposal.new_particulars OR NOT EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = proposal.to_member AND position.shares > 0));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_shareissuancerequest_company_id_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_owner_id uuid;
BEGIN
    SELECT parent.company_id INTO parent_owner_id
    FROM tokens_sharetoken AS parent
    WHERE parent.uuid = NEW.token_id;

    IF parent_owner_id IS NULL THEN
        RAISE EXCEPTION 'tokens_shareissuancerequest.company_id cannot be derived: tokens_sharetoken % has no company_id', NEW.token_id;
    END IF;

    IF NEW.company_id IS NULL THEN
        NEW.company_id := parent_owner_id;
    ELSIF NEW.company_id <> parent_owner_id THEN
        RAISE EXCEPTION 'tokens_shareissuancerequest.company_id % does not match tokens_sharetoken.company_id %',
            NEW.company_id, parent_owner_id;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL AND OLD.company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'tokens_shareissuancerequest.company_id cannot change, from % to %', OLD.company_id, NEW.company_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_swap_execution_intent(candidate blockchain_blockchaintransaction)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
    arguments jsonb := candidate.function_args;
    calldata text := '0xe420d7b5';
    field text;
    value text;
BEGIN
    FOREACH field IN ARRAY ARRAY['seller', 'buyer', 'shareToken', 'paymentToken'] LOOP
        value := arguments->>field;
        IF coalesce(value, '') !~ '^0x[0-9A-Fa-f]{40}$' THEN
            RAISE EXCEPTION 'Swap execution requires an exact address';
        END IF;
        calldata := calldata || lpad(lower(substr(value, 3)), 64, '0');
    END LOOP;
    FOREACH field IN ARRAY ARRAY['shareAmount', 'paymentAmount', 'nonce', 'deadline'] LOOP
        value := arguments->>field;
        IF coalesce(value, '') !~ '^(0|[1-9][0-9]*)$' OR length(value) > 19 THEN
            RAISE EXCEPTION 'Swap execution requires a supported exact integer';
        END IF;
        calldata := calldata || lpad(to_hex(value::bigint), 64, '0');
    END LOOP;
    calldata := calldata || lpad('140', 64, '0') || lpad('1c0', 64, '0');
    FOREACH field IN ARRAY ARRAY['sellerSignature', 'buyerSignature'] LOOP
        value := arguments->>field;
        IF coalesce(value, '') !~ '^(0x)?[0-9A-Fa-f]{130}$' THEN
            RAISE EXCEPTION 'Swap execution requires both original 65-byte signatures';
        END IF;
        calldata := calldata || lpad('41', 64, '0') || rpad(lower(regexp_replace(value, '^0x', '')), 192, '0');
    END LOOP;
    value := arguments->'settlement'->'domain'->>'chainId';
    IF coalesce(value, '') !~ '^[1-9][0-9]*$' OR length(value) > 19 THEN
        RAISE EXCEPTION 'Swap execution requires a supported exact chain';
    END IF;
    RETURN jsonb_build_object('chain_id', value::bigint, 'sender', lower(candidate.from_address),
        'to', lower(candidate.to_address), 'value', '0', 'data', calldata);
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_swap_has_current_party(candidate tokens_swaporder)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    SELECT NULLIF(current_setting('app.user_id', true), '') IS NOT NULL AND EXISTS (
        SELECT 1 FROM tokens_transferorder owned
        JOIN wallets held ON held.uuid = owned.wallet_id
        WHERE owned.owner_account_id IN (SELECT app_principal_account_ids())
          AND held.user_account_id = owned.owner_account_id
          AND lower(held.address) = lower(owned.wallet_address)
          AND held.verification_status = 'VERIFIED'
          AND held.chain IN ('ethereum', 'base')
          AND owned.token_id = candidate.share_token_id
          AND (
              (owned.uuid = candidate.sell_order_id
               AND owned.wallet_id = candidate.seller_wallet_id
               AND lower(held.address) = lower(candidate.seller_address)
               AND candidate.settlement_context->'seller'->>'order_uuid' = owned.uuid::text
               AND candidate.settlement_context->'seller'->>'owner_account_uuid' = owned.owner_account_id::text
               AND candidate.settlement_context->'seller'->>'wallet_uuid' = owned.wallet_id::text
               AND lower(candidate.settlement_context->'seller'->>'address') = lower(held.address)
               AND (candidate.settlement_context->'seller'->>'payment_asset_uuid')
                   IS NOT DISTINCT FROM owned.payment_asset_id::text)
              OR
              (owned.uuid = candidate.buy_order_id
               AND owned.wallet_id = candidate.buyer_wallet_id
               AND lower(held.address) = lower(candidate.buyer_address)
               AND candidate.settlement_context->'buyer'->>'order_uuid' = owned.uuid::text
               AND candidate.settlement_context->'buyer'->>'owner_account_uuid' = owned.owner_account_id::text
               AND candidate.settlement_context->'buyer'->>'wallet_uuid' = owned.wallet_id::text
               AND lower(candidate.settlement_context->'buyer'->>'address') = lower(held.address)
               AND (candidate.settlement_context->'buyer'->>'payment_asset_uuid')
                   IS NOT DISTINCT FROM owned.payment_asset_id::text)
          )
    );
$function$;

CREATE OR REPLACE FUNCTION public.tokens_swap_settlement_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    seller tokens_transferorder%ROWTYPE;
    buyer tokens_transferorder%ROWTYPE;
    context jsonb;
    typed jsonb;
    message jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.settlement_protocol_version <> 0 THEN
            RAISE EXCEPTION 'A recorded swap settlement identity cannot be deleted' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.settlement_protocol_version, NEW.settlement_context, NEW.settlement_digest)
           IS DISTINCT FROM ROW(OLD.settlement_protocol_version, OLD.settlement_context, OLD.settlement_digest) THEN
            RAISE EXCEPTION 'A swap cannot replace its original settlement context' USING ERRCODE = '23514';
        END IF;
        IF OLD.settlement_protocol_version <> 0 AND
           ROW(NEW.uuid, NEW.sell_order_id, NEW.buy_order_id, NEW.seller_wallet_id, NEW.buyer_wallet_id,
               NEW.share_token_id, NEW.payment_asset_id, NEW.seller_address, NEW.buyer_address,
               NEW.share_amount, NEW.payment_amount, NEW.nonce, NEW.order_hash, NEW.expires_at, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.uuid, OLD.sell_order_id, OLD.buy_order_id, OLD.seller_wallet_id, OLD.buyer_wallet_id,
               OLD.share_token_id, OLD.payment_asset_id, OLD.seller_address, OLD.buyer_address,
               OLD.share_amount, OLD.payment_amount, OLD.nonce, OLD.order_hash, OLD.expires_at, OLD.created_at) THEN
            RAISE EXCEPTION 'A swap settlement identity is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.settlement_protocol_version IS DISTINCT FROM 1
       OR jsonb_typeof(NEW.settlement_context) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'New swaps require the settlement context protocol' USING ERRCODE = '23514';
    END IF;
    context := NEW.settlement_context;
    typed := context->'typed_data';
    message := typed->'message';
    SELECT * INTO seller FROM tokens_transferorder WHERE uuid = NEW.sell_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'A swap settlement must name its seller order' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO buyer FROM tokens_transferorder WHERE uuid = NEW.buy_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'A swap settlement must name its buyer order' USING ERRCODE = '23514';
    END IF;
    IF context->>'protocol_version' IS DISTINCT FROM '1'
       OR seller.token_id IS DISTINCT FROM NEW.share_token_id
       OR buyer.token_id IS DISTINCT FROM NEW.share_token_id
       OR COALESCE(buyer.payment_asset_id, seller.payment_asset_id) IS DISTINCT FROM NEW.payment_asset_id
       OR context->'seller'->>'payment_asset_uuid' IS DISTINCT FROM seller.payment_asset_id::text
       OR context->'buyer'->>'payment_asset_uuid' IS DISTINCT FROM buyer.payment_asset_id::text
       OR seller.order_type IS DISTINCT FROM 'sell'
       OR buyer.order_type IS DISTINCT FROM 'buy'
       OR seller.wallet_id IS DISTINCT FROM NEW.seller_wallet_id
       OR buyer.wallet_id IS DISTINCT FROM NEW.buyer_wallet_id
       OR lower(seller.wallet_address) IS DISTINCT FROM lower(NEW.seller_address)
       OR lower(buyer.wallet_address) IS DISTINCT FROM lower(NEW.buyer_address)
       OR context->>'swap_uuid' IS DISTINCT FROM NEW.uuid::text
       OR context->'seller'->>'order_uuid' IS DISTINCT FROM NEW.sell_order_id::text
       OR context->'buyer'->>'order_uuid' IS DISTINCT FROM NEW.buy_order_id::text
       OR context->'seller'->>'wallet_uuid' IS DISTINCT FROM NEW.seller_wallet_id::text
       OR context->'buyer'->>'wallet_uuid' IS DISTINCT FROM NEW.buyer_wallet_id::text
       OR context->'seller'->>'owner_account_uuid' IS DISTINCT FROM seller.owner_account_id::text
       OR context->'buyer'->>'owner_account_uuid' IS DISTINCT FROM buyer.owner_account_id::text
       OR context->'share_token'->>'uuid' IS DISTINCT FROM NEW.share_token_id::text
       OR context->'payment_asset'->>'uuid' IS DISTINCT FROM NEW.payment_asset_id::text
       OR lower(context->'seller'->>'address') IS DISTINCT FROM lower(NEW.seller_address)
       OR lower(context->'buyer'->>'address') IS DISTINCT FROM lower(NEW.buyer_address)
       OR lower(message->>'seller') IS DISTINCT FROM lower(NEW.seller_address)
       OR lower(message->>'buyer') IS DISTINCT FROM lower(NEW.buyer_address)
       OR message->>'shareAmount' IS DISTINCT FROM NEW.share_amount::text
       OR message->>'paymentAmount' IS DISTINCT FROM NEW.payment_amount::text
       OR message->>'nonce' IS DISTINCT FROM NEW.nonce::text
       OR message->>'deadline' IS DISTINCT FROM trunc(extract(epoch FROM NEW.expires_at))::bigint::text
       OR message->>'shareToken' IS DISTINCT FROM context->'share_token'->>'address'
       OR message->>'paymentToken' IS DISTINCT FROM context->'payment_asset'->>'deployment_address'
       OR context->>'digest' IS DISTINCT FROM NEW.settlement_digest
       OR context->>'order_hash' IS DISTINCT FROM NEW.order_hash
       OR typed->>'primaryType' IS DISTINCT FROM 'SwapOrder'
       OR typed->'domain'->>'name' IS DISTINCT FROM 'LedovaAtomicSwap'
       OR typed->'domain'->>'version' IS DISTINCT FROM '1'
       OR jsonb_typeof(typed->'domain'->'chainId') IS DISTINCT FROM 'string'
       OR COALESCE(typed->'domain'->>'chainId', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(typed->'domain'->>'verifyingContract', '') !~ '^0x[0-9A-Fa-f]{40}$'
       OR COALESCE(NEW.settlement_digest, '') !~ '^0x[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'A swap settlement must preserve its complete signed and relational identity'
            USING ERRCODE = '23514';
    END IF;
    IF typed->'types' IS DISTINCT FROM '{
        "EIP712Domain": [
            {"name": "name", "type": "string"},
            {"name": "version", "type": "string"},
            {"name": "chainId", "type": "uint256"},
            {"name": "verifyingContract", "type": "address"}
        ],
        "SwapOrder": [
            {"name": "seller", "type": "address"},
            {"name": "buyer", "type": "address"},
            {"name": "shareToken", "type": "address"},
            {"name": "paymentToken", "type": "address"},
            {"name": "shareAmount", "type": "uint256"},
            {"name": "paymentAmount", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint256"}
        ]
    }'::jsonb THEN
        RAISE EXCEPTION 'A swap settlement must retain the V1 signed field types' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_swaporder_buyer_wallet_id_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_owner_id uuid;
BEGIN

    IF TG_OP = 'UPDATE' AND OLD.settlement_protocol_version = 1
       AND ROW(NEW.settlement_protocol_version, NEW.settlement_context, NEW.settlement_digest,
               NEW.uuid, NEW.sell_order_id, NEW.buy_order_id, NEW.seller_wallet_id, NEW.buyer_wallet_id,
               NEW.share_token_id, NEW.payment_asset_id, NEW.seller_address, NEW.buyer_address,
               NEW.share_amount, NEW.payment_amount, NEW.nonce, NEW.order_hash, NEW.expires_at, NEW.created_at)
           IS NOT DISTINCT FROM
           ROW(OLD.settlement_protocol_version, OLD.settlement_context, OLD.settlement_digest,
               OLD.uuid, OLD.sell_order_id, OLD.buy_order_id, OLD.seller_wallet_id, OLD.buyer_wallet_id,
               OLD.share_token_id, OLD.payment_asset_id, OLD.seller_address, OLD.buyer_address,
               OLD.share_amount, OLD.payment_amount, OLD.nonce, OLD.order_hash, OLD.expires_at, OLD.created_at)
       AND tokens_swap_has_current_party(NEW) THEN
        RETURN NEW;
    END IF;
    SELECT parent.wallet_id INTO parent_owner_id
    FROM tokens_transferorder AS parent
    WHERE parent.uuid = NEW.buy_order_id;

    IF parent_owner_id IS NULL THEN
        RAISE EXCEPTION 'tokens_swaporder.buyer_wallet_id cannot be derived: tokens_transferorder % has no wallet_id', NEW.buy_order_id;
    END IF;

    IF NEW.buyer_wallet_id IS NULL THEN
        NEW.buyer_wallet_id := parent_owner_id;
    ELSIF NEW.buyer_wallet_id <> parent_owner_id THEN
        RAISE EXCEPTION 'tokens_swaporder.buyer_wallet_id % does not match tokens_transferorder.wallet_id %',
            NEW.buyer_wallet_id, parent_owner_id;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.buyer_wallet_id IS NOT NULL AND OLD.buyer_wallet_id <> NEW.buyer_wallet_id THEN
        RAISE EXCEPTION 'tokens_swaporder.buyer_wallet_id cannot change, from % to %', OLD.buyer_wallet_id, NEW.buyer_wallet_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_swaporder_seller_wallet_id_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_owner_id uuid;
BEGIN

    IF TG_OP = 'UPDATE' AND OLD.settlement_protocol_version = 1
       AND ROW(NEW.settlement_protocol_version, NEW.settlement_context, NEW.settlement_digest,
               NEW.uuid, NEW.sell_order_id, NEW.buy_order_id, NEW.seller_wallet_id, NEW.buyer_wallet_id,
               NEW.share_token_id, NEW.payment_asset_id, NEW.seller_address, NEW.buyer_address,
               NEW.share_amount, NEW.payment_amount, NEW.nonce, NEW.order_hash, NEW.expires_at, NEW.created_at)
           IS NOT DISTINCT FROM
           ROW(OLD.settlement_protocol_version, OLD.settlement_context, OLD.settlement_digest,
               OLD.uuid, OLD.sell_order_id, OLD.buy_order_id, OLD.seller_wallet_id, OLD.buyer_wallet_id,
               OLD.share_token_id, OLD.payment_asset_id, OLD.seller_address, OLD.buyer_address,
               OLD.share_amount, OLD.payment_amount, OLD.nonce, OLD.order_hash, OLD.expires_at, OLD.created_at)
       AND tokens_swap_has_current_party(NEW) THEN
        RETURN NEW;
    END IF;
    SELECT parent.wallet_id INTO parent_owner_id
    FROM tokens_transferorder AS parent
    WHERE parent.uuid = NEW.sell_order_id;

    IF parent_owner_id IS NULL THEN
        RAISE EXCEPTION 'tokens_swaporder.seller_wallet_id cannot be derived: tokens_transferorder % has no wallet_id', NEW.sell_order_id;
    END IF;

    IF NEW.seller_wallet_id IS NULL THEN
        NEW.seller_wallet_id := parent_owner_id;
    ELSIF NEW.seller_wallet_id <> parent_owner_id THEN
        RAISE EXCEPTION 'tokens_swaporder.seller_wallet_id % does not match tokens_transferorder.wallet_id %',
            NEW.seller_wallet_id, parent_owner_id;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.seller_wallet_id IS NOT NULL AND OLD.seller_wallet_id <> NEW.seller_wallet_id THEN
        RAISE EXCEPTION 'tokens_swaporder.seller_wallet_id cannot change, from % to %', OLD.seller_wallet_id, NEW.seller_wallet_id;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_trading_binding(command jsonb)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_trading_command()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.tokens_trading_current(command jsonb, checked_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NOT public.tokens_trading_binding(command) THEN
        RAISE EXCEPTION 'Bind the actual trading decision' USING ERRCODE = '23514';
    END IF;
    IF NOT public.users_company_eligibility_decision_current((command->>'decision_uuid')::uuid,
        (command->>'owner_account_uuid')::uuid, (command->>'company_uuid')::uuid, 'secondary', NULL, NULL, checked_at)
    THEN RAISE EXCEPTION 'The trading decision is no longer current' USING ERRCODE = '23514',
        CONSTRAINT = 'tokens_trading_eligibility_current'; END IF;
END;
$function$;

CREATE TRIGGER protect_swap_transaction BEFORE INSERT OR DELETE OR UPDATE ON blockchain_blockchaintransaction FOR EACH ROW EXECUTE FUNCTION protect_swap_transaction();

CREATE TRIGGER protect_nav_operation BEFORE INSERT OR UPDATE ON blockchain_outgoingoperation FOR EACH ROW EXECUTE FUNCTION protect_nav_operation();

CREATE TRIGGER protect_pause_operation BEFORE INSERT OR UPDATE ON blockchain_outgoingoperation FOR EACH ROW EXECUTE FUNCTION protect_pause_operation();

CREATE TRIGGER protect_swap_outgoing BEFORE INSERT OR UPDATE ON blockchain_outgoingoperation FOR EACH ROW EXECUTE FUNCTION protect_swap_outgoing();

CREATE TRIGGER tokens_company_capital_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_signature();

CREATE CONSTRAINT TRIGGER tokens_company_capital_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_signature();

CREATE TRIGGER tokens_company_issue_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_signature();

CREATE CONSTRAINT TRIGGER tokens_company_issue_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_signature();

CREATE TRIGGER tokens_company_pause_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_signature();

CREATE CONSTRAINT TRIGGER tokens_company_pause_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_signature();

CREATE CONSTRAINT TRIGGER tokens_deployment_signature_current AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_deployment_signature();

CREATE TRIGGER tokens_deployment_signature_source BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_deployment_signature();

CREATE TRIGGER protect_issuance_subscription BEFORE INSERT OR DELETE OR UPDATE ON offerings_subscription FOR EACH ROW EXECUTE FUNCTION protect_issuance_subscription();

CREATE TRIGGER signing_challenges_bind_action BEFORE INSERT OR UPDATE ON signing_challenges FOR EACH ROW EXECUTE FUNCTION signing_challenges_bind_action();

CREATE TRIGGER signing_challenges_bind_submission BEFORE INSERT OR UPDATE ON signing_challenges FOR EACH ROW EXECUTE FUNCTION signing_challenges_bind_submission();

CREATE TRIGGER signing_challenges_preserve_issued_intent BEFORE UPDATE ON signing_challenges FOR EACH ROW EXECUTE FUNCTION signing_challenges_preserve_issued_intent();

CREATE TRIGGER signing_challenges_wallet_is_checked BEFORE INSERT OR UPDATE ON signing_challenges FOR EACH ROW EXECUTE FUNCTION signing_challenges_wallet_is_checked();

CREATE TRIGGER protect_capital_execution BEFORE INSERT OR DELETE OR UPDATE ON tokens_capitalincreaseexecution FOR EACH ROW EXECUTE FUNCTION protect_capital_execution();

CREATE TRIGGER tokens_company_capital_execution BEFORE INSERT OR UPDATE ON tokens_capitalincreaseexecution FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital_execution();

CREATE CONSTRAINT TRIGGER tokens_company_capital_execution_effect AFTER INSERT OR UPDATE ON tokens_capitalincreaseexecution DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_execution();

CREATE TRIGGER protect_capital_request BEFORE INSERT OR DELETE OR UPDATE ON tokens_capitalincreaserequest FOR EACH ROW EXECUTE FUNCTION protect_capital_request();

CREATE TRIGGER tokens_capitalincreaserequest_company_id_is_derived BEFORE INSERT OR UPDATE ON tokens_capitalincreaserequest FOR EACH ROW EXECUTE FUNCTION tokens_capitalincreaserequest_company_id_is_derived();

CREATE TRIGGER tokens_company_capital_request BEFORE INSERT OR DELETE OR UPDATE ON tokens_capitalincreaserequest FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital_request();

CREATE CONSTRAINT TRIGGER tokens_company_capital_request_source AFTER INSERT OR UPDATE ON tokens_capitalincreaserequest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_request();

CREATE TRIGGER tokens_formerholder_owner_id_derive BEFORE INSERT OR UPDATE ON tokens_formerholder FOR EACH ROW EXECUTE FUNCTION tokens_formerholder_owner_id_is_derived();

CREATE TRIGGER protect_mint_request_operation BEFORE INSERT OR DELETE OR UPDATE ON tokens_mintrequest FOR EACH ROW EXECUTE FUNCTION protect_mint_request_operation();

CREATE TRIGGER protect_nav_update BEFORE INSERT OR DELETE OR UPDATE ON tokens_navupdate FOR EACH ROW EXECUTE FUNCTION protect_nav_update();

CREATE TRIGGER tokens_order_action_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_orderactionsubmission FOR EACH ROW EXECUTE FUNCTION tokens_order_action_guard();

CREATE TRIGGER tokens_trading_action_begin BEFORE UPDATE ON tokens_orderactionsubmission FOR EACH STATEMENT EXECUTE FUNCTION tokens_begin_trading_admission();

CREATE TRIGGER tokens_trading_action_guard BEFORE INSERT OR UPDATE ON tokens_orderactionsubmission FOR EACH ROW EXECUTE FUNCTION tokens_guard_trading_action();

CREATE TRIGGER tokens_trading_pending_action_token BEFORE INSERT ON tokens_orderactionsubmission FOR EACH ROW EXECUTE FUNCTION tokens_lock_pending_trading_token();

CREATE TRIGGER tokens_trading_log_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_ordermodificationlog FOR EACH ROW EXECUTE FUNCTION tokens_guard_trading_log();

CREATE TRIGGER tokens_order_submission_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_ordersubmission FOR EACH ROW EXECUTE FUNCTION tokens_order_submission_guard();

CREATE TRIGGER tokens_trading_pending_submission_token BEFORE INSERT ON tokens_ordersubmission FOR EACH ROW EXECUTE FUNCTION tokens_lock_pending_trading_token();

CREATE TRIGGER tokens_trading_submission_begin BEFORE UPDATE ON tokens_ordersubmission FOR EACH STATEMENT EXECUTE FUNCTION tokens_begin_trading_admission();

CREATE TRIGGER tokens_trading_submission_guard BEFORE INSERT OR UPDATE ON tokens_ordersubmission FOR EACH ROW EXECUTE FUNCTION tokens_guard_trading_submission();

CREATE TRIGGER protect_pause_change BEFORE INSERT OR DELETE OR UPDATE ON tokens_pausechange FOR EACH ROW EXECUTE FUNCTION protect_pause_change();

CREATE TRIGGER tokens_company_pause_execution BEFORE INSERT OR UPDATE ON tokens_pausechange FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_pause_execution();

CREATE CONSTRAINT TRIGGER tokens_company_pause_execution_effect AFTER INSERT OR UPDATE ON tokens_pausechange DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_execution();

CREATE TRIGGER tokens_register_acknowledgement_record BEFORE INSERT OR DELETE OR UPDATE ON tokens_registeracknowledgement FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_acknowledgement();

CREATE CONSTRAINT TRIGGER tokens_company_capital_preparation AFTER INSERT ON tokens_registercapitalincrease DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_preparation();

CREATE TRIGGER tokens_company_capital_source BEFORE INSERT OR DELETE OR UPDATE ON tokens_registercapitalincrease FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital();

CREATE TRIGGER tokens_company_capital_decision BEFORE INSERT OR DELETE OR UPDATE ON tokens_registercapitalincreasedecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital_decision();

CREATE CONSTRAINT TRIGGER tokens_company_capital_decision_effect AFTER INSERT ON tokens_registercapitalincreasedecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_decision();

CREATE TRIGGER tokens_register_correction_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registercorrection FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_correction();

CREATE CONSTRAINT TRIGGER tokens_register_correction_decision_effect AFTER INSERT ON tokens_registercorrectiondecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_correction_decision();

CREATE TRIGGER tokens_register_correction_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registercorrectiondecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_correction_decision();

CREATE CONSTRAINT TRIGGER tokens_register_deployment_preparation AFTER INSERT ON tokens_registerdeployment DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_deployment_preparation();

CREATE TRIGGER tokens_register_deployment_source BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerdeployment FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_deployment();

CREATE TRIGGER tokens_register_deployment_decision BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerdeploymentdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_deployment_decision();

CREATE CONSTRAINT TRIGGER tokens_register_deployment_effect AFTER INSERT ON tokens_registerdeploymentdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_deployment_decision();

CREATE TRIGGER tokens_company_issue_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue_entry();

CREATE TRIGGER tokens_register_correction_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_correction_register_entry();

CREATE CONSTRAINT TRIGGER tokens_register_correction_entry_effect AFTER INSERT ON tokens_registerentry DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_correction_register_entry();

CREATE TRIGGER tokens_register_entry_cessation AFTER INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_record_member_cessations();

CREATE TRIGGER tokens_register_entry_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_entry();

CREATE TRIGGER tokens_register_entry_projection AFTER INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_project_register_entry();

CREATE TRIGGER tokens_register_grant_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_grant_register_entry();

CREATE TRIGGER tokens_register_transfer_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_transfer_register_entry();

CREATE TRIGGER tokens_register_evidence_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerevidence FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_evidence();

CREATE TRIGGER tokens_register_export_record BEFORE UPDATE ON tokens_registerexport FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_export();

CREATE TRIGGER tokens_register_grant_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registergrant FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_grant();

CREATE CONSTRAINT TRIGGER tokens_register_grant_decision_effect AFTER INSERT ON tokens_registergrantdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_grant_decision();

CREATE TRIGGER tokens_register_grant_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registergrantdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_grant_decision();

CREATE TRIGGER tokens_register_import_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerimport FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_import();

CREATE CONSTRAINT TRIGGER tokens_register_import_decision_effect AFTER INSERT ON tokens_registerimportdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_import_decision();

CREATE TRIGGER tokens_register_import_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerimportdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_import_decision();

CREATE CONSTRAINT TRIGGER tokens_company_issue_preparation AFTER INSERT ON tokens_registerinstruction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_preparation();

CREATE TRIGGER tokens_company_issue_source BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerinstruction FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue();

CREATE TRIGGER tokens_register_instruction_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerinstruction FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_instruction();

CREATE TRIGGER tokens_company_issue_decision BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerinstructiondecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue_decision();

CREATE CONSTRAINT TRIGGER tokens_company_issue_decision_effect AFTER INSERT ON tokens_registerinstructiondecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_decision();

CREATE TRIGGER tokens_register_grant_member BEFORE INSERT ON tokens_registermember FOR EACH ROW EXECUTE FUNCTION tokens_guard_grant_member();

CREATE TRIGGER tokens_register_member_identity BEFORE DELETE OR UPDATE ON tokens_registermember FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_member();

CREATE TRIGGER tokens_register_transfer_member BEFORE INSERT ON tokens_registermember FOR EACH ROW EXECUTE FUNCTION tokens_guard_transfer_member();

CREATE TRIGGER tokens_register_member_cessation_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registermembercessation FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_cessation();

CREATE TRIGGER tokens_register_member_particulars_source BEFORE INSERT OR DELETE OR UPDATE ON tokens_registermemberparticulars FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_member_particulars();

CREATE TRIGGER tokens_register_member_wallet_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registermemberwallet FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_member_wallet();

CREATE TRIGGER tokens_register_opening_history BEFORE INSERT OR UPDATE ON tokens_registeropening FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening_history();

CREATE TRIGGER tokens_register_opening_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registeropening FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening();

CREATE TRIGGER tokens_register_opening_mapping_values BEFORE INSERT ON tokens_registeropening FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening_mapping_values();

CREATE CONSTRAINT TRIGGER tokens_register_opening_decision_effect AFTER INSERT ON tokens_registeropeningdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_opening_decision();

CREATE TRIGGER tokens_register_opening_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registeropeningdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening_decision();

CREATE TRIGGER tokens_register_particulars_change_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerparticularschange FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_particulars_change();

CREATE CONSTRAINT TRIGGER tokens_register_particulars_decision_effect AFTER INSERT ON tokens_registerparticularschangedecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_particulars_decision();

CREATE TRIGGER tokens_register_particulars_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerparticularschangedecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_particulars_decision();

CREATE CONSTRAINT TRIGGER tokens_company_pause_preparation AFTER INSERT ON tokens_registerpausechange DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_preparation();

CREATE TRIGGER tokens_company_pause_source BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerpausechange FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_pause();

CREATE TRIGGER tokens_company_pause_decision BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerpausechangedecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_pause_decision();

CREATE CONSTRAINT TRIGGER tokens_company_pause_decision_effect AFTER INSERT ON tokens_registerpausechangedecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_decision();

CREATE TRIGGER tokens_register_position_projection BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerposition FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_position();

CREATE TRIGGER tokens_register_reconciliation_record BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerreconciliation FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_reconciliation();

CREATE TRIGGER tokens_register_transfer_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registertransfer FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_transfer();

CREATE CONSTRAINT TRIGGER tokens_register_transfer_decision_effect AFTER INSERT ON tokens_registertransferdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_transfer_decision();

CREATE TRIGGER tokens_register_transfer_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registertransferdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_transfer_decision();

CREATE TRIGGER tokens_register_wallet_link_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerwalletlink FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_wallet_link();

CREATE CONSTRAINT TRIGGER tokens_register_link_decision_effect AFTER INSERT ON tokens_registerwalletlinkdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_link_decision();

CREATE TRIGGER tokens_register_link_decision_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_registerwalletlinkdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_link_decision();

CREATE TRIGGER protect_issuance_projection BEFORE INSERT OR DELETE OR UPDATE ON tokens_shareissuance FOR EACH ROW EXECUTE FUNCTION protect_issuance_projection();

CREATE TRIGGER protect_issuance_execution BEFORE INSERT OR DELETE OR UPDATE ON tokens_shareissuanceexecution FOR EACH ROW EXECUTE FUNCTION protect_issuance_execution();

CREATE TRIGGER tokens_company_issue_execution BEFORE INSERT OR UPDATE ON tokens_shareissuanceexecution FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue_execution();

CREATE CONSTRAINT TRIGGER tokens_company_issue_execution_effect AFTER INSERT OR UPDATE ON tokens_shareissuanceexecution DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_execution();

CREATE TRIGGER tokens_guard_issuance_finalized_receipt BEFORE INSERT OR UPDATE ON tokens_shareissuanceexecution FOR EACH ROW EXECUTE FUNCTION tokens_guard_issuance_finalized_receipt();

CREATE TRIGGER protect_issuance_request BEFORE INSERT OR DELETE OR UPDATE ON tokens_shareissuancerequest FOR EACH ROW EXECUTE FUNCTION protect_issuance_request();

CREATE CONSTRAINT TRIGGER tokens_company_issue_request_source AFTER INSERT OR UPDATE ON tokens_shareissuancerequest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_request();

CREATE TRIGGER tokens_issuance_review_decision BEFORE INSERT OR UPDATE ON tokens_shareissuancerequest FOR EACH ROW EXECUTE FUNCTION tokens_guard_issuance_review();

CREATE CONSTRAINT TRIGGER tokens_paid_issue_cancellation AFTER UPDATE ON tokens_shareissuancerequest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_paid_issue_cancellation();

CREATE TRIGGER tokens_shareissuancerequest_company_id_is_derived BEFORE INSERT OR UPDATE ON tokens_shareissuancerequest FOR EACH ROW EXECUTE FUNCTION tokens_shareissuancerequest_company_id_is_derived();

CREATE TRIGGER tokens_share_register_identity BEFORE INSERT OR DELETE OR UPDATE ON tokens_shareregister FOR EACH ROW EXECUTE FUNCTION tokens_guard_share_register();

CREATE TRIGGER protect_capital_token BEFORE UPDATE ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION protect_capital_token();

CREATE TRIGGER protect_issuance_token BEFORE UPDATE ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION protect_issuance_token();

CREATE TRIGGER protect_token_deployment_identity BEFORE UPDATE ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION protect_token_deployment_identity();

CREATE TRIGGER tokens_pause_projection BEFORE UPDATE ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION tokens_guard_pause_projection();

CREATE TRIGGER tokens_registered_class_company BEFORE UPDATE OF company_id ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION tokens_guard_registered_class();

CREATE TRIGGER tokens_trading_issuer_guard BEFORE UPDATE OF company_id ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION tokens_keep_trading_issuer();

CREATE TRIGGER protect_swap_approval_submission BEFORE INSERT OR DELETE OR UPDATE ON tokens_swapapprovalsubmission FOR EACH ROW EXECUTE FUNCTION protect_swap_approval_submission();

CREATE TRIGGER hold_legacy_swap BEFORE DELETE OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION hold_legacy_swap();

CREATE TRIGGER protect_swap_execution BEFORE INSERT OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION protect_swap_execution();

CREATE TRIGGER protect_swap_finalized_receipt BEFORE INSERT OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION protect_swap_finalized_receipt();

CREATE TRIGGER swaps_preserve_expiry_eligibility BEFORE UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION swaps_preserve_expiry_eligibility();

CREATE TRIGGER tokens_swap_settlement_guard BEFORE INSERT OR DELETE OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION tokens_swap_settlement_guard();

CREATE TRIGGER tokens_swaporder_buyer_wallet_id_is_derived BEFORE INSERT OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION tokens_swaporder_buyer_wallet_id_is_derived();

CREATE TRIGGER tokens_swaporder_seller_wallet_id_is_derived BEFORE INSERT OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION tokens_swaporder_seller_wallet_id_is_derived();

CREATE TRIGGER tokens_trading_swap_begin BEFORE UPDATE ON tokens_swaporder FOR EACH STATEMENT EXECUTE FUNCTION tokens_begin_trading_admission();

CREATE TRIGGER tokens_trading_swap_guard BEFORE INSERT OR UPDATE ON tokens_swaporder FOR EACH ROW EXECUTE FUNCTION tokens_guard_trading_swap();

CREATE TRIGGER protect_swap_approval BEFORE INSERT OR UPDATE ON tokens_tokendeployment FOR EACH ROW EXECUTE FUNCTION protect_swap_approval();

CREATE TRIGGER protect_token_deployment BEFORE INSERT OR DELETE OR UPDATE ON tokens_tokendeployment FOR EACH ROW EXECUTE FUNCTION protect_token_deployment();

CREATE TRIGGER tokens_order_owner_identity_guard BEFORE UPDATE ON tokens_transferorder FOR EACH ROW EXECUTE FUNCTION tokens_order_owner_identity_guard();

CREATE CONSTRAINT TRIGGER tokens_trading_birth_complete AFTER INSERT ON tokens_transferorder DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_trading_birth();

CREATE CONSTRAINT TRIGGER tokens_trading_modification_complete AFTER UPDATE ON tokens_transferorder DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_trading_modification();

CREATE TRIGGER tokens_trading_order_begin BEFORE INSERT OR UPDATE ON tokens_transferorder FOR EACH STATEMENT EXECUTE FUNCTION tokens_begin_trading_admission();

CREATE TRIGGER tokens_trading_order_guard BEFORE INSERT OR UPDATE ON tokens_transferorder FOR EACH ROW EXECUTE FUNCTION tokens_guard_trading_order();

CREATE TRIGGER protect_nav_target BEFORE UPDATE ON tokens_yieldtoken FOR EACH ROW EXECUTE FUNCTION protect_nav_target();
