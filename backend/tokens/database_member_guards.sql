CREATE FUNCTION tokens_member_identity(issuer uuid, member_uuid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT jsonb_build_object('name', held.name, 'residential_address', held.residential_address)
        FROM tokens_registermember member JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
        WHERE member.uuid = member_uuid AND member.company_id = issuer
            AND (EXISTS (SELECT 1 FROM tokens_registerposition WHERE member_id = member_uuid AND shares > 0)
                OR EXISTS (SELECT 1 FROM tokens_registeraward WHERE company_id = issuer AND member = member_uuid)
                OR tokens_register_member_left_on(member_uuid) >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 2557);
$$;
CREATE FUNCTION tokens_member_invitation_current(invitation_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_memberinvitation invitation WHERE invitation.uuid = invitation_uuid
        AND invitation.acceptance_deadline > clock_timestamp()
        AND tokens_register_appointment_current(invitation.appointment_id, invitation.company_id,
            invitation.issued_by_id, 'admin', clock_timestamp())
        AND invitation.source_snapshot = tokens_member_identity(invitation.company_id, invitation.member));
$$;
CREATE FUNCTION tokens_member_association_current(association_uuid uuid, actor bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_memberassociation association
        JOIN authentication_customuser person ON person.id = association.user_id
        JOIN customer_accounts_account account ON account.uuid = association.user_account_id
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        WHERE association.uuid = association_uuid AND association.user_id = actor AND profile.user_id = actor
            AND person.is_active AND person.is_email_verified AND association.current
            AND NOT EXISTS (SELECT 1 FROM tokens_memberassociationrevocation WHERE association_id = association.uuid)
            AND tokens_member_identity(association.company_id, association.member) IS NOT NULL);
$$;
CREATE FUNCTION tokens_member_certificate_entry(association_uuid uuid, entry_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_memberassociation association
        JOIN tokens_shareregister register ON register.company_id = association.company_id
        JOIN tokens_registerentry entry ON entry.register_id = register.uuid
        WHERE association.uuid = association_uuid AND entry.uuid = entry_uuid
            AND tokens_member_association_current(association.uuid, association.user_id)
            AND entry.kind IN ('issue', 'transfer') AND entry.corrects_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry WHERE corrects_id = entry.uuid)
            AND (SELECT coalesce(sum((change->>'shares')::numeric), 0) FROM jsonb_array_elements(entry.changes) change
                WHERE change->>'member' = association.member::text) > 0);
