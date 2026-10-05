import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

SQL = """
CREATE FUNCTION whitelist_eligibility_invalidation_facts(bound_account_id uuid, bound_wallet_id uuid, bound_chain_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT jsonb_build_object('account', account.uuid::text, 'profile', profile.uuid::text,
        'holder', actor.id::text, 'role', account.role, 'standing', account.account_status,
        'active', actor.is_active, 'email_verified', actor.is_email_verified,
        'identity_verified', profile.is_id_verified, 'kyc_required', configuration.investor_kyc_required,
        'identity_provider', profile.kyc_provider, 'identity_status', profile.verification_status,
        'identity_review', profile.review_result, 'identity_observed_at', profile.verified_at,
        'standing_reason', account.rejection_reason,
        'wallet', wallet.uuid::text, 'address', lower(wallet.address), 'chain', wallet.chain,
        'wallet_verified', wallet.verification_status, 'chain_id', bound_chain_id,
        'targets', COALESCE((SELECT jsonb_agg(jsonb_build_object('company', approval.company_id::text,
            'registry', approval.registry_address, 'address', lower(target.address), 'wallet', target.uuid::text)
            ORDER BY approval.company_id, approval.registry_address, target.uuid)
            FROM whitelist_whitelistapproval approval JOIN whitelist_whitelistentry entry ON entry.uuid = approval.entry_id
            JOIN wallets target ON target.uuid = entry.wallet_id WHERE target.user_account_id = account.uuid
                AND (bound_wallet_id IS NULL OR target.uuid = bound_wallet_id)), '[]'::jsonb))
    FROM customer_accounts_account account
    JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
    JOIN authentication_customuser actor ON actor.id = profile.user_id
    JOIN operators_operator configuration ON configuration.id = 1
    LEFT JOIN wallets wallet ON wallet.uuid = bound_wallet_id AND wallet.user_account_id = account.uuid
    WHERE account.uuid = bound_account_id;
$$;
CREATE FUNCTION whitelist_invalidation_actor_permission(bound_actor_id bigint, bound_holder_id bigint,
    bound_app text, bound_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM authentication_customuser actor WHERE actor.id = bound_actor_id
        AND (actor.id = bound_holder_id OR (actor.is_active AND actor.is_staff AND (actor.is_superuser OR EXISTS (
            SELECT 1 FROM auth_permission p JOIN django_content_type ct ON ct.id = p.content_type_id
            WHERE p.codename = bound_permission AND ct.app_label = bound_app
                AND (EXISTS (SELECT 1 FROM authentication_customuser_user_permissions direct
                    WHERE direct.customuser_id = actor.id AND direct.permission_id = p.id)
                OR EXISTS (SELECT 1 FROM authentication_customuser_groups membership
                    JOIN auth_group_permissions grant_row ON grant_row.group_id = membership.group_id
                    WHERE membership.customuser_id = actor.id AND grant_row.permission_id = p.id)))))));
$$;
CREATE FUNCTION whitelist_guard_eligibility_invalidation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    principal bigint;
    actual_facts jsonb;
    effect_field text;
    permission text;
    permission_app text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Eligibility invalidation attribution is retained unchanged' USING ERRCODE = '23514';
    END IF;
    IF current_user <> __OPERATOR__ THEN
        RAISE EXCEPTION 'Eligibility invalidation requires its bounded operator entry' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    actual_facts := whitelist_eligibility_invalidation_facts(NEW.user_account_id, NEW.wallet_id, NEW.chain_id);
    IF actual_facts IS NULL OR NEW.facts IS DISTINCT FROM actual_facts THEN
        RAISE EXCEPTION 'Retain the actual account facts before its loss' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.cause_fields) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Retain the exact fields causing the loss' USING ERRCODE = '23514';
    END IF;
    IF NEW.cause_fields IS DISTINCT FROM COALESCE((SELECT jsonb_agg(DISTINCT field ORDER BY field)
        FROM jsonb_array_elements(NEW.cause_fields) field), '[]'::jsonb)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.cause_fields) field WHERE jsonb_typeof(field) <> 'string')
        OR (NEW.cause = 'wallet_removal' AND NEW.cause_fields <> '[]'::jsonb)
        OR (NEW.cause = 'identity_loss' AND NEW.cause_fields <> '["is_id_verified"]'::jsonb)
        OR (NEW.cause = 'standing_loss' AND (NEW.cause_fields = '[]'::jsonb OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(NEW.cause_fields) field
            WHERE field NOT IN ('account_status', 'role', 'is_active', 'is_email_verified'))))
    THEN RAISE EXCEPTION 'Retain the exact fields causing the loss' USING ERRCODE = '23514'; END IF;
    IF NEW.initiated_by_id IS NOT NULL THEN
        IF principal IS DISTINCT FROM NEW.initiated_by_id THEN
            RAISE EXCEPTION 'Record the actual human principal' USING ERRCODE = '23514'; END IF;
        IF NEW.cause = 'wallet_removal' THEN
            IF NOT (whitelist_invalidation_actor_permission(principal, (actual_facts->>'holder')::bigint,
                    'wallets', 'change_wallet') OR whitelist_invalidation_actor_permission(
                    principal, (actual_facts->>'holder')::bigint, 'wallets', 'delete_wallet'))
            THEN RAISE EXCEPTION 'Record the actual wallet holder or permitted technical actor'
                USING ERRCODE = '23514'; END IF;
        ELSE
            FOR effect_field IN SELECT jsonb_array_elements_text(NEW.cause_fields) LOOP
                permission := CASE WHEN effect_field IN ('is_active', 'is_email_verified') THEN 'change_customuser'
                    WHEN effect_field = 'is_id_verified' THEN 'change_userprofile' ELSE 'change_useraccount' END;
                permission_app := CASE WHEN effect_field IN ('is_active', 'is_email_verified')
                    THEN 'authentication' ELSE 'users' END;
                IF NOT whitelist_invalidation_actor_permission(principal, (actual_facts->>'holder')::bigint,
                        permission_app, permission)
                THEN RAISE EXCEPTION 'Retain the actual permission for every changed field'
                    USING ERRCODE = '23514'; END IF;
            END LOOP;
        END IF;
    ELSIF principal IS NOT NULL OR NEW.cause = 'wallet_removal' THEN
        RAISE EXCEPTION 'Automation does not invent a wallet removal actor' USING ERRCODE = '23514';
    END IF;
    IF NEW.cause = 'identity_loss' AND NOT (
        (actual_facts->>'kyc_required')::boolean AND (actual_facts->>'identity_verified')::boolean)
    THEN RAISE EXCEPTION 'Retain configured identity before its genuine loss' USING ERRCODE = '23514'; END IF;
    IF NEW.cause = 'wallet_removal' AND (actual_facts->>'wallet' IS DISTINCT FROM NEW.wallet_id::text
        OR actual_facts->>'address' IS DISTINCT FROM NEW.address OR actual_facts->>'chain' <> 'base')
    THEN RAISE EXCEPTION 'Retain the actual wallet and its holder' USING ERRCODE = '23514'; END IF;
    NEW.invalidated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_eligibility_invalidation_history
BEFORE INSERT OR UPDATE OR DELETE ON whitelist_whitelisteligibilityinvalidation
FOR EACH ROW EXECUTE FUNCTION whitelist_guard_eligibility_invalidation();
CREATE FUNCTION whitelist_check_wallet_invalidation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public SET row_security = off AS $$
DECLARE
    actual_facts jsonb;
    actual_wallet wallets%ROWTYPE;
    effect_field text;
    permission text;
    permission_app text;
BEGIN
    actual_facts := whitelist_eligibility_invalidation_facts(NEW.user_account_id, NULL, NEW.chain_id);
    IF actual_facts IS NULL OR actual_facts->>'profile' IS DISTINCT FROM NEW.facts->>'profile'
        OR actual_facts->>'holder' IS DISTINCT FROM NEW.facts->>'holder'
        OR actual_facts->>'kyc_required' IS DISTINCT FROM NEW.facts->>'kyc_required'
    THEN RAISE EXCEPTION 'Retain the original account, holder and loss configuration'
        USING ERRCODE = '23514'; END IF;
    IF NEW.cause = 'wallet_removal' THEN
        SELECT * INTO actual_wallet FROM wallets WHERE uuid = NEW.wallet_id;
        IF FOUND THEN
            IF actual_wallet.user_account_id IS DISTINCT FROM NEW.user_account_id
                OR lower(actual_wallet.address) IS DISTINCT FROM NEW.address OR actual_wallet.chain <> 'base'
                OR actual_wallet.verification_status IS DISTINCT FROM 'PENDING'
                OR NEW.facts->>'wallet_verified' IS DISTINCT FROM 'VERIFIED'
            THEN RAISE EXCEPTION 'A wallet invalidation must commit its exact verification loss or deletion'
                USING ERRCODE = '23514'; END IF;
            permission := 'change_wallet';
        ELSE
            permission := 'delete_wallet';
        END IF;
        IF NOT whitelist_invalidation_actor_permission(NEW.initiated_by_id, (NEW.facts->>'holder')::bigint,
                'wallets', permission)
        THEN RAISE EXCEPTION 'Require the actual wallet effect permission at commit' USING ERRCODE = '23514'; END IF;
    ELSE
        FOR effect_field IN SELECT jsonb_array_elements_text(NEW.cause_fields) LOOP
            IF (CASE effect_field
                WHEN 'role' THEN NOT (NEW.facts->>'role' IN ('investor', 'both')
                    AND actual_facts->>'role' NOT IN ('investor', 'both'))
                WHEN 'account_status' THEN NOT ((NEW.facts->>'standing' = 'active'
                    OR (NEW.facts->>'standing' = 'pending' AND NOT (NEW.facts->>'kyc_required')::boolean))
                    AND actual_facts->>'standing' <> 'active' AND NOT (
                        actual_facts->>'standing' = 'pending' AND NOT (actual_facts->>'kyc_required')::boolean))
                WHEN 'is_active' THEN NOT ((NEW.facts->>'active')::boolean AND NOT (actual_facts->>'active')::boolean)
                WHEN 'is_email_verified' THEN NOT ((NEW.facts->>'email_verified')::boolean
                    AND NOT (actual_facts->>'email_verified')::boolean)
                WHEN 'is_id_verified' THEN NOT ((NEW.facts->>'identity_verified')::boolean
                    AND NOT (actual_facts->>'identity_verified')::boolean AND (actual_facts->>'kyc_required')::boolean)
                ELSE true END)
            THEN RAISE EXCEPTION 'Every retained cause field must commit its genuine loss'
                USING ERRCODE = '23514'; END IF;
            IF NEW.initiated_by_id IS NOT NULL THEN
                permission := CASE WHEN effect_field IN ('is_active', 'is_email_verified') THEN 'change_customuser'
                    WHEN effect_field = 'is_id_verified' THEN 'change_userprofile' ELSE 'change_useraccount' END;
                permission_app := CASE WHEN effect_field IN ('is_active', 'is_email_verified')
                    THEN 'authentication' ELSE 'users' END;
                IF NOT whitelist_invalidation_actor_permission(NEW.initiated_by_id, (NEW.facts->>'holder')::bigint,
                        permission_app, permission)
                THEN RAISE EXCEPTION 'Require the actual field effect permission at commit'
                    USING ERRCODE = '23514'; END IF;
            END IF;
        END LOOP;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER whitelist_wallet_invalidation_effect
AFTER INSERT ON whitelist_whitelisteligibilityinvalidation DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION whitelist_check_wallet_invalidation();
CREATE FUNCTION whitelist_eligibility_invalidation_cause(bound_decision_id uuid, bound_cause text, bound_invalidation_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT CASE WHEN bound_invalidation_id IS NOT NULL THEN (
        SELECT jsonb_build_object('actor', event.initiated_by_id::text, 'at', event.invalidated_at,
            'account', event.user_account_id::text, 'wallet', event.wallet_id::text, 'address', event.address, 'targets', event.facts->'targets', 'chain_id', event.chain_id)
        FROM whitelist_whitelisteligibilityinvalidation event WHERE event.uuid = bound_invalidation_id AND event.cause = bound_cause)
    ELSE (SELECT CASE bound_cause
        WHEN 'source_withdrawal' THEN CASE WHEN source.status = 'withdrawn' AND source.withdrawn_by_id IS NOT NULL
            AND source.reviewed_at IS NOT NULL THEN jsonb_build_object('actor', source.withdrawn_by_id::text,
                'at', source.reviewed_at, 'account', proposal.user_account_id::text) END
        WHEN 'request_withdrawal' THEN (SELECT jsonb_build_object('actor', withdrawal.withdrawn_by_id::text,
            'at', withdrawal.withdrawn_at, 'account', proposal.user_account_id::text)
            FROM users_companyeligibilityrequestwithdrawal withdrawal WHERE withdrawal.request_id = proposal.uuid)
        WHEN 'company_revocation' THEN (SELECT jsonb_build_object('actor', revoked.revoked_by_id::text,
            'at', revoked.revoked_at, 'account', proposal.user_account_id::text)
            FROM users_companyeligibilityrevocation revoked WHERE revoked.decision_id = decision.uuid)
        WHEN 'expiry' THEN CASE WHEN LEAST(decision.expires_at, source.expires_at,
            CASE WHEN source.category = 'accountant_certificate'
                THEN users_company_eligibility_certificate_expiry(source.certificate_issued_at) END) <= clock_timestamp()
            THEN jsonb_build_object('actor', NULL, 'at', LEAST(decision.expires_at, source.expires_at,
                CASE WHEN source.category = 'accountant_certificate'
                    THEN users_company_eligibility_certificate_expiry(source.certificate_issued_at) END),
                'account', proposal.user_account_id::text) END
        WHEN 'evidence_purge' THEN CASE WHEN users_classification_evidence_retention_days() > 0
            AND CASE source.status WHEN 'verified' THEN source.expires_at WHEN 'rejected' THEN source.reviewed_at
                WHEN 'revoked' THEN source.reviewed_at WHEN 'withdrawn' THEN source.reviewed_at END
                + make_interval(secs => 86400.0 * users_classification_evidence_retention_days()) <= clock_timestamp()
            AND (COALESCE(source.evidence_file, '') = '' OR EXISTS (
                SELECT 1 FROM documents WHERE classification_id = source.uuid AND purged_at IS NOT NULL AND file = ''))
            THEN jsonb_build_object('actor', NULL, 'at', CASE WHEN COALESCE(source.evidence_file, '') = ''
                THEN source.updated_at ELSE (SELECT min(purged_at) FROM documents WHERE classification_id = source.uuid
                    AND purged_at IS NOT NULL AND file = '') END,
                'account', proposal.user_account_id::text) END
        END FROM users_companyeligibilitydecision decision
        JOIN users_companyeligibilityrequest proposal ON proposal.uuid = decision.request_id
        JOIN users_investorclassification source ON source.uuid = proposal.source_id
        WHERE decision.uuid = bound_decision_id AND decision.outcome = 'accepted'
            AND proposal.category IN ('accountant_certificate', 'professional_investor')) END;
$$;
CREATE FUNCTION whitelist_lock_eligibility_invalidation(command jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    issuer_id uuid;
    account_id uuid;
    bound_wallet_id uuid;
    decision_id uuid;
    event_id uuid;
    retained_cause jsonb;
    account_ids uuid[];
    profile_ids uuid[];
    actor_ids bigint[];
    source_ids uuid[];
    proposal_ids uuid[];
    decision_ids uuid[];
    captured_binding jsonb;
    lock_id bigint;
BEGIN
    IF current_user <> __OPERATOR__ OR jsonb_typeof(command) IS DISTINCT FROM 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(command)) <> 12
        OR command->'version' IS DISTINCT FROM '1'::jsonb OR command->>'operation' IS DISTINCT FROM 'remove'
        OR NOT (command ?& ARRAY['version', 'operation', 'company', 'account', 'wallet', 'address', 'registry',
            'decision', 'invalidation', 'cause', 'actor', 'chain_id']) OR NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
    THEN RAISE EXCEPTION 'Bind the exact automatic REMOVE entry' USING ERRCODE = '23514'; END IF;
    IF command->>'version' IS DISTINCT FROM '1' OR EXISTS (
        SELECT 1 FROM unnest(ARRAY['company', 'account', 'address', 'registry', 'cause', 'operation']) key
        WHERE jsonb_typeof(command->key) IS DISTINCT FROM 'string') OR EXISTS (
        SELECT 1 FROM unnest(ARRAY['wallet', 'decision', 'invalidation', 'actor']) key
        WHERE jsonb_typeof(command->key) NOT IN ('null', 'string'))
        OR (command->>'actor' IS NOT NULL AND command->>'actor' !~ '^[1-9][0-9]*$')
    THEN RAISE EXCEPTION 'Retain complete typed REMOVE command facts' USING ERRCODE = '23514'; END IF;
    IF jsonb_typeof(command->'chain_id') IS DISTINCT FROM 'number'
        OR NOT COALESCE(command->>'chain_id' ~ '^[1-9][0-9]*$', false)
    THEN RAISE EXCEPTION 'Bind the original positive chain ID' USING ERRCODE = '23514'; END IF;
    issuer_id := (command->>'company')::uuid;
    account_id := (command->>'account')::uuid;
    bound_wallet_id := (command->>'wallet')::uuid;
    decision_id := (command->>'decision')::uuid;
    event_id := (command->>'invalidation')::uuid;
    IF issuer_id IS NULL OR account_id IS NULL OR NOT COALESCE(command->>'address' ~ '^0x[0-9a-f]{40}$', false)
        OR NOT COALESCE(command->>'registry' ~ '^0x[0-9a-f]{40}$', false)
    THEN RAISE EXCEPTION 'Bind the actual account and company target' USING ERRCODE = '23514'; END IF;
    lock_id := ('x' || substr(encode(sha256(convert_to('whitelist:' || (command->>'chain_id') || ':'
        || (command->>'registry') || ':' || (command->>'address'), 'UTF8')), 'hex'), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(lock_id);
    PERFORM 1 FROM companies_company company WHERE company.uuid = issuer_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The target company is unavailable' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM wallets wallet WHERE wallet.uuid = bound_wallet_id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM wallets wallet WHERE wallet.uuid = bound_wallet_id AND (wallet.user_account_id <> account_id
        OR lower(wallet.address) IS DISTINCT FROM command->>'address' OR wallet.chain <> 'base'))
    THEN RAISE EXCEPTION 'The captured wallet changed account or address' USING ERRCODE = '23514'; END IF;
    retained_cause := whitelist_eligibility_invalidation_cause(decision_id, command->>'cause', event_id);
    IF retained_cause IS NULL OR retained_cause->>'account' IS DISTINCT FROM account_id::text
        OR retained_cause->>'actor' IS DISTINCT FROM command->>'actor'
        OR (event_id IS NOT NULL AND retained_cause->>'chain_id' IS DISTINCT FROM command->>'chain_id')
        OR (command->>'cause' = 'wallet_removal' AND (retained_cause->>'wallet' IS DISTINCT FROM bound_wallet_id::text
            OR retained_cause->>'address' IS DISTINCT FROM command->>'address'))
    THEN RAISE EXCEPTION 'Retain the original attributable invalidation' USING ERRCODE = '23514'; END IF;
    SELECT array_agg(account.uuid ORDER BY account.uuid), jsonb_object_agg(account.uuid::text, account.user_profile_id::text)
        INTO account_ids, captured_binding FROM customer_accounts_account account WHERE account.uuid = account_id
        OR account.user_profile_id IN (SELECT profile.uuid FROM users_userprofile profile
            WHERE profile.user_id = (retained_cause->>'actor')::bigint);
    PERFORM 1 FROM customer_accounts_account account WHERE account.uuid = ANY(account_ids) ORDER BY account.uuid FOR NO KEY UPDATE;
    IF (SELECT jsonb_object_agg(account.uuid::text, account.user_profile_id::text) FROM customer_accounts_account account
            WHERE account.uuid = ANY(account_ids)) IS DISTINCT FROM captured_binding
    THEN RAISE EXCEPTION 'The captured account profile changed' USING ERRCODE = '23514'; END IF;
    SELECT array_agg(profile.uuid ORDER BY profile.uuid), array_agg(DISTINCT profile.user_id ORDER BY profile.user_id)
        INTO profile_ids, actor_ids FROM users_userprofile profile WHERE profile.uuid IN (
            SELECT account.user_profile_id FROM customer_accounts_account account WHERE account.uuid = ANY(account_ids))
        OR profile.user_id = (retained_cause->>'actor')::bigint;
    PERFORM 1 FROM authentication_customuser actor WHERE actor.id = ANY(actor_ids) ORDER BY actor.id FOR NO KEY UPDATE;
    PERFORM 1 FROM users_userprofile profile WHERE profile.uuid = ANY(profile_ids) ORDER BY profile.uuid FOR NO KEY UPDATE;
    IF (SELECT array_agg(DISTINCT profile.user_id ORDER BY profile.user_id) FROM users_userprofile profile WHERE profile.uuid = ANY(profile_ids))
        IS DISTINCT FROM actor_ids THEN RAISE EXCEPTION 'The captured human changed' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM operators_operator configuration WHERE configuration.id = 1 FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Company eligibility configuration is missing' USING ERRCODE = '55000'; END IF;
    SELECT array_agg(DISTINCT proposal.source_id ORDER BY proposal.source_id),
        array_agg(proposal.uuid ORDER BY proposal.uuid), array_agg(decision.uuid ORDER BY decision.uuid)
        INTO source_ids, proposal_ids, decision_ids FROM users_companyeligibilityrequest proposal
        JOIN users_companyeligibilitydecision decision ON decision.request_id = proposal.uuid
        WHERE proposal.company_id = issuer_id AND proposal.user_account_id = account_id
            AND proposal.category IN ('accountant_certificate', 'professional_investor') AND decision.outcome = 'accepted';
    IF decision_id IS NOT NULL AND NOT COALESCE(decision_id = ANY(decision_ids), false)
    THEN RAISE EXCEPTION 'The cause decision belongs to another context' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM users_investorclassification source WHERE source.uuid = ANY(source_ids) ORDER BY source.uuid FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM users_investorclassification source WHERE source.uuid = ANY(source_ids) AND source.user_account_id <> account_id)
    THEN RAISE EXCEPTION 'Retain the captured source account' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM documents document WHERE document.classification_id = ANY(source_ids) ORDER BY document.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM users_companyeligibilityrequest proposal WHERE proposal.uuid = ANY(proposal_ids) ORDER BY proposal.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM users_companyeligibilitydecision decision WHERE decision.uuid = ANY(decision_ids) ORDER BY decision.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM users_companyeligibilityrequestwithdrawal withdrawal WHERE withdrawal.request_id = ANY(proposal_ids)
        ORDER BY withdrawal.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM users_companyeligibilityrevocation revoked WHERE revoked.decision_id = ANY(decision_ids)
        ORDER BY revoked.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM whitelist_whitelisteligibilityinvalidation event WHERE event.uuid = event_id FOR NO KEY UPDATE;
    PERFORM 1 FROM whitelist_whitelistchange mutation WHERE mutation.chain_id = (command->>'chain_id')::bigint
        AND mutation.registry_address = command->>'registry' AND mutation.address = command->>'address'
        ORDER BY mutation.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM whitelist_whitelistentry entry WHERE entry.wallet_id = bound_wallet_id AND entry.wallet_id IS NOT NULL
        ORDER BY entry.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM whitelist_whitelistapproval approval WHERE approval.company_id = issuer_id
        AND approval.registry_address = command->>'registry' AND approval.entry_id IN (
            SELECT entry.uuid FROM whitelist_whitelistentry entry
            WHERE entry.wallet_id = bound_wallet_id AND entry.wallet_id IS NOT NULL)
        ORDER BY approval.uuid FOR NO KEY UPDATE;
END;
$$;
CREATE FUNCTION whitelist_begin_eligibility_invalidation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE command jsonb;
BEGIN
    command := NULLIF(current_setting('app.whitelist_invalidation', true), '')::jsonb;
    IF command IS NOT NULL THEN PERFORM whitelist_lock_eligibility_invalidation(command); END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER whitelist_eligibility_invalidation_begin BEFORE INSERT ON whitelist_whitelistchange
FOR EACH STATEMENT EXECUTE FUNCTION whitelist_begin_eligibility_invalidation();
CREATE FUNCTION whitelist_guard_invalidation_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
    command jsonb;
    retained_cause jsonb;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.eligibility_decision_id, NEW.eligibility_invalidation_id, NEW.invalidation_cause, NEW.invalidated_at)
            IS DISTINCT FROM ROW(OLD.eligibility_decision_id, OLD.eligibility_invalidation_id,
                OLD.invalidation_cause, OLD.invalidated_at)
        THEN RAISE EXCEPTION 'Whitelist invalidation provenance is immutable' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.authority <> 'refresh' THEN
        IF NEW.initiated_by_id IS NULL OR NEW.eligibility_decision_id IS NOT NULL
            OR NEW.eligibility_invalidation_id IS NOT NULL OR NEW.invalidation_cause <> '' OR NEW.invalidated_at IS NOT NULL
        THEN RAISE EXCEPTION 'Technical commands do not borrow eligibility invalidation provenance'
            USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    command := NULLIF(current_setting('app.whitelist_invalidation', true), '')::jsonb;
    retained_cause := whitelist_eligibility_invalidation_cause(
        NEW.eligibility_decision_id, NEW.invalidation_cause, NEW.eligibility_invalidation_id);
    IF current_user <> __OPERATOR__ OR command IS NULL OR retained_cause IS NULL
        OR NEW.action <> 'remove' OR NEW.expires_at IS NOT NULL
        OR NEW.chain_id::text IS DISTINCT FROM command->>'chain_id'
        OR NEW.company_id::text IS DISTINCT FROM command->>'company'
        OR NEW.address IS DISTINCT FROM command->>'address' OR NEW.registry_address IS DISTINCT FROM command->>'registry'
        OR NEW.eligibility_decision_id::text IS DISTINCT FROM command->>'decision'
        OR NEW.eligibility_invalidation_id::text IS DISTINCT FROM command->>'invalidation'
        OR NEW.invalidation_cause IS DISTINCT FROM command->>'cause'
        OR NEW.initiated_by_id::text IS DISTINCT FROM retained_cause->>'actor'
        OR NEW.initiated_by_id::text IS DISTINCT FROM command->>'actor'
        OR NEW.invalidated_at IS DISTINCT FROM (retained_cause->>'at')::timestamptz
        OR NEW.requested_wallet_id IS NOT NULL OR retained_cause->>'account' IS DISTINCT FROM command->>'account'
    THEN RAISE EXCEPTION 'Only the exact retained cause can admit a REMOVE' USING ERRCODE = '23514'; END IF;
    IF NEW.invalidation_cause <> 'wallet_removal' AND EXISTS (
        SELECT 1 FROM users_companyeligibilitydecision decision
        JOIN users_companyeligibilityrequest proposal ON proposal.uuid = decision.request_id
        WHERE proposal.company_id = NEW.company_id AND proposal.user_account_id = (command->>'account')::uuid
            AND proposal.category IN ('accountant_certificate', 'professional_investor')
            AND users_company_eligibility_decision_facts_current(
                decision.uuid, proposal.user_account_id, NEW.company_id, 'secondary', NULL, NULL, clock_timestamp()))
    THEN RAISE EXCEPTION 'Another live general company decision prevents removal' USING ERRCODE = '23514'; END IF;
    IF NEW.eligibility_invalidation_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(retained_cause->'targets') target
        WHERE target->>'company' = NEW.company_id::text AND target->>'registry' = NEW.registry_address
            AND target->>'address' = NEW.address AND target->>'wallet' = command->>'wallet')
    THEN RAISE EXCEPTION 'The invalidation never recorded this approval target' USING ERRCODE = '23514'; END IF;
    IF NEW.entry_id IS NULL AND (NEW.invalidation_cause <> 'wallet_removal' OR EXISTS (
        SELECT 1 FROM wallets WHERE uuid = (command->>'wallet')::uuid))
    THEN RAISE EXCEPTION 'Only an actually deleted wallet retains a missing approval entry'
        USING ERRCODE = '23514'; END IF;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM whitelist_whitelistapproval approval WHERE approval.entry_id = NEW.entry_id
            AND approval.company_id = NEW.company_id AND approval.registry_address = NEW.registry_address)
    THEN RAISE EXCEPTION 'Retain the actual company approval target' USING ERRCODE = '23514'; END IF;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM whitelist_whitelistentry entry JOIN wallets wallet ON wallet.uuid = entry.wallet_id
        WHERE entry.uuid = NEW.entry_id AND wallet.uuid::text = command->>'wallet'
            AND wallet.user_account_id::text = command->>'account' AND lower(wallet.address) = NEW.address)
    THEN RAISE EXCEPTION 'The removal entry belongs to another wallet' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_eligibility_invalidation_change BEFORE INSERT OR UPDATE ON whitelist_whitelistchange
FOR EACH ROW EXECUTE FUNCTION whitelist_guard_invalidation_change();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM whitelist_whitelisteligibilityinvalidation)
        OR EXISTS (SELECT 1 FROM whitelist_whitelistchange WHERE invalidation_cause <> '')
    THEN RAISE EXCEPTION 'Cannot discard retained eligibility invalidation history'; END IF;
END $$;
DROP TRIGGER whitelist_eligibility_invalidation_change ON whitelist_whitelistchange;
DROP FUNCTION whitelist_guard_invalidation_change();
DROP TRIGGER whitelist_eligibility_invalidation_begin ON whitelist_whitelistchange;
DROP FUNCTION whitelist_begin_eligibility_invalidation();
DROP FUNCTION whitelist_lock_eligibility_invalidation(jsonb);
DROP FUNCTION whitelist_eligibility_invalidation_cause(uuid, text, uuid);
DROP TRIGGER whitelist_wallet_invalidation_effect ON whitelist_whitelisteligibilityinvalidation;
DROP FUNCTION whitelist_check_wallet_invalidation();
DROP TRIGGER whitelist_eligibility_invalidation_history ON whitelist_whitelisteligibilityinvalidation;
DROP FUNCTION whitelist_guard_eligibility_invalidation();
DROP FUNCTION whitelist_invalidation_actor_permission(bigint, bigint, text, text);
DROP FUNCTION whitelist_eligibility_invalidation_facts(uuid, uuid, bigint);
"""


