from uuid import UUID

from django.db.models import Q
from rest_framework.exceptions import NotFound

from companies.models import CompanyDocument
from companies.services.authority_requests import _requester_principal
from offerings.models import Offering
from shared.db import principal_of, use_operator
from tokens.models import ShareToken
from users.services.eligibility import directory_admission

NO_DOCUMENT = "Document not found."


def _published_offerings(token, user):
    if not ShareToken.objects.in_directory().filter(pk=token.pk, company_id=token.company_id).exists():
        return []
    admission = directory_admission(user)
    offerings = Offering.objects.for_token(token).published()
    if token.company_id not in admission.company_ids:
        offerings = offerings.filter(pk__in=admission.offering_ids)
    return list(offerings.values_list("pk", flat=True))


def _offered(token, offerings):
    return CompanyDocument.objects.filter(company_id=token.company_id, offerings__in=offerings).exclude(
        Q(file__isnull=True) | Q(file="")
    )


def published_documents(token, *, user):
    principal = principal_of()
    offerings = _published_offerings(token, user)
    if not offerings:
        return []
    with use_operator(), _requester_principal(principal or ""):
        return list(_offered(token, offerings).distinct().order_by("-created_at", "uuid"))


def published_document(token, document_id, *, user):
    try:
        document_id = UUID(str(document_id))
    except (ValueError, TypeError, AttributeError):
        raise NotFound(NO_DOCUMENT) from None
    principal = principal_of()
    offerings = _published_offerings(token, user)
    document = None
    if offerings:
        with use_operator(), _requester_principal(principal or ""):
            document = _offered(token, offerings).filter(pk=document_id).first()
    if document is None:
        raise NotFound(NO_DOCUMENT)
    return document
