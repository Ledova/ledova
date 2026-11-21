from tokens.services.register import certificate_preview, prepare_certificate
from tokens.services.register_authority import (
    current_register_reader,
    register_output_access,
    register_reader_appointment,
)


def preview_company_certificate(*, actor, token, sequence):
    with register_output_access(actor, token, "register_certificate") as (company, actor, profile, token):
        appointment = current_register_reader(company, actor, profile)
        preview = {**certificate_preview(token, sequence=sequence), "appointment": appointment.pk}
        register_reader_appointment(company, actor, profile, appointment.pk)
        return preview


def prepare_company_certificate(*, actor, token, appointment, sequence, source_digest, instruction=""):
    with register_output_access(actor, token, "register_certificate") as (company, actor, profile, token):
        register_reader_appointment(company, actor, profile, appointment)
        content = prepare_certificate(
            token, actor, sequence=sequence, instruction=instruction, source_digest=source_digest
        )
        register_reader_appointment(company, actor, profile, appointment)
        return content
