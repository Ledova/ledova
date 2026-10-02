from wallets.querysets.share_class import ShareClassQuerySet


class HoldingQuerySet(ShareClassQuerySet):
    def active_assets_only(self):
        return self.filter(asset__is_active=True, asset__is_verified=True)
