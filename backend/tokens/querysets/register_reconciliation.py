from django.db.models import Exists, OuterRef, Prefetch, Q, QuerySet


class RegisterReconciliationQuerySet(QuerySet):

    def register_readable_by(self, user):
        from tokens.models import ShareToken

        return self.filter(token__in=ShareToken.objects.register_readable_by(user))

    def with_acknowledgements(self):
        from tokens.models import RegisterAcknowledgement

        later = self.model._default_manager.filter(token_id=OuterRef("token_id")).filter(
            Q(created_at__gt=OuterRef("created_at")) | Q(created_at=OuterRef("created_at"), uuid__gt=OuterRef("uuid"))
        )
        return self.annotate(latest=~Exists(later)).prefetch_related(
            Prefetch(
                "acknowledgements",
                queryset=RegisterAcknowledgement.objects.select_related("appointment__appointee_profile"),
            )
        )
