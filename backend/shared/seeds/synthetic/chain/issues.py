from datetime import timedelta

from shared.db import atomic
from shared.seeds.synthetic.chain.classes import ChainStepFailed
from shared.seeds.synthetic.chain.registers import (
    instruct,
    reference_prefix,
    request_item,
)
from shared.seeds.synthetic.clock import frozen
from shared.seeds.synthetic.paper import authority
from tokens.models import IssuanceType, RequestStatus, ShareToken
from tokens.services import issuance_execution, share_token_service

NOT_EXECUTED = "Issuance request {request} for {shares} {symbol} ended {status}: {results}"


def execute_request(request, records):
    staff = records.operations
    confirmed = issuance_execution.confirmation(request, staff)
    issuance_execution.admit(request, staff, confirmed=confirmed)
    results = records.run()
    request.refresh_from_db()
    if request.status != RequestStatus.EXECUTED:
        raise ChainStepFailed(
            NOT_EXECUTED.format(
                request=request.pk,
                shares=request.amount,
                symbol=request.token.symbol,
                status=request.status,
                results=results,
            )
        )
    return request


def mint_positions(share_class, records):
    token = ShareToken.objects.select_related("company").get(pk=records.classes[share_class.key].pk)
    founder = token.company.owner
    requests = [
        share_token_service.create_issuance_request(
            token,
            position.address,
            position.shares,
            founder,
            reason=f"{position.reason}, entered in the company's register on {position.entered_on:%d %B %Y}.",
            issuance_type=IssuanceType.INITIAL if position.initial else IssuanceType.ADDITIONAL,
        )
        for position in share_class.positions
    ]
    if not requests:
        return []
    document = authority(
        records.companies[share_class.company],
        f"issue-{share_class.symbol.lower()}",
        f"issue of the {share_class.symbol} shares already on the register",
        [
            f"The directors resolved to issue on chain the {share_class.name} the register already records,",
            "to each member's wallet, so that the register can be kept on the platform.",
        ],
        records.documents,
    )
    instruct(
        token,
        [request_item(request) for request in requests],
        document,
        records,
        reference=f"{reference_prefix(token)}-ISS-{share_class.symbol}",
        reason="Issue on chain the shares the company's register already records.",
    )
    return [execute_request(request, records) for request in requests]


def apply_request(item, records):
    token = ShareToken.objects.select_related("company").get(pk=records.classes[item.share_class].pk)
    staff = records.operations
    with atomic(), frozen(item.submitted_at):
        request = share_token_service.create_issuance_request(
            token, item.address, item.shares, token.company.owner, reason=item.reason
        )
    if item.review_at:
        with atomic(), frozen(item.review_at):
            request.start_review(staff)
    if item.status == "rejected":
        with atomic(), frozen(item.decided_at):
            request.reject(staff, item.decision)
    elif item.status in ("approved", "executed"):
        document = authority(
            records.companies[item.share_class.split("/")[0]],
            f"issue-{item.key}",
            f"issue of {item.shares:,} {token.symbol} shares",
            [item.reason, f"The directors resolved to issue {item.shares:,} {token.name} to {item.address}."],
            records.documents,
            at=item.decided_at - timedelta(hours=3),
        )
        instruct(
            token,
            [request_item(request)],
            document,
            records,
            reference=f"{reference_prefix(token)}-ISS-{item.key.upper()}",
            reason=item.reason,
            at=item.decided_at,
        )
    if item.status == "executed":
        execute_request(request, records)
    request.refresh_from_db()
    return request
