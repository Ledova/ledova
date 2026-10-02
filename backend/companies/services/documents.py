from companies.exceptions import OfferedDocumentException
from companies.models import CompanyDocument


def delete_document(document):
    if CompanyDocument.objects.filter(pk=document.pk).offered().exists():
        raise OfferedDocumentException()
    document.delete()
