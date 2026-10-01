from contextlib import contextmanager
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone

AEST = dt_timezone(timedelta(hours=10), "AEST")


def utc(moment):
    return moment.astimezone(dt_timezone.utc)


def utc_midnight(moment):
    return utc(moment).replace(hour=0, minute=0, second=0, microsecond=0)


def nearest_midnight(moment):
    day = utc_midnight(moment)
    return day + timedelta(days=1) if utc(moment) - day > timedelta(hours=12) else day


@contextmanager
def frozen(moment):
    original = timezone.now
    pinned = utc(moment)
    timezone.now = lambda: pinned
    try:
        yield pinned
    finally:
        timezone.now = original


class Calendar:
    def __init__(self, now):
        self.today = utc(now).astimezone(AEST).date()
        self.anchor = utc(datetime.combine(self.today, time.min, AEST))

    def day(self, days_ago, hour=10, minute=0, second=0):
        if days_ago < 1:
            raise ValueError("A calendar day is at least one day before the anchor.")
        local = datetime.combine(self.today - timedelta(days=days_ago), time(hour, minute, second), AEST)
        return utc(local)
