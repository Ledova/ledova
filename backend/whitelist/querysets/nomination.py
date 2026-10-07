from django.db.models import QuerySet


class CompanyWalletNominationQuerySet(QuerySet):
    def owned_by(self, user):
        return self.filter(request__user_account__user_profile__user=user)

    def register_readable_by(self, user):
        from companies.models import Company

        return self.filter(company__in=Company.objects.register_readable_by(user))
