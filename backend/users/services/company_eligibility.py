import hashlib
import json
from contextlib import contextmanager
from datetime import timezone as datetime_timezone
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, connections
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyStatus,
)
from companies.services.authority_requests import _requester_principal
from offerings.models import Offering, OfferingStatus
from operators.models import Operator
from shared.constants import CURRENCY_AUD
from shared.db import atomic, current_alias, use_operator
from users.constants import ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING
from users.exceptions import CompanyEligibilityConflict
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityDecisionOutcome,
    CompanyEligibilityRequest,
    CompanyEligibilityRequestWithdrawal,
    CompanyEligibilityRevocation,
    InvestorClassification,
)
from users.models.investor_classification import (
    DECLARATION_TEXT,
    PRODUCT_VALUE_THRESHOLD_AUD,
    CertifierBody,
    InvestorCategory,
    InvestorClassificationStatus,
    plus_years,
)
from users.models.user_account import AccountRole
from users.services.investor_classification import require_evidence_retention_policy
from whitelist.models import WhitelistInvalidationCause


def _stamp(value):
    return value.astimezone(datetime_timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _digest(value):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT encode(sha256(convert_to(%s::jsonb::text, 'UTF8')), 'hex')", [json.dumps(value)])
        return cursor.fetchone()[0]


def _text_digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@contextmanager
def eligibility_operation(actor, operation, **command):
    if actor is None or not actor.is_authenticated:
        raise NotFound("Eligibility request not found.")
    values = {"operation": operation, "command": json.dumps(command, default=str)}
    with use_operator(), _requester_principal(actor.pk):
        command_connection = connections[current_alias()]
        with command_connection.cursor() as cursor:
            previous = {}
            for name, value in values.items():
                setting = f"app.company_eligibility_{name}"
                cursor.execute("SELECT current_setting(%s, true)", [setting])
                previous[setting] = cursor.fetchone()[0] or ""
                cursor.execute("SELECT set_config(%s, %s, false)", [setting, value])
        try:
            with atomic():
                yield
        finally:
            with command_connection.cursor() as cursor:
                for setting, value in previous.items():
                    cursor.execute("SELECT set_config(%s, %s, false)", [setting, value])


def _lock_context():
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT users_lock_company_eligibility_context()")
    require_evidence_retention_policy()
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT users_company_eligibility_certificate_time_zone()")
        if cursor.fetchone()[0] != settings.TIME_ZONE:
            raise ImproperlyConfigured("Certificate time-zone configuration changed; install its guard migration.")


@contextmanager
def eligibility_command(actor, operation, **command):
    try:
        with eligibility_operation(actor, operation, **command):
            yield
    except IntegrityError as error:
        if getattr(error.__cause__, "sqlstate", None) == "23514":
            raise CompanyEligibilityConflict() from error
        raise


def _require_actor(actor):
    if actor is None or not actor.is_authenticated:
        raise NotFound("Eligibility request not found.")


def _configuration():
    configuration = Operator.objects.filter(pk=1).first()
    if configuration is None:
        raise ImproperlyConfigured("Company eligibility configuration is missing.")
    return configuration


def _require_company_actor(actor, company_id, *, appointment=None, approve=False):
    identity_required = _configuration().issuer_kyc_required
    candidates = CompanyAppointment.objects.current_for(
        actor, company_id, at=timezone.now(), identity_required=identity_required
    )
    if appointment is not None:
        candidates = candidates.filter(pk=appointment)
    capabilities = [CompanyCapability.APPROVE] if approve else [CompanyCapability.PREPARE, CompanyCapability.APPROVE]
    if not any(set(row.capabilities) & set(capabilities) for row in candidates):
        raise NotFound("Eligibility request not found or company appointment no longer effective.")
    return candidates.get(pk=appointment) if appointment is not None else None


def company_eligibility_requests(actor, company_id):
    _require_actor(actor)
    with use_operator(), _requester_principal(actor.pk):
        _require_company_actor(actor, company_id)
        return CompanyEligibilityRequest.objects.filter(company_id=company_id).select_related(
            "decision__revocation", "withdrawal"
        )


def own_eligibility_requests(actor):
    _require_actor(actor)
    return CompanyEligibilityRequest.objects.filter(user_account__user_profile__user_id=actor.pk).select_related(
        "decision__revocation", "withdrawal"
    )


def _evidence_hash(source):
    manifest = []
    files = [(str(source.pk), source.evidence_file)]
    files.extend((str(row.pk), row.file) for row in source.supporting_documents.order_by("uuid"))
    for identifier, field in files:
        if not field:
            raise ValidationError("Retained evidence is unavailable.")
        digest = hashlib.sha256()
        try:
            with field.storage.open(field.name, "rb") as stored:
                for chunk in iter(lambda: stored.read(65536), b""):
                    digest.update(chunk)
        except (FileNotFoundError, OSError) as error:
            raise ValidationError("Retained evidence is unavailable.") from error
        manifest.append({"uuid": identifier, "sha256": digest.hexdigest()})
    return _digest(manifest)


def _source_fingerprint(source, evidence_hash):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT users_company_eligibility_metadata_digest(%s)", [source.pk])
        metadata = cursor.fetchone()[0]
    if metadata is None:
        raise NotFound("Eligibility evidence not found.")
    return _text_digest(f"{metadata}:{evidence_hash}")


def _offering_terms(offering):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute("SELECT users_company_eligibility_offering_terms(%s)::text", [offering.pk])
        return json.loads(cursor.fetchone()[0])


def _requirements(source, company, operator, *, at):
    problems = []
    account = source.user_account
    profile = account.user_profile
    actor = profile.user
    if (
        not actor.is_active
        or not actor.is_email_verified
        or account.account_status not in (ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_PENDING)
        or (operator.investor_kyc_required and account.account_status == ACCOUNT_STATUS_PENDING)
    ):
        problems.append("participant_account_inactive")
    if account.role not in (AccountRole.INVESTOR, AccountRole.BOTH):
        problems.append("participant_investor_account_required")
    if operator.investor_kyc_required and not profile.is_id_verified:
        problems.append("participant_identity_required")
    if company.status != CompanyStatus.ACTIVE:
        problems.append("company_inactive")
    if source.status not in (InvestorClassificationStatus.SUBMITTED, InvestorClassificationStatus.VERIFIED):
        problems.append("source_not_current")
    if source.expires_at is not None and source.expires_at <= at:
        problems.append("source_expired")
    if not source.declaration_accepted or source.declaration_text != DECLARATION_TEXT.get(source.category):
        problems.append("source_declaration_invalid")
    if source.submitted_at is None:
        problems.append("source_not_submitted")
    if source.evidence_horizon is not None and source.evidence_horizon <= at:
        problems.append("source_evidence_unavailable")
    if source.category == InvestorCategory.ASSOCIATED_PERSON and source.company_id != company.pk:
        problems.append("associated_company_mismatch")
    if source.category == InvestorCategory.ACCOUNTANT_CERTIFICATE:
        issued = source.certificate_issued_at
        if (
            issued is None
            or issued > timezone.localdate(at)
            or plus_years(issued) <= at
            or not source.certifier_name.strip()
            or source.certifier_body not in CertifierBody.values
            or not source.certifier_membership_number.strip()
        ):
            problems.append("certificate_not_current")
    return problems


def _source_expiry(source, requested):
    limits = [requested]
    if source.expires_at is not None:
        limits.append(source.expires_at)
    if source.category == InvestorCategory.ACCOUNTANT_CERTIFICATE and source.certificate_issued_at:
        limits.append(plus_years(source.certificate_issued_at))
    return min(limits)


def _request_preview(source, company, offering, quantity, requested_expires_at):
    at = timezone.now()
    requirements = _requirements(source, company, _configuration(), at=at)
    if requested_expires_at <= at:
        requirements.append("requested_expiry_not_future")
    summary = {
        "category": source.category,
        "declaration_text": source.declaration_text,
        "source": str(source.pk),
        "user_account": str(source.user_account_id),
        "company": str(company.pk),
        "submitted_at": _stamp(source.submitted_at) if source.submitted_at else None,
        "requested_expires_at": _stamp(requested_expires_at),
    }
    if source.category == InvestorCategory.ACCOUNTANT_CERTIFICATE:
        summary.update(
            certificate_issued_at=source.certificate_issued_at.isoformat() if source.certificate_issued_at else None,
            certifier_name=source.certifier_name,
            certifier_body=source.certifier_body,
            certifier_membership_number=source.certifier_membership_number,
        )
    if source.category == InvestorCategory.ASSOCIATED_PERSON:
        summary["associated_company"] = str(source.company_id) if source.company_id else None
    product = {}
    if source.category == InvestorCategory.PRODUCT_VALUE:
        if offering is None or isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise ValidationError("An exact offering and positive whole-share quantity are required.")
        amount = offering.price_per_share * quantity
        terms = _offering_terms(offering)
        product = {
            "offering": str(offering.pk),
            "token": str(offering.token_id),
            "quantity": quantity,
            "price_per_share": str(offering.price_per_share),
            "price_currency": offering.price_currency,
            "amount_aud": str(amount),
            "offering_terms": terms,
            "offering_terms_digest": _digest(terms),
        }
        summary.update(product)
        if (
            offering.status != OfferingStatus.APPROVED
            or offering.company_id != company.pk
            or offering.token.company_id != company.pk
            or offering.price_currency != CURRENCY_AUD
            or offering.price_per_share <= 0
            or amount < PRODUCT_VALUE_THRESHOLD_AUD
            or amount > Decimal("9999999999999999.99")
            or quantity > 2147483647
        ):
            requirements.append("product_context_invalid")
    elif offering is not None or quantity is not None:
        raise ValidationError("This category does not accept a product context.")
    evidence_hash = None
    fingerprint = None
    try:
        evidence_hash = _evidence_hash(source)
        fingerprint = _source_fingerprint(source, evidence_hash)
    except ValidationError:
        requirements.append("source_evidence_unavailable")
    facts = {
        "version": "1",
        "shared_summary": summary,
        "source_fingerprint": fingerprint,
        "evidence_hash": evidence_hash,
    }
    return {
        **facts,
        "preview_digest": _digest(facts),
        "unmet_requirements": sorted(set(requirements)),
        "can_submit": not requirements,
    }, product


def _request_context(actor, source_id, company_id, offering_id):
    source = get_object_or_404(
        InvestorClassification.objects.filter(user_account__user_profile__user_id=actor.pk), pk=source_id
    )
    offering = (
        get_object_or_404(Offering.objects.filter(status=OfferingStatus.APPROVED), pk=offering_id)
        if offering_id is not None
        else None
    )
    if source.category == InvestorCategory.PRODUCT_VALUE:
        if offering is None or company_id is not None:
            raise ValidationError("Select the exact offering for this product claim.")
        company_id = offering.company_id
    elif company_id is None or offering is not None:
        raise ValidationError("Select the exact company for this claim.")
    return source, get_object_or_404(Company.objects.active(), pk=company_id), offering


def preview_eligibility_request(*, actor, source, requested_expires_at, company=None, offering=None, quantity=None):
    _require_actor(actor)
    with use_operator(), _requester_principal(actor.pk), atomic():
        current, issuer, product = _request_context(actor, source, company, offering)
        with eligibility_command(actor, "preview", source=current.pk, company=issuer.pk, offering=offering):
            _lock_context()
            current.refresh_from_db()
            issuer.refresh_from_db()
            if product:
                product.refresh_from_db()
            if issuer.status != CompanyStatus.ACTIVE or (product and product.status != OfferingStatus.APPROVED):
                raise NotFound("Eligibility context not found.")
            return _request_preview(current, issuer, product, quantity, requested_expires_at)[0]


def _retained_request(actor, key, source, company, offering, quantity, requested_expires_at, preview_digest):
    prior = own_eligibility_requests(actor).filter(submitted_by=actor, idempotency_key=key).first()
    if prior and (
        prior.source_id != source
        or (offering is None and prior.company_id != company)
        or (offering is not None and company is not None)
        or prior.offering_id != offering
        or prior.quantity != quantity
        or prior.requested_expires_at != requested_expires_at
        or prior.digest != preview_digest
    ):
        raise CompanyEligibilityConflict()
    return prior


def submit_eligibility_request(
    *,
    actor,
    source,
    requested_expires_at,
    preview_digest,
    idempotency_key,
    sharing_accepted,
    declaration_accepted,
    company=None,
    offering=None,
    quantity=None,
):
    _require_actor(actor)
    if sharing_accepted is not True or declaration_accepted is not True:
        raise ValidationError("Confirm the exact declaration and sharing summary.")
    with use_operator(), _requester_principal(actor.pk), atomic(durable=True):
        prior = _retained_request(
            actor, idempotency_key, source, company, offering, quantity, requested_expires_at, preview_digest
        )
        if prior:
            return prior, False
        current, issuer, product = _request_context(actor, source, company, offering)
        command = {
            "source": current.pk,
            "company": issuer.pk,
            "offering": offering,
            "quantity": quantity,
            "requested_expires_at": _stamp(requested_expires_at),
            "preview_digest": preview_digest,
            "idempotency_key": idempotency_key,
        }
        with eligibility_command(actor, "submit", **command):
            _lock_context()
            prior = _retained_request(
                actor, idempotency_key, source, company, offering, quantity, requested_expires_at, preview_digest
            )
            if prior:
                return prior, False
            current.refresh_from_db()
            issuer.refresh_from_db()
            if product:
                product.refresh_from_db()
            if issuer.status != CompanyStatus.ACTIVE or (product and product.status != OfferingStatus.APPROVED):
                raise NotFound("Eligibility context not found.")
            preview, product_fields = _request_preview(current, issuer, product, quantity, requested_expires_at)
            if preview["preview_digest"] != preview_digest:
                raise CompanyEligibilityConflict()
            if preview["unmet_requirements"]:
                raise ValidationError({"unmet_requirements": preview["unmet_requirements"]})
            proposal = CompanyEligibilityRequest.objects.create(
                user_account=current.user_account,
                company=issuer,
                source=current,
                submitted_by=actor,
                idempotency_key=idempotency_key,
                category=current.category,
                shared_summary=preview["shared_summary"],
                source_fingerprint=preview["source_fingerprint"],
                evidence_hash=preview["evidence_hash"],
                digest=preview_digest,
                requested_expires_at=requested_expires_at,
                submitted_at=timezone.now(),
                sharing_accepted=True,
                declaration_accepted=True,
                **{
                    f"{key}_id" if key in ("offering", "token") else key: value for key, value in product_fields.items()
                },
            )
            proposal.refresh_from_db()
            return proposal, True


def _decision_preview(proposal, actor, appointment, outcome, expires_at, reason):
    selected = _require_company_actor(actor, proposal.company_id, appointment=appointment)
    at = timezone.now()
    requirements = []
    if CompanyCapability.APPROVE not in selected.capabilities:
        requirements.append("personal_approve_required")
    if getattr(proposal, "withdrawal", None) or getattr(proposal, "decision", None):
        requirements.append("request_already_resolved")
    if outcome == CompanyEligibilityDecisionOutcome.ACCEPTED:
        requirements.extend(_requirements(proposal.source, proposal.company, _configuration(), at=at))
        if (
            expires_at is None
            or expires_at <= at
            or expires_at > _source_expiry(proposal.source, proposal.requested_expires_at)
        ):
            requirements.append("decision_expiry_invalid")
        if reason:
            requirements.append("acceptance_reason_not_empty")
        try:
            evidence_hash = _evidence_hash(proposal.source)
            if (
                evidence_hash != proposal.evidence_hash
                or _source_fingerprint(proposal.source, evidence_hash) != proposal.source_fingerprint
            ):
                requirements.append("request_evidence_changed")
        except ValidationError:
            requirements.append("source_evidence_unavailable")
        if proposal.offering_id:
            product = proposal.offering
            if (
                product.status != OfferingStatus.APPROVED
                or product.company_id != proposal.company_id
                or product.token.company_id != proposal.company_id
                or _digest(_offering_terms(product)) != proposal.offering_terms_digest
            ):
                requirements.append("product_context_changed")
    elif outcome != CompanyEligibilityDecisionOutcome.REFUSED or expires_at is not None or not reason.strip():
        raise ValidationError("Refusal requires a reason and no expiry.")
    facts = {
        "request": str(proposal.pk),
        "request_digest": proposal.digest,
        "appointment": str(selected.pk),
        "actor": actor.pk,
        "outcome": outcome,
        "expires_at": _stamp(expires_at) if expires_at else None,
        "reason": reason,
        "issuer_identity_required": _configuration().issuer_kyc_required,
        "investor_identity_required": _configuration().investor_kyc_required,
    }
    return {
        "preview_digest": _digest(facts),
        "unmet_requirements": sorted(set(requirements)),
        "can_decide": not requirements,
    }


def preview_eligibility_decision(*, actor, request_id, company_id, appointment, outcome, expires_at=None, reason=""):
    with eligibility_command(
        actor, "decision-preview", request=request_id, company=company_id, appointment=appointment
    ), atomic():
        _lock_context()
        proposal = get_object_or_404(CompanyEligibilityRequest, pk=request_id, company_id=company_id)
        return _decision_preview(proposal, actor, appointment, outcome, expires_at, reason)


def _retained_decision(actor, key, proposal, appointment, outcome, expires_at, reason, digest):
    prior = CompanyEligibilityDecision.objects.filter(decided_by=actor, idempotency_key=key).first()
    if prior and (
        prior.request_id != proposal.pk
        or prior.appointment_id != appointment
        or prior.outcome != outcome
        or prior.expires_at != expires_at
        or prior.reason != reason
        or prior.digest != digest
    ):
        raise CompanyEligibilityConflict()
    return prior


def _retained_revocation(actor, key, decision, digest):
    prior = CompanyEligibilityRevocation.objects.filter(revoked_by=actor, idempotency_key=key).first()
    if prior and (prior.decision_id != decision.pk or prior.digest != digest):
        raise CompanyEligibilityConflict()
    return prior


def decide_eligibility_request(
    *,
    actor,
    request_id,
    company_id,
    appointment,
    outcome,
    preview_digest,
    idempotency_key,
    confirmation,
    expires_at=None,
    reason="",
):
    if confirmation is not True:
        raise ValidationError("Confirm the exact company decision.")
    with use_operator(), atomic(durable=True), eligibility_command(
        actor,
        "decide",
        request=request_id,
        company=company_id,
        appointment=appointment,
        outcome=outcome,
        expires_at=_stamp(expires_at) if expires_at else None,
        reason=reason,
        preview_digest=preview_digest,
        idempotency_key=idempotency_key,
        confirmation=confirmation,
    ):
        proposal = get_object_or_404(CompanyEligibilityRequest, pk=request_id, company_id=company_id)
        _require_company_actor(actor, company_id)
        prior = _retained_decision(
            actor, idempotency_key, proposal, appointment, outcome, expires_at, reason, preview_digest
        )
        if prior:
            return proposal
        _lock_context()
        proposal.refresh_from_db()
        _require_company_actor(actor, company_id)
        if _retained_decision(
            actor, idempotency_key, proposal, appointment, outcome, expires_at, reason, preview_digest
        ):
            return proposal
        _require_company_actor(actor, company_id, appointment=appointment, approve=True)
        preview = _decision_preview(proposal, actor, appointment, outcome, expires_at, reason)
        if preview["preview_digest"] != preview_digest:
            raise CompanyEligibilityConflict()
        if preview["unmet_requirements"]:
            raise ValidationError({"unmet_requirements": preview["unmet_requirements"]})
        CompanyEligibilityDecision.objects.create(
            request=proposal,
            decided_by=actor,
            appointment_id=appointment,
            idempotency_key=idempotency_key,
            request_digest=proposal.digest,
            digest=preview_digest,
            outcome=outcome,
            decided_at=timezone.now(),
            expires_at=expires_at,
            reason=reason,
        )
        proposal.refresh_from_db()
        return proposal


def withdraw_eligibility_request(*, actor, request_id, idempotency_key):
    from whitelist.services.refresh import enqueue_for_decision

    with use_operator(), atomic(durable=True), eligibility_command(
        actor, "withdraw", request=request_id, idempotency_key=idempotency_key
    ):
        _lock_context()
        proposal = get_object_or_404(own_eligibility_requests(actor), pk=request_id)
        digest = _digest({"request": str(proposal.pk), "request_digest": proposal.digest, "actor": actor.pk})
        prior = CompanyEligibilityRequestWithdrawal.objects.filter(
            withdrawn_by=actor, idempotency_key=idempotency_key
        ).first()
        if prior:
            if prior.request_id != proposal.pk or prior.digest != digest:
                raise CompanyEligibilityConflict()
            return proposal
        if getattr(proposal, "withdrawal", None):
            raise CompanyEligibilityConflict()
        decision = getattr(proposal, "decision", None)
        if decision and decision.outcome == CompanyEligibilityDecisionOutcome.REFUSED:
            raise ValidationError("A company refusal remains the retained outcome.")
        CompanyEligibilityRequestWithdrawal.objects.create(
            request=proposal,
            withdrawn_by=actor,
            idempotency_key=idempotency_key,
            digest=digest,
            withdrawn_at=timezone.now(),
        )
        proposal.refresh_from_db()
        if decision and decision.outcome == CompanyEligibilityDecisionOutcome.ACCEPTED:
            enqueue_for_decision(decision.pk, WhitelistInvalidationCause.REQUEST_WITHDRAWAL)
        return proposal


def revoke_eligibility_decision(*, actor, request_id, company_id, appointment, idempotency_key, reason):
    from whitelist.services.refresh import enqueue_for_decision

    if not reason.strip() or len(reason) > 500:
        raise ValidationError("A bounded revocation reason is required.")
    with use_operator(), atomic(durable=True), eligibility_command(
        actor,
        "revoke",
        request=request_id,
        company=company_id,
        appointment=appointment,
        idempotency_key=idempotency_key,
        reason=reason,
    ):
        proposal = get_object_or_404(CompanyEligibilityRequest, pk=request_id, company_id=company_id)
        _require_company_actor(actor, company_id)
        decision = getattr(proposal, "decision", None)
        if decision is None or decision.outcome != CompanyEligibilityDecisionOutcome.ACCEPTED:
            raise ValidationError("Only a retained acceptance can be revoked.")
        digest = _digest(
            {"decision": str(decision.pk), "actor": actor.pk, "appointment": str(appointment), "reason": reason}
        )
        prior = _retained_revocation(actor, idempotency_key, decision, digest)
        if prior:
            return proposal
        _lock_context()
        proposal.refresh_from_db()
        _require_company_actor(actor, company_id)
        if _retained_revocation(actor, idempotency_key, decision, digest):
            return proposal
        _require_company_actor(actor, company_id, appointment=appointment, approve=True)
        if getattr(decision, "revocation", None):
            raise CompanyEligibilityConflict()
        CompanyEligibilityRevocation.objects.create(
            decision=decision,
            revoked_by=actor,
            appointment_id=appointment,
            idempotency_key=idempotency_key,
            digest=digest,
            reason=reason,
            revoked_at=timezone.now(),
        )
        proposal.refresh_from_db()
        enqueue_for_decision(decision.pk, WhitelistInvalidationCause.COMPANY_REVOCATION)
        return proposal


def request_outcome(proposal):
    if getattr(proposal, "withdrawal", None):
        return "withdrawn"
    decision = getattr(proposal, "decision", None)
    if decision is None:
        return "pending"
    if getattr(decision, "revocation", None):
        return "revoked"
    if decision.outcome == CompanyEligibilityDecisionOutcome.ACCEPTED and decision.expires_at <= timezone.now():
        return "expired"
    return decision.outcome
