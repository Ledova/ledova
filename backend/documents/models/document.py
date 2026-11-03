import os
import uuid as uuid_lib


def document_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    if instance.classification_id:
        return f"users/supporting-documents/{instance.classification_id}/{instance.uuid}/{uuid_lib.uuid4()}{ext}"
    return f"documents/{instance.uuid}/{uuid_lib.uuid4()}{ext}"
