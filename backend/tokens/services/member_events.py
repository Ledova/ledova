from django.db.models import BooleanField, F, Func

from shared.tasks.queue import defer
from tokens.models import MemberAssociation


def _current(**lookup):
    return (
        MemberAssociation.objects.filter(current=True, **lookup)
        .alias(
            access_current=Func(
                F("uuid"), F("user_id"), function="tokens_member_association_current", output_field=BooleanField()
            )
        )
        .filter(access_current=True)
        .first()
    )


def _tell(association, title, body, data):
    from users.tasks.notifications import send_push_notification

    if association is None:
        return
    defer(
        send_push_notification,
        user_id=str(association.user_id),
        title=title,
        body=body,
        data={**data, "record": str(association.pk)},
        notification_type="general",
    )


def certificate_ready(request):
    _tell(
        _current(pk=request.association_id),
        "Certificate ready",
        f"{request.company.name} · {request.token.name}",
        {"type": "certificate", "event": "ready", "company": str(request.company_id)},
    )


def shares_vested(vesting):
    _tell(
        _current(company_id=vesting.company_id, member=vesting.award.member),
        "Shares vested",
        f"{vesting.company.name} · Employee award",
        {"type": "award", "event": "vested", "award": str(vesting.award_id)},
    )


def shares_issued(proposal):
    _tell(
        _current(company_id=proposal.company_id, member=proposal.member),
        "Shares issued",
        f"{proposal.company.name} · {proposal.token.name}",
        {"type": "holding", "event": "issued", "token": str(proposal.token_id)},
    )


def details_decided(change):
    if change.member_request_id is None:
        return
    applied = change.status == "applied"
    _tell(
        _current(pk=change.member_request.association_id),
        "Details changed" if applied else "Details change declined",
        f"{change.company.name} {'accepted' if applied else 'declined'} your change",
        {"type": "particulars", "event": change.status},
    )
