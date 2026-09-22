from datetime import datetime
from uuid import UUID, uuid4

from django.contrib import messages
from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
from django.core import signing
from django.shortcuts import render
from django.utils import timezone
from rest_framework.exceptions import APIException

from companies.models import Company
from whitelist.models import WhitelistAction, WhitelistChangeStatus
from whitelist.services.changes import submit

SALT = "whitelist-command-confirmation"


def _chosen_company(request, fixed):
    try:
        chosen = UUID(fixed or request.POST.get("whitelist_company", ""))
    except ValueError:
        return None
    return Company.objects.filter(pk=chosen).first()


def _chosen_expiry(request, action):
    value = request.POST.get("whitelist_expires_at", "").strip()
    if action != WhitelistAction.ADD or not value:
        return None
    moment = datetime.fromisoformat(value)
    return moment if timezone.is_aware(moment) else timezone.make_aware(moment)


def confirm_changes(model_admin, request, queryset, entries, action, authority, company=None):
    selected = sorted(str(pk) for pk in queryset.values_list("pk", flat=True))
    fixed = str(company.pk) if company else None
    terms = [
        {
            "entry": str(entry.pk),
            "address": entry.wallet_address,
            "label": entry.label,
            "wallet": str(entry.wallet_id) if entry.wallet_id else None,
        }
        for entry in sorted(entries, key=lambda entry: str(entry.pk))
    ]
    expected = {
        "actor": str(request.user.pk),
        "authority": authority,
        "action": action,
        "company": fixed,
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
        chosen = _chosen_company(request, fixed)
        if chosen is None:
            model_admin.message_user(request, "Choose the company this whitelist change is for.", messages.ERROR)
            return None
        try:
            expires_at = _chosen_expiry(request, action)
        except ValueError:
            model_admin.message_user(request, "Enter the expiry as a date and time, or leave it blank.", messages.ERROR)
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
                    company=chosen,
                    expires_at=expires_at,
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
        "asks_for_expiry": action == WhitelistAction.ADD,
        "fixed_company": company,
        "companies": [] if company else Company.objects.order_by("name"),
        "whitelist_confirmation": signing.dumps(payload, salt=SALT, compress=True),
        "selected": selected,
        "checkbox_name": ACTION_CHECKBOX_NAME,
        "admin_action": request.POST.get("action", ""),
    }
    return render(request, "admin/whitelist/confirm_changes.html", context)
