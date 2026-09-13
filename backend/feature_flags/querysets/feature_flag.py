from django.db.models import QuerySet


class FeatureFlagQuerySet(QuerySet):

    def enabled(self):
        return self.filter(enabled=True)
