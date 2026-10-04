from contextlib import contextmanager

from django.shortcuts import get_object_or_404

from companies.exceptions import OfferedDocumentException
from companies.models import CompanyDocument
from companies.services.administration import (
    company_operation,
    lock_company_actor,
    require_company_administration,
)
from offerings.models import Offering
from shared.db import atomic


def create_document(*, company_id, actor, data):
    document = CompanyDocument(company_id=company_id, **data)
    new_upload = bool(document.file) and not document.file._committed
    try:
        with company_operation(actor, company_id, "document_create"), atomic(durable=True):
            company, current_actor, profile, operator = lock_company_actor(actor, company_id)
            require_company_administration(company, current_actor, profile, operator)
            document.company = company
            document.save()
            return document
    except BaseException:
        if new_upload and document.file and document.file._committed:
            document.file.storage.delete(document.file.name)
        raise


@contextmanager
def document_file(*, company_id, document_id, actor):
    with company_operation(actor, company_id, "document_file"), atomic():
        company, current_actor, profile, operator = lock_company_actor(actor, company_id)
        document = get_object_or_404(CompanyDocument.objects.select_for_update(), pk=document_id, company=company)
        require_company_administration(company, current_actor, profile, operator)
        yield document.file, document.mime_type


def delete_document(document, *, actor):
    with company_operation(actor, document.company_id, "document_delete"), atomic():
        company, current_actor, profile, operator = lock_company_actor(actor, document.company_id)
        current = get_object_or_404(
            CompanyDocument.objects.select_for_update(no_key=True), pk=document.pk, company=company
        )
        list(
            Offering.objects.select_for_update(of=("self",))
            .filter(documents=current)
            .order_by("uuid")
            .values_list("uuid", flat=True)
        )
        require_company_administration(company, current_actor, profile, operator)
        if CompanyDocument.objects.filter(pk=current.pk).offered().exists():
            raise OfferedDocumentException()
        current.delete()
