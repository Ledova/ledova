from django.db import models


class PublicationRecipientQuerySet(models.QuerySet):
    def with_latest_payment_record(self):
        from shareholders.models.event import PAYMENT_RECORDS, PublicationEvent

        latest = PublicationEvent.objects.filter(recipient_id=models.OuterRef("pk"), kind__in=PAYMENT_RECORDS)
        return self.annotate(latest_payment_record=models.Subquery(latest.order_by("-sequence").values("kind")[:1]))
