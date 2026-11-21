from django.db.models import F, Q, QuerySet


class CompanyAppointmentQuerySet(QuerySet):
    def current(self, *, at):
        return self.filter(
            appointee__is_active=True,
            appointee__is_email_verified=True,
            appointee_profile__user_id=F("appointee_id"),
            revocation__isnull=True,
        ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=at))

    def current_of(self, requester, *, at):
        return self.current(at=at).filter(appointee_id=requester.pk)

    def current_for(self, requester, company_id, *, at):
        return self.current_of(requester, at=at).filter(company_id=company_id)

    def holding_any(self, capabilities):
        return self.filter(capabilities__has_any_keys=[str(capability) for capability in capabilities])
