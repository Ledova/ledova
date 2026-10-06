from django.db.models import Q

from offerings.models import Offering
from tokens.models import ShareToken
from users.services.eligibility import directory_admission


def directory_tokens(user):
    admission = directory_admission(user)
    offerings = Offering.objects.filter(
        Q(company_id__in=admission.company_ids) | Q(pk__in=admission.offering_ids)
    ).values("pk")
    return (
        ShareToken.objects.with_company()
        .in_directory()
        .filter(Q(company_id__in=admission.company_ids) | Q(pk__in=admission.token_ids))
        .with_issued_shares()
        .with_open_offering(allowed_offering_ids=offerings)
    )
