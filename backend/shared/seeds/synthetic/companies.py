from datetime import timedelta

from django.utils import timezone

from companies.identity import officeholder_declaration
from companies.models import (
    Company,
    CompanyRegistryCheck,
    CompanyStatus,
    DocumentType,
    RegistryCheckPurpose,
)
from companies.services.company import register_company
from companies.services.registry import (
    ABR_COMPANY_TYPES,
    begin_registry_check,
    complete_registry_check,
)
from integrations.abr.client import RegistryObservation
from shared.db import atomic
from shared.seeds.synthetic.clock import AEST, frozen
from shared.seeds.synthetic.identities import spaced_abn
from shared.seeds.synthetic.paper import acn_text, company_document, pdf, verified
from wallets.models import Wallet

ATTESTATION_FIELDS = (
    "declarant_name",
    "board_resolution_reference",
    "officeholder_attested_by",
    "officeholder_attested_at",
    "officeholder_attestation",
    "lifecycle_revision",
    "updated_at",
)


def apply_company(plan, seeded):
    company = _register(plan, seeded)
    seeded.companies[plan.key] = company
    records = {document.document_type: _upload(document, plan, company) for document in plan.documents}
    events = [(step.at, step, None) for step in plan.steps]
    events += [(document.verified_at, None, document) for document in plan.documents if document.verified_at]
    for at, step, document in sorted(events, key=lambda event: event[0]):
        if step:
            _transition(plan, step, records, seeded)
        else:
            verified(records[document.document_type], seeded.users["documents"], at=at)
    seeded.companies[plan.key] = Company.objects.get(pk=company.pk)
    return seeded.companies[plan.key]


def _details(plan):
    return {
        "trading_name": plan.trading_name,
        "company_type": plan.company_type,
        "abn": plan.abn,
        "phone": plan.phone,
        "address_line_1": plan.address_line_1,
        "address_line_2": plan.address_line_2,
        "city": plan.city,
        "state": plan.state,
        "postcode": plan.postcode,
        "country": "Australia",
        "description": plan.description,
        "industry": plan.industry,
        "founded_year": plan.founded_year,
    }


def _register(plan, seeded):
    if plan.existing:
        company = Company.objects.get(acn=plan.acn)
        Company.objects.filter(pk=company.pk).update(
            name=plan.name,
            status=CompanyStatus.DRAFT,
            lifecycle_revision=0,
            created_at=plan.registered_at,
            updated_at=plan.registered_at,
            **_details(plan),
        )
        return Company.objects.get(pk=company.pk)
    owner = seeded.users[plan.owner]
    first, _, last = seeded.plan.person(plan.owner).full_name.partition(" ")
    with atomic(), frozen(plan.registered_at):
        return register_company(owner, plan.name, plan.acn, {"first_name": first, "last_name": last}, **_details(plan))


def _upload(document, plan, company):
    label = DocumentType(document.document_type).label
    content = pdf(
        label,
        [
            plan.name,
            acn_text(plan.acn),
            f"ABN {spaced_abn(plan.abn)}",
            f"Document: {label}",
            f"Prepared: {document.uploaded_at:%d %B %Y}",
        ],
    )
    return company_document(
        company,
        document.document_type,
        document.name,
        content,
        at=document.uploaded_at,
        valid_from=document.valid_from,
    )


def _observation(plan, at):
    return RegistryObservation(
        acn=plan.acn,
        abn=plan.abn,
        entity_name=plan.name.upper(),
        entity_type=ABR_COMPANY_TYPES[plan.company_type],
        entity_status="Active",
        effective_from=plan.incorporated_on,
        retrieved_at=at.astimezone(AEST).isoformat(timespec="milliseconds"),
        register_updated_at=(at - timedelta(days=1)).date(),
    )


def _registry_check(company, purpose, plan, at, staff):
    with atomic(), frozen(at):
        check = begin_registry_check(company, purpose, staff)
    completed = at + timedelta(seconds=3)
    with frozen(completed):
        complete_registry_check(check, _observation(plan, completed))
    CompanyRegistryCheck.objects.filter(pk=check.pk).update(started_at=at)


def _attest(company, plan, staff):
    company.declarant_name = plan.declarant_name
    company.board_resolution_reference = plan.board_resolution_reference
    company.officeholder_attested_by = staff
    company.officeholder_attested_at = timezone.now()
    company.officeholder_attestation = officeholder_declaration(company)
    company.lifecycle_revision += 1
    company.save(update_fields=list(ATTESTATION_FIELDS))


def _transition(plan, step, records, seeded):
    staff = seeded.users["operations"]
    company = Company.objects.get(acn=plan.acn)
    if step.method == "start_review":
        with atomic(), frozen(step.at):
            company.start_review()
        _registry_check(company, RegistryCheckPurpose.REVIEW, plan, step.at + timedelta(seconds=1), staff)
        return
    if step.method == "activate":
        with atomic(), frozen(step.at):
            company.operator_wallet = Wallet.objects.filter_by_address(plan.operator_wallet, chain="base").get(
                user_account__user_profile__user=company.owner
            )
            company.is_open_to_investors = plan.open_to_investors
            company.save(update_fields=["operator_wallet", "is_open_to_investors", "updated_at"])
        _registry_check(company, RegistryCheckPurpose.ACTIVATION, plan, step.at, staff)
        company = Company.objects.get(pk=company.pk)
        with atomic(), frozen(step.at + timedelta(seconds=5)):
            company.activate()
        return
    with atomic(), frozen(step.at):
        if step.method == "submit":
            company.submit(submitted_by=seeded.users[plan.owner])
        elif step.method == "request_info":
            company.request_info(step.reason)
            for document in plan.documents:
                if document.rejection_reason:
                    record = records[document.document_type]
                    record.rejection_reason = document.rejection_reason
                    record.save(update_fields=["rejection_reason", "updated_at"])
        elif step.method == "resubmit":
            company.resubmit(step.reason)
        elif step.method == "approve":
            _attest(company, plan, staff)
            company.approve(approved_by=staff)
