from django.db import migrations

GUARD = """
CREATE FUNCTION protect_nav_update() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;
CREATE TRIGGER protect_nav_update BEFORE INSERT OR UPDATE OR DELETE ON tokens_navupdate
FOR EACH ROW EXECUTE FUNCTION protect_nav_update();

CREATE FUNCTION protect_nav_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;
CREATE TRIGGER protect_nav_operation BEFORE INSERT OR UPDATE ON blockchain_outgoingoperation
FOR EACH ROW EXECUTE FUNCTION protect_nav_operation();

CREATE FUNCTION protect_nav_target() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;
CREATE TRIGGER protect_nav_target BEFORE UPDATE ON tokens_yieldtoken
FOR EACH ROW EXECUTE FUNCTION protect_nav_target();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_navupdate WHERE mode <> 'historical') THEN
        RAISE EXCEPTION 'Cannot remove admitted NAV submission or recovery history';
    END IF;
END $$;
DROP TRIGGER protect_nav_target ON tokens_yieldtoken;
DROP FUNCTION protect_nav_target();
DROP TRIGGER protect_nav_operation ON blockchain_outgoingoperation;
DROP FUNCTION protect_nav_operation();
DROP TRIGGER protect_nav_update ON tokens_navupdate;
DROP FUNCTION protect_nav_update();
"""


class Migration(migrations.Migration):
    dependencies = [("tokens", "0053_nav_update_recovery")]
    operations = [migrations.RunSQL(GUARD, REVERSE)]