def install(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["operator"]])
        operator = cursor.fetchone()[0]
        cursor.execute(SQL.replace("__OPERATOR__", operator))
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON whitelist_whitelisteligibilityinvalidation FROM {app_role}")
        cursor.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON whitelist_whitelisteligibilityinvalidation TO {operator_role}"
        )


def uninstall(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REVERSE)


class Migration(migrations.Migration):
    dependencies = [
        ("whitelist", "0008_classification_refresh_authority"),
        ("users", "0034_company_eligibility_consumption"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name="WhitelistEligibilityInvalidation",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "cause",
                    models.CharField(
                        choices=[
                            ("source_withdrawal", "Source withdrawn by its holder"),
                            ("request_withdrawal", "Company request withdrawn by its holder"),
                            ("company_revocation", "Company decision revoked"),
                            ("expiry", "Eligibility expired automatically"),
                            ("evidence_purge", "Evidence purged automatically"),
                            ("standing_loss", "Account standing lost"),
                            ("identity_loss", "Configured identity lost"),
                            ("wallet_removal", "Wallet removed or verification lost"),
                        ],
                        editable=False,
                        max_length=32,
                    ),
                ),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("wallet_id", models.UUIDField(editable=False, null=True)),
                ("address", models.CharField(blank=True, editable=False, max_length=42)),
                ("facts", models.JSONField(editable=False)),
                ("cause_fields", models.JSONField(default=list, editable=False)),
                ("invalidated_at", models.DateTimeField(editable=False)),
                (
                    "initiated_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.useraccount"
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(cause__in=["standing_loss", "identity_loss", "wallet_removal"]),
                        name="whitelist_invalidation_retained_cause",
                    ),
                    models.CheckConstraint(condition=models.Q(chain_id__gt=0), name="whitelist_invalidation_chain"),
                    models.CheckConstraint(
                        condition=models.Q(
                            cause="wallet_removal", wallet_id__isnull=False, address__regex=r"^0x[0-9a-f]{40}$"
                        )
                        | ~models.Q(cause="wallet_removal") & models.Q(wallet_id__isnull=True, address=""),
                        name="whitelist_invalidation_wallet_scope",
                    ),
                ]
            },
        ),
        migrations.AlterField(
            model_name="whitelistchange",
            name="initiated_by",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AlterField(
            model_name="whitelistchange",
            name="authority",
            field=models.CharField(
                choices=[
                    ("operator_api", "Operator API"),
                    ("whitelist_admin", "Whitelist administration"),
                    ("subscription_admin", "Subscription administration"),
                    ("refresh", "Eligibility invalidation"),
                ],
                editable=False,
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="whitelistchange",
            name="eligibility_decision",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="whitelistchange",
            name="eligibility_invalidation",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="whitelist.whitelisteligibilityinvalidation",
            ),
        ),
        migrations.AddField(
            model_name="whitelistchange",
            name="invalidation_cause",
            field=models.CharField(
                choices=[
                    ("source_withdrawal", "Source withdrawn by its holder"),
                    ("request_withdrawal", "Company request withdrawn by its holder"),
                    ("company_revocation", "Company decision revoked"),
                    ("expiry", "Eligibility expired automatically"),
                    ("evidence_purge", "Evidence purged automatically"),
                    ("standing_loss", "Account standing lost"),
                    ("identity_loss", "Configured identity lost"),
                    ("wallet_removal", "Wallet removed or verification lost"),
                ],
                blank=True,
                editable=False,
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="whitelistchange", name="invalidated_at", field=models.DateTimeField(editable=False, null=True)
        ),
        migrations.RunPython(install, uninstall),
    ]
