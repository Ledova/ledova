from django.db import models
from django.db.models import OuterRef, QuerySet, Subquery


class ShareTokenQuerySet(QuerySet):

    def issued_by(self, user):
        if user is None or not user.is_authenticated:
            return self.none()
        return self.filter(company__owner=user)

    def deployed(self):
        return self.filter(status="deployed")

    def deployed_with_contract(self):
        return self.deployed().exclude(contract_address__isnull=True).exclude(contract_address="")

    def on_chain(self):
        return self.exclude(contract_address__isnull=True).exclude(contract_address="")

    def deployed_at(self, chain: str, contract_address: str):
        return self.deployed_with_contract().filter(chain=chain, contract_address__iexact=contract_address)

    def stuck_deploying(self, cutoff):
        from tokens.models.choices import ShareTokenStatus

        return self.filter(status=ShareTokenStatus.DEPLOYING, updated_at__lt=cutoff)

    def with_company(self):
        return self.select_related("company")

    def in_directory(self):
        from companies.models import Company

        return self.deployed_with_contract().filter(company__in=Company.objects.open_to_investors())

    def with_issued_shares(self):
        from tokens.querysets.share_issuance import completed_supply_annotation

        return self.annotate(issued_shares=completed_supply_annotation(OuterRef("pk")))

    def with_open_offering(self):
        from offerings.models import Offering

        offering = Offering.objects.filter(token=OuterRef("pk")).open_now().order_by("-created_at")
        return self.annotate(
            open_offering_uuid=Subquery(offering.values("uuid")[:1]),
            open_offering_price=Subquery(offering.values("price_per_share")[:1]),
            open_offering_currency=Subquery(offering.values("price_currency")[:1]),
            open_offering_opens_at=Subquery(offering.values("opens_at")[:1]),
            open_offering_closes_at=Subquery(offering.values("closes_at")[:1]),
        )

    def search(self, query):
        if not query:
            return self
        return self.filter(
            models.Q(name__icontains=query)
            | models.Q(symbol__icontains=query)
            | models.Q(contract_address__icontains=query)
        )
