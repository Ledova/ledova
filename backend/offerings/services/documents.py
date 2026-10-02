from uuid import UUID

from django.db.models import Q
from rest_framework.exceptions import NotFound

from companies.models import CompanyDocument
from offerings.models import Offering
from shared.db import use_operator

NO_DOCUMENT = "Document not found."


def _published_offerings(token):
    return list(Offering.objects.for_token(token).published().values_list("pk", flat=True))


def _offered(token, offerings):
    return CompanyDocument.objects.filter(company_id=token.company_id, offerings__in=offerings).exclude(
        Q(file__isnull=True) | Q(file="")
    )


def published_documents(token):
    offerings = _published_offerings(token)
    if not offerings:
        return []
    with use_operator():
        return list(_offered(token, offerings).distinct().order_by("-created_at", "uuid"))


def published_document(token, document_id):
    try:
        document_id = UUID(str(document_id))
    except ValueError:
        raise NotFound(NO_DOCUMENT) from None
    offerings = _published_offerings(token)
    document = None
    if offerings:
        with use_operator():
            document = _offered(token, offerings).filter(pk=document_id).first()
    if document is None:
        raise NotFound(NO_DOCUMENT)
    return document
