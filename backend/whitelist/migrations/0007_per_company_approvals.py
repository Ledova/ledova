import importlib
import uuid

import django.db.models.deletion
from django.db import migrations, models

FRESH_START = (
    "Whitelist changes recorded against the retired global registry cannot move to per-company registries. "
    "Reset the database and redeploy the contracts: see docs/operations/chains.md#fresh-start-redeploy."
)

GUARD = """
DROP TRIGGER protect_whitelist_change ON whitelist_whitelistchange;
DROP FUNCTION protect_whitelist_change();
CREATE FUNCTION protect_whitelist_change() RETURNS trigger
LANGUAGE plpgsql AS $$
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
$$;
CREATE TRIGGER protect_whitelist_change
BEFORE INSERT OR UPDATE OR DELETE ON whitelist_whitelistchange
FOR EACH ROW EXECUTE FUNCTION protect_whitelist_change();
"""


def previous_guard():
    return importlib.import_module("whitelist.migrations.0006_whitelist_change_guards").GUARD


def require_a_fresh_journal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE whitelist_whitelistchange IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM whitelist_whitelistchange)")
        if cursor.fetchone()[0]:
            raise RuntimeError(FRESH_START)


def install_guard(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables

    with schema_editor.connection.cursor() as cursor:
        cursor.execute(GUARD)
    grant_reachable_tables(schema_editor)


def restore_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE whitelist_whitelistchange IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM whitelist_whitelistchange)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Cannot remove admitted whitelist recovery history")
        cursor.execute("DROP TRIGGER protect_whitelist_change ON whitelist_whitelistchange")
        cursor.execute("DROP FUNCTION protect_whitelist_change()")
        cursor.execute(previous_guard())


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("whitelist", "0006_whitelist_change_guards"),
    ]

    operations = [
        migrations.RunPython(require_a_fresh_journal, migrations.RunPython.noop),
        migrations.CreateModel(
            name="WhitelistApproval",
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
                ("registry_address", models.CharField(max_length=42)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("active", "Active"),
                            ("removed", "Removed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                (
                    "expires_at",
                    models.DateTimeField(blank=True, help_text="Blank means the approval never expires.", null=True),
                ),
                ("last_synced_at", models.DateTimeField(blank=True, null=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
                    ),
                ),
                (
                    "entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="approvals",
                        to="whitelist.whitelistentry",
                    ),
                ),
            ],
            options={
                "verbose_name": "Whitelist Approval",
                "verbose_name_plural": "Whitelist Approvals",
                "ordering": ["-created_at"],
                "indexes": [models.Index(fields=["status"], name="whitelist_w_status_67131c_idx")],
                "constraints": [
                    models.UniqueConstraint(fields=("entry", "company"), name="one_whitelist_approval_per_company"),
                    models.CheckConstraint(
                        condition=models.Q(("registry_address__regex", "^0x[0-9a-f]{40}$")),
                        name="whitelist_approval_registry",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("status__in", ["pending", "active", "removed", "failed"])),
                        name="whitelist_approval_status",
                    ),
                ],
            },
        ),
        migrations.RemoveIndex(model_name="whitelistentry", name="whitelist_w_status_17a99e_idx"),
        migrations.RemoveIndex(model_name="whitelistentry", name="whitelist_w_is_whit_d18750_idx"),
        migrations.RemoveField(model_name="whitelistentry", name="add_tx_hash"),
        migrations.RemoveField(model_name="whitelistentry", name="failure_reconciled_at"),
        migrations.RemoveField(model_name="whitelistentry", name="is_whitelisted"),
        migrations.RemoveField(model_name="whitelistentry", name="last_synced_at"),
        migrations.RemoveField(model_name="whitelistentry", name="on_chain_timestamp"),
        migrations.RemoveField(model_name="whitelistentry", name="remove_tx_hash"),
        migrations.RemoveField(model_name="whitelistentry", name="status"),
        migrations.AddField(
            model_name="whitelistchange",
            name="company_id",
            field=models.UUIDField(editable=False),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="whitelistchange",
            name="expires_at",
            field=models.DateTimeField(editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="whitelistchange",
            constraint=models.CheckConstraint(
                condition=models.Q(("action", "add"), ("expires_at__isnull", True), _connector="OR"),
                name="whitelist_change_removal_has_no_expiry",
            ),
        ),
        migrations.RunPython(install_guard, restore_guard),
    ]
