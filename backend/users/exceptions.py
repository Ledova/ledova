from rest_framework import status
from rest_framework.exceptions import APIException


class CompanyEligibilityConflict(APIException):
    status_code = 409
    default_detail = "The request or evidence changed. Preview the exact decision again."
    default_code = "company_eligibility_conflict"


class InvalidClassificationTransitionException(APIException):

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "Invalid classification transition."
    default_code = "invalid_classification_transition"

    def __init__(self, from_status: str, to_status: str):
        super().__init__(detail=f"Cannot transition from '{from_status}' to '{to_status}'.")


class InvestorNotEligibleException(APIException):

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This account is not eligible to invest."
    default_code = "investor_not_eligible"

    def __init__(self, reasons):
        super().__init__(detail=f"{self.default_detail} ({', '.join(reasons)})")
        self.reasons = tuple(reasons)


class VerificationTokenGenerationException(APIException):
    status_code = 502
    default_detail = "Unable to initialize verification. Please try again."
    default_code = "verification_token_generation_failed"
