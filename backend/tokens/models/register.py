from django.conf import settings
from django.db import models

from shared.models import BaseModel


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
