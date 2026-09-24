from django.db import migrations

PREIMAGE = r"""
CREATE FUNCTION shareholders_publication_event_preimage(event shareholders_publicationevent) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT (CASE WHEN event.kind IN ('payment', 'payment_void') THEN jsonb_build_array(
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
    ) END)::text;
$$;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("shareholders", "0004_distributions"),
    ]

    operations = [
        migrations.RunSQL(
            PREIMAGE,
            "DROP FUNCTION shareholders_publication_event_preimage(shareholders_publicationevent)",
        ),
    ]
