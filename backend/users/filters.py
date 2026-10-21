import django_filters
from django.db.models import Q
from django.utils import timezone

from users.models.company_eligibility import (
    CompanyEligibilityDecisionOutcome,
    CompanyEligibilityRequest,
)
from users.models.notification import Notification
from users.serializers.company_eligibility import REQUEST_OUTCOME_CHOICES


class NotificationFilter(django_filters.FilterSet):
    notification_type = django_filters.CharFilter()
    is_read = django_filters.BooleanFilter()
    is_archived = django_filters.BooleanFilter()

    class Meta:
        model = Notification
        fields = []


class CompanyEligibilityRequestFilter(django_filters.FilterSet):
    outcome = django_filters.ChoiceFilter(
        choices=[(outcome, outcome) for outcome in REQUEST_OUTCOME_CHOICES], method="filter_outcome"
    )

    class Meta:
        model = CompanyEligibilityRequest
        fields = []

    def filter_outcome(self, queryset, name, value):
        decided = Q(withdrawal__isnull=True, decision__isnull=False)
        standing = decided & Q(decision__revocation__isnull=True)
        accepted = standing & Q(decision__outcome=CompanyEligibilityDecisionOutcome.ACCEPTED)
        now = timezone.now()
        return queryset.filter(
            {
                "pending": Q(withdrawal__isnull=True, decision__isnull=True),
                "accepted": accepted & Q(decision__expires_at__gt=now),
                "refused": standing & Q(decision__outcome=CompanyEligibilityDecisionOutcome.REFUSED),
                "withdrawn": Q(withdrawal__isnull=False),
                "revoked": decided & Q(decision__revocation__isnull=False),
                "expired": accepted & Q(decision__expires_at__lte=now),
            }[value]
        )
