import re
import unicodedata

from django import template
from django.utils.safestring import mark_safe

register = template.Library()

LINE_BREAKING = ("Cc", "Zl", "Zp")
STRUCTURE = re.compile(r"([\\`*_{}\[\]<>#|&!~])")
LIST_MARKER = re.compile(r"^(\d{1,9}(?=[.)])|(?=[-+]))")


@register.filter
def md(value):
    text = "".join(" " if unicodedata.category(character) in LINE_BREAKING else character for character in str(value))
    return mark_safe(LIST_MARKER.sub(r"\1\\", STRUCTURE.sub(r"\\\1", text.strip()), count=1))
