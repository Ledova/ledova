import os
import uuid as uuid_lib


def company_document_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    unique_name = f"{uuid_lib.uuid4()}{ext}"
    return f"companies/{instance.company.uuid}/documents/{instance.document_type}/{unique_name}"
