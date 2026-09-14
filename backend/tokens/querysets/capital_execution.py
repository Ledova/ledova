from django.db import models

from blockchain.models import OutgoingStatus, TransactionStatus


class CapitalIncreaseExecutionQuerySet(models.QuerySet):
    def recoverable(self, cutoff):
        return self.filter(projected_at__isnull=True, updated_at__lt=cutoff).filter(
            models.Q(attribution_evidence__isnull=True)
            | models.Q(operation__status=OutgoingStatus.SIGNED)
            | models.Q(
                operation__status__in=(OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED),
                transaction__status__in=(TransactionStatus.PENDING, TransactionStatus.SUBMITTED),
            )
        )
