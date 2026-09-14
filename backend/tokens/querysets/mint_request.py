from django.db import models


class MintRequestQuerySet(models.QuerySet):
    def recoverable(self):
        from blockchain.models import OutgoingStatus
        from tokens.models import MintRequestStatus

        return self.filter(execution_intent__isnull=False, dispatch_id__isnull=False).filter(
            models.Q(status=MintRequestStatus.EXECUTING)
            | models.Q(
                status=MintRequestStatus.FAILED,
                operation__status__in=[OutgoingStatus.PREPARING, OutgoingStatus.SIGNED, OutgoingStatus.CONFIRMED],
            )
        )
