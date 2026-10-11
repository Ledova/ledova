import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("companies", "0002_initial"),
        ("shareholders", "0001_initial"),
        ("tokens", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="publication",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="publications", to="tokens.sharetoken"
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
            model_name="publicationrecipient",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="publication_recipients",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="publicationrecipient",
            name="publication",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="recipients", to="shareholders.publication"
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
                    ("audience_digest__regex", "^[0-9a-f]{64}$"),
                    ("authority_fingerprint__regex", "^[0-9a-f]{64}$"),
                    ("register_head_hash__regex", "^[0-9a-f]{64}$"),
                    ("register_sequence__gte", 1),
                    models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                ),
                name="publication_records_its_authority_and_snapshot",
            ),
        ),
        migrations.AddConstraint(
            model_name="publication",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("company_name__regex", "^\\s*$"), _negated=True),
                    models.Q(("token_name__regex", "^\\s*$"), _negated=True),
                    models.Q(("token_symbol__regex", "^\\s*$"), _negated=True),
                ),
                name="publication_names_the_company_and_the_class",
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
    ]
