from django.db.models import QuerySet


class WhitelistApprovalQuerySet(QuerySet):
    def pending(self):
        from whitelist.models import WhitelistStatus

        return self.filter(status=WhitelistStatus.PENDING)

    def to_sync(self):
        from whitelist.models import WhitelistStatus

        return self.filter(status__in=[WhitelistStatus.ACTIVE, WhitelistStatus.PENDING])

    def for_company(self, company_id):
        return self.filter(company_id=company_id)
