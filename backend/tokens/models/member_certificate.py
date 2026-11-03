import uuid


def member_certificate_path(instance, filename):
    return f"companies/{instance.request.company_id}/member-certificates/{instance.pk}/{uuid.uuid4()}.bin"
