CREATE OR REPLACE FUNCTION public.tokens_reproject_register()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    later tokens_registerentry;
    previous text;
    blocking bigint;
BEGIN
    IF companies_entry_disposal_register() IS DISTINCT FROM OLD.register_id THEN
        RETURN OLD;
    END IF;
    PERFORM 1 FROM tokens_shareregister WHERE uuid = OLD.register_id FOR UPDATE;
    SELECT entry_hash INTO previous FROM tokens_registerentry
        WHERE register_id = OLD.register_id AND sequence = OLD.sequence - 1;
    previous := COALESCE(previous, repeat('0', 64));
    FOR later IN SELECT * FROM tokens_registerentry
        WHERE register_id = OLD.register_id AND sequence > OLD.sequence ORDER BY sequence
    LOOP
        later.sequence := later.sequence - 1;
        later.previous_hash := previous;
        later.entry_hash := tokens_register_entry_hash(later);
        UPDATE tokens_registerentry SET sequence = later.sequence, previous_hash = later.previous_hash,
            entry_hash = later.entry_hash WHERE uuid = later.uuid;
        previous := later.entry_hash;
    END LOOP;
    WITH movement AS (
        SELECT entry.uuid AS entry_id, entry.sequence, entry.kind, (effect->>'member')::uuid AS member,
            (effect->>'shares')::numeric AS delta
        FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
        WHERE entry.register_id = OLD.register_id
    ), running AS (
        SELECT movement.*, sum(delta) OVER (PARTITION BY member ORDER BY sequence) AS held FROM movement
    )
    SELECT min(sequence) INTO blocking FROM running
        WHERE held < 0 OR (kind = 'cessation' AND (delta > 0 OR held <> 0))
            OR EXISTS (SELECT 1 FROM tokens_registermembercessation ceased
                WHERE ceased.register_id = OLD.register_id AND ceased.entry_id = running.entry_id
                    AND ceased.member_id = running.member AND (held <> 0 OR held - delta <= 0));
    IF blocking IS NOT NULL THEN
        RAISE EXCEPTION 'Deleting this entry would leave entry % of the register without valid holdings', blocking
            USING ERRCODE = '23514';
    END IF;
    WITH movement AS (
        SELECT entry.uuid AS entry_id, entry.sequence, entry.created_at,
            tokens_register_transition_on(entry) AS transition_on,
            (effect->>'member')::uuid AS member, (effect->>'shares')::numeric AS delta
        FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
        WHERE entry.register_id = OLD.register_id
    ), running AS (
        SELECT movement.*, sum(delta) OVER (PARTITION BY member ORDER BY sequence) AS held FROM movement
    ), final AS (
        SELECT DISTINCT ON (member) member, held AS shares, entry_id, created_at
        FROM running ORDER BY member, sequence DESC
    ), entered AS (
        SELECT DISTINCT ON (member) member, transition_on
        FROM running WHERE held - delta = 0 ORDER BY member, sequence DESC
    )
    UPDATE tokens_registerposition position SET shares = final.shares, entered_on = entered.transition_on,
        last_entry_id = final.entry_id, updated_at = final.created_at
    FROM final JOIN entered USING (member)
    WHERE position.register_id = OLD.register_id AND position.member_id = final.member
        AND (position.shares, position.entered_on, position.last_entry_id)
            IS DISTINCT FROM (final.shares, entered.transition_on, final.entry_id);
    DELETE FROM tokens_registerposition position WHERE position.register_id = OLD.register_id
        AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
            WHERE entry.register_id = OLD.register_id AND effect->>'member' = position.member_id::text);
    UPDATE tokens_registermembercessation SET returned_entry_id = NULL, returned_on = NULL, returned_at = NULL,
        updated_at = clock_timestamp()
        WHERE register_id = OLD.register_id AND returned_entry_id = OLD.uuid;
    UPDATE tokens_shareregister SET
        sequence = COALESCE((SELECT max(sequence) FROM tokens_registerentry WHERE register_id = OLD.register_id), 0),
        head_hash = COALESCE((SELECT entry_hash FROM tokens_registerentry WHERE register_id = OLD.register_id
            ORDER BY sequence DESC LIMIT 1), repeat('0', 64)),
        issued_supply = COALESCE((SELECT sum(shares) FROM tokens_registerposition
            WHERE register_id = OLD.register_id), 0),
        updated_at = clock_timestamp()
        WHERE uuid = OLD.register_id;
    RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS tokens_register_entry_reprojection ON tokens_registerentry;
CREATE TRIGGER tokens_register_entry_reprojection AFTER DELETE ON tokens_registerentry
    FOR EACH ROW EXECUTE FUNCTION tokens_reproject_register();
