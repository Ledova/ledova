from django.db.models import QuerySet


class BlockchainTransactionQuerySet(QuerySet):
    def pending(self):
        from blockchain.models import TransactionStatus

        return self.filter(status__in=[TransactionStatus.PENDING, TransactionStatus.SUBMITTED])

    def without_outgoing_operations(self):
        return (
            self.exclude(mint_requests__operation__isnull=False)
            .exclude(related_model="whitelist.WhitelistChange")
            .exclude(token_deployments__isnull=False)
            .exclude(capital_increases__isnull=False)
        )

    def with_tx_hash(self):
        return self.filter(tx_hash__isnull=False)

    def stale(self, cutoff_datetime):
        return self.pending().filter(created_at__lt=cutoff_datetime)
