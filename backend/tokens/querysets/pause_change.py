from django.db import models


class PauseChangeQuerySet(models.QuerySet):
    def unresolved(self):
        return self.filter(completed_at__isnull=True)

    def recoverable(self, cutoff):
        return self.unresolved().filter(updated_at__lt=cutoff).order_by("updated_at", "pk")