$$;
CREATE FUNCTION tokens_guard_member_invitation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable intended-recipient invitations' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint; at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.issued_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_invitation_issue'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'admin', at_time)
        OR NEW.intended_email !~ '^[!-~]+@[!-~]+$' OR NEW.intended_email <> lower(btrim(NEW.intended_email))
        OR NEW.code_sha256 !~ '^[0-9a-f]{64}$' OR NEW.acceptance_deadline <= at_time
        OR NEW.acceptance_deadline > at_time + interval '30 days'
        OR NEW.source_snapshot IS DISTINCT FROM tokens_member_identity(NEW.company_id, NEW.member)
        OR NEW.source_snapshot IS NULL
        OR EXISTS (SELECT 1 FROM tokens_memberassociation WHERE company_id = NEW.company_id AND member = NEW.member AND current)
    THEN RAISE EXCEPTION 'Invitations need current company administration and one exact recorded member and recipient'
        USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_member_invitation_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_memberinvitation
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_invitation();
CREATE FUNCTION tokens_guard_member_association() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; invitation tokens_memberinvitation; proof text;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain exact accepted member associations' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF TG_OP = 'UPDATE' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NOT OLD.current OR NEW.current
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_association_revoke'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR (to_jsonb(NEW) - ARRAY['current', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['current', 'updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_memberassociationrevocation revoked WHERE revoked.association_id = NEW.uuid
                AND revoked.revoked_by_id = principal AND tokens_register_appointment_current(revoked.appointment_id,
                    NEW.company_id, principal, 'admin', clock_timestamp()))
        THEN RAISE EXCEPTION 'Only exact current company revocation may end an immutable association' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO invitation FROM tokens_memberinvitation WHERE uuid = NEW.invitation_id FOR UPDATE;
    proof := current_setting('app.member_invitation_code', true);
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.user_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_invitation_accept'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text OR NOT NEW.current
        OR invitation.uuid IS NULL OR NEW.company_id IS DISTINCT FROM invitation.company_id OR NEW.member IS DISTINCT FROM invitation.member
        OR NEW.accepted_email IS DISTINCT FROM invitation.intended_email
        OR proof IS NULL OR proof !~ '^[A-Za-z0-9_-]{43}$'
        OR encode(sha256(convert_to(proof, 'UTF8')), 'hex') IS DISTINCT FROM invitation.code_sha256
        OR NOT tokens_member_invitation_current(invitation.uuid)
        OR NOT EXISTS (SELECT 1 FROM customer_accounts_account account JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
            JOIN authentication_customuser person ON person.id = profile.user_id
            WHERE account.uuid = NEW.user_account_id AND person.id = principal AND person.is_active AND person.is_email_verified
                AND person.email = invitation.intended_email)
    THEN RAISE EXCEPTION 'Acceptance needs the exact invited recipient, current source and actually owned account'
        USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_member_association_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_memberassociation
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_association();
CREATE FUNCTION tokens_guard_member_revocation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; subject tokens_memberassociation;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only member revocations' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO subject FROM tokens_memberassociation WHERE uuid = NEW.association_id;
    PERFORM 1 FROM companies_company WHERE uuid = subject.company_id FOR UPDATE;
    SELECT * INTO subject FROM tokens_memberassociation WHERE uuid = NEW.association_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.revoked_by_id IS DISTINCT FROM principal
        OR subject.uuid IS NULL OR NOT subject.current OR NEW.reason !~ '[^[:space:]]'
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_association_revoke'
        OR current_setting('app.company_id', true) IS DISTINCT FROM subject.company_id::text
        OR NOT tokens_register_appointment_current(NEW.appointment_id, subject.company_id, principal, 'admin', clock_timestamp())
    THEN RAISE EXCEPTION 'Member revocation needs exact current company administration' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_member_revocation_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_memberassociationrevocation
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_revocation();
CREATE FUNCTION tokens_guard_member_certificate_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; subject tokens_memberassociation;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain immutable member certificate requests' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO subject FROM tokens_memberassociation WHERE uuid = NEW.association_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.requested_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_certificate_request'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NOT tokens_member_association_current(NEW.association_id, principal)
        OR NEW.company_id IS DISTINCT FROM subject.company_id OR NEW.member IS DISTINCT FROM subject.member
        OR NOT tokens_member_certificate_entry(NEW.association_id, NEW.entry_id)
        OR NOT EXISTS (SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            WHERE entry.uuid = NEW.entry_id AND register.token_id = NEW.token_id AND register.company_id = NEW.company_id)
    THEN RAISE EXCEPTION 'Certificate requests need an exact genuine receiving effect for this associated member'
        USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_member_certificate_request_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_membercertificaterequest
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_certificate_request();
CREATE FUNCTION tokens_guard_member_certificate_withdrawal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; source tokens_membercertificaterequest;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only member certificate withdrawals' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id;
    PERFORM 1 FROM companies_company WHERE uuid = source.company_id FOR UPDATE;
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.withdrawn_by_id IS DISTINCT FROM principal
        OR source.uuid IS NULL OR source.requested_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_certificate_withdraw'
        OR current_setting('app.company_id', true) IS DISTINCT FROM source.company_id::text
        OR NOT tokens_member_association_current(source.association_id, principal)
    THEN RAISE EXCEPTION 'Only the own current associated requester may withdraw a certificate request' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_member_certificate_withdrawal_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_membercertificatewithdrawal
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_certificate_withdrawal();
CREATE FUNCTION tokens_check_member_source() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE subject tokens_memberassociation; source tokens_membercertificaterequest; valid boolean;
BEGIN
    CASE TG_TABLE_NAME
    WHEN 'tokens_memberinvitation' THEN
        valid := tokens_member_invitation_current(NEW.uuid);
    WHEN 'tokens_memberassociation' THEN
        IF TG_OP = 'INSERT' THEN
            valid := tokens_member_invitation_current(NEW.invitation_id) AND tokens_member_association_current(NEW.uuid, NEW.user_id)
                AND EXISTS (SELECT 1 FROM authentication_customuser WHERE id = NEW.user_id AND email = NEW.accepted_email);
        ELSE valid := NOT EXISTS (SELECT 1 FROM tokens_memberassociation WHERE uuid = NEW.uuid AND current); END IF;
    WHEN 'tokens_memberassociationrevocation' THEN
        SELECT * INTO subject FROM tokens_memberassociation WHERE uuid = NEW.association_id;
        valid := NOT subject.current AND tokens_register_appointment_current(NEW.appointment_id, subject.company_id,
            NEW.revoked_by_id, 'admin', clock_timestamp());
    WHEN 'tokens_membercertificaterequest' THEN
        valid := tokens_member_association_current(NEW.association_id, NEW.requested_by_id)
            AND tokens_member_certificate_entry(NEW.association_id, NEW.entry_id);
    WHEN 'tokens_membercertificatewithdrawal' THEN
        SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id;
        valid := tokens_member_association_current(source.association_id, NEW.withdrawn_by_id);
    END CASE;
    IF valid IS NOT TRUE THEN RAISE EXCEPTION 'Exact member identity and authority must remain current at commit' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_member_invitation_commit AFTER INSERT ON tokens_memberinvitation
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_source();
CREATE CONSTRAINT TRIGGER tokens_member_association_commit AFTER INSERT OR UPDATE ON tokens_memberassociation
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_source();
CREATE CONSTRAINT TRIGGER tokens_member_revocation_commit AFTER INSERT ON tokens_memberassociationrevocation
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_source();
CREATE CONSTRAINT TRIGGER tokens_member_certificate_request_commit AFTER INSERT ON tokens_membercertificaterequest
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_source();
CREATE CONSTRAINT TRIGGER tokens_member_certificate_withdrawal_commit AFTER INSERT ON tokens_membercertificatewithdrawal
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_source();
