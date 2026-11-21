from django.db.models import Q, QuerySet
from django.utils import timezone


class RegisterAwardQuerySet(QuerySet):
    def readable_by(self, actor):
        from companies.models import REGISTER_READERS, CompanyAppointment

        if actor is None or not actor.is_authenticated:
            return self.none()
        appointments = CompanyAppointment.objects.current_of(actor, at=timezone.now()).holding_any(REGISTER_READERS)
        return self.filter(company_id__in=appointments.values("company_id"))


class RegisterAwardGrantQuerySet(RegisterAwardQuerySet):
    def register_readable_by(self, actor):
        from companies.models import Company

        if actor is None or not actor.is_authenticated:
            return self.none()
        appointed = self.readable_by(actor).values("uuid")
        return self.filter(
            Q(award__isnull=True, company__in=Company.objects.register_readable_by(actor))
            | Q(award__isnull=False, uuid__in=appointed)
        )
