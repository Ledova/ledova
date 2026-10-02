from django.db.models import QuerySet


class CompanyDocumentQuerySet(QuerySet):

    def offered(self):
        from offerings.models.offering import PUBLISHED_OFFERING_STATUSES

        return self.filter(offerings__status__in=PUBLISHED_OFFERING_STATUSES).distinct()
