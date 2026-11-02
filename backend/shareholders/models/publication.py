import uuid


def publication_file_path(instance, filename):
    return f"companies/{instance.company_id}/publications/{instance.pk}/{uuid.uuid4()}.bin"
