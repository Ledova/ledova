from uuid import UUID

from django.contrib.auth import get_user_model

from assets.models import Asset
from shared.constants import BLOCKCHAIN_BASE
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.chain.settlement import AUDY
from shared.seeds.synthetic.identities import EMAIL_DOMAIN
from shared.seeds.synthetic.market import jobs
from shared.seeds.synthetic.market.keyring import KeyRing
from shared.seeds.synthetic.story import STAFF
from wallets.models import Wallet

User = get_user_model()


def seeded_id(*labels):
    return UUID(bytes=keys.secret("market", *labels)[:16], version=4)


class Market:
    def __init__(self, plan, companies, deferrals):
        self.plan = plan
        self.companies = companies
        self.deferrals = deferrals
        self.keyring = KeyRing()
        self.staff = {
            key: User.objects.get(email=f"{handle}@{EMAIL_DOMAIN}") for key, handle, _, _, left in STAFF if not left
        }
        self.audy = Asset.objects.get(symbol=AUDY)
        self.tokens = {}
        self.orders = {}
        self.swaps = []
        self.funded = set()

    @property
    def tokens_by_id(self):
        return {token.pk: token for token in self.tokens.values()}

    @property
    def operations(self):
        return self.staff["operations"]

    @property
    def documents(self):
        return self.staff["documents"]

    def user(self, investor):
        return User.objects.get(email=investor)

    def wallet(self, investor, address):
        return Wallet.objects.filter_by_address(address, chain=BLOCKCHAIN_BASE).get(
            user_account__user_profile__user__email=investor
        )

    def run(self):
        return jobs.run(self.deferrals)
