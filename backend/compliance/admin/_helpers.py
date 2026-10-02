from django.utils.html import format_html

GREEN = "#28a745"
YELLOW = "#ffc107"
ORANGE = "#fd7e14"
RED = "#dc3545"
GREY = "#6c757d"
TEAL = "#17a2b8"

SEVERITY_COLOURS = {"low": GREEN, "medium": YELLOW, "high": ORANGE, "critical": RED}


def badge(text, colour, title=""):
    return format_html(
        '<span title="{}" style="background-color: {}; color: white; padding: 2px 8px; '
        'border-radius: 4px; font-size: 11px;">{}</span>',
        title,
        colour,
        text,
    )


def choice_badge(value, colours):
    if not value:
        return "-"
    return badge(value.upper().replace("_", " "), colours.get(value, GREY))


def short_hex(value, head=10, tail=8):
    return f"{value[:head]}...{value[-tail:]}" if value else "-"
