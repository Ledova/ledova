import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_opening


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(schema_editor, ["tokens_registermemberwallet", "tokens_registeropening"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE UNIQUE INDEX tokens_registermemberwallet_company_address_ci
    ON tokens_registermemberwallet (company_id, lower(address));
CREATE FUNCTION tokens_guard_register_member_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register wallet links are immutable identity records' USING ERRCODE = '23514';
    END IF;
    IF NEW.address !~ '^0x[0-9a-fA-F]{40}$'
        OR NOT EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid = NEW.member_id
            AND m.company_id = NEW.company_id)
        OR EXISTS (SELECT 1 FROM tokens_registermemberwallet w WHERE w.company_id = NEW.company_id
            AND lower(w.address) = lower(NEW.address) AND w.uuid <> NEW.uuid)
    THEN
        RAISE EXCEPTION 'Register wallet links bind one member of the company to one address' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_member_wallet_identity
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registermemberwallet
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_member_wallet();
CREATE FUNCTION tokens_guard_register_opening() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    share_class tokens_sharetoken;
    head tokens_shareregister;
    applied tokens_registerentry;
    owner bigint;
    expected_changes jsonb;
    mapping_count bigint;
    holdings_count bigint;
    pair_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain opening proposals and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT * INTO share_class FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> '' OR NEW.boundary IS NOT NULL
            OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR share_class.uuid IS NULL OR share_class.company_id IS DISTINCT FROM NEW.company_id
            OR share_class.status NOT IN ('deployed', 'paused')
            OR EXISTS (SELECT 1 FROM tokens_shareregister r WHERE r.token_id = NEW.token_id
                AND EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = r.uuid))
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-openings/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
            OR jsonb_typeof(NEW.mapping) <> 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'member')
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR mapping_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.mapping) item)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermember m ON m.uuid::text = item->>'member'
                WHERE m.company_id IS DISTINCT FROM NEW.company_id)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermemberwallet w ON w.company_id = NEW.company_id
                    AND lower(w.address) = lower(item->>'address')
                WHERE w.member_id::text IS DISTINCT FROM item->>'member')
        THEN
            RAISE EXCEPTION 'Opening submissions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.boundary IS NULL AND NEW.boundary IS NOT NULL THEN
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        SELECT count(*) INTO holdings_count FROM jsonb_array_elements(NEW.boundary->'holdings');
        SELECT count(*) INTO pair_count FROM jsonb_array_elements(NEW.mapping) m(item)
            JOIN jsonb_array_elements(NEW.boundary->'holdings') h(item)
            ON lower(h.item->>'address') = lower(m.item->>'address');
        IF current_user = %s OR OLD.status <> 'submitted' OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR (to_jsonb(NEW) - ARRAY['boundary', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['boundary', 'updated_at'])
            OR COALESCE(NEW.boundary->>'version', '') <> '1'
            OR NEW.boundary->>'token' IS DISTINCT FROM NEW.token_id::text
            OR NEW.boundary->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.boundary->>'chain_id', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'number', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'hash', '') !~ '^0x[0-9a-f]{64}$'
            OR COALESCE(NEW.boundary->'block'->>'timestamp', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            OR COALESCE(NEW.boundary->'policy'->>'mode', '') NOT IN ('finalized', 'depth')
            OR (NEW.boundary->'policy'->>'mode' = 'depth') <> (NEW.boundary->'policy' ? 'depth')
            OR COALESCE(NEW.boundary->>'authorized_supply', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->>'issued_supply', 'x') !~ '^[0-9]+$'
            OR (CASE WHEN COALESCE(NEW.boundary->>'issued_supply', '') ~ '^[0-9]+$'
                     AND COALESCE(NEW.boundary->>'authorized_supply', '') ~ '^[0-9]+$'
                THEN (NEW.boundary->>'issued_supply')::numeric > (NEW.boundary->>'authorized_supply')::numeric
                ELSE FALSE END)
            OR jsonb_typeof(NEW.boundary->'holdings') <> 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.boundary->'holdings') item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'shares')
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'shares' !~ '^[1-9][0-9]*$')
            OR (CASE WHEN COALESCE(NEW.boundary->>'issued_supply', '') ~ '^[0-9]+$'
                THEN (SELECT COALESCE(sum((item->>'shares')::numeric), 0)
                    FROM jsonb_array_elements(NEW.boundary->'holdings') item)
                    IS DISTINCT FROM (NEW.boundary->>'issued_supply')::numeric
                ELSE FALSE END)
            OR holdings_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.boundary->'holdings') item)
            OR pair_count <> mapping_count OR pair_count <> holdings_count
        THEN
            RAISE EXCEPTION 'The captured boundary must bind this share class and its mapped holders exactly'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user = %s OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
            OR NEW.boundary IS DISTINCT FROM OLD.boundary
            OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
                'applied_entry_id', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
                'applied_entry_id', 'updated_at'])
            OR NEW.reviewed_at IS NULL OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
            ) THEN
            RAISE EXCEPTION 'Only operator review may decide an immutable opening submission' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            SELECT * INTO head FROM tokens_shareregister WHERE token_id = NEW.token_id;
            SELECT * INTO applied FROM tokens_registerentry WHERE uuid = NEW.applied_entry_id;
            SELECT COALESCE(
                       jsonb_agg(jsonb_build_object('member', agg.member, 'shares', agg.total::text) ORDER BY agg.member),
                       '[]'::jsonb)
                INTO expected_changes
                FROM (SELECT m.item->>'member' AS member, sum((h.item->>'shares')::numeric) AS total
                    FROM jsonb_array_elements(NEW.mapping) m(item)
                    JOIN jsonb_array_elements(NEW.boundary->'holdings') h(item)
                    ON lower(h.item->>'address') = lower(m.item->>'address')
                    GROUP BY m.item->>'member') agg;
            IF NEW.boundary IS NULL OR head.uuid IS NULL OR applied.uuid IS NULL
                OR applied.register_id <> head.uuid OR head.company_id IS DISTINCT FROM NEW.company_id
                OR head.sequence <> 1 OR applied.sequence <> 1
                OR applied.kind <> 'opening' OR applied.operation_id <> NEW.uuid
                OR applied.corrects_id IS NOT NULL
                OR applied.changes IS DISTINCT FROM expected_changes
                OR applied.effective_on <> (NEW.boundary->'block'->>'date')::date
                OR applied.recorded_by_id <> NEW.reviewed_by_id
                OR applied.previous_hash <> repeat('0', 64)
                OR NEW.rejection_reason <> ''
                OR EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = head.uuid
                    AND e.uuid <> applied.uuid)
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                    WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet w
                        WHERE w.company_id = NEW.company_id AND lower(w.address) = lower(item->>'address')
                        AND w.member_id::text = item->>'member'))
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                    WHERE NOT EXISTS (SELECT 1 FROM tokens_registermember m2
                        WHERE m2.uuid::text = item->>'member' AND m2.company_id = NEW.company_id))
            THEN
                RAISE EXCEPTION 'Approval must initialise the register from its captured boundary'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.applied_entry_id IS NOT NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
            RAISE EXCEPTION 'Rejection requires a reason and no applied entry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_opening_identity
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registeropening
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening();
""",
            [settings.RLS_ROLES["app"], settings.RLS_ROLES["app"]],
        )
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registeropening IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registeropening)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain opening proposals and their authority evidence; downgrade would discard it.")
        cursor.execute("DROP TRIGGER tokens_register_opening_identity ON tokens_registeropening")
        cursor.execute("DROP FUNCTION tokens_guard_register_opening()")
        cursor.execute("LOCK TABLE tokens_registermemberwallet IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registermemberwallet)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain register wallet links; downgrade would discard them.")
        cursor.execute("DROP TRIGGER tokens_register_member_wallet_identity ON tokens_registermemberwallet")
        cursor.execute("DROP FUNCTION tokens_guard_register_member_wallet()")
        cursor.execute("DROP INDEX tokens_registermemberwallet_company_address_ci")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("tokens", "0064_reviewed_register_corrections"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterOpening",
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
                ("mapping", models.JSONField()),
                ("boundary", models.JSONField(null=True)),
                (
                    "authority",
                    models.CharField(
                        choices=[("director_resolution", "Director resolution"), ("court_order", "Court order")],
                        max_length=24,
                    ),
                ),
                ("approving_director", models.CharField(blank=True, max_length=255)),
                ("authority_reference", models.CharField(max_length=255)),
                ("reason", models.CharField(max_length=1000)),
                ("source_document", models.UUIDField()),
                ("evidence_fingerprint", models.CharField(max_length=64)),
                ("evidence_snapshot", models.JSONField()),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=tokens.models.register_opening.opening_evidence_path,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("submitted", "Submitted"), ("applied", "Applied"), ("rejected", "Rejected")],
                        default="submitted",
                        max_length=16,
                    ),
                ),
                ("reviewed_at", models.DateTimeField(editable=False, null=True)),
                ("rejection_reason", models.CharField(blank=True, editable=False, max_length=1000)),
                (
                    "applied_entry",
                    models.OneToOneField(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="approved_opening",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_openings",
                        to="companies.company",
                    ),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_openings",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="RegisterMemberWallet",
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
                ("address", models.CharField(max_length=42)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_wallets",
                        to="companies.company",
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="wallets", to="tokens.registermember"
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("company", "address"), name="register_wallet_company_address")
                ],
            },
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
