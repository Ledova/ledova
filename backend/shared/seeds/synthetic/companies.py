from datetime import timedelta

from django.utils import timezone

from companies.models import Company, CompanyStatus
from companies.services.company import register_company
from shared.db import atomic
from shared.seeds.synthetic.clock import frozen
from wallets.models import Wallet


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


def _transition(plan, step, seeded):
    company = Company.objects.get(acn=plan.acn)
    if step.method == "activate":
        with atomic(), frozen(step.at):
            company.operator_wallet = Wallet.objects.filter_by_address(plan.operator_wallet, chain="base").get(
                user_account__user_profile__user=company.owner
            )
            company.save(update_fields=["operator_wallet", "updated_at"])
        with atomic(), frozen(step.at + timedelta(seconds=5)):
            _historical_transition(company, status=CompanyStatus.ACTIVE, activated_at=timezone.now())


def _historical_transition(company, **fields):
    for name, value in fields.items():
        setattr(company, name, value)
    company.lifecycle_revision += 1
    company.save(update_fields=[*fields, "lifecycle_revision", "updated_at"])
