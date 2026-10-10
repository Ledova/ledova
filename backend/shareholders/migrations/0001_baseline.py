import uuid

import django.db.models.deletion
from django.db import migrations, models

import shared.storage
import shareholders.models.event
import shareholders.models.publication


class Migration(migrations.Migration):

    replaces = [
        ("shareholders", "0001_publications"),
        ("shareholders", "0002_publication_names_its_company_and_class"),
        ("shareholders", "0003_resolutions"),
        ("shareholders", "0004_distributions"),
        ("shareholders", "0005_publication_event_preimage"),
        ("shareholders", "0006_publication_to_a_paused_class"),
    ]

    initial = True

    dependencies = [
        ("companies", "0001_baseline"),
        ("companies", "0002_baseline"),
        ("tokens", "0001_baseline"),
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
                ("event_uuid", models.UUIDField(blank=True, null=True)),
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
                ("company_name", models.CharField(editable=False, max_length=255)),
                ("token_name", models.CharField(editable=False, max_length=100)),
                ("token_symbol", models.CharField(editable=False, max_length=10)),
                (
                    "kind",
                    models.CharField(
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
                ("question", models.TextField(blank=True, editable=False)),
                (
                    "resolution_kind",
                    models.CharField(
                        blank=True,
                        choices=[("ordinary", "Ordinary resolution"), ("special", "Special resolution")],
                        editable=False,
                        max_length=16,
                    ),
                ),
                (
                    "vote_basis",
                    models.CharField(
                        blank=True, choices=[("per_share", "One vote per share")], editable=False, max_length=16
                    ),
                ),
                ("opens_at", models.DateTimeField(blank=True, editable=False, null=True, verbose_name="voting opens")),
                (
                    "closes_at",
                    models.DateTimeField(blank=True, editable=False, null=True, verbose_name="voting closes"),
                ),
                (
                    "rate_per_share",
                    models.DecimalField(blank=True, decimal_places=6, editable=False, max_digits=18, null=True),
                ),
                (
                    "currency",
                    models.CharField(
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
                (
                    "declared_on",
                    models.DateField(blank=True, editable=False, null=True, verbose_name="dividend declared on"),
                ),
                ("payment_date", models.DateField(blank=True, editable=False, null=True)),
                (
                    "declared_total",
                    models.DecimalField(blank=True, decimal_places=2, editable=False, max_digits=18, null=True),
                ),
                (
                    "undistributed",
                    models.DecimalField(blank=True, decimal_places=2, editable=False, max_digits=18, null=True),
                ),
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
                ("entitlement", models.DecimalField(decimal_places=2, editable=False, max_digits=18, null=True)),
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
                (
                    "kind",
                    models.CharField(
                        choices=[
                            ("ballot", "Ballot"),
                            ("close", "Close"),
                            ("payment", "Payment recorded"),
                            ("payment_void", "Payment record withdrawn"),
                        ],
                        max_length=16,
                    ),
                ),
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
                ("paid_on", models.DateField(blank=True, null=True, verbose_name="recorded as paid on")),
                (
                    "reference",
                    models.CharField(blank=True, max_length=64, verbose_name="the company's payment reference"),
                ),
                (
                    "evidence",
                    models.FileField(
                        blank=True,
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=shareholders.models.event.payment_evidence_path,
                    ),
                ),
                ("evidence_digest", models.CharField(blank=True, max_length=64)),
                ("evidence_mime_type", models.CharField(blank=True, max_length=100)),
                ("previous_hash", models.CharField(blank=True, editable=False, max_length=64)),
                ("entry_hash", models.CharField(blank=True, editable=False, max_length=64)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="publication_events",
                        to="companies.company",
                    ),
                ),
                (
                    "publication",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="events",
                        to="shareholders.publication",
                    ),
                ),
                (
                    "recipient",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="ballots",
                        to="shareholders.publicationrecipient",
                    ),
                ),
            ],
            options={
                "ordering": ["sequence"],
            },
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
