from django.db import models


class PublicationQuerySet(models.QuerySet):
    def seen_by(self, user_id):
        from shareholders.models.event import PublicationEvent, PublicationEventKind
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
        return self.annotate(
            holding=models.Subquery(
                mine.order_by().values("publication_id").annotate(total=models.Sum("shares")).values("total")
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
        )
