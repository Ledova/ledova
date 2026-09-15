from django.db.models import QuerySet


class BlockchainTransactionQuerySet(QuerySet):
    def without_swap_transactions(self):
        from blockchain.models import TransactionType

        return (
            self.exclude(tx_type=TransactionType.ATOMIC_SWAP)
            .exclude(related_model="tokens.SwapOrder")
            .exclude(swap_orders__isnull=False)
        )

    def pending(self):
        from blockchain.models import TransactionStatus

        return self.filter(status__in=[TransactionStatus.PENDING, TransactionStatus.SUBMITTED])

    def without_outgoing_operations(self):
        return (
            self.without_swap_transactions()
            .exclude(mint_requests__operation__isnull=False)
            .exclude(related_model="whitelist.WhitelistChange")
            .exclude(token_deployments__isnull=False)
            .exclude(swap_approvals__isnull=False)
            .exclude(capital_increases__isnull=False)
            .exclude(issuance_executions__isnull=False)
        )

    def with_tx_hash(self):
        return self.filter(tx_hash__isnull=False)

    def stale(self, cutoff_datetime):
        return self.pending().filter(created_at__lt=cutoff_datetime)
