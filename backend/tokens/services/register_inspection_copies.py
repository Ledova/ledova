from tokens.models import RegisterExportRoute
from tokens.services.register import inspection_copy_preview, prepare_inspection_copy
from tokens.services.register_authority import (
    current_register_reader,
    register_output_access,
    register_reader_appointment,
)


def preview_company_inspection_copy(*, actor, token):
    with register_output_access(actor, token, "register_inspection_copy") as (company, actor, profile, operator, token):
        appointment = current_register_reader(company, actor, profile, operator)
        preview = {**inspection_copy_preview(token), "appointment": appointment.pk}
        register_reader_appointment(company, actor, profile, operator, appointment.pk)
        return preview


def prepare_company_inspection_copy(*, actor, token, appointment, source_digest, instruction, requested_on, recipient):
    with register_output_access(actor, token, "register_inspection_copy") as (company, actor, profile, operator, token):
        register_reader_appointment(company, actor, profile, operator, appointment)
        content = prepare_inspection_copy(
            token,
            actor,
            instruction=instruction,
            requested_on=requested_on,
            recipient=recipient,
            produced_through=RegisterExportRoute.COMPANY,
            source_digest=source_digest,
        )
        register_reader_appointment(company, actor, profile, operator, appointment)
        return content
