from django.db.models import F, Q, QuerySet


class CompanyAppointmentQuerySet(QuerySet):
    def current(self, *, at, identity_required):
        current = self.filter(
            appointee__is_active=True,
            appointee__is_email_verified=True,
            appointee_profile__user_id=F("appointee_id"),
            revocation__isnull=True,
        ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=at))
        if identity_required:
            current = current.filter(appointee_profile__is_id_verified=True)
        return current

    def current_of(self, requester, *, at, identity_required):
        return self.current(at=at, identity_required=identity_required).filter(appointee_id=requester.pk)

    def current_for(self, requester, company_id, *, at, identity_required):
        return self.current_of(requester, at=at, identity_required=identity_required).filter(company_id=company_id)

    def holding_any(self, capabilities):
        return self.filter(capabilities__has_any_keys=[str(capability) for capability in capabilities])
