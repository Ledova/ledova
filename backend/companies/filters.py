import django_filters

from companies.models import Company


class CompanyFilter(django_filters.FilterSet):
    status = django_filters.CharFilter()
    acn = django_filters.CharFilter()
    company_type = django_filters.CharFilter()
    search = django_filters.CharFilter(method="filter_search")
    active_only = django_filters.BooleanFilter(method="filter_active_only")

    class Meta:
        model = Company
        fields = []

    def filter_search(self, queryset, name, value):
        return queryset.search(value)

    def filter_active_only(self, queryset, name, value):
        if value:
            return queryset.active()
        return queryset
