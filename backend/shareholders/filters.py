import django_filters

from shareholders.models import Publication, PublicationKind

ADDRESSED_TO_THE_CALLER = "me"


class PublicationFilter(django_filters.FilterSet):
    kind = django_filters.ChoiceFilter(choices=PublicationKind.choices)
    addressed = django_filters.ChoiceFilter(
        choices=[(ADDRESSED_TO_THE_CALLER, "Addressed to the caller")], method="filter_addressed"
    )

    class Meta:
        model = Publication
        fields = []

    def filter_addressed(self, queryset, name, value):
        return queryset.addressed_to(self.request.user.pk)
