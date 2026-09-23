from django.db import models


class PublicationQuerySet(models.QuerySet):
    def with_the_holding_of(self, user_id):
        from shareholders.models.recipient import PublicationRecipient

        return self.annotate(
            holding=models.Subquery(
                PublicationRecipient.objects.filter(publication_id=models.OuterRef("pk"), user_id=user_id).values(
                    "shares"
                )[:1]
            )
        )
