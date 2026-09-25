from django.db import models

from shared.models import BaseModel


class FreshSignerBootstrap(BaseModel):
    signer = models.OneToOneField(
        "blockchain.SigningAccount", on_delete=models.PROTECT, related_name="bootstrap", editable=False
    )
    manifest_digest = models.CharField(max_length=64, unique=True, editable=False)
    validator_version = models.CharField(max_length=32, editable=False)
    manifest = models.JSONField(editable=False)
    artifact_identities = models.JSONField(editable=False)
    chain_evidence = models.JSONField(editable=False)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(manifest_digest__regex=r"^[0-9a-f]{64}$"), name="fresh_signer_manifest_digest"
            ),
        ]
