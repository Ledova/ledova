from decimal import Decimal

from django.db import models
from django.db.models.functions import Coalesce


class PublicationQuerySet(models.QuerySet):
    def addressed_to(self, user_id):
        from shareholders.models.recipient import PublicationRecipient

        return self.filter(
            models.Exists(PublicationRecipient.objects.filter(publication_id=models.OuterRef("pk"), user_id=user_id))
        )

    def seen_by(self, user_id):
        from shareholders.models.event import (
            PAYMENT_RECORDS,
            PublicationEvent,
            PublicationEventKind,
        )
        from shareholders.models.publication import PublicationKind
        from shareholders.models.recipient import PublicationRecipient

        mine = PublicationRecipient.objects.filter(publication_id=models.OuterRef("pk"), user_id=user_id)
        unvoted = mine.filter(
            ~models.Exists(
                PublicationEvent.objects.filter(recipient_id=models.OuterRef("pk"), kind=PublicationEventKind.BALLOT)
            )
        )
        my_ballot = PublicationEvent.objects.filter(
            publication_id=models.OuterRef("pk"), kind=PublicationEventKind.BALLOT, recipient__user_id=user_id
        )
        close = PublicationEvent.objects.filter(publication_id=models.OuterRef("pk"), kind=PublicationEventKind.CLOSE)
        superseded = PublicationEvent.objects.filter(
            recipient_id=models.OuterRef("recipient_id"),
            kind__in=PAYMENT_RECORDS,
            sequence__gt=models.OuterRef("sequence"),
        )
        my_payment = (
            PublicationEvent.objects.filter(
                publication_id=models.OuterRef("pk"), kind=PublicationEventKind.PAYMENT, recipient__user_id=user_id
            )
            .exclude(models.Exists(superseded))
            .order_by("-sequence")
        )
        recorded = mine.with_latest_payment_record().filter(latest_payment_record=PublicationEventKind.PAYMENT)
        return self.annotate(
            holding=models.Subquery(
                mine.order_by().values("publication_id").annotate(total=models.Sum("shares")).values("total")
            ),
            entitled=models.Subquery(
                mine.order_by().values("publication_id").annotate(total=models.Sum("entitlement")).values("total")
            ),
            ballot_choice=models.Subquery(my_ballot.values("choice")[:1]),
            ballot_cast_at=models.Subquery(my_ballot.values("created_at")[:1]),
            ballot_staff_entered=models.Subquery(my_ballot.values("staff_entered")[:1]),
            ballot_outstanding=models.Case(
                models.When(kind=PublicationKind.RESOLUTION, then=models.Exists(unvoted)),
                default=models.Value(False),
                output_field=models.BooleanField(),
            ),
            result=models.Subquery(close.values("payload")[:1]),
            payment_paid_on=models.Subquery(my_payment.values("paid_on")[:1]),
            payment_reference=models.Subquery(my_payment.values("reference")[:1]),
            payment_recorded_at=models.Subquery(my_payment.values("created_at")[:1]),
        ).annotate(
            recorded_entitlement=models.Case(
                models.When(
                    entitled__isnull=False,
                    then=Coalesce(
                        models.Subquery(
                            recorded.order_by()
                            .values("publication_id")
                            .annotate(total=models.Sum("entitlement"))
                            .values("total")
                        ),
                        models.Value(Decimal("0.00")),
                    ),
                ),
                default=models.Value(None),
                output_field=models.DecimalField(max_digits=18, decimal_places=2),
            )
        )
