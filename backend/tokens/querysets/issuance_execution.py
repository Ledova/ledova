from django.db import models


class ShareIssuanceExecutionQuerySet(models.QuerySet):
    def recoverable(self, cutoff):
        return self.filter(status__in=("queued", "executing"), updated_at__lt=cutoff)
