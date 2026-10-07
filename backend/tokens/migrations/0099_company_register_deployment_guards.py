from importlib import import_module

from django.db import migrations

IMPORTS = import_module("tokens.migrations.0084_company_register_import_guards")
FOUNDATION = import_module("tokens.migrations.0062_register_foundation")
DEPLOYMENT = import_module("tokens.migrations.0044_token_deployment_guards")
ISSUANCE = import_module("tokens.migrations.0048_issuance_execution_guards")
OPENING = import_module("tokens.migrations.0077_import_opening")


def _function(sql, name):
    start = sql.index(f"CREATE FUNCTION {name}(")
    end = sql.index("\n$$;", start) + len("\n$$;")
    return sql[start:end].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


FUNCTIONS = """
CREATE FUNCTION tokens_register_deployment_approval(proposal_uuid uuid, at_time timestamptz) RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT decision.uuid FROM tokens_registerdeploymentdecision decision
        JOIN tokens_registerdeployment proposal ON proposal.uuid = decision.register_deployment_id
        WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time)
        ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$$;
CREATE FUNCTION tokens_register_deployment_approved(proposal_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_deployment_approval(proposal_uuid, at_time) IS NOT NULL;
$$;
CREATE FUNCTION tokens_register_deployment_ready(proposal tokens_registerdeployment, before_effect boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
$$;
CREATE FUNCTION tokens_register_deployment_source_current(proposal_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerdeployment proposal
        JOIN tokens_registerdeploymentdecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registerdeploymentdecision application ON application.register_deployment_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid AND proposal.status = 'applied'
            AND approval.register_deployment_id = proposal.uuid AND approval.kind = 'approve'
            AND application.decided_by_id = proposal.reviewed_by_id AND application.decided_at = proposal.reviewed_at
            AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', at_time)
            AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', at_time));
$$;
CREATE FUNCTION tokens_register_deployment_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
$$;
CREATE FUNCTION tokens_guard_register_deployment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
$$;
CREATE TRIGGER tokens_register_deployment_source BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerdeployment
FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_deployment();
CREATE FUNCTION tokens_check_register_deployment_preparation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id,
            NEW.submitted_by_id, 'prepare', clock_timestamp()) OR NOT tokens_register_deployment_ready(NEW, true) THEN
        RAISE EXCEPTION 'Deployment preparation retains current authority and exact terms at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_deployment_preparation AFTER INSERT ON tokens_registerdeployment
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_deployment_preparation();
CREATE FUNCTION tokens_guard_register_deployment_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
$$;
CREATE TRIGGER tokens_register_deployment_decision BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerdeploymentdecision
FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_deployment_decision();
CREATE FUNCTION tokens_check_register_deployment_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
$$;
CREATE CONSTRAINT TRIGGER tokens_register_deployment_effect AFTER INSERT ON tokens_registerdeploymentdecision
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_deployment_decision();
CREATE FUNCTION tokens_check_deployment_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
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
$$;
CREATE TRIGGER tokens_deployment_signature_source BEFORE INSERT ON blockchain_signedattempt
FOR EACH ROW EXECUTE FUNCTION tokens_check_deployment_signature();
CREATE CONSTRAINT TRIGGER tokens_deployment_signature_current AFTER INSERT ON blockchain_signedattempt
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_deployment_signature();
"""

OLD_TOKEN = _function(DEPLOYMENT.GUARD, "protect_token_deployment_identity")
TOKEN = OLD_TOKEN.replace(
    "    RETURN NEW;",
    """    IF OLD.deployment_id IS NULL AND NEW.deployment_id IS NOT NULL AND NOT EXISTS (
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
    RETURN NEW;""",
)
OLD_JOURNAL = _function(DEPLOYMENT.GUARD, "protect_token_deployment")
JOURNAL = OLD_JOURNAL.replace(
    "    IF TG_OP = 'UPDATE' THEN",
    """    IF TG_OP = 'INSERT' AND NEW.source_deployment_id IS NOT NULL AND NOT EXISTS (
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
    IF TG_OP = 'UPDATE' THEN""",
    1,
)
OLD_ISSUANCE = _function(ISSUANCE.GUARDS, "protect_issuance_execution")
ISSUANCE_GUARD = OLD_ISSUANCE.replace(
    "    SELECT * INTO request",
    f"""    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'failed' AND NEW.status = 'queued'))
        AND {OPENING.OPENED_BY_IMPORT.format(scope=" AND i.token_id = NEW.token_id")} THEN
        RAISE EXCEPTION 'Imported registers require attributed issuance execution' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO request""",
    1,
)
OLD_ENTRY = _function(FOUNDATION.GUARDS, "tokens_guard_register_entry")
ENTRY = OLD_ENTRY.replace(
    "    original tokens_registerentry;",
    """    original tokens_registerentry;
    deployment_source tokens_registerdeployment;
    deployment_journal tokens_tokendeployment;""",
).replace(
    "    IF NEW.kind NOT IN",
    """    SELECT proposal.* INTO deployment_source FROM tokens_registerdeployment proposal JOIN tokens_sharetoken token
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
    IF NEW.kind NOT IN""",
    1,
)

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_registerdeployment) OR EXISTS (SELECT 1 FROM tokens_registerdeploymentdecision)
        OR EXISTS (SELECT 1 FROM tokens_tokendeployment WHERE source_deployment_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot remove retained company deployment history';
    END IF;
END $$;
DROP TRIGGER tokens_deployment_signature_current ON blockchain_signedattempt;
DROP TRIGGER tokens_deployment_signature_source ON blockchain_signedattempt;
DROP FUNCTION tokens_check_deployment_signature();
DROP TRIGGER tokens_register_deployment_effect ON tokens_registerdeploymentdecision;
DROP TRIGGER tokens_register_deployment_decision ON tokens_registerdeploymentdecision;
DROP TRIGGER tokens_register_deployment_source ON tokens_registerdeployment;
DROP TRIGGER tokens_register_deployment_preparation ON tokens_registerdeployment;
DROP FUNCTION tokens_check_register_deployment_preparation();
DROP FUNCTION tokens_check_register_deployment_decision();
DROP FUNCTION tokens_guard_register_deployment_decision();
DROP FUNCTION tokens_guard_register_deployment();
DROP FUNCTION tokens_register_deployment_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_deployment_source_current(uuid, timestamptz);
DROP FUNCTION tokens_register_deployment_ready(tokens_registerdeployment, boolean);
DROP FUNCTION tokens_register_deployment_approved(uuid, timestamptz);
DROP FUNCTION tokens_register_deployment_approval(uuid, timestamptz);
""" + OLD_ENTRY + OLD_ISSUANCE + OLD_JOURNAL + OLD_TOKEN


def install(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(IMPORTS._with_roles(cursor, FUNCTIONS + TOKEN + JOURNAL + ISSUANCE_GUARD + ENTRY))


def reverse(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REVERSE)


class Migration(migrations.Migration):
    dependencies = [("tokens", "0098_company_register_deployments")]
    operations = [migrations.RunPython(install, reverse)]
