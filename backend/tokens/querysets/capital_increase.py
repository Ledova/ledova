from django.db import models
from django.db.models import QuerySet

from tokens.models.choices import IN_FLIGHT_STATUSES, RequestStatus


class CapitalIncreaseRequestQuerySet(QuerySet):

    def pending(self):
        return self.filter(status__in=[RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW, RequestStatus.APPROVED])

    def in_flight(self):
        return self.filter(status__in=IN_FLIGHT_STATUSES)

    def needing_attention(self):
        return self.filter(
            status__in=[
                RequestStatus.SUBMITTED,
                RequestStatus.UNDER_REVIEW,
                RequestStatus.APPROVED,
                RequestStatus.FAILED,
            ]
        )

    def with_relations(self):
        return self.select_related(
            "token",
            "token__company",
            "submitted_by",
            "reviewed_by",
            "executed_issuance",
        )

    def search(self, query):
        if not query:
            return self
        return self.filter(
            models.Q(token__symbol__icontains=query)
            | models.Q(token__name__icontains=query)
            | models.Q(token__company__name__icontains=query)
            | models.Q(purpose__icontains=query)
            | models.Q(board_resolution_reference__icontains=query)
        )
