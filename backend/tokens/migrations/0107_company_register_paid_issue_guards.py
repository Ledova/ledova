import re
from importlib import import_module

from django.conf import settings
from django.db import migrations

PREVIOUS = import_module("tokens.migrations.0101_company_register_issue_guards")


def _function(source, name):
    return re.search(r"CREATE FUNCTION " + name + r"\(.*?\$\$;", source, re.S).group(0)


PAID = """
CREATE FUNCTION tokens_register_paid_issue_ready(proposal tokens_registerinstruction) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT proposal.kind = 'issue' AND proposal.preparing_appointment_id IS NOT NULL
        AND company.status = 'active' AND token.status = 'deployed' AND token.chain = 'base' AND token.decimals = 0
        AND subscription.status = 'paid' AND subscription.refunded_at IS NULL AND wallet.chain = 'base'
        AND wallet.user_account_id = subscription.user_account_id
        AND subscription.amount_received >= COALESCE(subscription.allotted_quantity, subscription.quantity) * subscription.price_per_share
        AND COALESCE(subscription.allotted_quantity, subscription.quantity) BETWEEN 1 AND 2147483647
        AND (subscription.issuance_request_id IS NULL OR subscription.issuance_request_id = proposal.request_id)
        AND subscription.company_id = company.uuid AND offering.company_id = company.uuid AND token.company_id = company.uuid
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply::text)
        AND proposal.snapshot->'source'->>'subscription' = subscription.uuid::text
        AND proposal.snapshot->'source'->>'offering' = offering.uuid::text
        AND proposal.snapshot->'source'->>'company' = company.uuid::text AND proposal.snapshot->'source'->>'token' = token.uuid::text
        AND proposal.snapshot->'private'->>'wallet' = wallet.uuid::text AND proposal.snapshot->'private'->>'account' = subscription.user_account_id::text
        AND proposal.snapshot->'source'->>'recipient_address' = lower(wallet.address)
        AND proposal.snapshot->'source'->>'recipient_name' = (CASE WHEN (SELECT count(*) FROM wallets same
            WHERE same.chain = token.chain AND lower(same.address) = lower(wallet.address)) = 1 THEN
            COALESCE(NULLIF(regexp_replace(profile.full_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), actor.email, '') ELSE '' END)
        AND proposal.snapshot->'source'->>'shares' = COALESCE(subscription.allotted_quantity, subscription.quantity)::text
        AND proposal.snapshot->'source'->>'requested_shares' = subscription.quantity::text
        AND proposal.snapshot->'source'->>'currency' = subscription.currency
        AND (proposal.snapshot->'source'->>'price_per_share')::numeric = subscription.price_per_share
        AND (proposal.snapshot->'source'->>'amount_due')::numeric = subscription.amount_due
        AND (proposal.snapshot->'source'->>'amount_received')::numeric IS NOT DISTINCT FROM subscription.amount_received
        AND (proposal.snapshot->'source'->>'money_held')::numeric = COALESCE(subscription.amount_received, 0)
        AND (proposal.snapshot->'source'->>'payment_received_on')::date IS NOT DISTINCT FROM subscription.payment_received_on
        AND proposal.snapshot->'source'->>'payment_reference_seen' = COALESCE(subscription.payment_reference_seen, '')
        AND proposal.snapshot->'source'->>'payment_tx_hash' IS NOT DISTINCT FROM subscription.payment_tx_hash
        AND (proposal.snapshot->'source'->>'payment_confirmed_at')::timestamptz IS NOT DISTINCT FROM subscription.payment_confirmed_at
        AND (proposal.snapshot->'source'->>'refund_amount')::numeric IS NOT DISTINCT FROM subscription.refund_amount
        AND proposal.snapshot->'source'->>'refunded_at' IS NULL
        AND proposal.items = jsonb_build_array(jsonb_build_object('subscription', subscription.uuid,
            'recipient', lower(wallet.address), 'amount', COALESCE(subscription.allotted_quantity, subscription.quantity)::text))
        AND proposal.intent->>'recipient' = lower(wallet.address)
        AND proposal.intent->>'amount' = COALESCE(subscription.allotted_quantity, subscription.quantity)::text
        AND proposal.intent->>'to' = lower(token.contract_address) AND proposal.intent->>'token_chain' = token.chain
        AND proposal.intent->>'value' = '0' AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$'
        AND (proposal.intent->>'chain_id')::bigint IN (31337, 84532)
        AND proposal.intent->>'data' = '0x40c10f19' || lpad(substring(lower(wallet.address) FROM 3), 64, '0')
            || lpad(to_hex(COALESCE(subscription.allotted_quantity, subscription.quantity)::bigint), 64, '0')
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND proposal.snapshot->'transaction' = proposal.intent - ARRAY['token_chain', 'recipient', 'amount']
        AND proposal.approving_director ~ '[^[:space:]]' AND proposal.reason ~ '[^[:space:]]'
        AND proposal.authority_reference ~ '[^[:space:]]' AND length(proposal.reason) <= 1000
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.snapshot->'source'->>'recipient_name', '[[:space:]]+', ' ', 'g')))
        AND proposal.member_id IS NULL AND proposal.nomination_id IS NULL AND proposal.wallet_approval_id IS NULL
        AND proposal.terms_on IS NULL AND proposal.terms IS NULL AND proposal.acceptance_required IS NULL
        AND proposal.terms_evidence_id IS NULL AND proposal.acceptance_evidence_id IS NULL
        AND authority.company_id = company.uuid AND authority.kind = 'authority' AND authority.uploaded_by_id = proposal.submitted_by_id
        AND authority.sha256 = proposal.evidence_fingerprint AND proposal.evidence_snapshot->>'sha256' = authority.sha256
        AND proposal.evidence_snapshot->>'evidence' = authority.uuid::text
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        AND NOT EXISTS (SELECT 1 FROM tokens_registerimport imported JOIN tokens_registerentry entry ON entry.operation_id = imported.uuid
            WHERE imported.token_id = token.uuid AND imported.status = 'applied' AND entry.kind = 'opening')
        AND COALESCE(subscription.allotted_quantity, subscription.quantity) <= offering.cap_shares - COALESCE((
            SELECT sum(COALESCE(other.allotted_quantity, other.quantity)) FROM offerings_subscription other
            WHERE other.offering_id = offering.uuid AND other.uuid <> subscription.uuid AND other.status IN ('paid','allotted')
                AND other.issuance_request_id IS NOT NULL), 0)
        AND COALESCE(subscription.allotted_quantity, subscription.quantity) <= token.total_supply::numeric
            - GREATEST(COALESCE((proposal.snapshot->'chain_supply'->>1)::numeric, 0),
                COALESCE((SELECT issued_supply FROM tokens_shareregister WHERE token_id = token.uuid AND sequence > 0), 0))
            - COALESCE((SELECT sum(request.amount) FROM tokens_shareissuancerequest request
                WHERE request.token_id = token.uuid AND request.uuid IS DISTINCT FROM proposal.request_id AND (
                    request.status IN ('approved','executing') OR (request.status = 'failed' AND EXISTS (
                        SELECT 1 FROM tokens_shareissuance issuance WHERE issuance.idempotency_key = 'issuance-request:' || request.uuid::text
                            AND issuance.tx_hash IS NOT NULL AND issuance.status <> 'completed')) OR EXISTS (
                        SELECT 1 FROM tokens_shareissuanceexecution execution WHERE execution.request_id = request.uuid
                            AND execution.status = 'executed' AND request.executed_at >= (proposal.snapshot->>'observed_at')::timestamptz
                            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
                                WHERE entry.operation_id = execution.issuance_id AND entry.kind = 'issue' AND register.token_id = token.uuid)))), 0)
        FROM offerings_subscription subscription JOIN offerings_offering offering ON offering.uuid = subscription.offering_id
        JOIN tokens_sharetoken token ON token.uuid = offering.token_id JOIN companies_company company ON company.uuid = token.company_id
        JOIN wallets wallet ON wallet.uuid = subscription.wallet_id LEFT JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
        LEFT JOIN users_userprofile profile ON profile.uuid = account.user_profile_id LEFT JOIN authentication_customuser actor ON actor.id = profile.user_id
        JOIN tokens_registerevidence authority ON authority.uuid = proposal.authority_evidence_id
        WHERE subscription.uuid = proposal.paid_subscription_id AND token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$$;
CREATE FUNCTION tokens_register_paid_issue_approval(proposal_uuid uuid, at_time timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_issue_approval(proposal_uuid, at_time);
$$;
CREATE FUNCTION tokens_register_paid_issue_approved(proposal_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_issue_approved(proposal_uuid, at_time);
$$;
CREATE FUNCTION tokens_register_paid_issue_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_issue_decision_digest(proposal_uuid, decision_kind, actor, appointment_uuid, decision_reason);
$$;
"""

