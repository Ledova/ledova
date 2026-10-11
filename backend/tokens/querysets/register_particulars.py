from django.db.models import Q

from tokens.querysets.register_proposal import RegisterProposalQuerySet


class RegisterParticularsQuerySet(RegisterProposalQuerySet):
    def register_readable_by(self, actor):
        from tokens.services.member_access import company_readable

        ordinary = super().register_readable_by(actor).filter(member_request__isnull=True).values("uuid")
        requested = company_readable(self.filter(member_request__isnull=False), actor).values("uuid")
        return self.filter(Q(uuid__in=ordinary) | Q(uuid__in=requested))
