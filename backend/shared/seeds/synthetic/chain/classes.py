from uuid import uuid4

from shared.db import atomic
from shared.seeds.synthetic.authority import historical_owner_appointment
from shared.seeds.synthetic.clock import frozen
from tokens.models import (
    CapitalIncreaseRequest,
    PauseChangeStatus,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services import capital_execution, pause_changes
from tokens.services.capital_increase import submit_capital_increase
from tokens.services.register_deployments import (
    decide_deployment,
    prepare_deployment,
    preview_deployment_decision,
)

NOT_DEPLOYED = "{symbol} of {company} did not reach the deployed state: {status}."
NOT_EXECUTED = "{label} did not execute on the chain: {status}."
NOT_PAUSED = "{symbol} of {company} did not pause: {status}."


class ChainStepFailed(RuntimeError):
    pass


def create_class(share_class, records):
    company = records.companies[share_class.company]
    token = ShareToken.objects.filter(company=company, symbol=share_class.symbol).first()
    if token is None:
        with atomic(), frozen(share_class.created_at):
            token = ShareToken.objects.create(
                company=company,
                symbol=share_class.symbol,
                name=share_class.name,
                token_type=share_class.kind,
                total_supply=str(share_class.authorised),
                status=ShareTokenStatus.DRAFT,
            )
    elif token.status == ShareTokenStatus.DRAFT:
        ShareToken.objects.filter(pk=token.pk).update(
            name=share_class.name,
            token_type=share_class.kind,
            total_supply=str(share_class.authorised),
            created_at=share_class.created_at,
            updated_at=share_class.created_at,
        )
        token.refresh_from_db()
    records.classes[share_class.key] = token
    return token


def deploy(share_class, records):
    token = records.classes[share_class.key]
    actor = records.owner(share_class.company)
    appointment = historical_owner_appointment(token.company)
    proposal = prepare_deployment(actor=actor, operation_id=uuid4(), appointment=appointment.pk, token=token.pk)
    for kind in ("approve", "apply"):
        _, preview = preview_deployment_decision(
            actor=actor, deployment_id=proposal.pk, appointment=appointment.pk, kind=kind
        )
        decide_deployment(
            actor=actor,
            deployment_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
    records.run()
    token.refresh_from_db()
    if token.status != ShareTokenStatus.DEPLOYED or not token.contract_address:
        raise ChainStepFailed(NOT_DEPLOYED.format(symbol=token.symbol, company=token.company.name, status=token.status))
    records.classes[share_class.key] = token
    return token


def pause(share_class, records):
    token = ShareToken.objects.get(pk=records.classes[share_class.key].pk)
    change = pause_changes.submit(token, records.owner(share_class.company), uuid4(), True)
    records.run()
    change.refresh_from_db()
    token.refresh_from_db()
    if change.status not in (PauseChangeStatus.CONFIRMED, PauseChangeStatus.OBSERVED) or not token.status == "paused":
        raise ChainStepFailed(NOT_PAUSED.format(symbol=token.symbol, company=token.company.name, status=change.status))
    records.classes[share_class.key] = token
    return token


def apply_raise(item, records):
    token = ShareToken.objects.get(pk=records.classes[item.share_class].pk)
    founder = records.owner(token_company_key(item.share_class))
    staff = records.operations
    with atomic(), frozen(item.created_at):
        request = CapitalIncreaseRequest.objects.create(
            token=token,
            additional_shares=item.additional,
            new_authorized_total=item.new_total,
            purpose=item.purpose,
            board_resolution_reference=item.board_reference,
        )
    if item.submitted_at:
        with frozen(item.submitted_at):
            submit_capital_increase(request, founder)
    if item.status == "rejected":
        with atomic(), frozen(item.decided_at):
            request.reject(staff, item.decision)
    elif item.status == "executed":
        with atomic(), frozen(item.decided_at):
            request.approve(staff, "Board resolution and shareholder approval checked.")
        confirmed = capital_execution.confirmation(request, staff)
        capital_execution.admit(request, staff, confirmed=confirmed)
        records.run()
        request.refresh_from_db()
        if request.status != "executed":
            raise ChainStepFailed(NOT_EXECUTED.format(label=f"Capital increase {item.key}", status=request.status))
        records.classes[item.share_class] = ShareToken.objects.get(pk=token.pk)
    return request


def token_company_key(class_key):
    return class_key.split("/")[0]
