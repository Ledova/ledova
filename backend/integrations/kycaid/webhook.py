import logging

from django.core.exceptions import ValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from compliance.services.identity_screening import raise_screening_alert
from integrations.kyc.constants import (
    KYCAID_EVENT_DATABASE_SCREENING,
    KYCAID_EVENT_VERIFICATION_COMPLETED,
    KYCAID_EVENT_VERIFICATION_STATUS_CHANGED,
    KYCAID_VERIFICATION_STATUSES,
    REVIEW_GREEN,
)
from integrations.kycaid.client import KYCAIDService
from integrations.webhooks import is_stale
from shared.db.middleware import RunsOnTheOperatorConnection
from users.models.user_profile import UserProfile
from users.services import identity

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name="dispatch")
class KYCAIDWebhookView(RunsOnTheOperatorConnection, APIView):

    authentication_classes = []
    permission_classes = []

    @extend_schema(exclude=True)
    def post(self, request):
        signature = request.headers.get("x-data-integrity", "")

        kycaid_service = KYCAIDService()
        if not kycaid_service.verify_webhook_signature(request.body, signature):
            logger.warning("Rejected webhook: invalid signature")
            return Response({"error": "Invalid signature"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            data = request.data
            event_type = data.get("type")
            applicant_id = data.get("applicant_id")

            if is_stale(data):
                logger.warning("Rejected webhook: timestamp outside the freshness window")
                return Response({"error": "Stale webhook"}, status=status.HTTP_400_BAD_REQUEST)

            if not applicant_id:
                logger.warning("Rejected webhook: no applicant id")
                return Response({"error": "Missing applicant_id"}, status=status.HTTP_400_BAD_REQUEST)

            try:
                user_profile = UserProfile.objects.get(kycaid_applicant_id=applicant_id)
            except (UserProfile.DoesNotExist, ValueError, ValidationError):
                logger.warning("Rejected webhook: applicant id matched no profile")
                return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

            if event_type == KYCAID_EVENT_VERIFICATION_COMPLETED:
                callback = data
                applicant_record = None
                if kycaid_service.reports_an_approval(data) and not kycaid_service.carries_the_pep_flag(
                    data.get("applicant")
                ):
                    applicant_record = kycaid_service.get_applicant_data(applicant_id)
                    callback = {**data, "applicant": applicant_record}
                normalized = kycaid_service.normalize_webhook(callback)
                identity.update_status_from_normalized(user_profile, normalized)

                if normalized.review_result == REVIEW_GREEN:
                    try:
                        applicant_data = applicant_record or kycaid_service.get_applicant_data(applicant_id)
                        extracted_data = kycaid_service.extract_verified_data(applicant_data)
                        identity.populate_profile(user_profile, extracted_data)
                    except Exception:
                        logger.exception("Failed to populate a profile from webhook data")

            elif event_type == KYCAID_EVENT_VERIFICATION_STATUS_CHANGED:
                reported_status = data.get("verification_status")
                new_status = KYCAID_VERIFICATION_STATUSES.get(reported_status)
                if new_status is None:
                    logger.warning("Ignored unrecognised verification status %r", reported_status)
                else:
                    user_profile.verification_status = new_status
                    user_profile.save(update_fields=["verification_status", "updated_at"])

            elif event_type == KYCAID_EVENT_DATABASE_SCREENING:
                user_account = getattr(user_profile, "user_account", None)
                if user_account is None:
                    logger.warning("Ignored a screening match for a profile without an account")
                else:
                    raise_screening_alert(user_account, kycaid_service.screening_match(data))

            else:
                logger.warning("Unhandled webhook type: %s", event_type)

            return Response({"success": True}, status=status.HTTP_200_OK)

        except Exception:
            logger.exception("Error processing webhook")
            return Response({"error": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
