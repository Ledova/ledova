from django.db.models import QuerySet


class RegisterProposalQuerySet(QuerySet):

    def register_readable_by(self, user):
        from companies.models import Company

        return self.filter(company__in=Company.objects.register_readable_by(user))
