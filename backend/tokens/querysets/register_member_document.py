from django.db.models import QuerySet
from django.utils import timezone


class RegisterMemberDocumentQuerySet(QuerySet):
    def readable_by(self, user):
        from companies.models import REGISTER_READERS, CompanyAppointment
        from operators.models import Operator

        companies = (
            CompanyAppointment.objects.current_of(
                user, at=timezone.now(), identity_required=Operator.get().issuer_kyc_required
            )
            .holding_any(REGISTER_READERS)
            .values("company_id")
        )
        return self.filter(company_id__in=companies).select_related("evidence")
