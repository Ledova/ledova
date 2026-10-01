from contextlib import contextmanager
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.utils import timezone

SYDNEY = ZoneInfo("Australia/Sydney")


def utc(moment):
    return moment.astimezone(dt_timezone.utc)


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
        self.today = utc(now).astimezone(SYDNEY).date()
        self.anchor = utc(datetime.combine(self.today, time.min, SYDNEY))

    def day(self, days_ago, hour=10, minute=0, second=0):
        if days_ago < 1:
            raise ValueError("A calendar day is at least one day before the anchor.")
        local = datetime.combine(self.today - timedelta(days=days_ago), time(hour, minute, second), SYDNEY)
        return utc(local)

    def days_before(self, moment):
        return (self.today - moment.astimezone(SYDNEY).date()).days
