from django.db.models import Q

SEARCH_MAX_LENGTH = 100


def every_word(queryset, query, *fields):
    for word in query.split():
        queryset = queryset.filter(Q.create([(f"{field}__icontains", word) for field in fields], connector=Q.OR))
    return queryset
