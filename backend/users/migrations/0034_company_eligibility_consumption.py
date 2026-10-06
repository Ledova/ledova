from django.db import migrations

FORWARD = """
CREATE FUNCTION users_company_eligibility_decision_facts_current(
    decision_id uuid, account_id uuid, issuer_id uuid, purpose text,
    product_id uuid, whole_quantity integer, at_time timestamptz
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
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
$$;
CREATE FUNCTION users_company_eligibility_decision_current(
    decision_id uuid, account_id uuid, issuer_id uuid, purpose text,
    product_id uuid, whole_quantity integer, at_time timestamptz
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT COALESCE((SELECT public.users_company_eligibility_metadata_digest(proposal.source_id) IS NOT NULL
        AND public.users_company_eligibility_decision_facts_current(
            decision_id, account_id, issuer_id, purpose, product_id, whole_quantity, at_time)
        FROM public.users_companyeligibilitydecision decision
        JOIN public.users_companyeligibilityrequest proposal ON proposal.uuid = decision.request_id
        WHERE decision.uuid = decision_id), false);
$$;
"""


class Migration(migrations.Migration):
    dependencies = [("users", "0033_company_eligibility_guards")]
    operations = [
        migrations.RunSQL(
            FORWARD,
            "DROP FUNCTION users_company_eligibility_decision_current(uuid, uuid, uuid, text, uuid, integer, timestamptz); "
            "DROP FUNCTION users_company_eligibility_decision_facts_current(uuid, uuid, uuid, text, uuid, integer, timestamptz)",
        )
    ]
