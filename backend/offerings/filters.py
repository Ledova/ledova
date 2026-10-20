import django_filters

from offerings.models import Subscription, SubscriptionStatus
from shared.api.search import SEARCH_MAX_LENGTH, every_word


class IssuerSubscriptionFilter(django_filters.FilterSet):
    status = django_filters.ChoiceFilter(choices=SubscriptionStatus.choices)
    search = django_filters.CharFilter(method="filter_search", max_length=SEARCH_MAX_LENGTH)

    class Meta:
        model = Subscription
        fields = []

    def filter_search(self, queryset, name, value):
        return every_word(queryset, value, "user_account__user_profile__full_name", "wallet__address", "reference")
