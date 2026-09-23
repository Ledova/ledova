import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

CHAIN = r"""
CREATE FUNCTION shareholders_publication_event_hash(event shareholders_publicationevent) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to(jsonb_build_array(
        'ledova-publication-event-v1', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload, event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION shareholders_guard_publication_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    resolution shareholders_publication;
    addressed shareholders_publicationrecipient;
    latest shareholders_publicationevent;
    counted record;
    eligible record;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A resolution''s record cannot be rewritten' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = %(app)s THEN
            RAISE EXCEPTION 'Only the retention purge removes a resolution''s record' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO resolution FROM shareholders_publication WHERE uuid = NEW.publication_id FOR UPDATE;
    IF NOT FOUND OR resolution.kind <> 'resolution' OR resolution.company_id <> NEW.company_id THEN
        RAISE EXCEPTION 'Only a resolution records ballots and a close, under its own company'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.kind = 'ballot' THEN
        IF EXISTS (
            SELECT 1 FROM shareholders_publicationevent closed
            WHERE closed.publication_id = resolution.uuid AND closed.kind = 'close'
        ) THEN
            RAISE EXCEPTION 'This resolution has closed and takes no more ballots' USING ERRCODE = '23514';
        END IF;
        IF now() < resolution.opens_at OR now() >= resolution.closes_at THEN
            RAISE EXCEPTION 'A ballot is cast only while the resolution is open' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO addressed FROM shareholders_publicationrecipient
            WHERE uuid = NEW.recipient_id AND publication_id = resolution.uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'A ballot is cast for a member on this resolution''s roll' USING ERRCODE = '23514';
        END IF;
        IF NEW.staff_entered THEN
            IF NEW.authority ~ '^\s*$' OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser staff
                WHERE staff.id = NEW.actor_id AND staff.is_active AND staff.is_staff
            ) THEN
                RAISE EXCEPTION 'A staff-entered ballot names its authority and an active staff member'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF addressed.user_id IS NULL OR NEW.actor_id IS DISTINCT FROM addressed.user_id THEN
            RAISE EXCEPTION 'A member casts only their own ballot' USING ERRCODE = '23514';
        END IF;
        NEW.shares := addressed.shares;
        NEW.payload := NULL;
    ELSIF NEW.kind = 'close' THEN
        IF EXISTS (
            SELECT 1 FROM shareholders_publicationevent closed
            WHERE closed.publication_id = resolution.uuid AND closed.kind = 'close'
        ) THEN
            RAISE EXCEPTION 'A resolution closes once' USING ERRCODE = '23514';
        END IF;
        IF now() < resolution.closes_at THEN
            RAISE EXCEPTION 'A resolution closes only once its window has passed' USING ERRCODE = '23514';
        END IF;
        SELECT
            coalesce(sum(ballot.shares) FILTER (WHERE ballot.choice = 'for'), 0) AS for_shares,
            count(*) FILTER (WHERE ballot.choice = 'for') AS for_members,
            coalesce(sum(ballot.shares) FILTER (WHERE ballot.choice = 'against'), 0) AS against_shares,
            count(*) FILTER (WHERE ballot.choice = 'against') AS against_members,
            coalesce(sum(ballot.shares) FILTER (WHERE ballot.choice = 'abstain'), 0) AS abstain_shares,
            count(*) FILTER (WHERE ballot.choice = 'abstain') AS abstain_members
            INTO counted
            FROM shareholders_publicationevent ballot
            WHERE ballot.publication_id = resolution.uuid AND ballot.kind = 'ballot';
        SELECT coalesce(sum(held.shares), 0) AS shares, count(*) AS members INTO eligible
            FROM shareholders_publicationrecipient held WHERE held.publication_id = resolution.uuid;
        NEW.shares := NULL;
        NEW.payload := jsonb_build_object(
            'basis', resolution.vote_basis,
            'resolution_kind', resolution.resolution_kind,
            'for', jsonb_build_object('shares', counted.for_shares::text, 'members', counted.for_members),
            'against', jsonb_build_object('shares', counted.against_shares::text, 'members', counted.against_members),
            'abstain', jsonb_build_object('shares', counted.abstain_shares::text, 'members', counted.abstain_members),
            'eligible', jsonb_build_object('shares', eligible.shares::text, 'members', eligible.members),
            'carried', CASE resolution.resolution_kind
                WHEN 'ordinary' THEN counted.for_shares > counted.against_shares
                WHEN 'special' THEN counted.for_shares + counted.against_shares > 0
                    AND counted.for_shares * 4 >= (counted.for_shares + counted.against_shares) * 3
            END
        );
    ELSE
        RAISE EXCEPTION 'A resolution records ballots and a close' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO latest FROM shareholders_publicationevent chained
        WHERE chained.publication_id = resolution.uuid ORDER BY chained.sequence DESC LIMIT 1;
    NEW.sequence := coalesce(latest.sequence, 0) + 1;
    NEW.previous_hash := coalesce(latest.entry_hash, repeat('0', 64));
    NEW.entry_hash := shareholders_publication_event_hash(NEW);
    RETURN NEW;
END;
$$;
CREATE TRIGGER shareholders_publication_event_chain
    BEFORE INSERT OR UPDATE OR DELETE ON shareholders_publicationevent
    FOR EACH ROW EXECUTE FUNCTION shareholders_guard_publication_event();
"""

DROP_CHAIN = """
DROP TRIGGER shareholders_publication_event_chain ON shareholders_publicationevent;
DROP FUNCTION shareholders_guard_publication_event();
DROP FUNCTION shareholders_publication_event_hash(shareholders_publicationevent);
"""

RETAINED = "Retain resolutions and their ballots; downgrade would discard them."


