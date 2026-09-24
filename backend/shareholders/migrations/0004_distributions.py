import importlib

from django.conf import settings
from django.db import migrations, models

import shared.storage
import shareholders.models.event

DISTRIBUTIONS = r"""
CREATE OR REPLACE FUNCTION shareholders_guard_publication_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    made shareholders_publication;
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
    SELECT * INTO made FROM shareholders_publication
        WHERE uuid = NEW.publication_id AND company_id = NEW.company_id;
    IF NOT FOUND
        OR (NEW.user_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM authentication_customuser reader WHERE reader.id = NEW.user_id
        ))
    THEN
        RAISE EXCEPTION 'A roll row belongs to its publication''s company and names a real account' USING ERRCODE = '23514';
    END IF;
    IF made.kind = 'distribution' THEN
        IF NEW.entitlement IS DISTINCT FROM trunc(NEW.shares * made.rate_per_share, 2) THEN
            RAISE EXCEPTION 'A distribution''s roll row is entitled to its shares times the rate, rounded down to the cent'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.entitlement IS NOT NULL THEN
        RAISE EXCEPTION 'Only a distribution''s roll row carries an entitlement' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION shareholders_distribution_adds_up() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    roll record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM shareholders_publication made WHERE made.uuid = NEW.uuid) THEN
        RETURN NULL;
    END IF;
    SELECT coalesce(sum(held.shares), 0) AS shares, coalesce(sum(held.entitlement), 0) AS entitled INTO roll
        FROM shareholders_publicationrecipient held WHERE held.publication_id = NEW.uuid;
    IF NEW.declared_total <> trunc(roll.shares * NEW.rate_per_share, 2)
        OR roll.entitled + NEW.undistributed <> NEW.declared_total
    THEN
        RAISE EXCEPTION 'A distribution''s declared total is its roll''s shares times its rate, rounded down to the cent, and its entitlements and undistributed remainder add up to it'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER shareholders_distribution_adds_up
    AFTER INSERT ON shareholders_publication DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.kind = 'distribution') EXECUTE FUNCTION shareholders_distribution_adds_up();

CREATE OR REPLACE FUNCTION shareholders_publication_event_hash(event shareholders_publicationevent) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(sha256(convert_to((CASE WHEN event.kind IN ('payment', 'payment_void') THEN jsonb_build_array(
        'ledova-publication-event-v2', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload,
        event.paid_on, event.reference, event.evidence, event.evidence_digest, event.evidence_mime_type,
        event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) ELSE jsonb_build_array(
        'ledova-publication-event-v1', event.uuid, event.publication_id, event.company_id,
        event.sequence, event.kind, event.recipient_id, event.choice, event.shares::text,
        event.actor_id, event.staff_entered, event.authority, event.payload, event.previous_hash,
        to_char(event.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ) END)::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION shareholders_guard_publication_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    published shareholders_publication;
    addressed shareholders_publicationrecipient;
    latest shareholders_publicationevent;
    latest_record text;
    counted record;
    eligible record;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'A publication''s record of events cannot be rewritten' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = %(app)s THEN
            RAISE EXCEPTION 'Only the retention purge removes a publication''s record of events' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    SELECT * INTO published FROM shareholders_publication WHERE uuid = NEW.publication_id FOR UPDATE;
    IF NOT FOUND OR published.company_id <> NEW.company_id
        OR (published.kind = 'resolution') <> (NEW.kind IN ('ballot', 'close'))
        OR (published.kind = 'distribution') <> (NEW.kind IN ('payment', 'payment_void'))
    THEN
        RAISE EXCEPTION 'Only a resolution records ballots and a close, and only a distribution records payments, each under its own company'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.kind = 'ballot' THEN
        IF EXISTS (
            SELECT 1 FROM shareholders_publicationevent closed
            WHERE closed.publication_id = published.uuid AND closed.kind = 'close'
        ) THEN
            RAISE EXCEPTION 'This resolution has closed and takes no more ballots' USING ERRCODE = '23514';
        END IF;
        IF now() < published.opens_at OR now() >= published.closes_at THEN
            RAISE EXCEPTION 'A ballot is cast only while the resolution is open' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO addressed FROM shareholders_publicationrecipient
            WHERE uuid = NEW.recipient_id AND publication_id = published.uuid;
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
            WHERE closed.publication_id = published.uuid AND closed.kind = 'close'
        ) THEN
            RAISE EXCEPTION 'A resolution closes once' USING ERRCODE = '23514';
        END IF;
        IF now() < published.closes_at THEN
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
            WHERE ballot.publication_id = published.uuid AND ballot.kind = 'ballot';
        SELECT coalesce(sum(held.shares), 0) AS shares, count(*) AS members INTO eligible
            FROM shareholders_publicationrecipient held WHERE held.publication_id = published.uuid;
        NEW.shares := NULL;
        NEW.payload := jsonb_build_object(
            'basis', published.vote_basis,
            'resolution_kind', published.resolution_kind,
            'for', jsonb_build_object('shares', counted.for_shares::text, 'members', counted.for_members),
            'against', jsonb_build_object('shares', counted.against_shares::text, 'members', counted.against_members),
            'abstain', jsonb_build_object('shares', counted.abstain_shares::text, 'members', counted.abstain_members),
            'eligible', jsonb_build_object('shares', eligible.shares::text, 'members', eligible.members),
            'carried', CASE published.resolution_kind
                WHEN 'ordinary' THEN counted.for_shares > counted.against_shares
                WHEN 'special' THEN counted.for_shares + counted.against_shares > 0
                    AND counted.for_shares * 4 >= (counted.for_shares + counted.against_shares) * 3
            END
        );
    ELSIF NEW.kind IN ('payment', 'payment_void') THEN
        IF NOT EXISTS (
            SELECT 1 FROM authentication_customuser staff
            WHERE staff.id = NEW.actor_id AND staff.is_active AND staff.is_staff
        ) THEN
            RAISE EXCEPTION 'A payment record names an active staff member' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO addressed FROM shareholders_publicationrecipient
            WHERE uuid = NEW.recipient_id AND publication_id = published.uuid;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'A payment is recorded for a member on this distribution''s roll' USING ERRCODE = '23514';
        END IF;
        SELECT recorded.kind INTO latest_record FROM shareholders_publicationevent recorded
            WHERE recorded.publication_id = published.uuid AND recorded.recipient_id = addressed.uuid
            ORDER BY recorded.sequence DESC LIMIT 1;
        IF NEW.kind = 'payment' THEN
            IF coalesce(addressed.entitlement, 0) <= 0 THEN
                RAISE EXCEPTION 'A payment is recorded only for a member entitled to at least a cent'
                    USING ERRCODE = '23514';
            END IF;
            IF latest_record = 'payment' THEN
                RAISE EXCEPTION 'This member already has a payment recorded, and it must be withdrawn before another'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.evidence !~ ('^companies/' || NEW.company_id || '/publications/' || NEW.publication_id
                || '/payments/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$') THEN
                RAISE EXCEPTION 'A payment''s evidence is stored under its own record' USING ERRCODE = '23514';
            END IF;
        ELSIF latest_record IS DISTINCT FROM 'payment' THEN
            RAISE EXCEPTION 'Only a recorded payment can be withdrawn' USING ERRCODE = '23514';
        END IF;
        NEW.shares := NULL;
        NEW.payload := NULL;
    ELSE
        RAISE EXCEPTION 'A publication records ballots, a close and payment records' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO latest FROM shareholders_publicationevent chained
        WHERE chained.publication_id = published.uuid ORDER BY chained.sequence DESC LIMIT 1;
    NEW.sequence := coalesce(latest.sequence, 0) + 1;
    NEW.previous_hash := coalesce(latest.entry_hash, repeat('0', 64));
    NEW.entry_hash := shareholders_publication_event_hash(NEW);
    RETURN NEW;
END;
$$;
"""

