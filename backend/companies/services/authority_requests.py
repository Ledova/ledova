import hashlib
import json
import logging
from contextlib import contextmanager
from datetime import timezone as datetime_timezone

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from companies.exceptions import AuthorityRequestConflictException
from companies.identity import company_identity, registered_name
from companies.models import (
    Company,
    CompanyAuthorityRequest,
    CompanyCapability,
    CompanyStatus,
)
from shared.db import (
    atomic,
    principal_of,
    reset_principal,
    set_principal,
    use_app,
    use_operator,
)
from shared.upload_errors import UploadRejected
from shared.uploads import read_bounded, validate_upload
from users.models import UserProfile

logger = logging.getLogger(__name__)


@contextmanager
def _requester_principal(requester_id):
    previous = principal_of()
    set_principal(requester_id)
    try:
        yield
    finally:
        if previous:
            set_principal(previous)
        else:
            reset_principal()


def _require_requester(user):
    if not user.is_authenticated or not user.is_active or not user.is_email_verified:
        raise PermissionDenied(
            "An active account with verified email is required to submit company authority evidence."
        )


def _capabilities(values, field):
    if not isinstance(values, list):
        raise ValidationError({field: "Use a list of capabilities."})
    if any(not isinstance(value, str) or value not in CompanyCapability.values for value in values):
        raise ValidationError({field: "Use the listed company capabilities."})
    if len(values) != len(set(values)):
        raise ValidationError({field: "Each capability may be requested only once."})
    return sorted(values)


def _snapshots(company, requester, profile):
    raw_company = {field: getattr(company, field) for field in ("name", "acn", "abn", "company_type")}
    raw_person = {
        "user_id": requester.pk,
        "profile_uuid": str(profile.pk),
        "email": requester.email,
        "full_name": profile.full_name or "",
    }
    person = {
        **raw_person,
        "email": requester.email.strip().casefold(),
        "full_name": registered_name(profile.full_name or ""),
    }
    return raw_company, company_identity(company), raw_person, person


def submit_authority_request(
    *,
    requester,
    company_id,
    idempotency_key,
    file,
    requested_capabilities,
    delegatable_capabilities=None,
    requested_expires_at=None
):
    _require_requester(requester)
    requested = _capabilities(requested_capabilities, "requested_capabilities")
    delegatable = _capabilities(
        [] if delegatable_capabilities is None else delegatable_capabilities, "delegatable_capabilities"
    )
    if not requested and not delegatable:
        raise ValidationError({"requested_capabilities": "Request at least one personal or delegatable capability."})
    with use_app(), _requester_principal(requester.pk):
        get_object_or_404(Company.objects.owned_by(requester), pk=company_id)
    file.seek(0)
    try:
        raw = read_bounded(file)
    except UploadRejected as error:
        raise ValidationError({"file": str(error)}) from None
    finally:
        file.seek(0)
    original_filename = file.name
    captured = ContentFile(raw, name=original_filename)
    captured.content_type = getattr(file, "content_type", "")
    file_size, mime_type = validate_upload(captured)
    file_sha256 = hashlib.sha256(raw).hexdigest()
    retained = None
    try:
        with use_operator(), _requester_principal(requester.pk), atomic():
            actor = get_object_or_404(get_user_model().objects.select_for_update(), pk=requester.pk)
            _require_requester(actor)
            profile = get_object_or_404(UserProfile.objects.select_for_update(), user=actor)
            company = get_object_or_404(Company.objects.select_for_update(), pk=company_id, owner=actor)
            if company.status != CompanyStatus.DRAFT:
                raise ValidationError(
                    {"company": "Initial authority evidence can only be requested for your draft company."}
                )
            raw_company, identity, raw_person, person = _snapshots(company, actor, profile)
            frozen = {
                "company": str(company.pk),
                "requester": actor.pk,
                "requester_profile": str(profile.pk),
                "purpose": "bootstrap",
                "company_identity_raw": raw_company,
                "company_identity": identity,
                "person_identity_raw": raw_person,
                "person_identity": person,
                "requested_capabilities": requested,
                "delegatable_capabilities": delegatable,
                "requested_expires_at": (
                    requested_expires_at.astimezone(datetime_timezone.utc).isoformat() if requested_expires_at else None
                ),
                "file_sha256": file_sha256,
                "file_size": file_size,
                "mime_type": mime_type,
                "original_filename": original_filename,
            }
            digest = hashlib.sha256(json.dumps(frozen, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            existing = CompanyAuthorityRequest.objects.filter(requester=actor, idempotency_key=idempotency_key).first()
            if existing:
                if existing.request_digest != digest:
                    raise AuthorityRequestConflictException()
                return existing, False
            if requested_expires_at and requested_expires_at <= timezone.now():
                raise ValidationError({"requested_expires_at": "Choose a future expiry."})
            proposal = CompanyAuthorityRequest(
                company=company,
                requester=actor,
                requester_profile=profile,
                idempotency_key=idempotency_key,
                company_identity_raw=raw_company,
                company_identity=identity,
                person_identity_raw=raw_person,
                person_identity=person,
                requested_capabilities=requested,
                delegatable_capabilities=delegatable,
                requested_expires_at=requested_expires_at,
                original_filename=original_filename,
                file_size=file_size,
                mime_type=mime_type,
                file_sha256=file_sha256,
                request_digest=digest,
            )
            proposal.file.save(original_filename, ContentFile(raw), save=False)
            retained = (proposal.file.storage, proposal.file.name)
            proposal.save(force_insert=True)
        return proposal, True
    except Exception:
        if retained:
            try:
                retained[0].delete(retained[1])
            except Exception:
                logger.warning("Authority evidence cleanup deferred for an uncommitted request")
        raise
