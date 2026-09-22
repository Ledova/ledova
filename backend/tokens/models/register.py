from django.conf import settings
from django.db import models

from shared.models import BaseModel

from .share_token import ShareToken


class RegisterEntryKind(models.TextChoices):
    OPENING = "opening", "Opening state"
    ISSUE = "issue", "Issue"
    TRANSFER = "transfer", "Transfer"
    CESSATION = "cessation", "Cessation"
    CORRECTION = "correction", "Compensating correction"


class RegisterMember(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="register_members")


class ShareRegister(BaseModel):
    token = models.OneToOneField("tokens.ShareToken", on_delete=models.PROTECT, related_name="stored_register")
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="registers")
    sequence = models.PositiveBigIntegerField(default=0, editable=False)
    head_hash = models.CharField(max_length=64, default="0" * 64, editable=False)
    issued_supply = models.DecimalField(max_digits=78, decimal_places=0, default=0, editable=False)


class RegisterEntry(BaseModel):
    register = models.ForeignKey(ShareRegister, on_delete=models.PROTECT, related_name="entries")
    operation_id = models.UUIDField()
    sequence = models.PositiveBigIntegerField(default=0, editable=False)
    kind = models.CharField(max_length=16, choices=RegisterEntryKind.choices)
    effective_on = models.DateField()
    changes = models.JSONField()
    corrects = models.OneToOneField("self", on_delete=models.PROTECT, null=True, related_name="correction")
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    previous_hash = models.CharField(max_length=64, blank=True, editable=False)
    entry_hash = models.CharField(max_length=64, blank=True, editable=False)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["register", "sequence"], name="register_entry_sequence"),
            models.UniqueConstraint(fields=["register", "operation_id"], name="register_entry_operation"),
        ]


class RegisterPosition(BaseModel):
    register = models.ForeignKey(ShareRegister, on_delete=models.PROTECT, related_name="positions")
    member = models.ForeignKey(RegisterMember, on_delete=models.PROTECT, related_name="positions")
    shares = models.DecimalField(max_digits=78, decimal_places=0, editable=False)
    entered_on = models.DateField(editable=False)
    last_entry = models.ForeignKey(RegisterEntry, on_delete=models.PROTECT, related_name="+")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["register", "member"], name="register_member_position"),
            models.CheckConstraint(condition=models.Q(shares__gte=0), name="register_position_nonnegative"),
        ]


class RegisterReconciliationStatus(models.TextChoices):
    MATCHED = "matched", "Matched"
    DISCREPANT = "discrepant", "Discrepant"
    FAILED = "failed", "Failed"


class RegisterReconciliation(BaseModel):
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="register_reconciliations")
    status = models.CharField(max_length=12, choices=RegisterReconciliationStatus.choices, editable=False)
    block_number = models.PositiveBigIntegerField(null=True, editable=False)
    block_hash = models.CharField(max_length=66, blank=True, editable=False)
    register_sequence = models.PositiveBigIntegerField(null=True, editable=False)
    discrepancies = models.JSONField(default=list, editable=False)
    failure = models.CharField(max_length=500, blank=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]


class RegisterAcknowledgement(BaseModel):
    token_id = models.UUIDField(editable=False)
    reconciliation = models.ForeignKey(
        RegisterReconciliation, on_delete=models.PROTECT, related_name="acknowledgements", editable=False
    )
    discrepancy = models.JSONField(editable=False)
    reason = models.CharField(max_length=1000, editable=False)
    acknowledged_by_id = models.PositiveBigIntegerField(editable=False)

    class Meta:
        ordering = ["created_at", "uuid"]
        constraints = [
            models.UniqueConstraint(fields=["reconciliation", "discrepancy"], name="register_acknowledged_once"),
        ]


class RegisterExportKind(models.TextChoices):
    REGISTER_CSV = "register_csv", "Register CSV"
    INSPECTION_COPY = "inspection_copy", "Inspection copy"
    CERTIFICATE = "certificate", "Certificate"
    NOTICE_FIGURES = "notice_figures", "Notice figures"


class RegisterExport(BaseModel):
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.DO_NOTHING, related_name="register_exports")
    requested_by_id = models.PositiveBigIntegerField(editable=False)
    kind = models.CharField(max_length=24, choices=RegisterExportKind.choices, editable=False)
    register_sequence = models.PositiveBigIntegerField(editable=False)
    member_rows = models.PositiveIntegerField(editable=False)
    former_rows = models.PositiveIntegerField(editable=False)
    digest = models.CharField(max_length=64, blank=True, editable=False)
    instruction = models.CharField(max_length=255, blank=True, editable=False)
    requested_on = models.DateField(null=True, editable=False)
    recipient = models.CharField(max_length=255, blank=True, editable=False)
    late = models.BooleanField(null=True, editable=False)
    period_from = models.DateField(null=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(kind=RegisterExportKind.INSPECTION_COPY)
                | (
                    models.Q(digest__regex="^[0-9a-f]{64}$", requested_on__isnull=False, late__isnull=False)
                    & ~models.Q(instruction__regex=r"^\s*$")
                    & ~models.Q(recipient__regex=r"^\s*$")
                ),
                name="register_export_inspection_copy_request",
            ),
            models.CheckConstraint(
                condition=~models.Q(kind=RegisterExportKind.REGISTER_CSV)
                | models.Q(digest="", instruction="", recipient="", requested_on__isnull=True, late__isnull=True),
                name="register_export_csv_carries_no_request",
            ),
            models.CheckConstraint(
                condition=~models.Q(kind=RegisterExportKind.CERTIFICATE)
                | (
                    models.Q(
                        digest__regex="^[0-9a-f]{64}$",
                        member_rows__gte=1,
                        member_rows__lte=2,
                        former_rows=0,
                        recipient="",
                        requested_on__isnull=True,
                        late__isnull=True,
                    )
                    & ~models.Q(instruction__regex=r"^\s*$")
                ),
                name="register_export_certificate_shape",
            ),
            models.CheckConstraint(
                condition=~models.Q(kind=RegisterExportKind.NOTICE_FIGURES)
                | (
                    models.Q(
                        digest__regex="^[0-9a-f]{64}$",
                        period_from__isnull=False,
                        former_rows=0,
                        recipient="",
                        requested_on__isnull=True,
                        late__isnull=True,
                    )
                    & ~models.Q(instruction__regex=r"^\s*$")
                ),
                name="register_export_notice_figures_shape",
            ),
            models.CheckConstraint(
                condition=models.Q(kind=RegisterExportKind.NOTICE_FIGURES) | models.Q(period_from__isnull=True),
                name="register_export_period_only_for_notice_figures",
            ),
        ]


class RegisterOutput(ShareToken):
    class Meta:
        proxy = True
        verbose_name = "register outputs"
        verbose_name_plural = "register outputs"
