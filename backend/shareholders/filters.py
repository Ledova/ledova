import django_filters
from rest_framework.exceptions import ValidationError

from companies.models import Company
from shareholders.models import Publication, PublicationKind

ADDRESSED_TO_THE_CALLER = "me"


class PublicationFilter(django_filters.FilterSet):
    kind = django_filters.ChoiceFilter(choices=PublicationKind.choices)
    issuer = django_filters.UUIDFilter(method="filter_issuer")
    addressed = django_filters.ChoiceFilter(
        choices=[(ADDRESSED_TO_THE_CALLER, "Addressed to the caller")], method="filter_addressed"
    )

    class Meta:
        model = Publication
        fields = []

    def filter_addressed(self, queryset, name, value):
        return queryset.addressed_to(self.request.user.pk)

    def filter_queryset(self, queryset):
        if self.data.get("issuer") == "":
            raise ValidationError({"issuer": "Select a company you own."})
        return super().filter_queryset(queryset)

    def filter_issuer(self, queryset, name, value):
        if not Company.objects.owned_by(self.request.user).filter(pk=value).exists():
            raise ValidationError({"issuer": "Select a company you own."})
        return queryset.filter(company_id=value)
