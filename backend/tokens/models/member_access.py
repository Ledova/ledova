from django.conf import settings
from django.db import models

from shared.models import BaseModel


class MemberInvitation(BaseModel):
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="member_invitations")
    member = models.UUIDField()
    intended_email = models.CharField(max_length=254)
    source_snapshot = models.JSONField()
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    acceptance_deadline = models.DateTimeField()
    code_sha256 = models.CharField(max_length=64, unique=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]


class MemberAssociation(BaseModel):
    invitation = models.OneToOneField(MemberInvitation, on_delete=models.PROTECT, related_name="association")
    company = models.ForeignKey("companies.Company", on_delete=models.PROTECT, related_name="member_associations")
    member = models.UUIDField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="member_associations")
    user_account = models.ForeignKey("users.UserAccount", on_delete=models.PROTECT, related_name="member_associations")
    accepted_email = models.CharField(max_length=254)
    current = models.BooleanField(default=True, editable=False)

    class Meta:
        ordering = ["-created_at", "-uuid"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "member"], condition=models.Q(current=True), name="one_current_member_association"
            ),
            models.UniqueConstraint(
                fields=["company", "user_account"],
                condition=models.Q(current=True),
                name="one_current_account_association",
            ),
        ]


class MemberAssociationRevocation(BaseModel):
    association = models.OneToOneField(MemberAssociation, on_delete=models.PROTECT, related_name="revocation")
    revoked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    appointment = models.ForeignKey("companies.CompanyAppointment", on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()
    reason = models.CharField(max_length=1000)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["revoked_by", "idempotency_key"], name="member_association_revocation_key")
        ]


class MemberParticularsRequest(BaseModel):
    association = models.ForeignKey(MemberAssociation, on_delete=models.PROTECT, related_name="particulars_requests")
    company = models.ForeignKey(
        "companies.Company", on_delete=models.PROTECT, related_name="member_particulars_requests"
    )
    member = models.UUIDField()
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    source_snapshot = models.JSONField()
    name = models.CharField(max_length=255)
    residential_address = models.CharField(max_length=1000)

    class Meta:
        ordering = ["-created_at", "-uuid"]


class MemberCertificateRequest(BaseModel):
    association = models.ForeignKey(MemberAssociation, on_delete=models.PROTECT, related_name="certificate_requests")
    company = models.ForeignKey(
        "companies.Company", on_delete=models.PROTECT, related_name="member_certificate_requests"
    )
    token = models.ForeignKey("tokens.ShareToken", on_delete=models.PROTECT, related_name="member_certificate_requests")
    member = models.UUIDField()
    entry = models.ForeignKey(
        "tokens.RegisterEntry", on_delete=models.PROTECT, related_name="member_certificate_requests"
    )
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")

    class Meta:
        ordering = ["-created_at", "-uuid"]


class MemberCertificateWithdrawal(BaseModel):
    request = models.OneToOneField(MemberCertificateRequest, on_delete=models.PROTECT, related_name="withdrawal")
    withdrawn_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    idempotency_key = models.UUIDField()

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["withdrawn_by", "idempotency_key"], name="member_certificate_withdrawal_key"
            )
        ]
