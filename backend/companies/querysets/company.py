from django.db.models import Q, QuerySet
from django.db.models.expressions import RawSQL
from django.utils import timezone


def administrable_company(actor, company_id):
    from companies.models import Company

    return Company.objects.administrable_by(actor).filter(pk=company_id).first()


class CompanyQuerySet(QuerySet):

    def for_activation(self, user, company_id):
        from companies.models import CompanyAppointment, CompanyCapability

        sources = CompanyAppointment.objects.current_for(user, company_id, at=timezone.now(), identity_required=False)
        return self.filter(pk__in=sources.filter(capabilities__contains=[CompanyCapability.ADMIN]).values("company_id"))

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

    def register_readable_by(self, user):
        if user is None or not user.is_authenticated:
            return self.none()
        from companies.models import REGISTER_READERS, CompanyAppointment
        from operators.models import Operator

        appointments = CompanyAppointment.objects.current_of(
            user, at=timezone.now(), identity_required=Operator.get().issuer_kyc_required
        ).holding_any(REGISTER_READERS)
        return self.filter(Q(owner=user) | Q(pk__in=appointments.values("company_id")))

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
