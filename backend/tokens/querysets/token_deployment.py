from django.db import models

from blockchain.models import OutgoingStatus, TransactionStatus


class TokenDeploymentQuerySet(models.QuerySet):
    def recoverable(self, cutoff):
        return self.filter(projected_at__isnull=True, attribution_required=False, updated_at__lt=cutoff).filter(
            models.Q(operation__isnull=True)
            | models.Q(
                operation__status__in=(OutgoingStatus.PREPARING, OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED)
            )
            | (
                models.Q(operation__status=OutgoingStatus.REVERTED, transaction__isnull=False)
                & ~models.Q(transaction__status=TransactionStatus.REVERTED)
            )
        )
