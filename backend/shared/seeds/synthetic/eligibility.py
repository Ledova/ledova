from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from django.conf import settings
from django.db import connections
from django.db.models import Q
from django.utils import timezone

from companies.models import (
    CompanyAppointment,
    CompanyCapability,
    CompanyLegacyOwnerSource,
)
from companies.services.authority import DECLARATION_VERSION
from companies.services.authority_requests import _requester_principal
from companies.services.team import accept_team_invitation, issue_team_invitation
from operators.models import Operator
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.seeds.synthetic.chain.population import _synthetic_accounts, companies
from users.models import InvestorClassification, InvestorClassificationStatus
from users.models.company_eligibility import CompanyEligibilityDecisionOutcome
from users.models.investor_classification import InvestorCategory, plus_years
from users.models.user_account import AccountRole
from users.services.company_eligibility import (
    decide_eligibility_request,
    preview_eligibility_decision,
    preview_eligibility_request,
    submit_eligibility_request,
)
from users.services.company_eligibility_consumption import company_eligibility

OWNER_PROVENANCE = "synthetic historical company owner"
DECISION_DAYS = 90


def seed_key(operation, *identifiers):
    return uuid5(
        NAMESPACE_URL, "/".join(str(value) for value in ("ledova/synthetic/eligibility", operation, *identifiers))
    )


def historical_owner_appointment(company):
    with use_migrate(), atomic(durable=True):
        existing = (
            CompanyAppointment.objects.filter(company=company, appointee=company.owner)
            .filter(Q(request__isnull=False) | Q(legacy_owner__isnull=False))
            .first()
        )
        if existing is not None:
            return existing
        selected_db = connections[current_alias()]
        with selected_db.cursor() as cursor:
            cursor.execute("SELECT current_user")
            if cursor.fetchone()[0] != settings.RLS_ROLES["migrate"]:
                raise RuntimeError("Synthetic historical owner sources require the configured migration role.")
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(
                "ALTER TABLE companies_companylegacyownersource DISABLE TRIGGER companies_legacy_owner_source_identity"
            )
            cursor.execute(
                "ALTER TABLE companies_companyappointment DISABLE TRIGGER companies_initial_appointment_identity"
            )
        try:
            with atomic():
                profile = company.owner.userprofile
                source = CompanyLegacyOwnerSource.objects.create(
                    company=company,
                    owner=company.owner,
                    owner_profile=profile,
                    provenance=OWNER_PROVENANCE,
                )
                appointment = CompanyAppointment.objects.create(
                    company=company,
                    appointee=company.owner,
                    appointee_profile=profile,
                    legacy_owner=source,
                    capabilities=[CompanyCapability.ADMIN],
                    delegatable_capabilities=sorted(CompanyCapability.values),
                )
                with selected_db.cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        finally:
            with selected_db.cursor() as cursor:
                cursor.execute(
                    "ALTER TABLE companies_companylegacyownersource "
                    "ENABLE TRIGGER companies_legacy_owner_source_identity"
                )
                cursor.execute(
                    "ALTER TABLE companies_companyappointment ENABLE TRIGGER companies_initial_appointment_identity"
                )
        return appointment


def company_approver(company, actor):
    initial = historical_owner_appointment(company)
    with use_operator(), _requester_principal(actor.pk):
        current = (
            CompanyAppointment.objects.current_for(
                actor, company.pk, at=timezone.now(), identity_required=Operator.get().issuer_kyc_required
            )
            .filter(capabilities__contains=[CompanyCapability.PREPARE, CompanyCapability.APPROVE])
            .first()
        )
        if current is not None:
            return current
    _, code, created = issue_team_invitation(
        requester=company.owner,
        company_id=company.pk,
        inviter_appointment_id=initial.pk,
        idempotency_key=seed_key("appointment", company.pk, actor.pk),
        capabilities=[CompanyCapability.PREPARE, CompanyCapability.APPROVE],
    )
    if not created:
        raise RuntimeError("The synthetic invitation has no retained accepted appointment.")
    return accept_team_invitation(
        requester=actor,
        code=code,
        declaration_version=DECLARATION_VERSION,
        accept_declaration=True,
    )


def accept_source(source, company, approver, appointment, *, offering=None, quantity=None):
    holder = source.user_account.user_profile.user
    context = {"offering": offering.pk, "quantity": quantity} if offering is not None else {"company": company.pk}
    expires_at = min(
        limit
        for limit in (
            timezone.now() + timedelta(days=DECISION_DAYS),
            source.expires_at,
            (
                plus_years(source.certificate_issued_at)
                if source.category == InvestorCategory.ACCOUNTANT_CERTIFICATE and source.certificate_issued_at
                else None
            ),
        )
        if limit is not None
    )
    terms = {"actor": holder, "source": source.pk, "requested_expires_at": expires_at, **context}
    preview = preview_eligibility_request(**terms)
    if not preview["can_submit"]:
        return None
    request, _ = submit_eligibility_request(
        **terms,
        preview_digest=preview["preview_digest"],
        idempotency_key=seed_key("request", source.pk, company.pk, offering.pk if offering else "general", quantity),
        sharing_accepted=True,
        declaration_accepted=True,
    )
    terms = {
        "actor": approver,
        "request_id": request.pk,
        "company_id": company.pk,
        "appointment": appointment.pk,
        "outcome": CompanyEligibilityDecisionOutcome.ACCEPTED,
        "expires_at": expires_at,
    }
    preview = preview_eligibility_decision(**terms)
    if preview["unmet_requirements"]:
        raise RuntimeError("The synthetic company decision no longer has current authority or evidence.")
    decide_eligibility_request(
        **terms,
        preview_digest=preview["preview_digest"],
        idempotency_key=seed_key("decision", request.pk),
        confirmation=True,
    )
    with use_operator():
        return request.decision


def seed_company_eligibility():
    with use_operator():
        found = [company for company in companies().values() if company.can_issue_tokens]
        accounts = list(_synthetic_accounts())
        actors = [
            account.user_profile.user
            for account in accounts
            if account.role == AccountRole.COMPANY
            and account.user_profile.user.is_active
            and account.user_profile.user.is_email_verified
            and account.user_profile.is_id_verified
            and account.account_status == "active"
        ]
    decisions = []
    for company in found:
        actor = next((actor for actor in actors if actor.pk != company.owner_id), None)
        if actor is None:
            raise RuntimeError("A synthetic company needs another current nonstaff founder to accept its P/A mandate.")
        appointment = company_approver(company, actor)
        for account in accounts:
            if account.role not in (AccountRole.INVESTOR, AccountRole.BOTH):
                continue
            holder = account.user_profile.user
            with use_operator(), _requester_principal(holder.pk):
                if company_eligibility(account, company, purpose="primary").is_eligible:
                    continue
                sources = list(
                    InvestorClassification.objects.filter(
                        user_account=account,
                        status__in=[InvestorClassificationStatus.SUBMITTED, InvestorClassificationStatus.VERIFIED],
                    )
                    .exclude(category=InvestorCategory.PRODUCT_VALUE)
                    .filter(Q(company=None) | Q(company=company))
                    .select_related("user_account__user_profile__user")
                    .order_by("submitted_at", "uuid")
                )
            for source in sources:
                decision = accept_source(source, company, actor, appointment)
                if decision is not None:
                    decisions.append(decision)
                    break
    return decisions
