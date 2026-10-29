import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from assets.models import AssetType
from shared.constants import BLOCKCHAIN_BASE, BLOCKCHAIN_ETHEREUM

SINGLETON_PK = 1
STABLECOIN_ONLY = {"asset_type": AssetType.STABLECOIN.value}
NOT_A_STABLECOIN = "{symbol} is not a stablecoin asset."


class ReceivingChain(models.TextChoices):
    ETHEREUM = BLOCKCHAIN_ETHEREUM, "Ethereum"
    BASE = BLOCKCHAIN_BASE, "Base"


def _digits(value: str) -> str:
    return re.sub(r"[\s-]", "", value or "")


class Operator(models.Model):

    id = models.PositiveSmallIntegerField(primary_key=True, default=SINGLETON_PK, editable=False)

    name = models.CharField(max_length=120)
    legal_name = models.CharField(max_length=255, blank=True)
    abn = models.CharField(max_length=14, blank=True)
    contact_email = models.EmailField(blank=True)
    website = models.URLField(blank=True)

    receiving_wallet_chain = models.CharField(
        max_length=20, choices=ReceivingChain.choices, default=ReceivingChain.BASE
    )
    issued_stablecoin = models.ForeignKey(
        "assets.Asset",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        limit_choices_to=STABLECOIN_ONLY,
    )
    supported_settlement_assets = models.ManyToManyField(
        "assets.Asset", blank=True, related_name="+", limit_choices_to=STABLECOIN_ONLY
    )

    investor_kyc_required = models.BooleanField(default=True)
    issuer_kyc_required = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Operator"
        verbose_name_plural = "Operator"
        constraints = [
            models.CheckConstraint(condition=models.Q(id=SINGLETON_PK), name="operators_operator_single_row"),
        ]

    def __str__(self):
        return self.name

    @classmethod
    def get(cls) -> "Operator":
        operator, _ = cls.objects.get_or_create(pk=SINGLETON_PK, defaults={"name": settings.OPERATOR_NAME})
        return operator

    def save(self, *args, **kwargs):
        self.id = SINGLETON_PK
        if self._state.adding and Operator.objects.filter(pk=SINGLETON_PK).exists():
            raise ValidationError("Only one operator row can exist; edit the existing one.")
        super().save(*args, **kwargs)

    def clean(self):
        errors = {}
        self.abn = _digits(self.abn)
        if self.abn and not re.fullmatch(r"\d{11}", self.abn):
            errors["abn"] = "ABN must be exactly 11 digits."
        if self.issued_stablecoin_id and self.issued_stablecoin.asset_type != AssetType.STABLECOIN.value:
            errors["issued_stablecoin"] = NOT_A_STABLECOIN.format(symbol=self.issued_stablecoin.symbol)
        if errors:
            raise ValidationError(errors)
