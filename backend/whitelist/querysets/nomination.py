from django.db.models import QuerySet


class CompanyWalletNominationQuerySet(QuerySet):
    def owned_by(self, user):
        if user is None or not user.is_authenticated:
            return self.none()
        return self.filter(submitted_by=user)

    def register_readable_by(self, user):
        from companies.models import Company

        return self.filter(company__in=Company.objects.register_readable_by(user))
