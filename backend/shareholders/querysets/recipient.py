from django.db import models


class PublicationRecipientQuerySet(models.QuerySet):
    def with_latest_payment_record(self):
        from shareholders.models.event import PAYMENT_RECORDS, PublicationEvent

        latest = PublicationEvent.objects.filter(recipient_id=models.OuterRef("pk"), kind__in=PAYMENT_RECORDS)
        return self.annotate(latest_payment_record=models.Subquery(latest.order_by("-sequence").values("kind")[:1]))

    def awaiting_a_payment_record(self):
        from shareholders.models.event import PublicationEventKind

        return (
            self.with_latest_payment_record()
            .filter(entitlement__gt=0)
            .filter(
                models.Q(latest_payment_record__isnull=True)
                | models.Q(latest_payment_record=PublicationEventKind.PAYMENT_VOID)
            )
        )

    def with_a_payment_recorded(self):
        from shareholders.models.event import PublicationEventKind

        return self.with_latest_payment_record().filter(latest_payment_record=PublicationEventKind.PAYMENT)
