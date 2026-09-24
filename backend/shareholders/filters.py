import django_filters

from shareholders.models import Publication, PublicationKind


class PublicationFilter(django_filters.FilterSet):
    kind = django_filters.ChoiceFilter(choices=PublicationKind.choices)

    class Meta:
        model = Publication
        fields = []
