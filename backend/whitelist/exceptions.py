from rest_framework import status
from rest_framework.exceptions import APIException


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


class WhitelistContractNotConfiguredException(APIException):

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = "Whitelist contract is not configured."
    default_code = "whitelist_contract_not_configured"


class BatchEntriesRequiredException(APIException):

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "No entries provided for batch operation."
    default_code = "batch_entries_required"


class BatchSizeLimitExceededException(APIException):

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "Batch size exceeds the maximum limit."
    default_code = "batch_size_limit_exceeded"

    def __init__(self, max_size=100):
        detail = f"Maximum {max_size} entries per batch."
        super().__init__(detail=detail)
