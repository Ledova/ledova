from rest_framework import status
from rest_framework.exceptions import APIException

from blockchain.services.outgoing import OutgoingTransactionError


class WhitelistSigningHold(OutgoingTransactionError):
    def __init__(self, unmet_requirements):
        self.unmet_requirements = unmet_requirements
        super().__init__("The original unsigned whitelist change requires its exact company source.")


class WhitelistRemovalPending(Exception):
    pass


class WhitelistChangeConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This whitelist change conflicts with recorded work."
    default_code = "whitelist_change_conflict"


class WhitelistChangeUnresolved(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The whitelist outcome is unresolved. Recover the original submission."
    default_code = "whitelist_change_unresolved"


class WalletNotRegisteredException(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "No unique registered wallet matches this address."
    default_code = "wallet_not_registered"


class WhitelistRegistryMissing(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This company has no share class on chain yet, so it has no whitelist registry."
    default_code = "whitelist_registry_missing"


class WhitelistRegistryUnreadable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "The company's whitelist registry could not be read. Try again."
    default_code = "whitelist_registry_unreadable"
