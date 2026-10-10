CREATE OR REPLACE FUNCTION public.users_keep_first_activation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.activation_date := LEAST(OLD.activation_date, NEW.activation_date);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_provider_identity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF current_user <> @APP_ROLE@ THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_id_verified OR NEW.verified_at IS NOT NULL OR NEW.review_result IS NOT NULL
            OR NEW.verification_status IS NOT NULL OR NEW.rejection_labels IS NOT NULL
            OR NEW.kyc_provider IS DISTINCT FROM 'kycaid' OR NEW.kycaid_applicant_id IS NOT NULL
            OR NEW.sumsub_applicant_id IS NOT NULL OR NEW.sumsub_verification_status IS NOT NULL
        THEN
            RAISE EXCEPTION 'Provider identity results are recorded by the bounded verification service'
                USING ERRCODE = '23514';
        END IF;
    ELSIF ROW(NEW.is_id_verified, NEW.verified_at, NEW.review_result, NEW.verification_status,
        NEW.rejection_labels, NEW.kyc_provider, NEW.kycaid_applicant_id, NEW.sumsub_applicant_id,
        NEW.sumsub_verification_status) IS DISTINCT FROM ROW(OLD.is_id_verified, OLD.verified_at,
        OLD.review_result, OLD.verification_status, OLD.rejection_labels, OLD.kyc_provider,
        OLD.kycaid_applicant_id, OLD.sumsub_applicant_id, OLD.sumsub_verification_status)
    THEN
        RAISE EXCEPTION 'Provider identity results are recorded by the bounded verification service'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operators_guard_issuer_identity_policy()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF current_user = @APP_ROLE@ THEN
        IF TG_OP = 'DELETE' OR (TG_OP = 'INSERT' AND (
            NEW.issuer_kyc_required IS DISTINCT FROM false OR NEW.investor_kyc_required IS DISTINCT FROM true))
            OR (TG_OP = 'UPDATE' AND ROW(NEW.issuer_kyc_required, NEW.investor_kyc_required)
                IS DISTINCT FROM ROW(OLD.issuer_kyc_required, OLD.investor_kyc_required))
        THEN RAISE EXCEPTION 'Only platform configuration can change required identity policies'
            USING ERRCODE = '23514'; END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_classification_evidence_retention_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$ SELECT @CLASSIFICATION_DAYS@; $function$;

CREATE OR REPLACE FUNCTION public.users_unattached_document_retention_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$ SELECT @DOCUMENT_DAYS@; $function$;

