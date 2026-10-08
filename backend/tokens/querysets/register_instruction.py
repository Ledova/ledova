from django.db.models import Q

from tokens.querysets.register_proposal import RegisterProposalQuerySet


class RegisterInstructionQuerySet(RegisterProposalQuerySet):

    def legacy_instructions(self):
        return self.filter(preparing_appointment__isnull=True)

    def company_issues(self):
        return self.filter(kind="issue", preparing_appointment__isnull=False, paid_subscription__isnull=True)

    def company_paid_issues(self):
        return self.filter(kind="issue", preparing_appointment__isnull=False, paid_subscription__isnull=False)

    def covering(self, *items):
        listed = Q()
        for item in items:
            listed |= Q(items__contains=[item])
        return self.filter(listed, status="applied")