PAID_SOURCE = """    IF NEW.paid_subscription_id IS NOT NULL THEN
        principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.preparing_appointment_id IS NULL
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
            RAISE EXCEPTION 'Paid issues require the exact current personal company command' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'INSERT' THEN
            IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_paid_issue_prepare'
                OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted' OR NEW.request_id IS NOT NULL
                OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
                OR NEW.source_document IS NOT NULL OR NEW.rejection_reason <> ''
                OR NEW.snapshot->'private'->>'request' IS NULL OR NEW.snapshot->'private'->>'dispatch' IS NULL
                OR EXISTS (SELECT 1 FROM tokens_shareissuancerequest request WHERE request.uuid = (NEW.snapshot->'private'->>'request')::uuid)
                OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
                OR NOT tokens_register_paid_issue_ready(NEW) THEN
                RAISE EXCEPTION 'Paid preparation retains the genuine paid source without admission' USING ERRCODE = '23514';
            END IF;
        ELSE
            IF OLD.paid_subscription_id IS NULL OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected')
                OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
                OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_paid_issue_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
                OR (to_jsonb(NEW) - ARRAY['request_id','status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['request_id','status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                OR NOT EXISTS (SELECT 1 FROM tokens_registerinstructiondecision decision WHERE decision.instruction_id = NEW.uuid
                    AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                    AND decision.kind = (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END))
                OR (NEW.status = 'applied' AND (NEW.request_id::text IS DISTINCT FROM NEW.snapshot->'private'->>'request'
                    OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_issue_approval(NEW.uuid, clock_timestamp())
                    OR NOT tokens_register_paid_issue_ready(NEW) OR NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest request
                        WHERE request.uuid = NEW.request_id AND request.dispatch_id::text = NEW.snapshot->'private'->>'dispatch'
                            AND request.status = 'under_review' AND request.reviewed_by_id IS NULL AND request.reviewed_at IS NULL
                            AND request.submitted_by_id = principal AND request.submitted_at = NEW.reviewed_at
                            AND request.token_id = NEW.token_id AND request.company_id = NEW.company_id
                            AND request.amount::text = NEW.intent->>'amount' AND lower(request.recipient_address) = NEW.intent->>'recipient')))
                OR (NEW.status = 'rejected' AND (NEW.request_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
                RAISE EXCEPTION 'Paid issue retains its exact original company decision and late admission' USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
"""


