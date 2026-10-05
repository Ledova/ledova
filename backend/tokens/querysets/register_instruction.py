from django.db.models import Q

from tokens.querysets.register_proposal import RegisterProposalQuerySet


class RegisterInstructionQuerySet(RegisterProposalQuerySet):

    def covering(self, *items):
        listed = Q()
        for item in items:
            listed |= Q(items__contains=[item])
        return self.filter(listed, status="applied")
