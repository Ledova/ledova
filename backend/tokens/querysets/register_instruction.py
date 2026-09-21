from django.db.models import Q, QuerySet


class RegisterInstructionQuerySet(QuerySet):

    def covering(self, *items):
        listed = Q()
        for item in items:
            listed |= Q(items__contains=[item])
        return self.filter(listed, status="applied")