READY = _function(PREVIOUS.FUNCTIONS, "tokens_register_issue_ready")
READY = READY.replace(
    "    SELECT COALESCE(",
    "    SELECT CASE WHEN proposal.paid_subscription_id IS NOT NULL THEN tokens_register_paid_issue_ready(proposal) ELSE COALESCE(",
    1,
)
READY = READY.replace(", false);", ", false) END;", 1)
SOURCE = _function(PREVIOUS.FUNCTIONS, "tokens_guard_company_issue").replace(
    "    IF NEW.preparing_appointment_id IS NULL THEN",
    PAID_SOURCE + "    IF NEW.preparing_appointment_id IS NULL THEN",
    1,
)
SOURCE = SOURCE.replace(
    "IF NEW.member_id IS NOT NULL", "IF NEW.paid_subscription_id IS NOT NULL OR NEW.member_id IS NOT NULL", 1
)
DECISION = _function(PREVIOUS.FUNCTIONS, "tokens_guard_company_issue_decision").replace(
    "'register_issue_' || NEW.kind",
    "(CASE WHEN proposal.paid_subscription_id IS NULL THEN 'register_issue_' ELSE 'register_paid_issue_' END) || NEW.kind",
)
EXECUTION = _function(PREVIOUS.FUNCTIONS, "tokens_guard_company_issue_execution")
EXECUTION = EXECUTION.replace(
    "    IF NEW.subscription_id IS NOT NULL THEN\n        IF NEW.source_instruction_id IS NOT NULL THEN RAISE EXCEPTION 'Paid allotment has its genuine separate source' USING ERRCODE = '23514'; END IF;\n        RETURN NEW;\n    END IF;",
    "",
)
EXECUTION = EXECUTION.replace(
    "'register_issue_apply'",
    "(CASE WHEN NEW.subscription_id IS NULL THEN 'register_issue_apply' ELSE 'register_paid_issue_apply' END)",
)
EXECUTION = EXECUTION.replace(
    "OR proposal.request_id IS DISTINCT FROM NEW.request_id",
    "OR proposal.paid_subscription_id IS DISTINCT FROM NEW.subscription_id OR proposal.request_id IS DISTINCT FROM NEW.request_id",
)
EXECUTION_CHECK = _function(PREVIOUS.FUNCTIONS, "tokens_check_company_issue_execution").replace(
    "IF NEW.subscription_id IS NULL AND", "IF"
)
SIGNATURE = _function(PREVIOUS.FUNCTIONS, "tokens_check_company_issue_signature").replace(
    "IF execution.uuid IS NULL OR execution.subscription_id IS NOT NULL THEN RETURN NEW; END IF;",
    "IF execution.uuid IS NULL THEN RETURN NEW; END IF;",
)
REQUEST = _function(PREVIOUS.FUNCTIONS, "tokens_check_company_issue_request")
REQUEST = REQUEST[: REQUEST.index("        AND NOT EXISTS (SELECT 1 FROM offerings_subscription")] + """ THEN
        RAISE EXCEPTION 'Fresh issuance approval requires its exact original company decision at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;"""
