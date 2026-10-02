from django.urls import reverse
from django.utils.html import format_html, format_html_join

BUTTON_STYLE = (
    "display: inline-block; padding: 6px 12px; margin: 2px; "
    "text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: bold;"
)


def _button(label, url, background, text="white"):
    style = f"{BUTTON_STYLE} background-color: {background}; color: {text};"
    if url:
        return format_html('<a href="{}" style="{}">{}</a>', url, style, label)
    return format_html('<span style="{}">{}</span>', style, label)


def action_buttons(items):
    if not items:
        return "-"
    return format_html_join(" ", "{}", ((_button(*item),) for item in items))


def admin_link(obj, label=None):
    if obj is None:
        return "-"
    url = reverse(f"admin:{obj._meta.app_label}_{obj._meta.model_name}_change", args=[obj.pk])
    return format_html('<a href="{}">{}</a>', url, str(obj)[:50] if label is None else label)
