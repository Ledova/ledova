import re
from datetime import date, datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.utils import timezone

RIGHTS_TYPES = {
    "voting": ("not_recorded", "general", "conditional", "no_general_vote", "custom"),
    "dividends": ("not_recorded", "participating", "preferential", "none", "custom"),
    "capital": ("not_recorded", "residual", "preferential", "custom"),
    "transfers": ("not_recorded", "restricted", "no_class_restrictions", "custom"),
    "conversion": ("not_recorded", "convertible", "none", "custom"),
    "redemption": ("not_recorded", "redeemable", "not_redeemable", "custom"),
}
RIGHTS_FIELDS = {
    "voting": {"votes_per_share": "positive"},
    "dividends": {
        "rate": "decimal",
        "amount": "decimal",
        "basis": 255,
        "currency": "currency",
        "cumulative": ("not_recorded", "cumulative", "non_cumulative"),
    },
    "capital": {
        "multiple": "positive",
        "amount": "decimal",
        "basis": 255,
        "currency": "currency",
        "ranking": 255,
        "participation": ("not_recorded", "non_participating", "participating", "capped"),
        "cap": 255,
    },
    "transfers": {"board_consent": "boolean", "pre_emption": "boolean"},
    "conversion": {"target_class": 255, "ratio": "positive"},
    "redemption": {"trigger": ("company", "holder", "event", "custom")},
}
RIGHTS_DECIMAL = r"(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,8})?"


def validate_class_rights_attributes(value):
    if not isinstance(value, dict) or set(value) - set(RIGHTS_TYPES):
        raise ValidationError("Choose only the supported class-rights groups.")
    for group, fields in value.items():
        allowed = {"type": RIGHTS_TYPES[group], "conditions": 2000, **RIGHTS_FIELDS[group]}
        if not isinstance(fields, dict) or set(fields) - set(allowed) or fields.get("type") not in RIGHTS_TYPES[group]:
            raise ValidationError(f"Choose supported {group} terms and a recorded type.")
        for key, item in fields.items():
            rule = allowed[key]
            if isinstance(rule, tuple):
                valid = isinstance(item, str) and item in rule
            elif isinstance(rule, int):
                valid = isinstance(item, str) and len(item) <= rule
            elif rule == "boolean":
                valid = isinstance(item, bool)
            elif rule == "currency":
                valid = isinstance(item, str) and re.fullmatch(r"[A-Z]{3}", item) is not None
            else:
                valid = isinstance(item, str) and re.fullmatch(RIGHTS_DECIMAL, item) is not None
                if valid and rule == "positive":
                    valid = Decimal(item) > 0
            if not valid:
                raise ValidationError(f"Check the recorded {group} {key.replace('_', ' ')}.")
        if fields["type"] == "not_recorded" and set(fields) != {"type"}:
            raise ValidationError(f"Leave {group} details blank when its terms are not recorded.")
        detail_free = {
            "voting": {"no_general_vote"},
            "dividends": {"none", "participating"},
            "capital": {"residual"},
            "transfers": {"no_class_restrictions"},
            "conversion": {"none"},
            "redemption": {"not_redeemable"},
        }
        if (fields["type"] == "custom" or fields["type"] in detail_free[group]) and set(fields) - {
            "type",
            "conditions",
        }:
            raise ValidationError(f"Record only conditions for the selected {group} type.")
        if group == "conversion" and "ratio" in fields and not fields.get("target_class", "").strip():
            raise ValidationError("Record the target class for the conversion ratio.")
        if "basis" in fields and not any(key in fields for key in ("rate", "amount", "multiple")):
            raise ValidationError(f"Record a rate, amount or multiple for the {group} basis.")
        if "currency" in fields and "amount" not in fields:
            raise ValidationError(f"Record an amount for the {group} currency.")
        if group == "capital" and "cap" in fields and fields.get("participation") != "capped":
            raise ValidationError("Choose capped participation before recording its cap.")
        if any(key in fields for key in ("rate", "amount", "multiple")) and not fields.get("basis", "").strip():
            raise ValidationError(f"Record the basis for the {group} rate, amount or multiple.")
        if "amount" in fields and "currency" not in fields:
            raise ValidationError(f"Record the currency for the {group} amount.")
        if "rate" in fields and "amount" in fields:
            raise ValidationError("Choose a dividend rate or amount; record any combined terms in Additional terms.")
        if "multiple" in fields and "amount" in fields:
            raise ValidationError("Choose a capital multiple or amount; record any combined terms in Additional terms.")
        if group == "capital" and fields.get("participation") == "capped" and not fields.get("cap", "").strip():
            raise ValidationError("Record the capital participation cap.")


def validate_class_rights_effective_date(value):
    if value is not None and (not isinstance(value, date) or isinstance(value, datetime)):
        raise ValidationError("Record a date when the terms took effect, or leave it unknown.")
    if value is not None and value > timezone.now().date():
        raise ValidationError("Record terms already in effect; future activation is not supported.")