REVIEW = PREVIOUS.REVIEW.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION")
REVIEW = REVIEW.replace(
    "current_setting('app.company_operation', true) = 'register_issue_' || decision.kind",
    "current_setting('app.company_operation', true) = (CASE WHEN proposal.paid_subscription_id IS NULL THEN 'register_issue_' ELSE 'register_paid_issue_' END) || decision.kind",
)
REVIEW = REVIEW.replace(
    "IF EXISTS (SELECT 1 FROM tokens_registerinstruction proposal WHERE proposal.request_id = NEW.uuid AND proposal.preparing_appointment_id IS NOT NULL) THEN",
    """IF EXISTS (SELECT 1 FROM tokens_registerinstruction proposal WHERE proposal.request_id = NEW.uuid AND proposal.preparing_appointment_id IS NOT NULL) THEN
        IF NEW.status = 'rejected' AND EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution
            JOIN offerings_subscription subscription ON subscription.uuid = execution.subscription_id
            WHERE execution.request_id = NEW.uuid AND execution.status = 'cancelled'
                AND subscription.issuance_request_id = NEW.uuid AND execution.source_instruction_id IS NOT NULL
                AND OLD.status IN ('approved','failed')
                AND (to_jsonb(NEW) - ARRAY['status','rejection_reason','updated_at']) = (to_jsonb(OLD) - ARRAY['status','rejection_reason','updated_at'])
                AND NEW.rejection_reason = 'Cancelled by refund of subscription ' || COALESCE(NULLIF(subscription.reference, ''), subscription.uuid::text) || '.') THEN
            RETURN NEW;
        END IF;""",
)
a = REVIEW.index("    IF NEW.status = 'approved' AND")
b = REVIEW.index("    IF current_user =", a)
REVIEW = (
    REVIEW[:a]
    + """    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review')) THEN
        RAISE EXCEPTION 'Fresh paid and nonpaid approval requires its retained company decision' USING ERRCODE = '23514';
    END IF;
"""
    + REVIEW[b:]
)
PAID_AUTHORITY = PREVIOUS.EXECUTION.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION").replace(
    "OR NEW.authority <> 'offerings.change_subscription'",
    "OR (NEW.authority <> 'offerings.change_subscription' AND NOT (NEW.authority = 'company' AND NEW.source_instruction_id IS NOT NULL))",
)
ENTRY = _function(PREVIOUS.FUNCTIONS, "tokens_guard_company_issue_entry").replace(
    "    SELECT * INTO proposal FROM",
    """    IF execution.subscription_id IS NOT NULL THEN
        IF execution.status <> 'executed' OR NOT EXISTS (SELECT 1 FROM tokens_registerinstruction source
            JOIN offerings_subscription subscription ON subscription.uuid = source.paid_subscription_id
            JOIN tokens_registermemberwallet linked ON linked.company_id = source.company_id
            WHERE source.uuid = execution.source_instruction_id AND source.status = 'applied' AND source.request_id = execution.request_id
                AND source.paid_subscription_id = execution.subscription_id AND subscription.issuance_request_id = execution.request_id
                AND subscription.status = 'allotted' AND source.reviewed_by_id = NEW.recorded_by_id
                AND lower(linked.address) = execution.intent->>'recipient'
                AND NEW.changes = jsonb_build_array(jsonb_build_object('member', linked.member_id, 'shares', execution.intent->>'amount')))
            OR NEW.corrects_id IS NOT NULL OR execution.finalized_receipt IS NULL
            OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
            OR NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.uuid = NEW.register_id
                AND register.token_id = execution.token_id AND register.company_id = execution.company_id) THEN
            RAISE EXCEPTION 'Paid ISSUE retains its original subscription, actual member link and finalised mint' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO proposal FROM""",
    1,
)
FINANCIAL_CANCELLATION = """
CREATE FUNCTION tokens_check_paid_issue_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.status = 'rejected' AND EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution
        WHERE execution.request_id = NEW.uuid AND execution.source_instruction_id IS NOT NULL AND execution.subscription_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution JOIN offerings_subscription subscription ON subscription.uuid = execution.subscription_id
            WHERE execution.request_id = NEW.uuid AND execution.status = 'cancelled' AND subscription.issuance_request_id = NEW.uuid
                AND subscription.status = 'refunded' AND subscription.refunded_at IS NOT NULL
                AND subscription.refund_amount > 0 AND execution.source_instruction_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Paid financial cancellation commits only with its genuine original recorded refund' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_paid_issue_cancellation AFTER UPDATE ON tokens_shareissuancerequest
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_paid_issue_cancellation();
"""