def install_chain(apps, schema_editor):
    from shared.db.policy_sql import grant_reachable_tables, install_tables

    if schema_editor.connection.vendor != "postgresql":
        return
    install_tables(schema_editor, ["shareholders_publicationevent"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(CHAIN, {"app": settings.RLS_ROLES["app"]})
    grant_reachable_tables(schema_editor)


def remove_chain(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE shareholders_publication, shareholders_publicationevent IN ACCESS EXCLUSIVE MODE")
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM shareholders_publicationevent) "
            "OR EXISTS (SELECT 1 FROM shareholders_publication WHERE kind = 'resolution')"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError(RETAINED)
        cursor.execute(DROP_CHAIN)


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("shareholders", "0002_publication_names_its_company_and_class"),
        ("tokens", "0079_order_submission_eligibility_refusal"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="PublicationEvent",
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
                ("kind", models.CharField(choices=[("ballot", "Ballot"), ("close", "Close")], max_length=16)),
                (
                    "choice",
                    models.CharField(
                        blank=True,
                        choices=[("for", "For"), ("against", "Against"), ("abstain", "Abstain")],
                        max_length=8,
                    ),
                ),
                ("shares", models.DecimalField(decimal_places=0, editable=False, max_digits=78, null=True)),
                ("actor_id", models.PositiveBigIntegerField(blank=True, null=True)),
                ("staff_entered", models.BooleanField(default=False)),
                ("authority", models.CharField(blank=True, max_length=255)),
                ("payload", models.JSONField(editable=False, null=True)),
                ("previous_hash", models.CharField(blank=True, editable=False, max_length=64)),
                ("entry_hash", models.CharField(blank=True, editable=False, max_length=64)),
            ],
            options={
                "ordering": ["sequence"],
            },
        ),
        migrations.RemoveConstraint(
            model_name="publication",
            name="publication_document_carries_its_bytes",
        ),
        migrations.AddField(
            model_name="publication",
            name="closes_at",
            field=models.DateTimeField(blank=True, editable=False, null=True, verbose_name="voting closes"),
        ),
        migrations.AddField(
            model_name="publication",
            name="opens_at",
            field=models.DateTimeField(blank=True, editable=False, null=True, verbose_name="voting opens"),
        ),
        migrations.AddField(
            model_name="publication",
            name="question",
            field=models.TextField(blank=True, editable=False),
        ),
        migrations.AddField(
            model_name="publication",
            name="resolution_kind",
            field=models.CharField(
                blank=True,
                choices=[("ordinary", "Ordinary resolution"), ("special", "Special resolution")],
                editable=False,
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="publication",
            name="vote_basis",
            field=models.CharField(
                blank=True, choices=[("per_share", "One vote per share")], editable=False, max_length=16
            ),
        ),
        migrations.AlterField(
            model_name="publication",
            name="kind",
            field=models.CharField(
                choices=[
                    ("holding_statement", "Annual holding statement"),
                    ("meeting_notice", "Meeting notice"),
                    ("resolution", "Resolution"),
                ],
                editable=False,
                max_length=32,
            ),
        ),
        migrations.AddConstraint(
            model_name="publication",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind__in", ("holding_statement", "meeting_notice", "resolution")), _negated=True),
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
                    models.Q(
                        ("closes_at__gt", models.F("opens_at")),
                        ("closes_at__isnull", False),
                        ("kind", "resolution"),
                        ("opens_at__isnull", False),
                        ("resolution_kind__in", ["ordinary", "special"]),
                        ("vote_basis__in", ["per_share"]),
                        models.Q(("question__regex", "^\\s*$"), _negated=True),
                    ),
                    models.Q(
                        models.Q(("kind", "resolution"), _negated=True),
                        ("closes_at__isnull", True),
                        ("opens_at__isnull", True),
                        ("question", ""),
                        ("resolution_kind", ""),
                        ("vote_basis", ""),
                    ),
                    _connector="OR",
                ),
                name="publication_resolution_states_its_question_and_window",
            ),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="publication_events", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="publication",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="events", to="shareholders.publication"
            ),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="recipient",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="ballots",
                to="shareholders.publicationrecipient",
            ),
        ),
        migrations.AddConstraint(
            model_name="publicationevent",
            constraint=models.UniqueConstraint(fields=("publication", "sequence"), name="publication_event_sequence"),
        ),
        migrations.AddConstraint(
            model_name="publicationevent",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind", "ballot")),
                fields=("publication", "recipient"),
                name="publication_ballot_once",
            ),
        ),
        migrations.AddConstraint(
            model_name="publicationevent",
            constraint=models.UniqueConstraint(
                condition=models.Q(("kind", "close")), fields=("publication",), name="publication_closes_once"
            ),
        ),
        migrations.AddConstraint(
            model_name="publicationevent",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("actor_id__isnull", False),
                        ("choice__in", ["for", "against", "abstain"]),
                        ("kind", "ballot"),
                        ("payload__isnull", True),
                        ("recipient__isnull", False),
                        ("shares__isnull", False),
                    ),
                    models.Q(
                        ("actor_id__isnull", True),
                        ("choice", ""),
                        ("kind", "close"),
                        ("payload__isnull", False),
                        ("recipient__isnull", True),
                        ("shares__isnull", True),
                        ("staff_entered", False),
                    ),
                    _connector="OR",
                ),
                name="publication_event_has_the_shape_of_its_kind",
            ),
        ),
        migrations.AddConstraint(
            model_name="publicationevent",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("staff_entered", True), models.Q(("authority__regex", "^\\s*$"), _negated=True)),
                    models.Q(("authority", ""), ("staff_entered", False)),
                    _connector="OR",
                ),
                name="publication_event_staff_entry_names_its_authority",
            ),
        ),
        migrations.RunPython(install_chain, remove_chain),
    ]
