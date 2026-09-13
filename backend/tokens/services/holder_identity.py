from wallets.models import Wallet
from whitelist.services.identity import profile_name


class StampedIdentity:
    def __init__(self, name: str = "", residential_address: str = ""):
        self.name = name
        self.residential_address = residential_address

    def __bool__(self):
        return bool(self.name or self.residential_address)


def identity_at_allotment(address: str, *, chain: str) -> StampedIdentity:
    wallets = list(Wallet.objects.filter_by_address(address, chain=chain).order_by("uuid")[:2])
    if len(wallets) != 1 or wallets[0].user_account_id is None:
        return StampedIdentity()

    holder = wallets[0].user_account.user_profile

    return StampedIdentity(profile_name(holder), (holder.residential_address or "").strip())
