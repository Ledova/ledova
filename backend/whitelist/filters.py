import django_filters

from whitelist.models import WhitelistEntry


class WhitelistEntryFilter(django_filters.FilterSet):
    company = django_filters.UUIDFilter(field_name="approvals__company", distinct=True)
    status = django_filters.CharFilter(field_name="approvals__status", distinct=True)
    date_from = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    date_to = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = WhitelistEntry
        fields = []
