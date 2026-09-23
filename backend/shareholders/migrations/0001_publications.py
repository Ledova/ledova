import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import shareholders.models.publication

GUARDS = """
CREATE FUNCTION shareholders_guard_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A publication is frozen once it is made' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = %(app)s THEN
            RAISE EXCEPTION 'Only the retention purge removes a publication' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF NOT EXISTS (
            SELECT 1 FROM tokens_sharetoken listed
            WHERE listed.uuid = NEW.token_id AND listed.company_id = NEW.company_id
              AND listed.status = 'deployed' AND length(listed.contract_address) > 0
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
        RAISE EXCEPTION 'A publication requires a deployed share class, its opened register head and the company''s verified authority' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER shareholders_publication_is_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON shareholders_publication
    FOR EACH ROW EXECUTE FUNCTION shareholders_guard_publication();

CREATE FUNCTION shareholders_guard_publication_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A frozen roll row cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = %(app)s THEN
            RAISE EXCEPTION 'Only the retention purge removes a frozen roll' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF NOT EXISTS (
            SELECT 1 FROM shareholders_publication made
            WHERE made.uuid = NEW.publication_id AND made.company_id = NEW.company_id
        )
        OR (NEW.user_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM authentication_customuser reader WHERE reader.id = NEW.user_id
        ))
    THEN
        RAISE EXCEPTION 'A roll row belongs to its publication''s company and names a real account' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER shareholders_publication_roll_is_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON shareholders_publicationrecipient
    FOR EACH ROW EXECUTE FUNCTION shareholders_guard_publication_recipient();
"""

DROP_GUARDS = """
DROP TRIGGER shareholders_publication_roll_is_frozen ON shareholders_publicationrecipient;
DROP FUNCTION shareholders_guard_publication_recipient();
DROP TRIGGER shareholders_publication_is_frozen ON shareholders_publication;
DROP FUNCTION shareholders_guard_publication();
"""

RETAINED = "Retain publications and the roll each was addressed to; downgrade would discard them."


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    if schema_editor.connection.vendor != "postgresql":
        return
    install_tables(schema_editor, ["shareholders_publication", "shareholders_publicationrecipient"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(GUARDS, {"app": settings.RLS_ROLES["app"]})
    grant_reachable_tables(schema_editor)


def remove_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE shareholders_publication IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM shareholders_publication)")
        if cursor.fetchone()[0]:
            raise RuntimeError(RETAINED)
        cursor.execute(DROP_GUARDS)


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("companies", "0009_document_verification"),
        ("shared", "0012_operator_creates_matches"),
        ("tokens", "0079_order_submission_eligibility_refusal"),
        ("whitelist", "0008_classification_refresh_authority"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PublicationRead",
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
                ("actor_id", models.PositiveBigIntegerField()),
                ("publication_uuid", models.UUIDField(db_index=True)),
                ("recipient_uuid", models.UUIDField(blank=True, null=True)),
                (
                    "kind",
                    models.CharField(
                        choices=[("member", "Member"), ("company", "Company"), ("staff", "Staff")], max_length=16
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Publication",
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
                    "kind",
                    models.CharField(
                        choices=[
                            ("holding_statement", "Annual holding statement"),
                            ("meeting_notice", "Meeting notice"),
                        ],
                        editable=False,
                        max_length=32,
                    ),
                ),
                ("title", models.CharField(editable=False, max_length=255)),
                ("record_date", models.DateField(editable=False)),
                ("instruction", models.CharField(editable=False, max_length=255)),
                ("authority_document", models.UUIDField(editable=False)),
                ("authority_fingerprint", models.CharField(editable=False, max_length=64)),
                (
                    "file",
                    models.FileField(
                        editable=False,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=shareholders.models.publication.publication_file_path,
                    ),
                ),
                ("mime_type", models.CharField(blank=True, editable=False, max_length=100)),
                ("digest", models.CharField(blank=True, editable=False, max_length=64)),
                ("register_sequence", models.PositiveBigIntegerField(editable=False)),
                ("register_head_hash", models.CharField(editable=False, max_length=64)),
                ("member_rows", models.PositiveIntegerField(editable=False)),
                ("audience_digest", models.CharField(editable=False, max_length=64)),
                ("prepared_by_id", models.PositiveBigIntegerField(editable=False)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="publications", to="companies.company"
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="publications", to="tokens.sharetoken"
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="PublicationRecipient",
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
                ("member_id", models.UUIDField(editable=False)),
                ("user_id", models.PositiveBigIntegerField(editable=False, null=True)),
                ("name", models.CharField(blank=True, editable=False, max_length=255)),
                (
                    "holder_type",
                    models.CharField(
                        choices=[
                            ("member", "Member"),
                            ("treasury", "Treasury"),
                            ("ambiguous", "Ambiguous"),
                            ("unidentified", "Unidentified"),
                        ],
                        editable=False,
                        max_length=16,
                    ),
                ),
                (
                    "identity_source",
                    models.CharField(
                        choices=[
                            ("profile", "Current profile"),
                            ("stamped", "Stamped at the time"),
                            ("recorded", "Name recorded at allotment, identity never resolved"),
                            ("particulars", "Recorded register particulars"),
                            ("treasury_label", "Whitelist entry label, no profile exists"),
                            ("unresolvable", "Not resolvable, two wallets share this address"),
                            ("none", "Not identified"),
                            ("unknown", "Never identified while it held shares"),
                        ],
                        editable=False,
                        max_length=24,
                    ),
                ),
                ("shares", models.DecimalField(decimal_places=0, editable=False, max_digits=78)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="publication_recipients",
                        to="companies.company",
                    ),
                ),
                (
                    "publication",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="recipients",
                        to="shareholders.publication",
                    ),
                ),
            ],
            options={
                "ordering": ["-shares", "member_id"],
            },
        ),
        migrations.AddConstraint(
            model_name="publication",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind__in", ("holding_statement", "meeting_notice")), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        models.Q(("title__regex", "^\\s*$"), _negated=True),
                        models.Q(("mime_type__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="publication_document_carries_its_bytes",
            ),
        ),
        migrations.AddConstraint(
            model_name="publication",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("audience_digest__regex", "^[0-9a-f]{64}$"),
                    ("authority_fingerprint__regex", "^[0-9a-f]{64}$"),
                    ("register_head_hash__regex", "^[0-9a-f]{64}$"),
                    ("register_sequence__gte", 1),
                    models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                ),
                name="publication_records_its_authority_and_snapshot",
            ),
        ),
        migrations.AddIndex(
            model_name="publicationrecipient",
            index=models.Index(fields=["user_id"], name="publication_recipient_user"),
        ),
        migrations.AddConstraint(
            model_name="publicationrecipient",
            constraint=models.UniqueConstraint(fields=("publication", "member_id"), name="publication_member_once"),
        ),
        migrations.AddConstraint(
            model_name="publicationrecipient",
            constraint=models.CheckConstraint(
                condition=models.Q(("shares__gt", 0)), name="publication_recipient_holds_shares"
            ),
        ),
        migrations.AddConstraint(
            model_name="publicationrecipient",
            constraint=models.CheckConstraint(
                condition=models.Q(("holder_type", "member"), ("user_id__isnull", True), _connector="OR"),
                name="publication_recipient_names_a_member",
            ),
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
