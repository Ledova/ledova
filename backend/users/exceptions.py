from rest_framework import status
from rest_framework.exceptions import APIException


class InvestorNotEligibleException(APIException):

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This account is not eligible to invest."
    default_code = "investor_not_eligible"

    def __init__(self, reasons):
        super().__init__(detail=f"{self.default_detail} ({', '.join(reasons)})")
        self.reasons = tuple(reasons)
