from datetime import timedelta

from django.utils import timezone

from companies.identity import officeholder_declaration
from companies.models import Company, CompanyStatus
from companies.services.company import register_company
from shared.db import atomic
from shared.seeds.synthetic.clock import frozen
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
    for step in sorted(plan.steps, key=lambda step: step.at):
        _transition(plan, step, seeded)
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


def _attest(company, plan, staff):
    company.declarant_name = plan.declarant_name
    company.board_resolution_reference = plan.board_resolution_reference
    company.officeholder_attested_by = staff
    company.officeholder_attested_at = timezone.now()
    company.officeholder_attestation = officeholder_declaration(company)
    company.lifecycle_revision += 1
    company.save(update_fields=list(ATTESTATION_FIELDS))


def _transition(plan, step, seeded):
    staff = seeded.users["operations"]
    company = Company.objects.get(acn=plan.acn)
    if step.method == "start_review":
        with atomic(), frozen(step.at):
            _historical_transition(company, status=CompanyStatus.REVIEW, review_started_at=timezone.now())
        return
    if step.method == "activate":
        with atomic(), frozen(step.at):
            company.operator_wallet = Wallet.objects.filter_by_address(plan.operator_wallet, chain="base").get(
                user_account__user_profile__user=company.owner
            )
            company.save(update_fields=["operator_wallet", "updated_at"])
        with atomic(), frozen(step.at + timedelta(seconds=5)):
            _historical_transition(company, status=CompanyStatus.ACTIVE, activated_at=timezone.now())
        return
    with atomic(), frozen(step.at):
        if step.method == "submit":
            _historical_transition(
                company,
                status=CompanyStatus.SUBMITTED,
                submitted_at=timezone.now(),
                submitted_by=seeded.users[plan.owner],
            )
        elif step.method == "request_info":
            _historical_transition(
                company,
                status=CompanyStatus.INFO_REQUIRED,
                info_requested_at=timezone.now(),
                info_request_reason=step.reason,
                additional_info_response="",
            )
        elif step.method == "resubmit":
            _historical_transition(
                company,
                status=CompanyStatus.SUBMITTED,
                submitted_at=timezone.now(),
                additional_info_response=step.reason,
            )
        elif step.method == "approve":
            _attest(company, plan, staff)
            _historical_transition(
                company,
                status=CompanyStatus.APPROVED,
                review_completed_at=timezone.now(),
                approved_at=timezone.now(),
                approved_by=staff,
                info_request_reason="",
                additional_info_response="",
            )


def _historical_transition(company, **fields):
    for name, value in fields.items():
        setattr(company, name, value)
    company.lifecycle_revision += 1
    company.save(update_fields=[*fields, "lifecycle_revision", "updated_at"])
