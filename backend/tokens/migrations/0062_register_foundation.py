import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

GUARDS = """
CREATE FUNCTION tokens_guard_registered_class() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
        AND EXISTS (SELECT 1 FROM tokens_shareregister WHERE token_id = OLD.uuid) THEN
        RAISE EXCEPTION 'A registered share class cannot move to another company' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_registered_class_company BEFORE UPDATE OF company_id ON tokens_sharetoken
FOR EACH ROW EXECUTE FUNCTION tokens_guard_registered_class();
CREATE FUNCTION tokens_register_entry_hash(entry tokens_registerentry) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        'ledova-register-v1', entry.uuid, entry.register_id, entry.operation_id,
        entry.sequence, entry.kind, to_char(entry.effective_on, 'YYYY-MM-DD'),
        entry.changes, entry.corrects_id, entry.recorded_by_id, entry.previous_hash,
        to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_register_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Register member references cannot be rewritten or deleted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER tokens_register_member_identity BEFORE UPDATE OR DELETE ON tokens_registermember
FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_member();
CREATE FUNCTION tokens_guard_share_register() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id AND company_id = NEW.company_id FOR KEY SHARE;
        IF NOT FOUND OR NEW.sequence <> 0 OR NEW.issued_supply <> 0 OR NEW.head_hash <> repeat('0', 64) THEN
            RAISE EXCEPTION 'A register must start empty for its own company and share class' USING ERRCODE = '23514';
        END IF;
    ELSIF TG_OP = 'DELETE' OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Only register entries may advance the register' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_share_register_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_shareregister
FOR EACH ROW EXECUTE FUNCTION tokens_guard_share_register();
CREATE FUNCTION tokens_guard_register_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Only register entries may change holdings' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_position_projection BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerposition
FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_position();
CREATE FUNCTION tokens_guard_register_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    head tokens_shareregister;
    original tokens_registerentry;
    effect jsonb;
    selected_member uuid;
    delta numeric;
    held numeric;
    total numeric := 0;
    previous_member text := '';
    inverse jsonb;
    maximum numeric := 115792089237316195423570985008687907853269984665640564039457584007913129639935;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register entries cannot be rewritten or deleted' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO STRICT head FROM tokens_shareregister WHERE uuid = NEW.register_id FOR UPDATE;
    IF NEW.kind NOT IN ('opening', 'issue', 'transfer', 'cessation', 'correction')
        OR (NEW.kind = 'opening') <> (head.sequence = 0)
        OR jsonb_typeof(NEW.changes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The register requires one opening followed by typed changes' USING ERRCODE = '23514';
    END IF;
    FOR effect IN SELECT value FROM jsonb_array_elements(NEW.changes) LOOP
        IF jsonb_typeof(effect) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Register changes require member and share fields' USING ERRCODE = '23514';
        END IF;
        IF (SELECT count(*) FROM jsonb_object_keys(effect)) <> 2
            OR jsonb_typeof(effect->'member') IS DISTINCT FROM 'string'
            OR jsonb_typeof(effect->'shares') IS DISTINCT FROM 'string'
            OR (effect->>'shares') !~ '^-?[1-9][0-9]{0,77}$'
            OR (effect->>'member') <= previous_member THEN
            RAISE EXCEPTION 'Register changes must be distinct sorted members with exact nonzero shares' USING ERRCODE = '23514';
        END IF;
        selected_member := (effect->>'member')::uuid;
        IF selected_member::text <> effect->>'member' OR NOT EXISTS (
            SELECT 1 FROM tokens_registermember WHERE uuid = selected_member AND company_id = head.company_id
        ) THEN
            RAISE EXCEPTION 'A register member must belong to its company' USING ERRCODE = '23514';
        END IF;
        previous_member := effect->>'member';
        delta := (effect->>'shares')::numeric;
        held := COALESCE((SELECT shares FROM tokens_registerposition
            WHERE register_id = head.uuid AND tokens_registerposition.member_id = selected_member), 0);
        IF abs(delta) > maximum OR held + delta < 0 OR held + delta > maximum
            OR (NEW.kind IN ('opening', 'issue') AND delta < 0)
            OR (NEW.kind = 'cessation' AND (delta > 0 OR held + delta <> 0)) THEN
            RAISE EXCEPTION 'Register changes must preserve valid holdings' USING ERRCODE = '23514';
        END IF;
        total := total + delta;
    END LOOP;
    IF (NEW.kind <> 'opening' AND jsonb_array_length(NEW.changes) = 0)
        OR (NEW.kind IN ('issue', 'cessation') AND jsonb_array_length(NEW.changes) <> 1)
        OR (NEW.kind = 'transfer' AND (jsonb_array_length(NEW.changes) <> 2 OR total <> 0))
        OR head.issued_supply + total < 0 OR head.issued_supply + total > maximum THEN
        RAISE EXCEPTION 'The register change has an invalid shape or supply' USING ERRCODE = '23514';
    END IF;
    IF NEW.kind = 'correction' THEN
        SELECT * INTO original FROM tokens_registerentry
            WHERE uuid = NEW.corrects_id AND register_id = head.uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'A correction must identify an earlier entry in this register' USING ERRCODE = '23514';
        END IF;
        SELECT jsonb_agg(jsonb_build_object('member', value->>'member',
            'shares', (-(value->>'shares')::numeric)::text) ORDER BY value->>'member')
            INTO inverse FROM jsonb_array_elements(original.changes);
        IF NEW.changes IS DISTINCT FROM inverse THEN
            RAISE EXCEPTION 'A correction must compensate the original entry exactly' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.corrects_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only a correction can compensate an earlier entry' USING ERRCODE = '23514';
    END IF;
    NEW.sequence := head.sequence + 1;
    NEW.previous_hash := head.head_hash;
    NEW.entry_hash := tokens_register_entry_hash(NEW);
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_entry_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerentry
FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_entry();
CREATE FUNCTION tokens_project_register_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    effect jsonb;
    delta numeric;
    total numeric := 0;
BEGIN
    FOR effect IN SELECT value FROM jsonb_array_elements(NEW.changes) LOOP
        delta := (effect->>'shares')::numeric;
        UPDATE tokens_registerposition SET shares = shares + delta,
            entered_on = CASE WHEN shares = 0 THEN NEW.effective_on ELSE entered_on END,
            last_entry_id = NEW.uuid, updated_at = NEW.created_at
            WHERE register_id = NEW.register_id AND member_id = (effect->>'member')::uuid;
        IF NOT FOUND THEN
            INSERT INTO tokens_registerposition
                (uuid, created_at, updated_at, register_id, member_id, shares, entered_on, last_entry_id)
            VALUES (gen_random_uuid(), NEW.created_at, NEW.created_at, NEW.register_id,
                (effect->>'member')::uuid, delta, NEW.effective_on, NEW.uuid);
        END IF;
        total := total + delta;
    END LOOP;
    UPDATE tokens_shareregister SET sequence = NEW.sequence, head_hash = NEW.entry_hash,
        issued_supply = issued_supply + total, updated_at = NEW.created_at WHERE uuid = NEW.register_id;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_entry_projection AFTER INSERT ON tokens_registerentry
FOR EACH ROW EXECUTE FUNCTION tokens_project_register_entry();
"""


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    install_tables(
        schema_editor,
        ["tokens_registermember", "tokens_shareregister", "tokens_registerentry", "tokens_registerposition"],
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(GUARDS)
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    for name in ("RegisterMember", "ShareRegister"):
        if apps.get_model("tokens", name).objects.using(schema_editor.connection.alias).exists():
            raise RuntimeError("Retain register history; this migration cannot discard member or register records.")
    with schema_editor.connection.cursor() as cursor:
        for table, trigger, function in (
            ("tokens_sharetoken", "tokens_registered_class_company", "tokens_guard_registered_class"),
            ("tokens_registerentry", "tokens_register_entry_projection", "tokens_project_register_entry"),
            ("tokens_registerentry", "tokens_register_entry_identity", "tokens_guard_register_entry"),
            ("tokens_registerposition", "tokens_register_position_projection", "tokens_guard_register_position"),
            ("tokens_shareregister", "tokens_share_register_identity", "tokens_guard_share_register"),
            ("tokens_registermember", "tokens_register_member_identity", "tokens_guard_register_member"),
        ):
            cursor.execute(f"DROP TRIGGER {trigger} ON {table}")
            cursor.execute(f"DROP FUNCTION {function}()")
        cursor.execute("DROP FUNCTION tokens_register_entry_hash(tokens_registerentry)")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0008_company_registry_verification"),
        ("shared", "0012_operator_creates_matches"),
        ("tokens", "0061_swap_approval_recovery_index"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterMember",
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
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="register_members",
                        to="companies.company",
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="ShareRegister",
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
                ("sequence", models.PositiveBigIntegerField(default=0, editable=False)),
                (
                    "head_hash",
                    models.CharField(
                        default="0000000000000000000000000000000000000000000000000000000000000000",
                        editable=False,
                        max_length=64,
                    ),
                ),
                ("issued_supply", models.DecimalField(decimal_places=0, default=0, editable=False, max_digits=78)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="registers", to="companies.company"
                    ),
                ),
                (
                    "token",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="stored_register",
                        to="tokens.sharetoken",
                    ),
                ),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.CreateModel(
            name="RegisterEntry",
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
                ("operation_id", models.UUIDField()),
                ("sequence", models.PositiveBigIntegerField(default=0, editable=False)),
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("opening", "Opening state"),
                            ("issue", "Issue"),
                            ("transfer", "Transfer"),
                            ("cessation", "Cessation"),
                            ("correction", "Compensating correction"),
                        ],
                        max_length=16,
                    ),
                ),
                ("effective_on", models.DateField()),
                ("changes", models.JSONField()),
                ("previous_hash", models.CharField(blank=True, editable=False, max_length=64)),
                ("entry_hash", models.CharField(blank=True, editable=False, max_length=64)),
                (
                    "corrects",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="correction",
                        to="tokens.registerentry",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "register",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="entries", to="tokens.shareregister"
                    ),
                ),
            ],
            options={
                "ordering": ["sequence"],
            },
        ),
        migrations.CreateModel(
            name="RegisterPosition",
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
                ("shares", models.DecimalField(decimal_places=0, editable=False, max_digits=78)),
                ("entered_on", models.DateField(editable=False)),
                (
                    "last_entry",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="tokens.registerentry"
                    ),
                ),
                (
                    "member",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="positions",
                        to="tokens.registermember",
                    ),
                ),
                (
                    "register",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="positions", to="tokens.shareregister"
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(fields=("register", "member"), name="register_member_position"),
                    models.CheckConstraint(
                        condition=models.Q(("shares__gte", 0)), name="register_position_nonnegative"
                    ),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="registerentry",
            constraint=models.UniqueConstraint(fields=("register", "sequence"), name="register_entry_sequence"),
        ),
        migrations.AddConstraint(
            model_name="registerentry",
            constraint=models.UniqueConstraint(fields=("register", "operation_id"), name="register_entry_operation"),
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
