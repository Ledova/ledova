from django.db.models import QuerySet


class WhitelistChangeQuerySet(QuerySet):
    def unresolved(self):
        from whitelist.models.change import WhitelistChangeStatus

        return self.filter(status__in=[WhitelistChangeStatus.PENDING, WhitelistChangeStatus.EXECUTING])

    def for_target(self, chain_id, registry_address, address):
        return self.filter(chain_id=chain_id, registry_address=registry_address.lower(), address=address.lower())

    def for_recovery(self):
        return self.unresolved().order_by("updated_at", "uuid")
