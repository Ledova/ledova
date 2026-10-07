from unittest.mock import patch
from uuid import uuid4

from ledova_backend.procrastinate_app import app
from shared.db import atomic
from shared.seeds.synthetic.authority import historical_owner_appointment
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.identities import slug
from shared.seeds.synthetic.paper import acn_text, pdf
from tokens.models import (
    CapitalIncreaseRequest,
    PauseChange,
    PauseChangeStatus,
    RegisterEvidenceKind,
    ShareToken,
    ShareTokenStatus,
)
from tokens.services.register_capital_increases import (
    decide_capital_increase,
    prepare_capital_increase,
    preview_capital_increase_decision,
)
from tokens.services.register_deployments import (
    decide_deployment,
    prepare_deployment,
    preview_deployment_decision,
)
from tokens.services.register_evidence import retain_register_evidence
from tokens.services.register_pause_changes import (
    decide_pause_change,
    prepare_pause_change,
    preview_pause_change_decision,
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
    actor = records.owner(share_class.company)
    appointment = historical_owner_appointment(token.company)
    reference = f"PAUSE-{slug(share_class.key)}"
    raw = pdf(
        f"Company instruction: pause transfers of {token.name}",
        [
            token.company.name,
            acn_text(token.company.acn),
            reference,
            "The company instructs the existing share contract to pause transfers.",
        ],
    )
    evidence, _ = retain_register_evidence(
        actor=actor,
        company_id=token.company_id,
        appointment=appointment.pk,
        kind=RegisterEvidenceKind.AUTHORITY,
        idempotency_key=uuid4(),
        name=f"pause-{slug(share_class.key)}.pdf",
        raw=raw,
        mime_type="application/pdf",
    )
    proposal = prepare_pause_change(
        actor=actor,
        operation_id=uuid4(),
        appointment=appointment.pk,
        token=token.pk,
        paused=True,
        reason="The company directs a pause of share transfers",
        authority_reference=reference,
        authority_evidence=evidence.pk,
    )
    for kind in ("approve", "apply"):
        _, preview = preview_pause_change_decision(
            actor=actor, pause_change_id=proposal.pk, appointment=appointment.pk, kind=kind
        )
        with patch("tokens.services.pause_changes.App", return_value=app):
            proposal = decide_pause_change(
                actor=actor,
                pause_change_id=proposal.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
            )
    change = PauseChange.objects.get(pk=proposal.pk)
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
    if not item.submitted_at:
        with atomic(), frozen(item.created_at):
            return CapitalIncreaseRequest.objects.create(
                token=token,
                additional_shares=item.additional,
                new_authorized_total=item.new_total,
                purpose=item.purpose,
                board_resolution_reference=item.board_reference,
            )
    appointment = historical_owner_appointment(token.company)
    raw = pdf(
        f"Directors' resolution: the authorised share cap of {token.name}",
        [
            token.company.name,
            acn_text(token.company.acn),
            item.purpose,
            item.board_reference,
            f"Resolution date provided by the company: {item.created_at.date().isoformat()}",
            f"Raise the authorised share cap to {item.new_total} whole shares.",
        ],
    )
    evidence, _ = retain_register_evidence(
        actor=founder,
        company_id=token.company_id,
        appointment=appointment.pk,
        kind=RegisterEvidenceKind.AUTHORITY,
        idempotency_key=uuid4(),
        name=f"capital-{slug(item.key)}.pdf",
        raw=raw,
        mime_type="application/pdf",
    )
    proposal = prepare_capital_increase(
        actor=founder,
        operation_id=uuid4(),
        appointment=appointment.pk,
        token=token.pk,
        additional_shares=item.additional,
        new_authorized_total=item.new_total,
        purpose=item.purpose,
        board_resolution_reference=item.board_reference,
        authority_evidence=evidence.pk,
    )
    kinds = ("reject",) if item.status == "rejected" else ("approve", "apply") if item.status == "executed" else ()
    for kind in kinds:
        reason = item.decision if kind == "reject" else ""
        _, preview = preview_capital_increase_decision(
            actor=founder, capital_increase_id=proposal.pk, appointment=appointment.pk, kind=kind, reason=reason
        )
        with patch("tokens.services.capital_execution.App", return_value=app):
            proposal = decide_capital_increase(
                actor=founder,
                capital_increase_id=proposal.pk,
                appointment=appointment.pk,
                kind=kind,
                idempotency_key=uuid4(),
                preview_digest=preview["preview_digest"],
                confirmation=True,
                reason=reason,
            )
    request = proposal.request
    if item.status == "executed":
        records.run()
        request.refresh_from_db()
        if request.status != "executed":
            raise ChainStepFailed(NOT_EXECUTED.format(label=f"Capital increase {item.key}", status=request.status))
        records.classes[item.share_class] = ShareToken.objects.get(pk=token.pk)
    return request


def token_company_key(class_key):
    return class_key.split("/")[0]
