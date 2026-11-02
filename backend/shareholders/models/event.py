import uuid


def payment_evidence_path(instance, filename):
    return (
        f"companies/{instance.company_id}/publications/{instance.publication_id}/payments/{instance.pk}/"
        f"{uuid.uuid4()}.bin"
    )
