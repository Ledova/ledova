from datetime import timedelta

from django.db import models
from django.utils import timezone

from shareholders.constants import RECENTLY_PUBLISHED_DAYS
from shareholders.models import (
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
    PublicationRecipient,
)


def summarise_for(user) -> dict:
    now = timezone.now()
    mine = PublicationRecipient.objects.filter(publication_id=models.OuterRef("pk"), user_id=user.pk)
    ballot = PublicationEvent.objects.filter(recipient_id=models.OuterRef("pk"), kind=PublicationEventKind.BALLOT)
    unrecorded = (
        mine.filter(entitlement__gt=0)
        .with_latest_payment_record()
        .filter(
            models.Q(latest_payment_record__isnull=True) | ~models.Q(latest_payment_record=PublicationEventKind.PAYMENT)
        )
    )
    voting = models.Q(
        models.Exists(mine.exclude(models.Exists(ballot))),
        kind=PublicationKind.RESOLUTION,
        opens_at__lte=now,
        closes_at__gt=now,
    )
    return Publication.objects.aggregate(
        open_resolutions=models.Count("pk", filter=voting),
        next_closes_at=models.Min("closes_at", filter=voting),
        published_since=models.Count(
            "pk",
            filter=models.Q(models.Exists(mine), created_at__gte=now - timedelta(days=RECENTLY_PUBLISHED_DAYS)),
        ),
        dividends_without_record=models.Count(
            "pk", filter=models.Q(models.Exists(unrecorded), kind=PublicationKind.DISTRIBUTION)
        ),
    )
