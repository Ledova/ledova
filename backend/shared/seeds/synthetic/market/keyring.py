from django.contrib.auth import get_user_model

from shared.constants import BLOCKCHAIN_BASE
from shared.seeds.synthetic import keys
from shared.seeds.synthetic.identities import EMAIL_DOMAIN
from wallets.models import Wallet

User = get_user_model()
POSITIONS = 8
TESTER_ACCOUNTS = 5
UNKNOWN = "The seed cannot derive a signing key for {address}, so that wallet cannot sign its orders."


class UnknownKey(RuntimeError):
    pass


def _people():
    count = User.objects.filter(email__endswith=f"@{EMAIL_DOMAIN}", is_staff=False).count()
    return [f"investor-{index:02d}" for index in range(1, count + 1)]


class KeyRing:
    def __init__(self):
        self.found = {}
        self.software = None
        self.fingerprints = None
        for account in keys.hardhat_keys(range(TESTER_ACCOUNTS)):
            self.found[keys.evm_address(account.key).lower()] = account.key

    def key(self, address):
        lowered = address.lower()
        if lowered not in self.found:
            wallet = Wallet.objects.filter(address__iexact=address, chain=BLOCKCHAIN_BASE).first()
            if wallet is not None and wallet.master_fingerprint and wallet.address_index is not None:
                self._hardware(wallet)
            else:
                self._software(lowered)
        if lowered not in self.found:
            raise UnknownKey(UNKNOWN.format(address=address))
        return self.found[lowered]

    def _software(self, wanted):
        if self.software is None:
            self.software = iter([(person, position) for person in _people() for position in range(POSITIONS)])
        for person, position in self.software:
            key = keys.secret("wallet", person, position)
            address = keys.evm_address(key).lower()
            self.found.setdefault(address, key)
            if address == wanted:
                return

    def _hardware(self, wallet):
        if self.fingerprints is None:
            self.fingerprints = {}
            for person in _people():
                seed = keys.secret("keystone", person)
                derivation = keys.hardware_keys(seed, [0])[0].derivation
                self.fingerprints[derivation.fingerprint] = seed
        seed = self.fingerprints.get(wallet.master_fingerprint)
        if seed is None:
            return
        key = keys.hardware_keys(seed, [wallet.address_index])[0].key
        self.found[keys.evm_address(key).lower()] = key
