import os
import uuid as uuid_lib


def investor_evidence_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    unique_name = f"{uuid_lib.uuid4()}{ext}"
    return f"users/{instance.user_account.uuid}/investor-classifications/{instance.category}/{unique_name}"
