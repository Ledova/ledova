CREATE OR REPLACE FUNCTION public.transactions_user_account_is_derived()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    parent_account_id wallets.user_account_id%TYPE;
BEGIN
    SELECT parent.user_account_id INTO parent_account_id
    FROM wallets AS parent
    WHERE parent.uuid = NEW.wallet_id;

    IF parent_account_id IS NULL THEN
        RAISE EXCEPTION 'transactions.user_account_id cannot be derived: wallet % has no user_account', NEW.wallet_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
           AND parent_account_id IS DISTINCT FROM OLD.user_account_id THEN
            RAISE EXCEPTION 'transactions.wallet_id cannot move this row to another user_account, from % to %',
                OLD.user_account_id, parent_account_id;
        END IF;

        IF NEW.user_account_id IS NULL OR NEW.user_account_id IS NOT DISTINCT FROM OLD.user_account_id THEN
            NEW.user_account_id := parent_account_id;
        ELSIF NEW.user_account_id <> parent_account_id THEN
            RAISE EXCEPTION 'transactions.user_account_id cannot be moved to %: wallet % names %',
                NEW.user_account_id, NEW.wallet_id, parent_account_id;
        END IF;
    ELSE
        IF NEW.user_account_id IS NULL THEN
            NEW.user_account_id := parent_account_id;
        ELSIF NEW.user_account_id <> parent_account_id THEN
            RAISE EXCEPTION 'transactions.user_account_id % does not match wallet.user_account_id %',
                NEW.user_account_id, parent_account_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_submission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Signed wallet submissions cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF to_jsonb(NEW) - ARRAY['last_attempt_at', 'acknowledged_at', 'updated_at']
            IS DISTINCT FROM to_jsonb(OLD) - ARRAY['last_attempt_at', 'acknowledged_at', 'updated_at'] THEN
            RAISE EXCEPTION 'Signed wallet submission intent cannot be changed';
        END IF;
        IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
            RAISE EXCEPTION 'A wallet submission acknowledgement cannot be changed';
        END IF;
        IF OLD.last_attempt_at IS NOT NULL AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < OLD.last_attempt_at) THEN
            RAISE EXCEPTION 'A wallet submission attempt cannot be rewound';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM transactions t JOIN wallets w ON w.uuid = t.wallet_id
             WHERE t.uuid = NEW.transaction_id AND t.wallet_id = NEW.wallet_id
               AND t.user_account_id = NEW.user_account_id AND w.user_account_id = NEW.user_account_id
               AND t.asset_id = NEW.asset_id AND t.tx_hash = NEW.tx_hash AND t.nonce = NEW.nonce
               AND t.chain = NEW.chain AND lower(w.chain) = NEW.chain
               AND lower(t.from_address) = NEW.sender_address AND lower(w.address) = NEW.sender_address
               AND NOT t.imported_from_history AND t.status = 'pending'
               AND t.amount = (NEW.intent->>'amount')::numeric
               AND t.to_address = NEW.intent->>'to_address'
               AND t.transaction_fee_estimated = (NEW.intent->>'maximum_fee')::numeric
        ) OR octet_length(NEW.raw_transaction) = 0 THEN
            RAISE EXCEPTION 'A wallet submission must match its pending transaction and wallet';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_submitted_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_TABLE_NAME = 'wallets' THEN
        IF EXISTS (SELECT 1 FROM wallets_walletsubmission WHERE wallet_id = OLD.uuid) AND (
            NEW.user_account_id IS DISTINCT FROM OLD.user_account_id
            OR NEW.chain IS DISTINCT FROM OLD.chain OR NEW.address IS DISTINCT FROM OLD.address
        ) THEN
            RAISE EXCEPTION 'A wallet with signed submissions cannot change its identity';
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM wallets_walletsubmission WHERE transaction_id = OLD.uuid) AND (
            ROW(NEW.wallet_id, NEW.user_account_id, NEW.tx_hash, NEW.chain, NEW.from_address,
                NEW.to_address, NEW.amount, NEW.asset_id, NEW.nonce, NEW.transaction_fee_estimated, NEW.imported_from_history)
            IS DISTINCT FROM
            ROW(OLD.wallet_id, OLD.user_account_id, OLD.tx_hash, OLD.chain, OLD.from_address,
                OLD.to_address, OLD.amount, OLD.asset_id, OLD.nonce, OLD.transaction_fee_estimated, OLD.imported_from_history)
        ) THEN
            RAISE EXCEPTION 'A submitted transaction cannot change its signed identity';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_bitcoin_submission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Signed Bitcoin submissions cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF to_jsonb(NEW) - ARRAY['last_attempt_at', 'acknowledged_at', 'updated_at']
            IS DISTINCT FROM to_jsonb(OLD) - ARRAY['last_attempt_at', 'acknowledged_at', 'updated_at'] THEN
            RAISE EXCEPTION 'Signed Bitcoin submission intent cannot be changed';
        END IF;
        IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
            RAISE EXCEPTION 'A Bitcoin submission acknowledgement cannot be changed';
        END IF;
        IF OLD.last_attempt_at IS NOT NULL AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < OLD.last_attempt_at) THEN
            RAISE EXCEPTION 'A Bitcoin submission attempt cannot be rewound';
        END IF;
    ELSE
        IF NOT EXISTS (
            SELECT 1 FROM transactions t JOIN wallets w ON w.uuid = t.wallet_id
             WHERE t.uuid = NEW.transaction_id AND t.wallet_id = NEW.wallet_id
               AND t.user_account_id = NEW.user_account_id AND w.user_account_id = NEW.user_account_id
               AND t.asset_id = NEW.asset_id AND t.tx_hash = NEW.tx_hash AND t.nonce IS NULL
               AND t.chain = 'bitcoin' AND lower(w.chain) = 'bitcoin'
               AND t.from_address = NEW.sender_address AND w.address = NEW.sender_address
               AND NOT t.imported_from_history AND t.status = 'pending'
               AND t.amount = (NEW.intent->>'amount_satoshis')::numeric / 100000000
               AND t.to_address = NEW.intent->>'to_address'
               AND t.transaction_fee_estimated = (NEW.intent->>'fee_satoshis')::numeric / 100000000
               AND NEW.intent->>'network' = NEW.network
               AND NEW.intent->>'genesis_hash' = NEW.genesis_hash
               AND NEW.intent->>'sender_address' = NEW.sender_address
               AND (NEW.intent->>'amount_satoshis')::numeric > 0
               AND (NEW.intent->>'fee_satoshis')::numeric >= 0
               AND jsonb_typeof(NEW.intent->'inputs') = 'array'
               AND jsonb_array_length(NEW.intent->'inputs') BETWEEN 1 AND 1000
               AND octet_length(NEW.raw_transaction) BETWEEN 10 AND 400000
               AND NEW.genesis_hash = CASE NEW.network
                   WHEN 'test' THEN '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943'
                   WHEN 'regtest' THEN '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206'
               END
        ) OR EXISTS (
            SELECT 1 FROM wallets_bitcoinsubmission s WHERE s.wallet_id = NEW.wallet_id AND s.network <> NEW.network
        ) THEN
            RAISE EXCEPTION 'A Bitcoin submission must match its pending transaction, wallet and network';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_bitcoin_input()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Recorded Bitcoin inputs cannot be changed or deleted';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM wallets_bitcoinsubmission s, jsonb_array_elements(s.intent->'inputs') AS item
         WHERE s.uuid = NEW.submission_id AND s.user_account_id = NEW.user_account_id AND s.network = NEW.network
           AND item->>'tx_hash' = NEW.previous_tx_hash
           AND (item->>'output_index')::bigint = NEW.output_index
           AND (item->>'satoshis')::bigint = NEW.satoshis
           AND item->>'script' = encode(NEW.script, 'hex')
           AND item->>'observed_block_hash' = NEW.observed_block_hash
    ) THEN
        RAISE EXCEPTION 'A Bitcoin input must match its recorded signed intent and owner';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_require_bitcoin_inputs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF (SELECT count(*) FROM wallets_bitcoinsubmissioninput WHERE submission_id = NEW.uuid)
        <> jsonb_array_length(NEW.intent->'inputs') THEN
        RAISE EXCEPTION 'A Bitcoin submission requires every recorded input reservation';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_bitcoin_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_TABLE_NAME = 'wallets' THEN
        IF EXISTS (SELECT 1 FROM wallets_bitcoinsubmission WHERE wallet_id = OLD.uuid) AND (
            NEW.user_account_id IS DISTINCT FROM OLD.user_account_id
            OR NEW.chain IS DISTINCT FROM OLD.chain OR NEW.address IS DISTINCT FROM OLD.address
        ) THEN
            RAISE EXCEPTION 'A wallet with signed Bitcoin submissions cannot change its identity';
        END IF;
    ELSE
        IF EXISTS (SELECT 1 FROM wallets_bitcoinsubmission WHERE transaction_id = OLD.uuid) AND (
            ROW(NEW.wallet_id, NEW.user_account_id, NEW.tx_hash, NEW.chain, NEW.from_address,
                NEW.to_address, NEW.amount, NEW.asset_id, NEW.nonce, NEW.transaction_fee_estimated, NEW.imported_from_history)
            IS DISTINCT FROM
            ROW(OLD.wallet_id, OLD.user_account_id, OLD.tx_hash, OLD.chain, OLD.from_address,
                OLD.to_address, OLD.amount, OLD.asset_id, OLD.nonce, OLD.transaction_fee_estimated, OLD.imported_from_history)
        ) THEN
            RAISE EXCEPTION 'A submitted Bitcoin transaction cannot change its signed identity';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_chain_watch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Chain watches cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.generation <> 0 OR NEW.last_completed_at IS NOT NULL OR NEW.latest_observation_id IS NOT NULL THEN
            RAISE EXCEPTION 'A chain watch must start without observations';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM transactions t JOIN wallets w ON w.uuid = t.wallet_id
             WHERE t.uuid = NEW.transaction_id AND t.wallet_id = NEW.wallet_id
               AND t.user_account_id = NEW.user_account_id AND w.user_account_id = NEW.user_account_id
               AND t.chain = NEW.chain AND lower(w.chain) = NEW.chain AND t.tx_hash = NEW.tx_hash
               AND NOT t.imported_from_history
               AND (
                   EXISTS (
                       SELECT 1 FROM wallets_walletsubmission s
                        WHERE s.transaction_id = t.uuid AND s.wallet_id = w.uuid
                          AND s.user_account_id = NEW.user_account_id AND s.chain = NEW.chain
                          AND NEW.network = 'evm:' || s.chain_id::text AND s.tx_hash = NEW.tx_hash
                   ) OR EXISTS (
                       SELECT 1 FROM wallets_bitcoinsubmission s
                        WHERE s.transaction_id = t.uuid AND s.wallet_id = w.uuid
                          AND s.user_account_id = NEW.user_account_id AND NEW.chain = 'bitcoin'
                          AND NEW.network = 'bitcoin:' || s.genesis_hash AND s.tx_hash = NEW.tx_hash
                   )
               )
        ) THEN
            RAISE EXCEPTION 'A chain watch must match a durable wallet journal';
        END IF;
        RETURN NEW;
    END IF;
    IF to_jsonb(NEW) - ARRAY['generation', 'target_fingerprint', 'last_started_at', 'last_completed_at', 'latest_observation_id', 'updated_at']
        IS DISTINCT FROM to_jsonb(OLD) - ARRAY['generation', 'target_fingerprint', 'last_started_at', 'last_completed_at', 'latest_observation_id', 'updated_at'] THEN
        RAISE EXCEPTION 'A chain watch cannot change its recorded identity';
    END IF;
    IF NEW.generation = OLD.generation + 1 THEN
        IF NEW.last_started_at IS NULL OR NEW.last_started_at < OLD.last_started_at
            OR NEW.last_completed_at IS DISTINCT FROM OLD.last_completed_at
            OR NEW.latest_observation_id IS DISTINCT FROM OLD.latest_observation_id THEN
            RAISE EXCEPTION 'A new chain claim must retain the previous observation';
        END IF;
    ELSIF NEW.generation = OLD.generation AND NEW.target_fingerprint = OLD.target_fingerprint
        AND NEW.last_started_at IS NOT DISTINCT FROM OLD.last_started_at
        AND NEW.latest_observation_id IS DISTINCT FROM OLD.latest_observation_id
        AND NEW.last_completed_at IS NOT NULL AND NEW.last_completed_at >= NEW.last_started_at
        AND (OLD.last_completed_at IS NULL OR NEW.last_completed_at >= OLD.last_completed_at) THEN
        IF NOT EXISTS (
            SELECT 1 FROM wallets_walletchainobservation o
             WHERE o.uuid = NEW.latest_observation_id AND o.watch_id = NEW.uuid
               AND o.generation = NEW.generation AND o.target_fingerprint = NEW.target_fingerprint
               AND o.started_at = NEW.last_started_at AND o.user_account_id = NEW.user_account_id
        ) THEN
            RAISE EXCEPTION 'The latest chain observation must match its current claim';
        END IF;
    ELSE
        RAISE EXCEPTION 'Chain claims cannot be rewound or completed by another generation';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_chain_observation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Chain observations cannot be rewritten or deleted';
    END IF;
    PERFORM 1 FROM wallets_walletchainwatch w
     WHERE w.uuid = NEW.watch_id AND w.user_account_id = NEW.user_account_id
       AND w.generation = NEW.generation AND w.target_fingerprint = NEW.target_fingerprint
       AND w.last_started_at = NEW.started_at
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'A chain observation must match the current watch claim';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_possession_proof_current(proof_uuid uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (SELECT 1 FROM wallets_walletpossessionproof proof
        JOIN wallets wallet ON wallet.uuid = proof.wallet_id
        JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        WHERE proof.uuid = proof_uuid AND proof.account_id = account.uuid AND proof.profile_id = profile.uuid
            AND proof.verified_by_id = profile.user_id AND proof.address = wallet.address AND proof.chain = wallet.chain
            AND wallet.verification_status = 'VERIFIED' AND wallet.verification_signature = proof.signature
            AND wallet.verified_at = proof.completed_at);
$function$;

CREATE OR REPLACE FUNCTION public.wallets_guard_possession_proof()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE principal bigint; retained_wallet wallets; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain successful wallet possession proofs' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO retained_wallet FROM wallets WHERE uuid = NEW.wallet_id FOR UPDATE;
    IF current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@) OR principal IS NULL
        OR current_setting('app.wallet_proof_operation', true) IS DISTINCT FROM 'complete'
        OR NEW.verified_by_id IS DISTINCT FROM principal OR retained_wallet.uuid IS NULL
        OR NOT EXISTS (SELECT 1 FROM customer_accounts_account account JOIN users_userprofile profile
            ON profile.uuid = account.user_profile_id WHERE account.uuid = retained_wallet.user_account_id
            AND account.uuid = NEW.account_id AND profile.uuid = NEW.profile_id AND profile.user_id = principal)
        OR NEW.address IS DISTINCT FROM retained_wallet.address OR NEW.chain IS DISTINCT FROM retained_wallet.chain
        OR NEW.challenge IS DISTINCT FROM retained_wallet.verification_challenge
        OR NEW.challenge_issued_at IS DISTINCT FROM retained_wallet.verification_challenge_issued_at
        OR NEW.challenge_expires_at IS DISTINCT FROM NEW.challenge_issued_at + interval '@CHALLENGE_MINUTES@ minutes'
        OR NOT COALESCE(NEW.challenge ~ 'Nonce: [0-9a-f]{32}', false)
        OR NOT COALESCE(length(NEW.signature) > 0, false)
        OR NEW.challenge_issued_at > at_time OR NEW.challenge_expires_at <= at_time
    THEN RAISE EXCEPTION 'A proof must come from the actual owned current challenge producer' USING ERRCODE = '23514'; END IF;
    NEW.completed_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    NEW.digest := encode(sha256(convert_to((to_jsonb(NEW) - ARRAY['uuid', 'created_at', 'updated_at', 'digest'])::text, 'UTF8')), 'hex');
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wallets_check_possession_proof()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NEW.challenge_expires_at <= clock_timestamp() OR NOT wallets_possession_proof_current(NEW.uuid)
        OR EXISTS (SELECT 1 FROM wallets WHERE uuid = NEW.wallet_id
            AND (verification_challenge IS NOT NULL OR verification_challenge_issued_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Successful proof and wallet completion commit together within the actual challenge lifetime' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE TRIGGER transactions_user_account_is_derived BEFORE INSERT OR UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION transactions_user_account_is_derived();

CREATE TRIGGER wallets_submission_immutable BEFORE INSERT OR DELETE OR UPDATE ON wallets_walletsubmission FOR EACH ROW EXECUTE FUNCTION wallets_guard_submission();

CREATE TRIGGER wallets_submitted_wallet_identity BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION wallets_guard_submitted_identity();

CREATE TRIGGER wallets_submitted_transaction_identity BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION wallets_guard_submitted_identity();

CREATE TRIGGER wallets_bitcoin_submission_immutable BEFORE INSERT OR DELETE OR UPDATE ON wallets_bitcoinsubmission FOR EACH ROW EXECUTE FUNCTION wallets_guard_bitcoin_submission();

CREATE TRIGGER wallets_bitcoin_input_immutable BEFORE INSERT OR DELETE OR UPDATE ON wallets_bitcoinsubmissioninput FOR EACH ROW EXECUTE FUNCTION wallets_guard_bitcoin_input();

CREATE CONSTRAINT TRIGGER wallets_bitcoin_complete_inputs AFTER INSERT ON wallets_bitcoinsubmission DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallets_require_bitcoin_inputs();

CREATE TRIGGER wallets_bitcoin_wallet_identity BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION wallets_guard_bitcoin_identity();

CREATE TRIGGER wallets_bitcoin_transaction_identity BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION wallets_guard_bitcoin_identity();

CREATE TRIGGER wallets_chain_watch_identity BEFORE INSERT OR DELETE OR UPDATE ON wallets_walletchainwatch FOR EACH ROW EXECUTE FUNCTION wallets_guard_chain_watch();

CREATE TRIGGER wallets_chain_observation_immutable BEFORE INSERT OR DELETE OR UPDATE ON wallets_walletchainobservation FOR EACH ROW EXECUTE FUNCTION wallets_guard_chain_observation();

CREATE TRIGGER wallets_possession_proof_source BEFORE INSERT OR DELETE OR UPDATE ON wallets_walletpossessionproof FOR EACH ROW EXECUTE FUNCTION wallets_guard_possession_proof();

CREATE CONSTRAINT TRIGGER wallets_possession_proof_effect AFTER INSERT ON wallets_walletpossessionproof DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallets_check_possession_proof();

REVOKE ALL ON wallets_walletpossessionproof FROM @APP_IDENTIFIER@;

GRANT SELECT, INSERT, UPDATE, DELETE ON wallets_walletpossessionproof TO @OPERATOR_IDENTIFIER@;
