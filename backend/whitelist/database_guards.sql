CREATE OR REPLACE FUNCTION public.protect_whitelist_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    expiry text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted whitelist history cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.status <> 'pending' OR NEW.operation_id IS NOT NULL
        OR NEW.transaction_id IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.failure_code <> '') THEN
        RAISE EXCEPTION 'A whitelist command must start with an unresolved membership decision';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.action, NEW.address, NEW.chain_id, NEW.registry_address,
               NEW.company_id, NEW.expires_at, NEW.intent, NEW.initiated_by_id, NEW.authority,
               NEW.requested_wallet_id, NEW.entry_id)
           IS DISTINCT FROM
           ROW(OLD.uuid, OLD.created_at, OLD.action, OLD.address, OLD.chain_id, OLD.registry_address,
               OLD.company_id, OLD.expires_at, OLD.intent, OLD.initiated_by_id, OLD.authority,
               OLD.requested_wallet_id, OLD.entry_id) THEN
            RAISE EXCEPTION 'Whitelist submission identity, intent and authority are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'Whitelist commands retain their original outgoing operation';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            RAISE EXCEPTION 'Whitelist commands retain their original transaction';
        END IF;
        IF OLD.status IN ('confirmed', 'unchanged', 'failed') AND
            ROW(NEW.status, NEW.operation_id, NEW.transaction_id, NEW.completed_at, NEW.failure_code)
            IS DISTINCT FROM ROW(OLD.status, OLD.operation_id, OLD.transaction_id, OLD.completed_at, OLD.failure_code) THEN
            RAISE EXCEPTION 'A completed whitelist submission cannot authorize another attempt';
        END IF;
        IF OLD.status <> NEW.status AND NOT (
            (OLD.status = 'pending' AND NEW.status IN ('executing', 'unchanged'))
            OR (OLD.status = 'executing' AND NEW.status IN ('confirmed', 'failed'))
        ) THEN
            RAISE EXCEPTION 'Invalid whitelist command transition';
        END IF;
    END IF;
    IF NEW.expires_at IS NOT NULL AND (NEW.action <> 'add'
        OR NEW.expires_at <> date_trunc('second', NEW.expires_at)
        OR extract(epoch FROM NEW.expires_at) <= 0) THEN
        RAISE EXCEPTION 'A whitelist expiry must be a whole second after the epoch on an addition';
    END IF;
    expiry := CASE
        WHEN NEW.action = 'remove' THEN repeat('0', 64)
        WHEN NEW.expires_at IS NULL THEN repeat('0', 48) || repeat('f', 16)
        ELSE lpad(to_hex(extract(epoch FROM NEW.expires_at)::bigint), 64, '0')
    END;
    IF jsonb_typeof(NEW.intent) <> 'object'
       OR NEW.intent->'chain_id' IS DISTINCT FROM to_jsonb(NEW.chain_id)
       OR NEW.intent->>'to' IS DISTINCT FROM NEW.registry_address
       OR NEW.intent->>'value' IS DISTINCT FROM '0'
       OR NEW.intent->>'data' IS DISTINCT FROM
          '0xe0468dcd' || repeat('0', 24) || substring(NEW.address from 3) || expiry
       OR NOT coalesce(NEW.intent->>'sender' ~ '^0x[0-9a-f]{40}$', false) THEN
        RAISE EXCEPTION 'A whitelist command must bind its exact registry call';
    END IF;
    IF (NEW.status IN ('confirmed', 'unchanged', 'failed')) IS DISTINCT FROM (NEW.completed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Whitelist completion time must agree with its outcome';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'whitelist-change:' || NEW.uuid::text
           OR operation.intent IS DISTINCT FROM NEW.intent THEN
            RAISE EXCEPTION 'A whitelist command must reference its original outgoing intent';
        END IF;
        IF NEW.status IN ('pending', 'unchanged') THEN
            RAISE EXCEPTION 'A sending whitelist command cannot discard its outcome';
        END IF;
        IF NEW.status = 'confirmed' AND (operation.status <> 'confirmed' OR NEW.transaction_id IS NULL) THEN
            RAISE EXCEPTION 'Whitelist confirmation requires its confirmed original operation';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'An uncertain whitelist command cannot be marked failed';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash
               OR projected.related_model IS DISTINCT FROM 'whitelist.WhitelistChange'
               OR projected.related_uuid IS DISTINCT FROM NEW.uuid THEN
                RAISE EXCEPTION 'Whitelist projection must name the original signed attempt';
            END IF;
        END IF;
    ELSIF NEW.status IN ('confirmed', 'failed') OR NEW.transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'A sent whitelist command requires its durable operation';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_begin_eligibility_invalidation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE command jsonb;
BEGIN
    command := NULLIF(current_setting('app.whitelist_invalidation', true), '')::jsonb;
    IF command IS NOT NULL THEN PERFORM whitelist_lock_eligibility_invalidation(command); END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_check_company_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE change whitelist_whitelistchange; instruction whitelist_companywalletinstruction; operation blockchain_outgoingoperation;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    SELECT * INTO change FROM whitelist_whitelistchange WHERE operation_id = NEW.operation_id;
    IF operation.operation_key LIKE 'whitelist-change:%' AND change.uuid IS NULL THEN
        RAISE EXCEPTION 'A fresh whitelist signature requires its retained journal' USING ERRCODE = '23514';
    END IF;
    IF change.uuid IS NULL OR change.authority = 'refresh' THEN RETURN NEW; END IF;
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = change.source_instruction_id;
    IF instruction.uuid IS NULL OR change.authority <> 'company' OR instruction.change_id IS DISTINCT FROM change.uuid
        OR change.intent IS DISTINCT FROM instruction.intent OR operation.intent IS DISTINCT FROM instruction.intent
        OR NEW.claim_id IS DISTINCT FROM operation.claim_id
        OR NOT whitelist_company_wallet_source_current(instruction.uuid,clock_timestamp()) OR NOT whitelist_company_wallet_ready(instruction) THEN
        RAISE EXCEPTION 'Fresh whitelist signatures require their exact current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_check_company_wallet_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE instruction whitelist_companywalletinstruction; at_time timestamptz;
BEGIN
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = NEW.instruction_id;
    at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id,instruction.company_id,NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,at_time)
        OR (NEW.kind <> 'reject' AND NOT whitelist_company_wallet_ready(instruction))
        OR (NEW.kind = 'apply' AND (NOT whitelist_company_wallet_source_current(instruction.uuid,at_time)
            OR NOT EXISTS (SELECT 1 FROM whitelist_whitelistchange change WHERE change.uuid = instruction.change_id
                AND change.source_instruction_id = instruction.uuid AND change.intent = instruction.intent
                AND change.action = instruction.action AND change.company_id = instruction.company_id
                AND change.initiated_by_id = NEW.decided_by_id)))
        OR (NEW.kind = 'approve' AND instruction.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (instruction.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR instruction.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR instruction.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND instruction.rejection_reason IS DISTINCT FROM NEW.reason))) THEN
        RAISE EXCEPTION 'Wallet decisions retain exact current authority and atomic journal admission at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_check_company_wallet_preparation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,NEW.submitted_by_id,'prepare',clock_timestamp())
        OR NOT whitelist_company_wallet_ready(NEW) THEN
        RAISE EXCEPTION 'Wallet preparation retains actual current authority/source at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_check_wallet_invalidation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET row_security TO 'off'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_check_wallet_nomination()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF NOT whitelist_wallet_nomination_current(NEW) THEN
        RAISE EXCEPTION 'Nomination commits only with its actual current participant source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_company_wallet_approval(instruction_uuid uuid, at_time timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT decision.uuid FROM whitelist_companywalletinstructiondecision decision
        JOIN whitelist_companywalletinstruction instruction ON instruction.uuid = decision.instruction_id
        WHERE instruction.uuid = instruction_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, instruction.company_id, decision.decided_by_id,
                'approve', GREATEST(at_time, clock_timestamp()))
        ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_company_wallet_approved(instruction_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT whitelist_company_wallet_approval(instruction_uuid, at_time) IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_company_wallet_decision_digest(instruction_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version','1','instruction',to_jsonb(instruction),
        'kind',decision_kind,'actor',actor,'appointment',appointment_uuid,'reason',decision_reason,
        'company',to_jsonb(company),'nomination',to_jsonb(nomination),'target',to_jsonb(original),
        'source_current', CASE WHEN nomination.uuid IS NOT NULL THEN whitelist_wallet_nomination_current(nomination) ELSE NULL END,
        'approval',whitelist_company_wallet_approval(instruction.uuid,clock_timestamp()))::text,'UTF8')),'hex')
    FROM whitelist_companywalletinstruction instruction JOIN companies_company company ON company.uuid = instruction.company_id
    LEFT JOIN whitelist_companywalletnomination nomination ON nomination.uuid = instruction.nomination_id
    LEFT JOIN whitelist_whitelistchange original ON original.uuid = instruction.target_change_id
    WHERE instruction.uuid = instruction_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_company_wallet_ready(instruction whitelist_companywalletinstruction)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (SELECT 1 FROM companies_company company WHERE company.uuid = instruction.company_id
        AND company.status = 'active' AND instruction.snapshot->'company' = jsonb_build_object('uuid', company.uuid,
            'name', company.name, 'acn', company.acn, 'status', company.status)
        AND instruction.snapshot->'target'->>'chain' = 'base'
        AND instruction.snapshot->'target'->>'address' ~ '^0x[0-9a-f]{40}$'
        AND instruction.snapshot->'target'->>'registry_address' ~ '^0x[0-9a-f]{40}$'
        AND instruction.intent->'chain_id' = instruction.snapshot->'target'->'chain_id'
        AND (instruction.intent->>'chain_id')::bigint IN (84532, 31337)
        AND instruction.intent->>'sender' ~ '^0x[0-9a-f]{40}$' AND instruction.intent->>'value' = '0'
        AND instruction.intent->>'to' = instruction.snapshot->'target'->>'registry_address'
        AND instruction.snapshot->'transaction' = instruction.intent
        AND instruction.intent_digest = encode(sha256(convert_to(instruction.intent::text, 'UTF8')), 'hex')
        AND CASE instruction.action WHEN 'add' THEN instruction.target_change_id IS NULL
            AND instruction.expires_at > clock_timestamp() AND instruction.expires_at = date_trunc('second', instruction.expires_at)
            AND (instruction.snapshot->'target'->>'expires_at')::timestamptz = instruction.expires_at
            AND EXISTS (SELECT 1 FROM whitelist_companywalletnomination nomination
                JOIN users_companyeligibilitydecision decision ON decision.uuid = nomination.decision_id
                WHERE nomination.uuid = instruction.nomination_id AND nomination.company_id = instruction.company_id
                    AND instruction.snapshot->'associations' = nomination.snapshot
                    AND instruction.snapshot->'target'->>'address' = nomination.snapshot->>'address'
                    AND instruction.expires_at <= decision.expires_at
                    AND instruction.snapshot->'source' = jsonb_build_object('nomination', nomination.uuid,
                        'request', nomination.request_id, 'decision', nomination.decision_id,
                        'proof_completed_at', nomination.snapshot->'proof_completed_at',
                        'eligibility_expires_at', nomination.snapshot->'eligibility_expires_at', 'target_change', NULL)
                    AND whitelist_wallet_nomination_current(nomination))
            AND instruction.intent->>'data' = '0xe0468dcd' || repeat('0',24)
                || substring(instruction.snapshot->'target'->>'address' from 3)
                || lpad(to_hex(extract(epoch FROM instruction.expires_at)::bigint),64,'0')
        WHEN 'remove' THEN instruction.nomination_id IS NULL AND instruction.expires_at IS NULL
            AND instruction.snapshot->'target'->'expires_at' = 'null'::jsonb
            AND instruction.snapshot->'associations' = 'null'::jsonb
            AND EXISTS (SELECT 1 FROM whitelist_whitelistchange original WHERE original.uuid = instruction.target_change_id
                AND original.company_id = instruction.company_id AND original.action = 'add'
                AND original.status IN ('confirmed', 'unchanged') AND original.completed_at IS NOT NULL
                AND original.chain_id::text = instruction.snapshot->'target'->>'chain_id'
                AND original.registry_address = instruction.snapshot->'target'->>'registry_address'
                AND original.address = instruction.snapshot->'target'->>'address')
            AND instruction.snapshot->'source' = jsonb_build_object('nomination', NULL, 'request', NULL, 'decision', NULL,
                'proof_completed_at', NULL, 'eligibility_expires_at', NULL, 'target_change', instruction.target_change_id)
            AND instruction.intent->>'data' = '0xe0468dcd' || repeat('0',24)
                || substring(instruction.snapshot->'target'->>'address' from 3) || repeat('0',64)
        ELSE false END);
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_company_wallet_source_current(instruction_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (SELECT 1 FROM whitelist_companywalletinstruction instruction
        JOIN whitelist_companywalletinstructiondecision approval ON approval.uuid = instruction.approval_decision_id
        JOIN whitelist_companywalletinstructiondecision application ON application.instruction_id = instruction.uuid AND application.kind = 'apply'
        WHERE instruction.uuid = instruction_uuid AND instruction.status = 'applied' AND instruction.change_id IS NOT NULL
            AND approval.instruction_id = instruction.uuid AND approval.kind = 'approve'
            AND application.decided_by_id = instruction.reviewed_by_id AND application.decided_at = instruction.reviewed_at
            AND tokens_register_appointment_current(approval.appointment_id, instruction.company_id, approval.decided_by_id,
                'approve', GREATEST(at_time,clock_timestamp()))
            AND tokens_register_appointment_current(application.appointment_id, instruction.company_id, application.decided_by_id,
                'apply', GREATEST(at_time,clock_timestamp())));
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_eligibility_invalidation_cause(bound_decision_id uuid, bound_cause text, bound_invalidation_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_eligibility_invalidation_facts(bound_account_id uuid, bound_wallet_id uuid, bound_chain_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_guard_company_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE instruction whitelist_companywalletinstruction; principal bigint;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.source_instruction_id IS DISTINCT FROM OLD.source_instruction_id THEN
            RAISE EXCEPTION 'Retain the original whitelist company source association' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.authority = 'refresh' THEN
        IF NEW.source_instruction_id IS NOT NULL THEN RAISE EXCEPTION 'Automatic removal keeps its genuine cause' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = NEW.source_instruction_id;
    IF NEW.authority <> 'company' OR instruction.uuid IS NULL OR current_user NOT IN (__OPERATOR__,__MIGRATE__)
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_apply'
        OR current_setting('app.company_id',true) IS DISTINCT FROM instruction.company_id::text
        OR principal IS NULL OR NEW.initiated_by_id IS DISTINCT FROM principal OR instruction.reviewed_by_id IS DISTINCT FROM principal
        OR NEW.uuid IS DISTINCT FROM instruction.change_id OR NEW.company_id IS DISTINCT FROM instruction.company_id
        OR NEW.action IS DISTINCT FROM instruction.action OR NEW.expires_at IS DISTINCT FROM instruction.expires_at
        OR NEW.intent IS DISTINCT FROM instruction.intent OR NEW.address IS DISTINCT FROM instruction.snapshot->'target'->>'address'
        OR NEW.registry_address IS DISTINCT FROM instruction.snapshot->'target'->>'registry_address'
        OR NEW.chain_id::text IS DISTINCT FROM instruction.snapshot->'target'->>'chain_id'
        OR NEW.status <> 'pending' OR NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
        OR NOT whitelist_company_wallet_source_current(instruction.uuid,clock_timestamp()) OR NOT whitelist_company_wallet_ready(instruction)
        OR (NEW.action = 'add' AND (NEW.requested_wallet_id::text IS DISTINCT FROM instruction.snapshot->'associations'->>'wallet'
            OR NOT EXISTS (SELECT 1 FROM whitelist_whitelistentry entry WHERE entry.uuid = NEW.entry_id AND entry.wallet_id = NEW.requested_wallet_id)))
        OR (NEW.action = 'remove' AND (NEW.requested_wallet_id IS NOT NULL OR NEW.entry_id IS DISTINCT FROM
            (SELECT entry.uuid FROM whitelist_whitelistentry entry JOIN whitelist_whitelistchange original ON original.entry_id = entry.uuid
                WHERE original.uuid = instruction.target_change_id))) THEN
        RAISE EXCEPTION 'Fresh whitelist admission requires its exact applied personal company instruction' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_guard_company_wallet_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE principal bigint; instruction whitelist_companywalletinstruction; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Wallet decisions are append only' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint; at_time := clock_timestamp();
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = NEW.instruction_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR instruction.uuid IS NULL
        OR current_setting('app.company_id',true) IS DISTINCT FROM instruction.company_id::text
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_' || NEW.kind
        OR NEW.decided_by_id IS DISTINCT FROM principal OR instruction.status <> 'submitted'
        OR NEW.kind NOT IN ('approve','apply','reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM whitelist_company_wallet_decision_digest(instruction.uuid,NEW.kind,principal,NEW.appointment_id,NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id,instruction.company_id,principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,at_time)
        OR (NEW.kind = 'approve' AND whitelist_company_wallet_approved(instruction.uuid,at_time))
        OR (NEW.kind = 'apply' AND NOT whitelist_company_wallet_approved(instruction.uuid,at_time))
        OR (NEW.kind <> 'reject' AND NOT whitelist_company_wallet_ready(instruction)) THEN
        RAISE EXCEPTION 'Wallet decision requires exact current personal company authority/source' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_guard_company_wallet_instruction()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company wallet instructions' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'A wallet instruction requires its bounded company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.approval_decision_id IS NOT NULL OR NEW.change_id IS NOT NULL OR NEW.reviewed_by_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,principal,'prepare',clock_timestamp())
            OR NOT whitelist_company_wallet_ready(NEW) THEN
            RAISE EXCEPTION 'Prepare only exact current company wallet source and terms' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected') OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','change_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','change_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM whitelist_companywalletinstructiondecision decision WHERE decision.instruction_id = NEW.uuid
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
            OR (NEW.status = 'applied' AND (NEW.change_id IS NULL OR NEW.rejection_reason <> ''
                OR NEW.approval_decision_id IS DISTINCT FROM whitelist_company_wallet_approval(NEW.uuid,clock_timestamp())
                OR NOT whitelist_company_wallet_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.change_id IS NOT NULL OR NEW.approval_decision_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]')) THEN
            RAISE EXCEPTION 'Wallet instructions retain their exact immutable terms and decision outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_guard_eligibility_invalidation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_guard_invalidation_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_guard_wallet_nomination()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain explicit wallet nominations' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.wallet_nomination_operation', true) IS DISTINCT FROM 'submit'
        OR NEW.submitted_by_id IS DISTINCT FROM principal OR NOT whitelist_wallet_nomination_current(NEW)
    THEN RAISE EXCEPTION 'Nominate only the participant owned wallet with genuine current proof and exact GENERAL eligibility' USING ERRCODE = '23514'; END IF;
    NEW.submitted_at := clock_timestamp(); NEW.created_at := NEW.submitted_at; NEW.updated_at := NEW.submitted_at;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_invalidation_actor_permission(bound_actor_id bigint, bound_holder_id bigint, bound_app text, bound_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT EXISTS (SELECT 1 FROM authentication_customuser actor WHERE actor.id = bound_actor_id
        AND (actor.id = bound_holder_id OR (actor.is_active AND actor.is_staff AND (actor.is_superuser OR EXISTS (
            SELECT 1 FROM auth_permission p JOIN django_content_type ct ON ct.id = p.content_type_id
            WHERE p.codename = bound_permission AND ct.app_label = bound_app
                AND (EXISTS (SELECT 1 FROM authentication_customuser_user_permissions direct
                    WHERE direct.customuser_id = actor.id AND direct.permission_id = p.id)
                OR EXISTS (SELECT 1 FROM authentication_customuser_groups membership
                    JOIN auth_group_permissions grant_row ON grant_row.group_id = membership.group_id
                    WHERE membership.customuser_id = actor.id AND grant_row.permission_id = p.id)))))));
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_lock_eligibility_invalidation(command jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.whitelist_wallet_nomination_current(nomination whitelist_companywalletnomination)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT nomination.sharing_accepted
        AND nomination.company_id = request.company_id AND nomination.request_id = decision.request_id
        AND nomination.decision_id = decision.uuid AND nomination.proof_id = proof.uuid
        AND nomination.wallet_id = proof.wallet_id AND request.user_account_id = proof.account_id
        AND nomination.submitted_by_id = proof.verified_by_id
        AND nomination.snapshot->>'company' = nomination.company_id::text
        AND nomination.snapshot->>'request' = request.uuid::text AND nomination.snapshot->>'decision' = decision.uuid::text
        AND nomination.snapshot->>'wallet' = proof.wallet_id::text AND nomination.snapshot->>'proof' = proof.uuid::text
        AND nomination.snapshot->>'account' = proof.account_id::text AND nomination.snapshot->>'profile' = proof.profile_id::text
        AND nomination.snapshot->>'participant' = proof.verified_by_id::text AND nomination.snapshot->>'address' = lower(proof.address)
        AND nomination.snapshot->>'chain' = 'base' AND proof.chain = 'base'
        AND (nomination.snapshot->>'proof_completed_at')::timestamptz = proof.completed_at
        AND (nomination.snapshot->>'eligibility_expires_at')::timestamptz = decision.expires_at
        AND nomination.snapshot->>'proof_digest' = proof.digest AND nomination.snapshot->>'request_digest' = request.digest
        AND nomination.snapshot->>'decision_digest' = decision.digest
        AND nomination.digest = nomination.preview_digest
        AND nomination.digest = encode(sha256(convert_to(nomination.snapshot::text, 'UTF8')), 'hex')
        AND wallets_possession_proof_current(proof.uuid)
        AND users_company_eligibility_decision_facts_current(decision.uuid, request.user_account_id, nomination.company_id,
            'secondary', NULL, NULL, clock_timestamp())
        FROM users_companyeligibilityrequest request JOIN users_companyeligibilitydecision decision ON decision.uuid = nomination.decision_id
        JOIN wallets_walletpossessionproof proof ON proof.uuid = nomination.proof_id WHERE request.uuid = nomination.request_id), false);
$function$;

CREATE TRIGGER whitelist_company_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_signature();

CREATE CONSTRAINT TRIGGER whitelist_company_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_signature();

CREATE TRIGGER whitelist_company_wallet_instruction_source BEFORE INSERT OR DELETE OR UPDATE ON whitelist_companywalletinstruction FOR EACH ROW EXECUTE FUNCTION whitelist_guard_company_wallet_instruction();

CREATE CONSTRAINT TRIGGER whitelist_company_wallet_preparation AFTER INSERT ON whitelist_companywalletinstruction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_wallet_preparation();

CREATE CONSTRAINT TRIGGER whitelist_company_wallet_decision_effect AFTER INSERT ON whitelist_companywalletinstructiondecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_wallet_decision();

CREATE TRIGGER whitelist_company_wallet_decision_source BEFORE INSERT OR DELETE OR UPDATE ON whitelist_companywalletinstructiondecision FOR EACH ROW EXECUTE FUNCTION whitelist_guard_company_wallet_decision();

CREATE CONSTRAINT TRIGGER whitelist_wallet_nomination_effect AFTER INSERT ON whitelist_companywalletnomination DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_wallet_nomination();

CREATE TRIGGER whitelist_wallet_nomination_source BEFORE INSERT OR DELETE OR UPDATE ON whitelist_companywalletnomination FOR EACH ROW EXECUTE FUNCTION whitelist_guard_wallet_nomination();

CREATE TRIGGER protect_whitelist_change BEFORE INSERT OR DELETE OR UPDATE ON whitelist_whitelistchange FOR EACH ROW EXECUTE FUNCTION protect_whitelist_change();

CREATE TRIGGER whitelist_company_change_source BEFORE INSERT OR UPDATE ON whitelist_whitelistchange FOR EACH ROW EXECUTE FUNCTION whitelist_guard_company_change();

CREATE TRIGGER whitelist_eligibility_invalidation_begin BEFORE INSERT ON whitelist_whitelistchange FOR EACH STATEMENT EXECUTE FUNCTION whitelist_begin_eligibility_invalidation();

CREATE TRIGGER whitelist_eligibility_invalidation_change BEFORE INSERT OR UPDATE ON whitelist_whitelistchange FOR EACH ROW EXECUTE FUNCTION whitelist_guard_invalidation_change();

CREATE TRIGGER whitelist_eligibility_invalidation_history BEFORE INSERT OR DELETE OR UPDATE ON whitelist_whitelisteligibilityinvalidation FOR EACH ROW EXECUTE FUNCTION whitelist_guard_eligibility_invalidation();

CREATE CONSTRAINT TRIGGER whitelist_wallet_invalidation_effect AFTER INSERT ON whitelist_whitelisteligibilityinvalidation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_wallet_invalidation();
