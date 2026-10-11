CREATE OR REPLACE FUNCTION public.blockchain_guard_outgoing_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' OR TG_TABLE_NAME = 'blockchain_signedattempt' THEN
        RAISE EXCEPTION 'Outgoing transaction history cannot be changed or deleted';
    END IF;
    IF TG_TABLE_NAME = 'blockchain_signingaccount' THEN
        IF NEW.chain_id IS DISTINCT FROM OLD.chain_id OR NEW.address IS DISTINCT FROM OLD.address
           OR NEW.next_nonce < OLD.next_nonce THEN
            RAISE EXCEPTION 'Outgoing signer identity and reserved nonces cannot be rewound';
        END IF;
    ELSE
        IF NEW.operation_key IS DISTINCT FROM OLD.operation_key OR NEW.intent IS DISTINCT FROM OLD.intent THEN
            RAISE EXCEPTION 'Outgoing operation identity cannot be changed';
        END IF;
        IF NEW.claim_id IS DISTINCT FROM OLD.claim_id THEN
            IF OLD.status NOT IN ('failed', 'reverted') OR NEW.status <> 'preparing'
               OR NEW.current_attempt_id IS NOT NULL THEN
                RAISE EXCEPTION 'Only a proved unsuccessful outgoing attempt can be restarted';
            END IF;
        ELSIF (OLD.status IN ('failed', 'confirmed', 'reverted') AND NEW.status <> OLD.status)
           OR (OLD.status = 'signed' AND NEW.status NOT IN ('signed', 'confirmed', 'reverted'))
           OR (OLD.status = 'preparing' AND NEW.status NOT IN ('preparing', 'signed', 'failed'))
           OR (OLD.current_attempt_id IS NOT NULL AND NEW.current_attempt_id IS DISTINCT FROM OLD.current_attempt_id)
        THEN
            RAISE EXCEPTION 'The outgoing attempt cannot be replaced or rewound';
        END IF;
        IF NEW.current_attempt_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM blockchain_signedattempt
             WHERE uuid = NEW.current_attempt_id AND operation_id = NEW.uuid AND claim_id = NEW.claim_id
        ) THEN
            RAISE EXCEPTION 'The outgoing operation must identify its own signed attempt';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.blockchain_guard_outgoing_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Outgoing history observations and cutover holds cannot be changed or deleted';
END;
$function$;

CREATE OR REPLACE FUNCTION public.blockchain_guard_signer_admission()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.admission_generation < OLD.admission_generation
       OR (NEW.admission_state IS DISTINCT FROM OLD.admission_state
           AND NEW.admission_generation <= OLD.admission_generation) THEN
        RAISE EXCEPTION 'Outgoing signer admission generations cannot be reused or rewound';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.blockchain_guard_fresh_bootstrap()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'Fresh signer bootstrap evidence cannot be changed or deleted';
END;
$function$;

CREATE TRIGGER blockchain_outgoingoperation_identity BEFORE DELETE OR UPDATE ON blockchain_outgoingoperation FOR EACH ROW EXECUTE FUNCTION blockchain_guard_outgoing_identity();

CREATE TRIGGER blockchain_signingaccount_identity BEFORE DELETE OR UPDATE ON blockchain_signingaccount FOR EACH ROW EXECUTE FUNCTION blockchain_guard_outgoing_identity();

CREATE TRIGGER blockchain_signedattempt_identity BEFORE DELETE OR UPDATE ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION blockchain_guard_outgoing_identity();

CREATE TRIGGER blockchain_outgoinghistorycapture_immutable BEFORE DELETE OR UPDATE ON blockchain_outgoinghistorycapture FOR EACH ROW EXECUTE FUNCTION blockchain_guard_outgoing_inventory();

CREATE TRIGGER blockchain_outgoinghistoryevidence_immutable BEFORE DELETE OR UPDATE ON blockchain_outgoinghistoryevidence FOR EACH ROW EXECUTE FUNCTION blockchain_guard_outgoing_inventory();

CREATE TRIGGER blockchain_outgoingcutoverhold_immutable BEFORE DELETE OR UPDATE ON blockchain_outgoingcutoverhold FOR EACH ROW EXECUTE FUNCTION blockchain_guard_outgoing_inventory();

CREATE TRIGGER blockchain_signingaccount_admission BEFORE UPDATE ON blockchain_signingaccount FOR EACH ROW EXECUTE FUNCTION blockchain_guard_signer_admission();

CREATE TRIGGER blockchain_freshsignerbootstrap_immutable BEFORE DELETE OR UPDATE ON blockchain_freshsignerbootstrap FOR EACH ROW EXECUTE FUNCTION blockchain_guard_fresh_bootstrap();
