from django.db import models

from blockchain.models import OutgoingStatus


class ShareIssuanceExecutionQuerySet(models.QuerySet):
    def with_register_effect(self):
        from tokens.models import RegisterEntry, RegisterOpening

        return self.annotate(
            after_opening=models.Exists(
                RegisterOpening.objects.filter(
                    token_id=models.OuterRef("token_id"),
                    status="applied",
                    boundary__block__number__lt=models.OuterRef("finalized_receipt__block_number"),
                )
            ),
            entered=models.Exists(
                RegisterEntry.objects.filter(
                    operation_id=models.OuterRef("issuance_id"),
                    register__token_id=models.OuterRef("token_id"),
                    kind="issue",
                )
            ),
        )

    def unentered_after_opening(self, token):
        return self.with_register_effect().filter(
            token_id=token.pk, status="executed", after_opening=True, entered=False
        )

    def recoverable(self, cutoff):
        return (
            self.with_register_effect()
            .filter(
                models.Q(status__in=("queued", "executing"))
                | models.Q(status="executed", after_opening=True, entered=False)
            )
            .filter(
                models.Q(updated_at__lt=cutoff)
                | models.Q(operation__status__in=(OutgoingStatus.CONFIRMED, OutgoingStatus.REVERTED))
            )
        )
