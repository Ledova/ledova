from django.db import models

from blockchain.models import OutgoingStatus


class ShareIssuanceExecutionQuerySet(models.QuerySet):
    def recoverable(self, cutoff):
        return self.filter(status__in=("queued", "executing")).filter(
            models.Q(updated_at__lt=cutoff)
            | models.Q(operation__status__in=(OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED))
        )
