from django.db.models import QuerySet


class PortfolioQuerySet(QuerySet):

    def active(self):
        return self.filter(is_active=True)