INSTRUCTION = PREVIOUS.INSTRUCTION.replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION").replace(
    "    IF NEW.preparing_appointment_id IS NOT NULL THEN RETURN NEW; END IF;",
    """    IF NEW.preparing_appointment_id IS NOT NULL THEN RETURN NEW; END IF;
    IF NEW.kind = 'issue' AND (TG_OP = 'INSERT' OR (OLD.status = 'submitted' AND NEW.status = 'applied'))
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item WHERE item ? 'subscription' OR EXISTS (
            SELECT 1 FROM offerings_subscription subscription WHERE subscription.issuance_request_id::text = item->>'request')) THEN
        RAISE EXCEPTION 'Fresh paid ISSUE authority requires its genuine company decision' USING ERRCODE = '23514';
    END IF;""",
    1,
)

CHANGED = [
    READY,
    SOURCE,
    DECISION,
    EXECUTION,
    EXECUTION_CHECK,
    SIGNATURE,
    REQUEST,
    REVIEW,
    PAID_AUTHORITY,
    ENTRY,
    INSTRUCTION,
]


def install(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        sql = (
            PAID
            + "\n".join(function.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1) for function in CHANGED)
            + FINANCIAL_CANCELLATION
        )
        cursor.execute(PREVIOUS.PREVIOUS.IMPORTS._with_roles(cursor, sql.replace("%(app)s", app)))


def remove(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registerinstruction, tokens_registerinstructiondecision, tokens_shareissuanceexecution, offerings_subscription IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_registerinstruction WHERE paid_subscription_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retained company paid issues prevent guard reversal.")
        cursor.execute(
            "DROP TRIGGER tokens_paid_issue_cancellation ON tokens_shareissuancerequest; DROP FUNCTION tokens_check_paid_issue_cancellation()"
        )
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        original = [
            _function(PREVIOUS.FUNCTIONS, name)
            for name in (
                "tokens_register_issue_ready",
                "tokens_guard_company_issue",
                "tokens_guard_company_issue_decision",
                "tokens_guard_company_issue_execution",
                "tokens_check_company_issue_execution",
                "tokens_check_company_issue_signature",
                "tokens_check_company_issue_request",
                "tokens_guard_company_issue_entry",
            )
        ]
        original.extend([PREVIOUS.REVIEW, PREVIOUS.EXECUTION, PREVIOUS.INSTRUCTION])
        sql = "\n".join(function.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1) for function in original)
        cursor.execute(PREVIOUS.PREVIOUS.IMPORTS._with_roles(cursor, sql.replace("%(app)s", app)))
        cursor.execute(
            "DROP FUNCTION tokens_register_paid_issue_decision_digest(uuid,text,bigint,uuid,text); DROP FUNCTION tokens_register_paid_issue_approved(uuid,timestamptz); DROP FUNCTION tokens_register_paid_issue_approval(uuid,timestamptz); DROP FUNCTION tokens_register_paid_issue_ready(tokens_registerinstruction)"
        )


class Migration(migrations.Migration):
    dependencies = [("tokens", "0106_company_register_paid_issues")]
    operations = [migrations.RunPython(install, remove)]
