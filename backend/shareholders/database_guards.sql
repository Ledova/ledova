CREATE OR REPLACE FUNCTION public.shareholders_distribution_adds_up()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    roll record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM shareholders_publication made WHERE made.uuid = NEW.uuid) THEN
        RETURN NULL;
    END IF;
    SELECT coalesce(sum(held.shares), 0) AS shares, coalesce(sum(held.entitlement), 0) AS entitled INTO roll
        FROM shareholders_publicationrecipient held WHERE held.publication_id = NEW.uuid;
    IF NEW.declared_total <> trunc(roll.shares * NEW.rate_per_share, 2)
        OR roll.entitled + NEW.undistributed <> NEW.declared_total
    THEN
        RAISE EXCEPTION 'A distribution''s declared total is its roll''s shares times its rate, rounded down to the cent, and its entitlements and undistributed remainder add up to it'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shareholders_guard_publication()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A publication is frozen once it is made' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = __APP__ THEN
            RAISE EXCEPTION 'Only the retention purge removes a publication' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF NOT EXISTS (
            SELECT 1 FROM tokens_sharetoken listed
            WHERE listed.uuid = NEW.token_id AND listed.company_id = NEW.company_id
              AND listed.status IN ('deployed', 'paused') AND length(listed.contract_address) > 0
        )
        OR NOT EXISTS (
            SELECT 1 FROM tokens_shareregister opened
            WHERE opened.token_id = NEW.token_id AND opened.company_id = NEW.company_id
              AND opened.sequence = NEW.register_sequence AND opened.head_hash = NEW.register_head_hash
        )
        OR NOT EXISTS (
            SELECT 1 FROM companies_companydocument authority
            WHERE authority.uuid = NEW.authority_document AND authority.company_id = NEW.company_id
              AND authority.is_verified AND authority.verified_by_id IS NOT NULL
              AND authority.verified_fingerprint = NEW.authority_fingerprint
        )
        OR NEW.file !~ ('^companies/' || NEW.company_id || '/publications/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
    THEN
        RAISE EXCEPTION 'A publication requires a share class on chain, deployed or paused, its opened register head and the company''s verified authority' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shareholders_guard_publication_event()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    published shareholders_publication;
    addressed shareholders_publicationrecipient;
    latest shareholders_publicationevent;
    latest_record text;
    counted record;
    eligible record;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A publication''s record of events cannot be rewritten' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = __APP__ THEN
            RAISE EXCEPTION 'Only the retention purge removes a publication''s record of events' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO published FROM shareholders_publication WHERE uuid = NEW.publication_id FOR UPDATE;
    IF NOT FOUND OR published.company_id <> NEW.company_id
        OR (published.kind = 'resolution') <> (NEW.kind IN ('ballot', 'close'))
        OR (published.kind = 'distribution') <> (NEW.kind IN ('payment', 'payment_void'))
    THEN
        RAISE EXCEPTION 'Only a resolution records ballots and a close, and only a distribution records payments, each under its own company'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.kind = 'ballot' THEN
        IF EXISTS (
            SELECT 1 FROM shareholders_publicationevent closed
            WHERE closed.publication_id = published.uuid AND closed.kind = 'close'
        ) THEN
            RAISE EXCEPTION 'This resolution has closed and takes no more ballots' USING ERRCODE = '23514';
        END IF;
        IF now() < published.opens_at OR now() >= published.closes_at THEN
            RAISE EXCEPTION 'A ballot is cast only while the resolution is open' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO addressed FROM shareholders_publicationrecipient
            WHERE uuid = NEW.recipient_id AND publication_id = published.uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'A ballot is cast for a member on this resolution''s roll' USING ERRCODE = '23514';
        END IF;
        IF NEW.staff_entered THEN
            IF NEW.authority ~ '^\s*$' OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser staff
                WHERE staff.id = NEW.actor_id AND staff.is_active AND staff.is_staff
            ) THEN
                RAISE EXCEPTION 'A staff-entered ballot names its authority and an active staff member'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF addressed.user_id IS NULL OR NEW.actor_id IS DISTINCT FROM addressed.user_id THEN
            RAISE EXCEPTION 'A member casts only their own ballot' USING ERRCODE = '23514';
        END IF;
        NEW.shares := addressed.shares;
        NEW.payload := NULL;
    ELSIF NEW.kind = 'close' THEN
        IF EXISTS (
            SELECT 1 FROM shareholders_publicationevent closed
            WHERE closed.publication_id = published.uuid AND closed.kind = 'close'
        ) THEN
            RAISE EXCEPTION 'A resolution closes once' USING ERRCODE = '23514';
        END IF;
        IF now() < published.closes_at THEN
            RAISE EXCEPTION 'A resolution closes only once its window has passed' USING ERRCODE = '23514';
        END IF;
        SELECT
            coalesce(sum(ballot.shares) FILTER (WHERE ballot.choice = 'for'), 0) AS for_shares,
            count(*) FILTER (WHERE ballot.choice = 'for') AS for_members,
            coalesce(sum(ballot.shares) FILTER (WHERE ballot.choice = 'against'), 0) AS against_shares,
            count(*) FILTER (WHERE ballot.choice = 'against') AS against_members,
            coalesce(sum(ballot.shares) FILTER (WHERE ballot.choice = 'abstain'), 0) AS abstain_shares,
            count(*) FILTER (WHERE ballot.choice = 'abstain') AS abstain_members
            INTO counted
            FROM shareholders_publicationevent ballot
            WHERE ballot.publication_id = published.uuid AND ballot.kind = 'ballot';
        SELECT coalesce(sum(held.shares), 0) AS shares, count(*) AS members INTO eligible
            FROM shareholders_publicationrecipient held WHERE held.publication_id = published.uuid;
        NEW.shares := NULL;
        NEW.payload := jsonb_build_object(
            'basis', published.vote_basis,
            'resolution_kind', published.resolution_kind,
            'for', jsonb_build_object('shares', counted.for_shares::text, 'members', counted.for_members),
            'against', jsonb_build_object('shares', counted.against_shares::text, 'members', counted.against_members),
            'abstain', jsonb_build_object('shares', counted.abstain_shares::text, 'members', counted.abstain_members),
            'eligible', jsonb_build_object('shares', eligible.shares::text, 'members', eligible.members),
            'carried', CASE published.resolution_kind
                WHEN 'ordinary' THEN counted.for_shares > counted.against_shares
                WHEN 'special' THEN counted.for_shares + counted.against_shares > 0
                    AND counted.for_shares * 4 >= (counted.for_shares + counted.against_shares) * 3
            END
        );
    ELSIF NEW.kind IN ('payment', 'payment_void') THEN
        IF NOT EXISTS (
            SELECT 1 FROM authentication_customuser staff
            WHERE staff.id = NEW.actor_id AND staff.is_active AND staff.is_staff
        ) THEN
            RAISE EXCEPTION 'A payment record names an active staff member' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO addressed FROM shareholders_publicationrecipient
            WHERE uuid = NEW.recipient_id AND publication_id = published.uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'A payment is recorded for a member on this distribution''s roll' USING ERRCODE = '23514';
        END IF;
        SELECT recorded.kind INTO latest_record FROM shareholders_publicationevent recorded
            WHERE recorded.publication_id = published.uuid AND recorded.recipient_id = addressed.uuid
            ORDER BY recorded.sequence DESC LIMIT 1;
        IF NEW.kind = 'payment' THEN
            IF coalesce(addressed.entitlement, 0) <= 0 THEN
                RAISE EXCEPTION 'A payment is recorded only for a member entitled to at least a cent'
                    USING ERRCODE = '23514';
            END IF;
            IF latest_record = 'payment' THEN
                RAISE EXCEPTION 'This member already has a payment recorded, and it must be withdrawn before another'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.evidence !~ ('^companies/' || NEW.company_id || '/publications/' || NEW.publication_id
                || '/payments/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$') THEN
                RAISE EXCEPTION 'A payment''s evidence is stored under its own record' USING ERRCODE = '23514';
            END IF;
        ELSIF latest_record IS DISTINCT FROM 'payment' THEN
            RAISE EXCEPTION 'Only a recorded payment can be withdrawn' USING ERRCODE = '23514';
        END IF;
        NEW.shares := NULL;
        NEW.payload := NULL;
    ELSE
        RAISE EXCEPTION 'A publication records ballots, a close and payment records' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO latest FROM shareholders_publicationevent chained
        WHERE chained.publication_id = published.uuid ORDER BY chained.sequence DESC LIMIT 1;
    NEW.sequence := coalesce(latest.sequence, 0) + 1;
    NEW.previous_hash := coalesce(latest.entry_hash, repeat('0', 64));
    NEW.entry_hash := shareholders_publication_event_hash(NEW);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shareholders_guard_publication_recipient()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    made shareholders_publication;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A frozen roll row cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = __APP__ THEN
            RAISE EXCEPTION 'Only the retention purge removes a frozen roll' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO made FROM shareholders_publication
        WHERE uuid = NEW.publication_id AND company_id = NEW.company_id;
    IF NOT FOUND
        OR (NEW.user_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM authentication_customuser reader WHERE reader.id = NEW.user_id
        ))
    THEN
        RAISE EXCEPTION 'A roll row belongs to its publication''s company and names a real account' USING ERRCODE = '23514';
    END IF;
    IF made.kind = 'distribution' THEN
        IF NEW.entitlement IS DISTINCT FROM trunc(NEW.shares * made.rate_per_share, 2) THEN
            RAISE EXCEPTION 'A distribution''s roll row is entitled to its shares times the rate, rounded down to the cent'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.entitlement IS NOT NULL THEN
        RAISE EXCEPTION 'Only a distribution''s roll row carries an entitlement' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shareholders_publication_event_hash(event shareholders_publicationevent)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT encode(sha256(convert_to((CASE WHEN event.kind IN ('payment', 'payment_void') THEN jsonb_build_array(
        'ledova-publication-event-v2', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload,
        event.paid_on, event.reference, event.evidence, event.evidence_digest, event.evidence_mime_type,
        event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ELSE jsonb_build_array(
        'ledova-publication-event-v1', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload, event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) END)::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.shareholders_publication_event_preimage(event shareholders_publicationevent)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT (CASE WHEN event.kind IN ('payment', 'payment_void') THEN jsonb_build_array(
        'ledova-publication-event-v2', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload,
        event.paid_on, event.reference, event.evidence, event.evidence_digest, event.evidence_mime_type,
        event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ELSE jsonb_build_array(
        'ledova-publication-event-v1', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload, event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) END)::text;
$function$;

CREATE CONSTRAINT TRIGGER shareholders_distribution_adds_up AFTER INSERT ON shareholders_publication DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.kind::text = 'distribution'::text) EXECUTE FUNCTION shareholders_distribution_adds_up();

CREATE TRIGGER shareholders_publication_is_frozen BEFORE INSERT OR DELETE OR UPDATE ON shareholders_publication FOR EACH ROW EXECUTE FUNCTION shareholders_guard_publication();

CREATE TRIGGER shareholders_publication_event_chain BEFORE INSERT OR DELETE OR UPDATE ON shareholders_publicationevent FOR EACH ROW EXECUTE FUNCTION shareholders_guard_publication_event();

CREATE TRIGGER shareholders_publication_roll_is_frozen BEFORE INSERT OR DELETE OR UPDATE ON shareholders_publicationrecipient FOR EACH ROW EXECUTE FUNCTION shareholders_guard_publication_recipient();
