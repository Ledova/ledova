from django.db.models import Q, QuerySet
from django.utils import timezone


class WhitelistApprovalQuerySet(QuerySet):
    def pending(self):
        from whitelist.models import WhitelistStatus

        return self.filter(status=WhitelistStatus.PENDING)

    def live(self):
        from whitelist.models import WhitelistStatus

        return self.filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now()), status=WhitelistStatus.ACTIVE)

    def to_sync(self):
        from whitelist.models import WhitelistStatus

        return self.filter(status__in=[WhitelistStatus.ACTIVE, WhitelistStatus.PENDING, WhitelistStatus.FAILED])

    def for_company(self, company_id):
        return self.filter(company_id=company_id)
