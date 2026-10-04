from django.db.models import Q, QuerySet


class CompanyAppointmentQuerySet(QuerySet):
    def current_for(self, requester, company_id, *, at, identity_required):
        current = self.filter(
            company_id=company_id,
            appointee_id=requester.pk,
            appointee__is_active=True,
            appointee__is_email_verified=True,
            appointee_profile__user_id=requester.pk,
            revocation__isnull=True,
        ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=at))
        if identity_required:
            current = current.filter(appointee_profile__is_id_verified=True)
        return current
