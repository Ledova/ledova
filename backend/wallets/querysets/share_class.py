from django.db.models import OuterRef, QuerySet, Subquery

from shared.constants import BLOCKCHAIN_BASE


class ShareClassQuerySet(QuerySet):
    def with_share_class(self):
        from assets.models import AssetChainDeployment
        from tokens.models import ShareToken

        deployed = AssetChainDeployment.objects.filter(asset=OuterRef("asset"), chain=BLOCKCHAIN_BASE)
        share_class = ShareToken.objects.filter(chain=BLOCKCHAIN_BASE, contract_address__iexact=OuterRef("contract"))
        return self.annotate(contract=Subquery(deployed.values("contract_address")[:1])).annotate(
            share_class_uuid=Subquery(share_class.values("uuid")[:1]),
            share_class_name=Subquery(share_class.values("name")[:1]),
            share_class_symbol=Subquery(share_class.values("symbol")[:1]),
            share_class_company_name=Subquery(share_class.values("company__name")[:1]),
        )