DROP_DISTRIBUTIONS = """
DROP TRIGGER shareholders_distribution_adds_up ON shareholders_publication;
DROP FUNCTION shareholders_distribution_adds_up();
DROP TRIGGER shareholders_publication_event_chain ON shareholders_publicationevent;
DROP FUNCTION shareholders_guard_publication_event();
DROP FUNCTION shareholders_publication_event_hash(shareholders_publicationevent);
DROP TRIGGER shareholders_publication_roll_is_frozen ON shareholders_publicationrecipient;
DROP FUNCTION shareholders_guard_publication_recipient();
DROP TRIGGER shareholders_publication_is_frozen ON shareholders_publication;
DROP FUNCTION shareholders_guard_publication();
"""

RETAINED = "Retain distributions and their payment records; downgrade would discard them."


def previous(name):
    return importlib.import_module(f"shareholders.migrations.{name}")


def install_distributions(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(DISTRIBUTIONS, {"app": settings.RLS_ROLES["app"]})
    install_tables(schema_editor, ["shareholders_publicationevent"])


def remove_distributions(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE shareholders_publication, shareholders_publicationrecipient, shareholders_publicationevent "
            "IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute("SELECT EXISTS (SELECT 1 FROM shareholders_publication WHERE kind = 'distribution')")
        if cursor.fetchone()[0]:
            raise RuntimeError(RETAINED)
        cursor.execute(DROP_DISTRIBUTIONS)
        cursor.execute(previous("0001_publications").GUARDS, {"app": settings.RLS_ROLES["app"]})
        cursor.execute(previous("0003_resolutions").CHAIN, {"app": settings.RLS_ROLES["app"]})


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
        ("shareholders", "0003_resolutions"),
        ("tokens", "0079_order_submission_eligibility_refusal"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="publication",
            name="publication_document_carries_its_bytes",
        ),
        migrations.RemoveConstraint(
            model_name="publicationevent",
            name="publication_event_has_the_shape_of_its_kind",
        ),
        migrations.AddField(
            model_name="publication",
            name="currency",
            field=models.CharField(
                blank=True,
                choices=[
                    ("AUD", "Australian Dollar"),
                    ("USD", "US Dollar"),
                    ("EUR", "Euro"),
                    ("GBP", "British Pound"),
                    ("CAD", "Canadian Dollar"),
                    ("JPY", "Japanese Yen"),
                    ("NZD", "New Zealand Dollar"),
                    ("SGD", "Singapore Dollar"),
                ],
                editable=False,
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="publication",
            name="declared_on",
            field=models.DateField(blank=True, editable=False, null=True, verbose_name="dividend declared on"),
        ),
        migrations.AddField(
            model_name="publication",
            name="declared_total",
            field=models.DecimalField(blank=True, decimal_places=2, editable=False, max_digits=18, null=True),
        ),
        migrations.AddField(
            model_name="publication",
            name="payment_date",
            field=models.DateField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="publication",
            name="rate_per_share",
            field=models.DecimalField(blank=True, decimal_places=6, editable=False, max_digits=18, null=True),
        ),
        migrations.AddField(
            model_name="publication",
            name="undistributed",
            field=models.DecimalField(blank=True, decimal_places=2, editable=False, max_digits=18, null=True),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="evidence",
            field=models.FileField(
                blank=True,
                max_length=255,
                storage=shared.storage.private_storage,
                upload_to=shareholders.models.event.payment_evidence_path,
            ),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="evidence_digest",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="evidence_mime_type",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="publicationread",
            name="event_uuid",
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="paid_on",
            field=models.DateField(blank=True, null=True, verbose_name="recorded as paid on"),
        ),
        migrations.AddField(
            model_name="publicationevent",
            name="reference",
            field=models.CharField(blank=True, max_length=64, verbose_name="the company's payment reference"),
        ),
        migrations.AddField(
            model_name="publicationrecipient",
            name="entitlement",
            field=models.DecimalField(decimal_places=2, editable=False, max_digits=18, null=True),
        ),
        migrations.AlterField(
            model_name="publication",
            name="kind",
            field=models.CharField(
                choices=[
                    ("holding_statement", "Annual holding statement"),
                    ("meeting_notice", "Meeting notice"),
                    ("resolution", "Resolution"),
                    ("distribution", "Dividend"),
                ],
                editable=False,
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="publicationevent",
            name="kind",
            field=models.CharField(
                choices=[
                    ("ballot", "Ballot"),
                    ("close", "Close"),
                    ("payment", "Payment recorded"),
                    ("payment_void", "Payment record withdrawn"),
                ],
                max_length=16,
            ),
        ),
        migrations.AddConstraint(
            model_name="publication",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("kind__in", ("holding_statement", "meeting_notice", "resolution", "distribution")),
                        _negated=True,
                    ),
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
                        ("currency__in", ("AUD",)),
                        ("declared_on__isnull", False),
                        ("declared_total__gt", 0),
                        ("declared_total__isnull", False),
                        ("kind", "distribution"),
                        ("payment_date__gte", models.F("record_date")),
                        ("payment_date__isnull", False),
                        ("rate_per_share__gt", 0),
                        ("rate_per_share__isnull", False),
                        ("undistributed__gte", 0),
                        ("undistributed__isnull", False),
                    ),
                    models.Q(
                        models.Q(("kind", "distribution"), _negated=True),
                        ("currency", ""),
                        ("declared_on__isnull", True),
                        ("declared_total__isnull", True),
                        ("payment_date__isnull", True),
                        ("rate_per_share__isnull", True),
                        ("undistributed__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="publication_distribution_states_its_rate_dates_and_total",
            ),
        ),
        migrations.AddConstraint(
            model_name="publicationevent",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("actor_id__isnull", False),
                        ("choice__in", ["for", "against", "abstain"]),
                        ("evidence", ""),
                        ("evidence_digest", ""),
                        ("evidence_mime_type", ""),
                        ("kind", "ballot"),
                        ("paid_on__isnull", True),
                        ("payload__isnull", True),
                        ("recipient__isnull", False),
                        ("reference", ""),
                        ("shares__isnull", False),
                    ),
                    models.Q(
                        ("actor_id__isnull", True),
                        ("choice", ""),
                        ("evidence", ""),
                        ("evidence_digest", ""),
                        ("evidence_mime_type", ""),
                        ("kind", "close"),
                        ("paid_on__isnull", True),
                        ("payload__isnull", False),
                        ("recipient__isnull", True),
                        ("reference", ""),
                        ("shares__isnull", True),
                        ("staff_entered", False),
                    ),
                    models.Q(
                        models.Q(("reference__regex", "^\\s*$"), _negated=True),
                        models.Q(("evidence", ""), _negated=True),
                        models.Q(("evidence_mime_type__regex", "^\\s*$"), _negated=True),
                        ("actor_id__isnull", False),
                        ("choice", ""),
                        ("evidence_digest__regex", "^[0-9a-f]{64}$"),
                        ("kind", "payment"),
                        ("paid_on__isnull", False),
                        ("payload__isnull", True),
                        ("recipient__isnull", False),
                        ("shares__isnull", True),
                        ("staff_entered", True),
                    ),
                    models.Q(
                        ("actor_id__isnull", False),
                        ("choice", ""),
                        ("evidence", ""),
                        ("evidence_digest", ""),
                        ("evidence_mime_type", ""),
                        ("kind", "payment_void"),
                        ("paid_on__isnull", True),
                        ("payload__isnull", True),
                        ("recipient__isnull", False),
                        ("reference", ""),
                        ("shares__isnull", True),
                        ("staff_entered", True),
                    ),
                    _connector="OR",
                ),
                name="publication_event_has_the_shape_of_its_kind",
            ),
        ),
        migrations.RunPython(install_distributions, remove_distributions),
    ]
