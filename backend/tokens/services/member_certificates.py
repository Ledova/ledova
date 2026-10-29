import hashlib
from contextlib import contextmanager

from django.core.files.base import ContentFile
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, ValidationError

from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    MemberAssociation,
    MemberCertificateFulfilment,
    MemberCertificateRequest,
    RegisterExport,
    RegisterExportKind,
    RegisterExportRoute,
)
from tokens.services.member_access import _query, company_readable, request_readable
from tokens.services.member_events import certificate_ready
from tokens.services.register import _certificate_source
from tokens.services.register_authority import (
    current_register_reader,
    register_output_access,
    register_reader_appointment,
)
from tokens.services.register_evidence import discard, matching_bytes

MAX_FILE_BYTES = 1048576


@contextmanager
def _access(actor, request_id, operation):
    request = get_object_or_404(
        company_readable(MemberCertificateRequest.objects.select_related("token"), actor), pk=request_id
    )
    with register_output_access(actor, request.token, operation) as (company, current, profile, operator, token):
        MemberAssociation.objects.select_for_update().get(pk=request.association_id)
        request = (
            MemberCertificateRequest.objects.select_for_update()
            .select_related("entry", "association")
            .get(pk=request.pk)
        )
        yield company, current, profile, operator, token, request


def _require_source(request):
    if getattr(request, "withdrawal", None) is not None:
        raise ValidationError("The member withdrew this certificate request.")
    if not _query("tokens_member_certificate_entry", request.association_id, request.entry_id):
        raise ValidationError(
            "This request no longer has a current association and genuine uncorrected receiving effect."
        )


def preview_member_certificate(*, actor, request_id):
    with _access(actor, request_id, "member_certificate_preview") as (
        company,
        current,
        profile,
        operator,
        token,
        request,
    ):
        appointment = current_register_reader(company, current, profile, operator)
        _require_source(request)
        if MemberCertificateFulfilment.objects.filter(request=request).exists():
            raise ValidationError("This request already has a retained certificate.")
        entry, _, page_count, _ = _certificate_source(token, request.entry.sequence, only_member=request.member)
        result = {
            "token": token.pk,
            "company": company.pk,
            "member_request": request.pk,
            "member": request.member,
            "appointment": appointment.pk,
            "entry": entry.pk,
            "sequence": entry.sequence,
            "register_sequence": entry.register.sequence,
            "page_count": page_count,
            "source_digest": _query("tokens_member_certificate_source_digest", request.pk),
        }
        register_reader_appointment(company, current, profile, operator, appointment.pk)
        return result


def fulfil_member_certificate(*, actor, request_id, operation_id, appointment, source_digest, instruction):
    output = None
    try:
        with _access(actor, request_id, "member_certificate_fulfil") as (
            company,
            current,
            profile,
            operator,
            token,
            request,
        ):
            source = register_reader_appointment(company, current, profile, operator, appointment)
            existing = MemberCertificateFulfilment.objects.filter(pk=operation_id).first()
            if existing:
                expected = {
                    "request_id": request.pk,
                    "appointment_id": source.pk,
                    "produced_by_id": current.pk,
                    "source_digest": source_digest,
                    "instruction": instruction,
                }
                if any(getattr(existing, key) != value for key, value in expected.items()):
                    raise RegisterChangeConflict()
                return request, False
            _require_source(request)
            if MemberCertificateFulfilment.objects.filter(request=request).exists():
                raise RegisterChangeConflict()
            if source_digest != _query("tokens_member_certificate_source_digest", request.pk):
                raise RegisterChangeConflict(
                    "The register or recorded particulars changed. Refresh this certificate request."
                )
            snapshot = _query("tokens_member_certificate_source", request.pk)
            entry, content, page_count, _ = _certificate_source(
                token, request.entry.sequence, only_member=request.member
            )
            if page_count != 1 or not 0 < len(content) <= MAX_FILE_BYTES:
                raise ValidationError("A permitted member certificate needs one bounded recipient-only page.")
            digest = hashlib.sha256(content).hexdigest()
            audit = RegisterExport.objects.create(
                token=token,
                requested_by_id=current.pk,
                kind=RegisterExportKind.CERTIFICATE,
                register_sequence=entry.sequence,
                member_rows=1,
                former_rows=0,
                produced_through=RegisterExportRoute.COMPANY,
                digest=digest,
                instruction=instruction,
            )
            output = MemberCertificateFulfilment(
                uuid=operation_id,
                request=request,
                export=audit,
                produced_by=current,
                appointment=source,
                instruction=instruction,
                source_snapshot=snapshot,
                source_digest=source_digest,
                digest=digest,
                file_size=len(content),
            )
            output.file.save("certificate.bin", ContentFile(content), save=False)
            try:
                output.save(force_insert=True)
            except IntegrityError:
                raise RegisterChangeConflict() from None
            register_reader_appointment(company, current, profile, operator, source.pk)
            _require_source(request)
            certificate_ready(request)
            return request, True
    except BaseException:
        if output is not None:
            discard(output.file)
        raise


def member_certificate_bytes(*, actor, request_id):
    request = get_object_or_404(
        request_readable(MemberCertificateRequest.objects.select_related("fulfilment", "association"), actor),
        pk=request_id,
    )
    if not company_readable(MemberCertificateRequest.objects.filter(pk=request.pk), actor).exists():
        if not _query("tokens_member_association_current", request.association_id, actor.pk):
            raise NotFound("Member certificate not found.")
    output = getattr(request, "fulfilment", None)
    if output is None:
        raise NotFound("No retained certificate fulfils this request.")
    content = matching_bytes(output.file, output.file_size, output.digest)
    if not company_readable(MemberCertificateRequest.objects.filter(pk=request.pk), actor).exists():
        if not _query("tokens_member_association_current", request.association_id, actor.pk):
            raise NotFound("Member certificate not found.")
    return content
