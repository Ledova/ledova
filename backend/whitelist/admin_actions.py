from uuid import uuid4

from django.contrib import messages
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.core import signing
from django.shortcuts import render
from rest_framework.exceptions import APIException

from whitelist.models import WhitelistAction, WhitelistChangeStatus
from whitelist.services.changes import submit

SALT = "whitelist-command-confirmation"


def confirm_changes(model_admin, request, queryset, entries, action, authority):
    selected = sorted(str(pk) for pk in queryset.values_list("pk", flat=True))
    terms = [
        {
            "entry": str(entry.pk),
            "address": entry.wallet_address,
            "label": entry.label,
            "status": entry.get_status_display(),
            "wallet": str(entry.wallet_id) if entry.wallet_id else None,
        }
        for entry in sorted(entries, key=lambda entry: str(entry.pk))
    ]
    expected = {
        "actor": str(request.user.pk),
        "authority": authority,
        "action": action,
        "selected": selected,
        "terms": [{key: term[key] for key in ("entry", "address", "wallet")} for term in terms],
    }
    if request.POST.get("confirm_whitelist") == "1":
        try:
            payload = signing.loads(request.POST.get("whitelist_confirmation", ""), salt=SALT)
            if {key: payload[key] for key in expected} != expected or len(payload["submissions"]) != len(terms):
                raise signing.BadSignature()
        except (signing.BadSignature, KeyError, TypeError):
            model_admin.message_user(
                request, "The whitelist confirmation no longer matches the selected work.", messages.ERROR
            )
            return None
        completed = 0
        pending = 0
        for term, submission_id in zip(terms, payload["submissions"]):
            try:
                change = submit(
                    submission_id,
                    action,
                    term["address"],
                    request.user,
                    authority=authority,
                    wallet_uuid=term["wallet"] if action == WhitelistAction.ADD else None,
                )
                if change.status in (WhitelistChangeStatus.CONFIRMED, WhitelistChangeStatus.UNCHANGED):
                    completed += 1
                elif change.status == WhitelistChangeStatus.FAILED:
                    model_admin.message_user(
                        request,
                        f"Whitelist submission {change.pk} failed. Submit a new change to try again.",
                        messages.ERROR,
                    )
                else:
                    pending += 1
            except APIException as exc:
                model_admin.message_user(request, str(exc.detail), messages.ERROR)
        if completed:
            model_admin.message_user(request, f"Completed {completed} whitelist change(s).", messages.SUCCESS)
        if pending:
            model_admin.message_user(
                request,
                f"{pending} accepted whitelist change(s) remain unresolved. Recovery will continue.",
                messages.WARNING,
            )
        return None
    payload = expected | {"submissions": [str(uuid4()) for _ in terms]}
    context = {
        **model_admin.admin_site.each_context(request),
        "opts": model_admin.model._meta,
        "title": "Confirm whitelist changes",
        "entries": terms,
        "change_action": action,
        "whitelist_confirmation": signing.dumps(payload, salt=SALT, compress=True),
        "selected": selected,
        "checkbox_name": ACTION_CHECKBOX_NAME,
        "admin_action": request.POST.get("action", ""),
    }
    return render(request, "admin/whitelist/confirm_changes.html", context)
