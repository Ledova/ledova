import logging

from django.core.exceptions import ValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from integrations.kyc.constants import (
    PROVIDER_SUMSUB,
    STATUS_INIT,
    STATUS_ON_HOLD,
    STATUS_PENDING,
    SUMSUB_EVENT_APPLICANT_CREATED,
    SUMSUB_EVENT_APPLICANT_ON_HOLD,
    SUMSUB_EVENT_APPLICANT_PENDING,
    SUMSUB_EVENT_APPLICANT_REVIEWED,
)
from integrations.sumsub import SumSubService
from integrations.webhooks import is_stale
from shared.db.middleware import RunsOnTheOperatorConnection
from users.models.user_profile import UserProfile
from users.services import identity

logger = logging.getLogger(__name__)

STATUS_BY_EVENT = {
    SUMSUB_EVENT_APPLICANT_CREATED: STATUS_INIT,
    SUMSUB_EVENT_APPLICANT_PENDING: STATUS_PENDING,
    SUMSUB_EVENT_APPLICANT_ON_HOLD: STATUS_ON_HOLD,
}


def _record_status(user_profile, status):
    user_profile.sumsub_verification_status = status
    fields = ["sumsub_verification_status", "updated_at"]
    if user_profile.kyc_provider == PROVIDER_SUMSUB:
        user_profile.verification_status = status
        fields.append("verification_status")
    user_profile.save(update_fields=fields)


@method_decorator(csrf_exempt, name="dispatch")
class SumSubWebhookView(RunsOnTheOperatorConnection, APIView):
    authentication_classes = []
    permission_classes = []

    parser_classes = [JSONParser]

    @extend_schema(exclude=True)
    def post(self, request):
        signature = request.headers.get("X-Payload-Digest", "")

        sumsub_service = SumSubService()
        if not sumsub_service.verify_webhook_signature(request.body, signature):
            logger.warning("Rejected webhook: invalid signature")
            return Response({"error": "Invalid signature"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            data = request.data
            webhook_type = data.get("type")
            applicant_id = data.get("applicantId")
            external_user_id = data.get("externalUserId")

            if is_stale(data):
                logger.warning("Rejected webhook: timestamp outside the freshness window")
                return Response({"error": "Stale webhook"}, status=status.HTTP_400_BAD_REQUEST)

            if not external_user_id:
                logger.warning("Rejected webhook: no externalUserId")
                return Response({"error": "Missing externalUserId"}, status=status.HTTP_400_BAD_REQUEST)

            try:
                user_profile = UserProfile.objects.get(uuid=external_user_id)

                if user_profile.sumsub_applicant_id != applicant_id:
                    user_profile.sumsub_applicant_id = applicant_id
                    user_profile.save(update_fields=["sumsub_applicant_id"])

            except (UserProfile.DoesNotExist, ValueError, ValidationError):
                logger.warning("Rejected webhook: externalUserId matched no profile")
                return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

            if webhook_type in STATUS_BY_EVENT:
                _record_status(user_profile, STATUS_BY_EVENT[webhook_type])

            elif webhook_type == SUMSUB_EVENT_APPLICANT_REVIEWED and user_profile.kyc_provider == PROVIDER_SUMSUB:
                identity.update_status_from_normalized(
                    user_profile,
                    sumsub_service.normalize_webhook(sumsub_service.with_approval_evidence(applicant_id, data)),
                )

            else:
                logger.warning("Unhandled webhook type: %s", webhook_type)

            return Response({"success": True}, status=status.HTTP_200_OK)

        except Exception:
            logger.exception("Error processing webhook")
            return Response({"error": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
