from django.db.models import Q, QuerySet
from django.db.models.expressions import RawSQL


def administrable_company(actor, company_id):
    from companies.models import Company

    return Company.objects.administrable_by(actor).filter(pk=company_id).first()


class CompanyQuerySet(QuerySet):

    def readable_by(self, user):
        if user is None or not user.is_authenticated:
            return self.none()
        return self.filter(
            Q(owner=user, owner__is_active=True)
            | Q(
                pk__in=RawSQL(
                    "SELECT app_company_administration_ids() WHERE "
                    "NULLIF(current_setting('app.user_id', true), '')::bigint = %s",
                    [user.pk],
                )
            )
        )

    def administrable_by(self, user):
        if user is None or not user.is_authenticated:
            return self.none()
        return self.filter(
            pk__in=RawSQL(
                "SELECT app_company_administration_ids() WHERE "
                "NULLIF(current_setting('app.user_id', true), '')::bigint = %s",
                [user.pk],
            )
        )

    def owned_by(self, user):
        if user is None or not user.is_authenticated:
            return self.none()
        return self.filter(owner=user)

    def active(self):
        from companies.models import CompanyStatus

        return self.filter(status=CompanyStatus.ACTIVE)

    def awaiting_review(self):
        from companies.models import CompanyStatus

        return self.filter(status__in=[CompanyStatus.SUBMITTED, CompanyStatus.REVIEW, CompanyStatus.INFO_REQUIRED])

    def open_to_investors(self):
        return self.active().filter(is_open_to_investors=True)

    def search(self, query):
        if not query:
            return self
        return self.filter(Q(name__icontains=query) | Q(trading_name__icontains=query) | Q(acn__icontains=query))
