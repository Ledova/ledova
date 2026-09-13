from uuid import UUID

from companies.models import Company
from shared.db import use_operator


def active_issuer_for_claim(user, company_id):
    if user is None or not user.is_authenticated:
        return None
    try:
        company_id = UUID(str(company_id))
    except (ValueError, TypeError):
        return None
    with use_operator():
        return Company.objects.active().only("pk").filter(pk=company_id).first()