CREATE OR REPLACE FUNCTION public.users_classification_evidence_purge_due(source_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT users_classification_evidence_retention_days() > 0
        AND NULLIF(source.evidence_file, '') IS NOT NULL
        AND CASE source.status
            WHEN 'verified' THEN source.expires_at
            WHEN 'rejected' THEN source.reviewed_at
            WHEN 'revoked' THEN source.reviewed_at
            WHEN 'withdrawn' THEN source.reviewed_at
        END + make_interval(secs => 86400.0 * users_classification_evidence_retention_days()) <= clock_timestamp()
        FROM users_investorclassification source WHERE source.uuid = source_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.documents_evidence_purge_due(document_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT document.purged_at IS NULL
        AND CASE WHEN document.classification_id IS NULL THEN
            users_unattached_document_retention_days() > 0
            AND document.created_at + make_interval(secs => 86400.0 * users_unattached_document_retention_days())
                <= clock_timestamp()
        ELSE users_classification_evidence_retention_days() > 0
            AND CASE source.status
                WHEN 'verified' THEN source.expires_at
                WHEN 'rejected' THEN source.reviewed_at
                WHEN 'revoked' THEN source.reviewed_at
                WHEN 'withdrawn' THEN source.reviewed_at
            END + make_interval(secs => 86400.0 * users_classification_evidence_retention_days()) <= clock_timestamp()
        END FROM documents document
        LEFT JOIN users_investorclassification source ON source.uuid = document.classification_id
        WHERE document.uuid = document_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.users_lock_classification_evidence_command()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    operation text;
    source_id uuid;
    account_id uuid;
    profile_id uuid;
    company_id uuid;
    principal bigint;
    account customer_accounts_account;
    profile users_userprofile;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Classification records and their original evidence are retained' USING ERRCODE = '23514';
    END IF;
    operation := NULLIF(current_setting('app.classification_evidence_operation', true), '');
    source_id := NULLIF(current_setting('app.classification_evidence_source', true), '')::uuid;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF source_id IS NULL OR operation IS NULL OR operation NOT IN ('create', 'withdraw', 'review', 'purge_classification') THEN
        RAISE EXCEPTION 'Classification changes require the exact bounded command' USING ERRCODE = '23514';
    END IF;
    IF (TG_OP = 'INSERT') IS DISTINCT FROM (operation = 'create') THEN
        RAISE EXCEPTION 'The classification command does not authorize this operation' USING ERRCODE = '23514';
    END IF;
    IF operation IN ('create', 'withdraw') THEN
        IF operation = 'create' THEN
            company_id := NULLIF(current_setting('app.classification_evidence_company', true), '')::uuid;
            IF company_id IS NOT NULL THEN
                PERFORM 1 FROM companies_company WHERE uuid = company_id AND status = 'active' FOR NO KEY UPDATE;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Active issuer not found' USING ERRCODE = '23514';
                END IF;
            END IF;
        END IF;
        account_id := NULLIF(current_setting('app.classification_evidence_account', true), '')::uuid;
        profile_id := NULLIF(current_setting('app.classification_evidence_profile', true), '')::uuid;
        IF principal IS NULL OR account_id IS NULL OR profile_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM customer_accounts_account holder
            JOIN users_userprofile holder_profile ON holder_profile.uuid = holder.user_profile_id
            WHERE holder.uuid = account_id AND holder_profile.uuid = profile_id AND holder_profile.user_id = principal
        ) THEN
            RAISE EXCEPTION 'Only the actual holder can withdraw a submitted classification' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO account FROM customer_accounts_account WHERE uuid = account_id FOR NO KEY UPDATE;
        IF account.uuid IS NULL OR account.user_profile_id IS DISTINCT FROM profile_id OR NOT EXISTS (
            SELECT 1 FROM users_userprofile WHERE uuid = profile_id AND user_id = principal
        ) THEN
            RAISE EXCEPTION 'The classification holder changed' USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM authentication_customuser WHERE id = principal FOR UPDATE;
        SELECT * INTO profile FROM users_userprofile WHERE uuid = profile_id AND user_id = principal FOR UPDATE;
        IF profile.uuid IS NULL OR NOT EXISTS (
            SELECT 1 FROM customer_accounts_account WHERE uuid = account_id AND user_profile_id = profile.uuid
        ) THEN
            RAISE EXCEPTION 'The classification holder changed' USING ERRCODE = '23514';
        END IF;
        IF operation = 'withdraw' THEN
            PERFORM 1 FROM users_investorclassification WHERE uuid = source_id AND user_account_id = account_id FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Classification not found or permission denied' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF operation = 'review' THEN
        IF current_user <> @OPERATOR_ROLE@ OR principal IS NULL THEN
            RAISE EXCEPTION 'Classification review requires the existing staff operation' USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM authentication_customuser WHERE id = principal AND is_active AND is_staff FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Classification review requires the existing staff operation' USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM users_investorclassification WHERE uuid = source_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Classification not found' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user <> @OPERATOR_ROLE@ THEN
            RAISE EXCEPTION 'Evidence purge requires the bounded technical operation' USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM users_investorclassification WHERE uuid = source_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Classification not found' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_classification_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    operation text;
    principal bigint;
    allowed text[];
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF TG_OP = 'INSERT' THEN
        IF NULLIF(current_setting('app.classification_evidence_operation', true), '') IS DISTINCT FROM 'create'
            OR NEW.uuid IS DISTINCT FROM NULLIF(current_setting('app.classification_evidence_source', true), '')::uuid
            OR NEW.user_account_id IS DISTINCT FROM NULLIF(current_setting('app.classification_evidence_account', true), '')::uuid
            OR NEW.company_id IS DISTINCT FROM NULLIF(current_setting('app.classification_evidence_company', true), '')::uuid
            OR principal IS NULL OR NOT EXISTS (
            SELECT 1 FROM customer_accounts_account holder
            JOIN users_userprofile profile ON profile.uuid = holder.user_profile_id
            WHERE holder.uuid = NEW.user_account_id AND profile.user_id = principal
                AND profile.uuid = NULLIF(current_setting('app.classification_evidence_profile', true), '')::uuid
        ) OR NEW.status IS DISTINCT FROM 'submitted' OR NOT NEW.declaration_accepted
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.withdrawn_by_id IS NOT NULL
            OR NEW.review_notes <> '' OR NEW.rejection_reason <> '' OR NEW.expires_at IS NOT NULL
            OR NULLIF(NEW.evidence_file, '') IS NULL OR NEW.evidence_file_size IS NULL OR NEW.evidence_file_size = 0
            OR NEW.evidence_mime_type = ''
            OR NEW.declaration_text IS DISTINCT FROM (CASE NEW.category
                WHEN 'product_value' THEN 'I declare that the amount payable on acceptance of this offer is at least AUD 500,000, so the offer is made to me under section 708(8)(a) of the Corporations Act 2001 (Cth) and no disclosure document is required.'
                WHEN 'accountant_certificate' THEN 'I declare that a qualified accountant has certified, within the last two years, that I have net assets of at least AUD 2.5 million or gross income of at least AUD 250,000 for each of the last two financial years, so the offer is made to me under section 708(8)(c) of the Corporations Act 2001 (Cth).'
                WHEN 'professional_investor' THEN 'I declare that I am a professional investor within the meaning of section 708(11) and section 761G(7)(d) of the Corporations Act 2001 (Cth).'
                WHEN 'associated_person' THEN 'I declare that I am a person associated with the named issuer within the meaning of section 708(12) of the Corporations Act 2001 (Cth).'
            END)
            OR NEW.category NOT IN ('product_value', 'accountant_certificate', 'professional_investor', 'associated_person')
            OR NEW.evidence_file NOT LIKE 'users/' || NEW.user_account_id::text
                || '/investor-classifications/' || NEW.category || '/%'
        THEN
            RAISE EXCEPTION 'A new classification records its actual holder and submitted evidence only'
                USING ERRCODE = '23514';
        END IF;
        NEW.created_at := clock_timestamp();
        NEW.updated_at := NEW.created_at;
        NEW.submitted_at := NEW.created_at;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Classification records and their original evidence are retained' USING ERRCODE = '23514';
    END IF;
    operation := NULLIF(current_setting('app.classification_evidence_operation', true), '');
    IF OLD.uuid IS DISTINCT FROM NULLIF(current_setting('app.classification_evidence_source', true), '')::uuid THEN
        RAISE EXCEPTION 'The classification differs from the bounded command' USING ERRCODE = '23514';
    END IF;
    IF operation = 'withdraw' THEN
        allowed := ARRAY['status', 'reviewed_at', 'withdrawn_by_id', 'updated_at'];
        IF OLD.status IS DISTINCT FROM 'submitted' OR NEW.status IS DISTINCT FROM 'withdrawn'
            OR NEW.withdrawn_by_id IS DISTINCT FROM principal OR principal IS NULL
            OR NEW.user_account_id IS DISTINCT FROM NULLIF(current_setting('app.classification_evidence_account', true), '')::uuid
            OR NOT EXISTS (
                SELECT 1 FROM customer_accounts_account holder
                JOIN users_userprofile profile ON profile.uuid = holder.user_profile_id
                WHERE holder.uuid = OLD.user_account_id
                    AND profile.uuid = NULLIF(current_setting('app.classification_evidence_profile', true), '')::uuid
                    AND profile.user_id = principal
            )
        THEN
            RAISE EXCEPTION 'Only the actual holder can withdraw this submitted classification' USING ERRCODE = '23514';
        END IF;
        NEW.reviewed_at := clock_timestamp();
    ELSIF operation = 'review' AND current_user = @OPERATOR_ROLE@ THEN
        IF principal IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = principal AND is_active AND is_staff
        ) THEN
            RAISE EXCEPTION 'Classification review requires the actual existing staff reviewer' USING ERRCODE = '23514';
        END IF;
        IF OLD.status = 'submitted' AND NEW.status = 'verified' THEN
            allowed := ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'review_notes', 'expires_at', 'updated_at'];
        ELSIF (OLD.status = 'submitted' AND NEW.status = 'rejected')
            OR (OLD.status = 'verified' AND NEW.status = 'revoked') THEN
            allowed := ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'];
        ELSE
            RAISE EXCEPTION 'The legacy classification review transition is invalid' USING ERRCODE = '23514';
        END IF;
        NEW.reviewed_at := clock_timestamp();
    ELSIF operation = 'purge_classification' AND current_user = @OPERATOR_ROLE@ THEN
        allowed := ARRAY['evidence_file', 'updated_at'];
        IF NOT users_classification_evidence_purge_due(OLD.uuid) OR NULLIF(NEW.evidence_file, '') IS NOT NULL THEN
            RAISE EXCEPTION 'Classification evidence is not past its installed retention horizon' USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'Classification changes require the exact bounded command' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
        RAISE EXCEPTION 'The original classification payload and evidence identity are immutable' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.documents_lock_evidence_command()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    operation text;
    source_id uuid;
    document_id uuid;
    document documents;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN RETURN NULL; END IF;
    operation := NULLIF(current_setting('app.classification_evidence_operation', true), '');
    source_id := NULLIF(current_setting('app.classification_evidence_source', true), '')::uuid;
    document_id := NULLIF(current_setting('app.classification_evidence_document', true), '')::uuid;
    IF document_id IS NULL OR operation IS NULL OR operation NOT IN ('attach', 'delete_unattached', 'purge_document') THEN
        RAISE EXCEPTION 'Document changes require the exact bounded evidence command' USING ERRCODE = '23514';
    END IF;
    IF (TG_OP = 'DELETE') IS DISTINCT FROM (operation = 'delete_unattached') THEN
        RAISE EXCEPTION 'The document command does not authorize this operation' USING ERRCODE = '23514';
    END IF;
    IF operation = 'purge_document' AND current_user <> @OPERATOR_ROLE@ THEN
        RAISE EXCEPTION 'Document purge requires the bounded technical operation' USING ERRCODE = '23514';
    END IF;
    IF source_id IS NOT NULL THEN
        PERFORM 1 FROM users_investorclassification WHERE uuid = source_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Classification not found or permission denied' USING ERRCODE = '23514';
        END IF;
    ELSIF operation = 'attach' THEN
        RAISE EXCEPTION 'Attachment requires the exact submitted classification' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO document FROM documents WHERE uuid = document_id FOR UPDATE;
    IF document.uuid IS NULL OR (operation = 'attach' AND document.classification_id IS NOT NULL)
        OR (operation <> 'attach' AND document.classification_id IS DISTINCT FROM source_id)
    THEN
        RAISE EXCEPTION 'The document differs from the bounded evidence command' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.documents_guard_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    operation text;
    source_id uuid;
    principal bigint;
    source users_investorclassification;
    allowed text[];
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF TG_OP = 'INSERT' THEN
        IF NEW.classification_id IS NOT NULL OR NEW.attached_at IS NOT NULL OR NEW.purged_at IS NOT NULL
            OR NEW.uploaded_by_id IS DISTINCT FROM principal OR principal IS NULL
            OR NULLIF(NEW.file, '') IS NULL OR NEW.file NOT LIKE 'documents/' || NEW.uuid::text || '/%' THEN
            RAISE EXCEPTION 'A new document records an unattached upload by the actual participant' USING ERRCODE = '23514';
        END IF;
        NEW.created_at := clock_timestamp();
        NEW.updated_at := NEW.created_at;
        RETURN NEW;
    END IF;
    operation := NULLIF(current_setting('app.classification_evidence_operation', true), '');
    source_id := NULLIF(current_setting('app.classification_evidence_source', true), '')::uuid;
    IF OLD.uuid IS DISTINCT FROM NULLIF(current_setting('app.classification_evidence_document', true), '')::uuid THEN
        RAISE EXCEPTION 'The document differs from the bounded evidence command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF operation IS DISTINCT FROM 'delete_unattached' OR OLD.classification_id IS NOT NULL
            OR OLD.uploaded_by_id IS DISTINCT FROM principal OR principal IS NULL THEN
            RAISE EXCEPTION 'Attached evidence is retained with its classification' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF operation = 'attach' THEN
        allowed := ARRAY['classification_id', 'file', 'attached_at', 'updated_at'];
        SELECT * INTO source FROM users_investorclassification WHERE uuid = source_id;
        IF source.uuid IS NULL OR source.status IS DISTINCT FROM 'submitted' OR OLD.classification_id IS NOT NULL
            OR NEW.classification_id IS DISTINCT FROM source_id OR OLD.uploaded_by_id IS DISTINCT FROM principal
            OR principal IS NULL OR NOT EXISTS (
                SELECT 1 FROM customer_accounts_account holder
                JOIN users_userprofile profile ON profile.uuid = holder.user_profile_id
                WHERE holder.uuid = source.user_account_id AND profile.user_id = principal
            ) OR EXISTS (SELECT 1 FROM users_companyeligibilityrequest retained WHERE retained.source_id = source.uuid)
            OR OLD.document_type IS DISTINCT FROM 'payslip' OR OLD.purged_at IS NOT NULL
            OR NULLIF(OLD.file, '') IS NULL OR documents_evidence_purge_due(OLD.uuid)
            OR NULLIF(NEW.file, '') IS NULL OR NEW.file NOT LIKE
                'users/supporting-documents/' || source.uuid::text || '/' || OLD.uuid::text || '/%'
        THEN
            RAISE EXCEPTION 'Only the actual holder can attach retained evidence before a company request'
                USING ERRCODE = '23514';
        END IF;
        NEW.attached_at := clock_timestamp();
    ELSIF operation = 'purge_document' AND current_user = @OPERATOR_ROLE@ THEN
        allowed := ARRAY['file', 'original_filename', 'note', 'mime_type', 'purged_at', 'updated_at'];
        IF OLD.classification_id IS DISTINCT FROM source_id OR NOT documents_evidence_purge_due(OLD.uuid)
            OR NULLIF(NEW.file, '') IS NOT NULL OR NEW.original_filename <> '' OR NEW.note <> ''
            OR NEW.mime_type <> '' OR NEW.purged_at IS NULL THEN
            RAISE EXCEPTION 'Document evidence is not past its installed retention horizon' USING ERRCODE = '23514';
        END IF;
        NEW.purged_at := clock_timestamp();
    ELSE
        RAISE EXCEPTION 'Document content and attached evidence identity are immutable' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
        RAISE EXCEPTION 'Document content and attached evidence identity are immutable' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_nonblank(value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE(btrim(value, E' \t\n\r\f\u000b\u001c\u001d\u001e\u001f\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000') <> '', false);
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_hash(value jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT encode(sha256(convert_to(value::text, 'UTF8')), 'hex');
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_stamp(value timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_certificate_expiry(value date)
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT (value + interval '2 years')::date::timestamp AT TIME ZONE @TIME_ZONE@;
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_certificate_time_zone()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT @TIME_ZONE@;
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_offering_terms(offering_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT jsonb_build_object(
        'offering', listed.uuid::text, 'token', listed.token_id::text, 'company', listed.company_id::text,
        'exemption', listed.exemption, 'price_per_share', listed.price_per_share::text,
        'price_currency', listed.price_currency, 'minimum_shares', listed.minimum_shares,
        'target_shares', listed.target_shares, 'cap_shares', listed.cap_shares,
        'maximum_shares', listed.maximum_shares, 'opens_at', users_company_eligibility_stamp(listed.opens_at),
        'closes_at', users_company_eligibility_stamp(listed.closes_at),
        'summary', listed.summary, 'use_of_proceeds', listed.use_of_proceeds,
        'accepts_bank_transfer', listed.accepts_bank_transfer,
        'settlement_assets', COALESCE((SELECT jsonb_agg(asset_id::text ORDER BY asset_id)
            FROM offerings_offering_settlement_assets settlement WHERE settlement.offering_id = listed.uuid), '[]'::jsonb),
        'documents', COALESCE((SELECT jsonb_agg(document.companydocument_id::text ORDER BY document.companydocument_id)
            FROM offerings_offering_documents document WHERE document.offering_id = listed.uuid), '[]'::jsonb))
    FROM offerings_offering listed WHERE listed.uuid = $1;
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_metadata_digest(source_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT users_company_eligibility_hash(jsonb_build_object(
        'source', jsonb_build_object('uuid', source.uuid, 'user_account', source.user_account_id,
            'company', source.company_id, 'category', source.category,
            'declaration_accepted', source.declaration_accepted, 'declaration_text', source.declaration_text,
            'declared_basis', source.declared_basis, 'submitted_at', source.submitted_at,
            'evidence_file', source.evidence_file, 'evidence_file_size', source.evidence_file_size,
            'evidence_mime_type', source.evidence_mime_type, 'certificate_issued_at', source.certificate_issued_at,
            'certifier_name', source.certifier_name, 'certifier_body', source.certifier_body,
            'certifier_membership_number', source.certifier_membership_number),
        'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'uuid', document.uuid, 'uploaded_by', document.uploaded_by_id,
            'classification', document.classification_id, 'attached_at', document.attached_at,
            'document_type', document.document_type, 'original_filename', document.original_filename,
            'mime_type', document.mime_type, 'file', document.file, 'note', document.note) ORDER BY document.uuid)
            FROM documents document WHERE document.classification_id = source.uuid), '[]'::jsonb)))
    FROM users_investorclassification source
    JOIN customer_accounts_account account ON account.uuid = source.user_account_id
    JOIN users_userprofile owner ON owner.uuid = account.user_profile_id
    WHERE source.uuid = source_id AND (
        owner.user_id = NULLIF(current_setting('app.user_id', true), '')::bigint
        OR EXISTS (SELECT 1 FROM users_companyeligibilityrequest request WHERE request.source_id = source.uuid
            AND request.company_id IN (SELECT app_company_eligibility_ids())));
$function$;

CREATE OR REPLACE FUNCTION public.users_lock_company_eligibility_context()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    command jsonb;
    operation text;
    principal bigint;
    bound_source_id uuid;
    bound_company_id uuid;
    bound_offering_id uuid;
    bound_token_id uuid;
    bound_request_id uuid;
    source_account uuid;
    account_ids uuid[];
    profile_ids uuid[];
    actor_ids bigint[];
    recorded_actor bigint;
    proposal users_companyeligibilityrequest;
BEGIN
    IF current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@) THEN
        RAISE EXCEPTION 'Eligibility effects use the bounded operator command' USING ERRCODE = '23514';
    END IF;
    operation := COALESCE(current_setting('app.company_eligibility_operation', true), '');
    command := NULLIF(current_setting('app.company_eligibility_command', true), '')::jsonb;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF operation NOT IN ('preview', 'submit', 'decision-preview', 'decide', 'withdraw', 'revoke')
        OR principal IS NULL OR command IS NULL OR jsonb_typeof(command) <> 'object'
    THEN RAISE EXCEPTION 'Bind the exact eligibility operation and actual actor' USING ERRCODE = '23514'; END IF;
    bound_request_id := (command->>'request')::uuid;
    IF bound_request_id IS NOT NULL THEN
        SELECT * INTO proposal FROM users_companyeligibilityrequest WHERE uuid = bound_request_id;
        IF proposal.uuid IS NULL THEN RETURN; END IF;
        bound_source_id := proposal.source_id;
        bound_company_id := proposal.company_id;
        bound_offering_id := proposal.offering_id;
        bound_token_id := proposal.token_id;
        recorded_actor := proposal.submitted_by_id;
        IF command->>'company' IS NOT NULL AND (command->>'company')::uuid IS DISTINCT FROM bound_company_id THEN
            RAISE EXCEPTION 'Retain the exact request company' USING ERRCODE = '23514';
        END IF;
    ELSE
        bound_source_id := (command->>'source')::uuid;
        bound_company_id := (command->>'company')::uuid;
        bound_offering_id := (command->>'offering')::uuid;
        SELECT listed.token_id INTO bound_token_id FROM offerings_offering listed WHERE listed.uuid = bound_offering_id;
    END IF;
    PERFORM 1 FROM companies_company WHERE uuid = bound_company_id FOR NO KEY UPDATE;
    IF bound_token_id IS NOT NULL THEN
        PERFORM 1 FROM tokens_sharetoken WHERE uuid = bound_token_id FOR NO KEY UPDATE;
        PERFORM 1 FROM offerings_offering WHERE uuid = bound_offering_id FOR NO KEY UPDATE;
        IF bound_request_id IS NULL AND NOT EXISTS (SELECT 1 FROM offerings_offering listed WHERE listed.uuid = bound_offering_id
            AND listed.company_id = bound_company_id AND listed.token_id = bound_token_id)
        THEN RAISE EXCEPTION 'The captured offering context changed; preview again' USING ERRCODE = '23514'; END IF;
    END IF;
    SELECT user_account_id INTO source_account FROM users_investorclassification WHERE uuid = bound_source_id;
    SELECT array_agg(uuid ORDER BY uuid) INTO account_ids FROM customer_accounts_account
        WHERE uuid = source_account OR user_profile_id IN (SELECT uuid FROM users_userprofile WHERE user_id = principal);
    PERFORM 1 FROM customer_accounts_account WHERE uuid = ANY(account_ids) ORDER BY uuid FOR NO KEY UPDATE;
    SELECT array_agg(uuid ORDER BY uuid), array_agg(DISTINCT user_id ORDER BY user_id)
        INTO profile_ids, actor_ids FROM users_userprofile WHERE uuid IN (
            SELECT user_profile_id FROM customer_accounts_account WHERE uuid = ANY(account_ids)) OR user_id = principal;
    IF recorded_actor IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM customer_accounts_account account JOIN users_userprofile owner ON owner.uuid = account.user_profile_id
        WHERE account.uuid = source_account AND owner.user_id = recorded_actor)
    THEN RAISE EXCEPTION 'The retained participant account changed owner' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM authentication_customuser WHERE id = principal OR id = ANY(actor_ids) ORDER BY id FOR NO KEY UPDATE;
    PERFORM 1 FROM users_userprofile WHERE uuid = ANY(profile_ids) ORDER BY uuid FOR NO KEY UPDATE;
    IF (SELECT array_agg(DISTINCT user_id ORDER BY user_id) FROM users_userprofile WHERE uuid = ANY(profile_ids))
        IS DISTINCT FROM actor_ids
    THEN RAISE EXCEPTION 'The captured account/profile actor changed' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM operators_operator WHERE id = 1 FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company eligibility configuration is missing' USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM companies_companyappointment appointment WHERE appointment.company_id = bound_company_id
        AND appointment.appointee_id = principal ORDER BY appointment.uuid FOR NO KEY UPDATE;
    PERFORM 1 FROM users_investorclassification WHERE uuid = bound_source_id FOR NO KEY UPDATE;
    IF (SELECT user_account_id FROM users_investorclassification WHERE uuid = bound_source_id) IS DISTINCT FROM source_account THEN
        RAISE EXCEPTION 'Retain the captured participant source' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM documents WHERE classification_id = bound_source_id ORDER BY uuid FOR NO KEY UPDATE;
    IF bound_request_id IS NOT NULL THEN
        PERFORM 1 FROM users_companyeligibilityrequest WHERE uuid = bound_request_id FOR NO KEY UPDATE;
        PERFORM 1 FROM users_companyeligibilitydecision decision WHERE decision.request_id = bound_request_id FOR NO KEY UPDATE;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_source_current(source_id uuid, issuer_id uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT actor.is_active AND actor.is_email_verified AND account.role IN ('investor', 'both')
        AND (account.account_status = 'active' OR (NOT configuration.investor_kyc_required AND account.account_status = 'pending'))
        AND (NOT configuration.investor_kyc_required OR profile.is_id_verified) AND issuer.status = 'active'
        AND source.status IN ('submitted', 'verified') AND source.submitted_at IS NOT NULL
        AND source.declaration_accepted AND source.category IN (
            'product_value', 'accountant_certificate', 'professional_investor', 'associated_person')
        AND source.declaration_text = CASE source.category WHEN 'product_value' THEN 'I declare that the amount payable on acceptance of this offer is at least AUD 500,000, so the offer is made to me under section 708(8)(a) of the Corporations Act 2001 (Cth) and no disclosure document is required.' WHEN 'accountant_certificate' THEN 'I declare that a qualified accountant has certified, within the last two years, that I have net assets of at least AUD 2.5 million or gross income of at least AUD 250,000 for each of the last two financial years, so the offer is made to me under section 708(8)(c) of the Corporations Act 2001 (Cth).' WHEN 'professional_investor' THEN 'I declare that I am a professional investor within the meaning of section 708(11) and section 761G(7)(d) of the Corporations Act 2001 (Cth).' WHEN 'associated_person' THEN 'I declare that I am a person associated with the named issuer within the meaning of section 708(12) of the Corporations Act 2001 (Cth).' END
        AND (source.expires_at IS NULL OR source.expires_at > at_time)
        AND COALESCE(source.evidence_file, '') <> ''
        AND (source.status <> 'verified' OR source.expires_at IS NULL
            OR users_classification_evidence_retention_days() = 0
            OR source.expires_at + make_interval(secs => 86400.0 * users_classification_evidence_retention_days()) > at_time)
        AND NOT EXISTS (SELECT 1 FROM documents evidence WHERE evidence.classification_id = source.uuid
            AND (evidence.purged_at IS NOT NULL OR evidence.file = ''))
        AND (source.category <> 'associated_person' OR source.company_id = issuer_id)
        AND (source.category <> 'accountant_certificate' OR (
            source.certificate_issued_at IS NOT NULL
            AND source.certificate_issued_at <= (at_time AT TIME ZONE 'UTC')::date
            AND users_company_eligibility_certificate_expiry(source.certificate_issued_at) > at_time
            AND users_company_eligibility_nonblank(source.certifier_name) AND source.certifier_body IN ('ca_anz', 'cpa_australia', 'ipa')
            AND users_company_eligibility_nonblank(source.certifier_membership_number)))
        FROM users_investorclassification source
        JOIN customer_accounts_account account ON account.uuid = source.user_account_id
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        JOIN authentication_customuser actor ON actor.id = profile.user_id
        JOIN operators_operator configuration ON configuration.id = 1
        JOIN companies_company issuer ON issuer.uuid = issuer_id WHERE source.uuid = source_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_summary(source_id uuid, issuer_id uuid, product_id uuid, quantity integer, requested_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    source users_investorclassification;
    product offerings_offering;
    summary jsonb;
    terms jsonb;
BEGIN
    SELECT * INTO source FROM users_investorclassification WHERE uuid = source_id;
    summary := jsonb_build_object('category', source.category, 'declaration_text', source.declaration_text,
        'source', source.uuid::text, 'user_account', source.user_account_id::text, 'company', issuer_id::text,
        'submitted_at', users_company_eligibility_stamp(source.submitted_at),
        'requested_expires_at', users_company_eligibility_stamp(requested_expires_at));
    IF source.category = 'accountant_certificate' THEN
        summary := summary || jsonb_build_object('certificate_issued_at', source.certificate_issued_at::text,
            'certifier_name', source.certifier_name, 'certifier_body', source.certifier_body,
            'certifier_membership_number', source.certifier_membership_number);
    ELSIF source.category = 'associated_person' THEN
        summary := summary || jsonb_build_object('associated_company', source.company_id::text);
    ELSIF source.category = 'product_value' THEN
        SELECT * INTO product FROM offerings_offering WHERE uuid = product_id;
        terms := users_company_eligibility_offering_terms(product_id);
        summary := summary || jsonb_build_object('offering', product.uuid::text, 'token', product.token_id::text,
            'quantity', quantity, 'price_per_share', product.price_per_share::text,
            'price_currency', product.price_currency, 'amount_aud', (product.price_per_share * quantity)::text,
            'offering_terms', terms, 'offering_terms_digest', users_company_eligibility_hash(terms));
    END IF;
    RETURN summary;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_company_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    principal bigint;
    operation text;
    command jsonb;
    proposal users_companyeligibilityrequest;
    source users_investorclassification;
    decision users_companyeligibilitydecision;
    appointment companies_companyappointment;
    product offerings_offering;
    summary jsonb;
    facts jsonb;
    at_time timestamptz;
    required_capability text;
BEGIN
    IF current_user = @MIGRATE_ROLE@ THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := COALESCE(current_setting('app.company_eligibility_operation', true), '');
    command := NULLIF(current_setting('app.company_eligibility_command', true), '')::jsonb;
    IF current_user <> @OPERATOR_ROLE@ OR TG_OP <> 'INSERT' OR principal IS NULL OR command IS NULL THEN
        RAISE EXCEPTION 'Company eligibility history is append-only and actor-bound' USING ERRCODE = '23514';
    END IF;
    at_time := clock_timestamp();
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    IF TG_TABLE_NAME = 'users_companyeligibilityrequest' THEN
        SELECT * INTO source FROM users_investorclassification WHERE uuid = NEW.source_id;
        summary := users_company_eligibility_summary(NEW.source_id, NEW.company_id, NEW.offering_id,
            NEW.quantity, NEW.requested_expires_at);
        facts := jsonb_build_object('version', '1', 'shared_summary', summary,
            'source_fingerprint', NEW.source_fingerprint, 'evidence_hash', NEW.evidence_hash);
        IF operation <> 'submit' OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR (command->>'source')::uuid IS DISTINCT FROM NEW.source_id
            OR (command->>'company')::uuid IS DISTINCT FROM NEW.company_id
            OR (command->>'offering')::uuid IS DISTINCT FROM NEW.offering_id
            OR (command->>'quantity')::integer IS DISTINCT FROM NEW.quantity
            OR (command->>'requested_expires_at')::timestamptz IS DISTINCT FROM NEW.requested_expires_at
            OR (command->>'idempotency_key')::uuid IS DISTINCT FROM NEW.idempotency_key
            OR command->>'preview_digest' IS DISTINCT FROM NEW.digest
            OR NEW.user_account_id IS DISTINCT FROM source.user_account_id
            OR NOT EXISTS (SELECT 1 FROM customer_accounts_account account
                JOIN users_userprofile owner ON owner.uuid = account.user_profile_id
                WHERE account.uuid = NEW.user_account_id AND owner.user_id = principal)
            OR NOT users_company_eligibility_source_current(NEW.source_id, NEW.company_id, at_time)
            OR NEW.version IS DISTINCT FROM '1' OR NEW.category IS DISTINCT FROM source.category
            OR NOT NEW.sharing_accepted OR NOT NEW.declaration_accepted
            OR NEW.shared_summary IS DISTINCT FROM summary OR NEW.evidence_hash !~ '^[0-9a-f]{64}$'
            OR NEW.source_fingerprint IS DISTINCT FROM encode(sha256(convert_to(
                users_company_eligibility_metadata_digest(NEW.source_id) || ':' || NEW.evidence_hash, 'UTF8')), 'hex')
            OR NEW.digest IS DISTINCT FROM users_company_eligibility_hash(facts)
            OR NEW.requested_expires_at <= at_time
        THEN RAISE EXCEPTION 'Retain the exact current participant summary and evidence' USING ERRCODE = '23514'; END IF;
        IF NEW.category = 'product_value' THEN
            SELECT * INTO product FROM offerings_offering WHERE uuid = NEW.offering_id;
            IF product.uuid IS NULL OR product.status <> 'approved' OR product.company_id IS DISTINCT FROM NEW.company_id
                OR product.token_id IS DISTINCT FROM NEW.token_id
                OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id AND company_id = NEW.company_id)
                OR NEW.quantity IS NULL OR NEW.quantity <= 0 OR product.price_currency <> 'AUD'
                OR product.price_per_share <= 0 OR product.price_per_share * NEW.quantity < 500000
                OR NEW.price_per_share IS DISTINCT FROM product.price_per_share
                OR NEW.price_currency IS DISTINCT FROM product.price_currency
                OR NEW.amount_aud IS DISTINCT FROM product.price_per_share * NEW.quantity
                OR NEW.offering_terms IS DISTINCT FROM users_company_eligibility_offering_terms(product.uuid)
                OR NEW.offering_terms_digest IS DISTINCT FROM users_company_eligibility_hash(NEW.offering_terms)
            THEN RAISE EXCEPTION 'Bind exact approved product terms and server amount' USING ERRCODE = '23514'; END IF;
        END IF;
        NEW.submitted_at := at_time;
        RETURN NEW;
    END IF;
    IF TG_TABLE_NAME = 'users_companyeligibilityrevocation' THEN
        SELECT * INTO decision FROM users_companyeligibilitydecision WHERE uuid = NEW.decision_id;
        SELECT * INTO proposal FROM users_companyeligibilityrequest WHERE uuid = decision.request_id;
    ELSE
        SELECT * INTO proposal FROM users_companyeligibilityrequest WHERE uuid = NEW.request_id;
    END IF;
    IF proposal.uuid IS NULL OR (command->>'request')::uuid IS DISTINCT FROM proposal.uuid
        OR (command->>'idempotency_key')::uuid IS DISTINCT FROM NEW.idempotency_key
    THEN RAISE EXCEPTION 'Bind the exact retained request and retry key' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME = 'users_companyeligibilityrequestwithdrawal' THEN
        facts := jsonb_build_object('request', proposal.uuid::text, 'request_digest', proposal.digest, 'actor', principal);
        IF EXISTS (SELECT 1 FROM users_companyeligibilitydecision resolved
            WHERE resolved.request_id = proposal.uuid AND resolved.outcome = 'refused')
            OR operation <> 'withdraw' OR NEW.withdrawn_by_id IS DISTINCT FROM principal
            OR NEW.digest IS DISTINCT FROM users_company_eligibility_hash(facts)
            OR NOT EXISTS (SELECT 1 FROM customer_accounts_account account
                JOIN users_userprofile owner ON owner.uuid = account.user_profile_id
                WHERE account.uuid = proposal.user_account_id AND owner.user_id = principal)
        THEN RAISE EXCEPTION 'Only the actual participant withdraws their request' USING ERRCODE = '23514'; END IF;
        NEW.withdrawn_at := at_time;
        RETURN NEW;
    END IF;
    SELECT * INTO appointment FROM companies_companyappointment WHERE uuid = NEW.appointment_id;
    IF appointment.uuid IS NULL OR appointment.company_id IS DISTINCT FROM proposal.company_id
        OR appointment.appointee_id IS DISTINCT FROM principal
        OR (command->>'appointment')::uuid IS DISTINCT FROM appointment.uuid
        OR (command->>'company')::uuid IS DISTINCT FROM proposal.company_id
        OR NOT appointment.capabilities @> '["approve"]'::jsonb
        OR (appointment.expires_at IS NOT NULL AND appointment.expires_at <= at_time)
        OR EXISTS (SELECT 1 FROM companies_companyappointmentrevocation WHERE appointment_id = appointment.uuid)
        OR NOT EXISTS (SELECT 1 FROM authentication_customuser actor
            JOIN users_userprofile profile ON profile.user_id = actor.id
            JOIN operators_operator configuration ON configuration.id = 1
            WHERE actor.id = principal AND actor.is_active AND actor.is_email_verified
                AND profile.uuid = appointment.appointee_profile_id
                AND (NOT configuration.issuer_kyc_required OR profile.is_id_verified))
    THEN RAISE EXCEPTION 'Current personal approval for the exact company is required' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME = 'users_companyeligibilitydecision' THEN
        facts := jsonb_build_object('request', proposal.uuid::text, 'request_digest', proposal.digest,
            'appointment', appointment.uuid::text, 'actor', principal, 'outcome', NEW.outcome,
            'expires_at', users_company_eligibility_stamp(NEW.expires_at), 'reason', NEW.reason,
            'issuer_identity_required', (SELECT issuer_kyc_required FROM operators_operator WHERE id = 1),
            'investor_identity_required', (SELECT investor_kyc_required FROM operators_operator WHERE id = 1));
        IF command->'confirmation' IS DISTINCT FROM 'true'::jsonb
            OR operation <> 'decide' OR NEW.decided_by_id IS DISTINCT FROM principal
            OR NEW.request_digest IS DISTINCT FROM proposal.digest
            OR NEW.digest IS DISTINCT FROM users_company_eligibility_hash(facts)
            OR command->>'preview_digest' IS DISTINCT FROM NEW.digest
            OR command->>'outcome' IS DISTINCT FROM NEW.outcome
            OR command->>'reason' IS DISTINCT FROM NEW.reason
            OR (command->>'expires_at')::timestamptz IS DISTINCT FROM NEW.expires_at
            OR EXISTS (SELECT 1 FROM users_companyeligibilityrequestwithdrawal WHERE request_id = proposal.uuid)
        THEN RAISE EXCEPTION 'Retain the exact fresh company decision' USING ERRCODE = '23514'; END IF;
        IF NEW.outcome = 'accepted' THEN
            SELECT * INTO source FROM users_investorclassification WHERE uuid = proposal.source_id;
            IF NOT users_company_eligibility_source_current(source.uuid, proposal.company_id, at_time)
                OR NEW.expires_at IS NULL OR NEW.expires_at <= at_time OR NEW.expires_at > proposal.requested_expires_at
                OR (source.expires_at IS NOT NULL AND NEW.expires_at > source.expires_at)
                OR (source.category = 'accountant_certificate'
                    AND NEW.expires_at > users_company_eligibility_certificate_expiry(source.certificate_issued_at))
                OR proposal.source_fingerprint IS DISTINCT FROM encode(sha256(convert_to(
                    users_company_eligibility_metadata_digest(source.uuid) || ':' || proposal.evidence_hash, 'UTF8')), 'hex')
                OR (proposal.offering_id IS NOT NULL AND (
                    NOT EXISTS (SELECT 1 FROM offerings_offering listed
                        JOIN tokens_sharetoken token ON token.uuid = listed.token_id
                        WHERE listed.uuid = proposal.offering_id AND listed.status = 'approved'
                            AND listed.company_id = proposal.company_id AND token.company_id = proposal.company_id)
                    OR proposal.offering_terms_digest IS DISTINCT FROM users_company_eligibility_hash(
                        users_company_eligibility_offering_terms(proposal.offering_id))))
            THEN RAISE EXCEPTION 'Acceptance needs current identity, evidence and exact scoped terms' USING ERRCODE = '23514'; END IF;
        ELSIF NEW.outcome <> 'refused' OR NEW.expires_at IS NOT NULL OR NOT users_company_eligibility_nonblank(NEW.reason) THEN
            RAISE EXCEPTION 'Refusal is a reasoned retained outcome, without permission' USING ERRCODE = '23514';
        END IF;
        NEW.decided_at := at_time;
        RETURN NEW;
    END IF;
    facts := jsonb_build_object('decision', decision.uuid::text, 'actor', principal,
        'appointment', appointment.uuid::text, 'reason', NEW.reason);
    IF TG_TABLE_NAME <> 'users_companyeligibilityrevocation' OR operation <> 'revoke'
        OR decision.outcome IS DISTINCT FROM 'accepted' OR NEW.revoked_by_id IS DISTINCT FROM principal
        OR NEW.digest IS DISTINCT FROM users_company_eligibility_hash(facts)
        OR command->>'reason' IS DISTINCT FROM NEW.reason OR NOT users_company_eligibility_nonblank(NEW.reason)
    THEN RAISE EXCEPTION 'Record exact authorised acceptance revocation' USING ERRCODE = '23514'; END IF;
    NEW.revoked_at := at_time;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_begin_company_eligibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user <> @MIGRATE_ROLE@ THEN
        IF TG_OP <> 'INSERT' THEN
            RAISE EXCEPTION 'Company eligibility history is append-only' USING ERRCODE = '23514';
        END IF;
        PERFORM users_lock_company_eligibility_context();
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_guard_account_standing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user = @APP_ROLE@ AND (
        (TG_OP = 'INSERT' AND NEW.account_status IS DISTINCT FROM 'pending')
        OR (TG_OP = 'UPDATE' AND NEW.account_status IS DISTINCT FROM OLD.account_status))
    THEN RAISE EXCEPTION 'Account standing changes require the bounded technical operation' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_decision_facts_current(decision_id uuid, account_id uuid, issuer_id uuid, purpose text, product_id uuid, whole_quantity integer, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT
        purpose IN ('primary', 'secondary') AND issuer_id IS NOT NULL
        AND (purpose <> 'secondary' OR (product_id IS NULL AND whole_quantity IS NULL))
        AND (product_id IS NULL OR (purpose = 'primary' AND whole_quantity > 0
            AND EXISTS (SELECT 1 FROM public.offerings_offering product
                JOIN public.tokens_sharetoken token ON token.uuid = product.token_id
                WHERE product.uuid = product_id AND product.status = 'approved'
                    AND product.company_id = issuer_id AND token.company_id = issuer_id)))
        AND decision.outcome = 'accepted' AND decision.expires_at > boundary.checked_at
        AND decision.expires_at <= proposal.requested_expires_at
        AND decision.request_digest = proposal.digest
        AND proposal.version = '1' AND proposal.sharing_accepted AND proposal.declaration_accepted
        AND proposal.user_account_id = account_id AND source.user_account_id = account_id
        AND proposal.submitted_by_id = actor.id AND proposal.category = source.category
        AND proposal.company_id = issuer_id
        AND NOT EXISTS (SELECT 1 FROM public.users_companyeligibilityrequestwithdrawal
            WHERE request_id = proposal.uuid)
        AND NOT EXISTS (SELECT 1 FROM public.users_companyeligibilityrevocation
            WHERE decision_id = decision.uuid)
        AND public.users_company_eligibility_source_current(source.uuid, issuer_id, boundary.checked_at)
        AND (source.expires_at IS NULL OR decision.expires_at <= source.expires_at)
        AND (source.category <> 'accountant_certificate'
            OR decision.expires_at <= public.users_company_eligibility_certificate_expiry(source.certificate_issued_at))
        AND proposal.evidence_hash ~ '^[0-9a-f]{64}$'
        AND proposal.source_fingerprint = encode(sha256(convert_to(
            users_company_eligibility_hash(jsonb_build_object(
        'source', jsonb_build_object('uuid', source.uuid, 'user_account', source.user_account_id,
            'company', source.company_id, 'category', source.category,
            'declaration_accepted', source.declaration_accepted, 'declaration_text', source.declaration_text,
            'declared_basis', source.declared_basis, 'submitted_at', source.submitted_at,
            'evidence_file', source.evidence_file, 'evidence_file_size', source.evidence_file_size,
            'evidence_mime_type', source.evidence_mime_type, 'certificate_issued_at', source.certificate_issued_at,
            'certifier_name', source.certifier_name, 'certifier_body', source.certifier_body,
            'certifier_membership_number', source.certifier_membership_number),
        'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'uuid', document.uuid, 'uploaded_by', document.uploaded_by_id,
            'classification', document.classification_id, 'attached_at', document.attached_at,
            'document_type', document.document_type, 'original_filename', document.original_filename,
            'mime_type', document.mime_type, 'file', document.file, 'note', document.note) ORDER BY document.uuid)
            FROM documents document WHERE document.classification_id = source.uuid), '[]'::jsonb))) || ':' || proposal.evidence_hash,
            'UTF8')), 'hex')
        AND proposal.digest = public.users_company_eligibility_hash(jsonb_build_object(
            'version', proposal.version, 'shared_summary', proposal.shared_summary,
            'source_fingerprint', proposal.source_fingerprint, 'evidence_hash', proposal.evidence_hash))
        AND proposal.shared_summary = public.users_company_eligibility_summary(
            source.uuid, issuer_id, proposal.offering_id, proposal.quantity, proposal.requested_expires_at)
        AND CASE WHEN proposal.category = 'product_value' THEN
            purpose = 'primary' AND product_id IS NOT NULL AND whole_quantity > 0
            AND proposal.offering_id = product_id AND proposal.quantity = whole_quantity
            AND proposal.token_id IS NOT NULL AND proposal.price_per_share > 0
            AND proposal.price_currency = 'AUD' AND proposal.amount_aud >= 500000.00
            AND EXISTS (SELECT 1 FROM public.offerings_offering product
                JOIN public.tokens_sharetoken token ON token.uuid = product.token_id
                WHERE product.uuid = product_id AND product.status = 'approved'
                    AND product.company_id = issuer_id AND token.company_id = issuer_id
                    AND product.token_id = proposal.token_id
                    AND product.price_per_share = proposal.price_per_share
                    AND product.price_currency = proposal.price_currency
                    AND product.price_per_share * whole_quantity = proposal.amount_aud)
            AND proposal.offering_terms = public.users_company_eligibility_offering_terms(product_id)
            AND proposal.offering_terms_digest = public.users_company_eligibility_hash(proposal.offering_terms)
        ELSE
            (proposal.category IN ('accountant_certificate', 'professional_investor')
                OR (purpose = 'primary' AND proposal.category = 'associated_person'))
            AND proposal.offering_id IS NULL AND proposal.token_id IS NULL AND proposal.quantity IS NULL
            AND proposal.price_per_share IS NULL AND proposal.price_currency IS NULL AND proposal.amount_aud IS NULL
            AND proposal.offering_terms IS NULL AND proposal.offering_terms_digest IS NULL
        END
        FROM public.users_companyeligibilitydecision decision
        JOIN public.users_companyeligibilityrequest proposal ON proposal.uuid = decision.request_id
        JOIN public.users_investorclassification source ON source.uuid = proposal.source_id
        JOIN public.customer_accounts_account account ON account.uuid = proposal.user_account_id
        JOIN public.users_userprofile profile ON profile.uuid = account.user_profile_id
        JOIN public.authentication_customuser actor ON actor.id = profile.user_id
        CROSS JOIN (SELECT GREATEST(at_time, clock_timestamp()) AS checked_at) boundary
        WHERE decision.uuid = decision_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.users_company_eligibility_decision_current(decision_id uuid, account_id uuid, issuer_id uuid, purpose text, product_id uuid, whole_quantity integer, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
    SELECT COALESCE((SELECT public.users_company_eligibility_metadata_digest(proposal.source_id) IS NOT NULL
        AND public.users_company_eligibility_decision_facts_current(
            decision_id, account_id, issuer_id, purpose, product_id, whole_quantity, at_time)
        FROM public.users_companyeligibilitydecision decision
        JOIN public.users_companyeligibilityrequest proposal ON proposal.uuid = decision.request_id
        WHERE decision.uuid = decision_id), false);
$function$;

CREATE OR REPLACE FUNCTION public.users_refuse_retired_classification_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
    IF current_user = @OPERATOR_ROLE@
        AND current_setting('app.classification_evidence_operation', true) = 'review' THEN
        RAISE EXCEPTION 'Staff source review is retired; retain the source and record the company decision'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE TRIGGER users_keep_first_activation BEFORE UPDATE OF activation_date ON customer_accounts_account FOR EACH ROW EXECUTE FUNCTION users_keep_first_activation();

CREATE TRIGGER users_provider_identity BEFORE INSERT OR UPDATE ON users_userprofile FOR EACH ROW EXECUTE FUNCTION users_guard_provider_identity();

CREATE TRIGGER users_classification_evidence_command BEFORE INSERT OR DELETE OR UPDATE ON users_investorclassification FOR EACH STATEMENT EXECUTE FUNCTION users_lock_classification_evidence_command();

CREATE TRIGGER users_classification_evidence_guard BEFORE INSERT OR DELETE OR UPDATE ON users_investorclassification FOR EACH ROW EXECUTE FUNCTION users_guard_classification_evidence();

CREATE TRIGGER documents_evidence_command BEFORE DELETE OR UPDATE ON documents FOR EACH STATEMENT EXECUTE FUNCTION documents_lock_evidence_command();

CREATE TRIGGER documents_evidence_guard BEFORE INSERT OR DELETE OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION documents_guard_evidence();

CREATE TRIGGER users_account_standing BEFORE INSERT OR UPDATE ON customer_accounts_account FOR EACH ROW EXECUTE FUNCTION users_guard_account_standing();

CREATE TRIGGER operators_issuer_identity_policy BEFORE INSERT OR DELETE OR UPDATE ON operators_operator FOR EACH ROW EXECUTE FUNCTION operators_guard_issuer_identity_policy();

CREATE TRIGGER users_eligibility_begin BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilityrequest FOR EACH STATEMENT EXECUTE FUNCTION users_begin_company_eligibility();

CREATE TRIGGER users_eligibility_history BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilityrequest FOR EACH ROW EXECUTE FUNCTION users_guard_company_eligibility();

CREATE TRIGGER users_eligibility_begin BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilitydecision FOR EACH STATEMENT EXECUTE FUNCTION users_begin_company_eligibility();

CREATE TRIGGER users_eligibility_history BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilitydecision FOR EACH ROW EXECUTE FUNCTION users_guard_company_eligibility();

CREATE TRIGGER users_eligibility_begin BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilityrequestwithdrawal FOR EACH STATEMENT EXECUTE FUNCTION users_begin_company_eligibility();

CREATE TRIGGER users_eligibility_history BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilityrequestwithdrawal FOR EACH ROW EXECUTE FUNCTION users_guard_company_eligibility();

CREATE TRIGGER users_eligibility_begin BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilityrevocation FOR EACH STATEMENT EXECUTE FUNCTION users_begin_company_eligibility();

CREATE TRIGGER users_eligibility_history BEFORE INSERT OR DELETE OR UPDATE ON users_companyeligibilityrevocation FOR EACH ROW EXECUTE FUNCTION users_guard_company_eligibility();

CREATE TRIGGER aaa_users_classification_review_retired BEFORE UPDATE ON users_investorclassification FOR EACH STATEMENT EXECUTE FUNCTION users_refuse_retired_classification_review();
