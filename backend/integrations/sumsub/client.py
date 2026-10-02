import hashlib
import hmac
import json
import logging
import time
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import pycountry
import requests
from django.conf import settings
from django.core.cache import cache

from compliance.constants import PEP_TYPE_NONE, PEP_TYPE_UNKNOWN
from integrations.exceptions import ApprovalEvidenceUnavailable
from integrations.kyc.base import (
    KYCProvider,
    NormalizedVerificationResult,
    VerificationSession,
)
from integrations.kyc.constants import (
    PROVIDER_SUMSUB,
    REVIEW_GREEN,
    STATUS_COMPLETED,
    STATUS_PENDING,
)
from integrations.kyc.pep import PEP_LABEL, pep_data_from_labels

logger = logging.getLogger(__name__)

PEP_BUTTON = "pep"
AML_CASE_RATE_KEY = "sumsub-aml-case"
AML_CASE_REQUESTS_PER_MINUTE = 10
IDENTITY_STEPS = ("IDENTITY", "IDENTITY2", "IDENTITY3", "IDENTITY4")


class SumSubService(KYCProvider):

    def __init__(self):
        self.api_key = settings.SUMSUB_API_KEY
        self.secret_key = settings.SUMSUB_SECRET_KEY
        self.base_url = settings.SUMSUB_BASE_URL
        self.level_name = settings.SUMSUB_LEVEL_NAME

    def get_provider_name(self) -> str:
        return PROVIDER_SUMSUB

    def create_applicant(self, external_user_id: str, **profile_data) -> dict:
        body = {"externalUserId": external_user_id}
        if profile_data.get("first_name"):
            body["fixedInfo"] = {"firstName": profile_data["first_name"]}
            if profile_data.get("last_name"):
                body["fixedInfo"]["lastName"] = profile_data["last_name"]
        if profile_data.get("email"):
            body["email"] = profile_data["email"]

        try:
            params = {"levelName": self.level_name}
            result = self._make_request("POST", "/resources/applicants", data=body, params=params)
            applicant_id = result.get("id")
        except requests.exceptions.HTTPError as e:
            if e.response is not None and e.response.status_code == 409:
                logger.info(f"[SUMSUB_CLIENT] Applicant already exists for {external_user_id}, fetching existing")
                existing = self.get_applicant_by_external_id(external_user_id)
                applicant_id = existing.get("id")
            else:
                raise

        access_token = self.generate_access_token_for_external_user(external_user_id)
        return {"access_token": access_token, "applicant_id": applicant_id}

    def normalize_webhook(self, webhook_data: dict) -> NormalizedVerificationResult:
        review_result = webhook_data.get("reviewResult")
        if not isinstance(review_result, dict):
            review_result = {}
        review_status = webhook_data.get("reviewStatus") or STATUS_PENDING
        review_answer = review_result.get("reviewAnswer") if review_status == STATUS_COMPLETED else None
        if review_answer == REVIEW_GREEN and not isinstance(webhook_data.get("amlCase"), dict):
            logger.warning("Sumsub approval has no fetched AML evidence; approval left pending")
            review_status, review_answer = STATUS_PENDING, None
        rejection_labels = review_result.get("rejectLabels", [])

        pep_data = self._extract_pep_data(webhook_data)

        doc_type, doc_country = self._extract_document_info(webhook_data)

        return NormalizedVerificationResult(
            verification_status=review_status,
            review_result=review_answer or None,
            is_verified=review_answer == REVIEW_GREEN,
            rejection_labels=rejection_labels,
            document_type=doc_type,
            document_country=doc_country,
            pep_data=pep_data,
            extracted_data={},
        )

    def extract_verified_data(self, applicant_data: dict) -> dict:
        info = applicant_data.get("info", {})
        addresses = info.get("addresses", [])

        first_name = info.get("firstName", "") or info.get("firstNameEn", "")
        last_name = info.get("lastName", "") or info.get("lastNameEn", "")
        full_name = f"{first_name} {last_name}".strip() if first_name or last_name else None

        address = None
        if addresses and len(addresses) > 0:
            first_address = addresses[0]
            address = first_address.get("formattedAddress")
            if not address:
                parts = []
                if first_address.get("street"):
                    parts.append(first_address.get("street"))
                if first_address.get("town"):
                    parts.append(first_address.get("town"))
                if first_address.get("state"):
                    parts.append(first_address.get("state"))
                if first_address.get("postCode"):
                    parts.append(first_address.get("postCode"))
                if first_address.get("country"):
                    parts.append(first_address.get("country"))
                address = ", ".join(parts) if parts else None

        date_of_birth = info.get("dob")

        return {
            "fullName": full_name,
            "dateOfBirth": date_of_birth,
            "address": address,
        }

    def generate_session(self, applicant_id: str, external_user_id: str) -> VerificationSession:
        access_token = self.generate_access_token_for_external_user(external_user_id)
        return VerificationSession(
            provider=PROVIDER_SUMSUB,
            applicant_id=applicant_id,
            access_token=access_token,
        )

    @staticmethod
    def _extract_pep_data(status_data: Dict[str, Any]) -> Dict[str, Any]:
        review_result = status_data.get("reviewResult") or {}
        if not isinstance(review_result, dict):
            review_result = {}
        if status_data.get("reviewStatus") == STATUS_COMPLETED and review_result.get("reviewAnswer") == REVIEW_GREEN:
            case = status_data.get("amlCase")
            if not isinstance(case, dict):
                return pep_data_from_labels([])
            evidence = []
            hits = case.get("hits")
            if isinstance(hits, list):
                for hit in hits:
                    if not isinstance(hit, dict):
                        continue
                    labels = hit.get("riskLabels") or []
                    result = hit.get("review") or {}
                    match = result.get("matchStatus") if isinstance(result, dict) else None
                    if "pep" in [str(label).lower() for label in labels] and match not in (
                        "false_positive",
                        "no_match",
                    ):
                        evidence.append({"id": hit.get("id"), "matchStatus": match, "riskLabels": labels})
            elif "pep" in [str(label).lower() for label in case.get("riskLabels") or []]:
                evidence.append({"riskLabels": case["riskLabels"]})
            if evidence:
                return {"pep_type": PEP_TYPE_UNKNOWN, "details": evidence, "approved_by_provider": True}
            return {"pep_type": PEP_TYPE_NONE, "details": None}
        evidence = [label for label in review_result.get("rejectLabels") or [] if str(label).upper() == PEP_LABEL]
        evidence += [
            button for button in review_result.get("buttonIds") or [] if str(button).split("_")[-1] == PEP_BUTTON
        ]
        return pep_data_from_labels(evidence)

    @staticmethod
    def _extract_document_info(status_data: Dict[str, Any]) -> tuple:
        steps = status_data.get("verificationSteps")
        if not isinstance(steps, dict):
            return None, None
        documents = [steps[key] for key in IDENTITY_STEPS if isinstance(steps.get(key), dict)]
        approved = [
            document
            for document in documents
            if (document.get("reviewResult") or {}).get("reviewAnswer") == REVIEW_GREEN
        ]
        if not approved:
            return None, None
        document = next((each for each in approved if each.get("idDocType") == "PASSPORT"), approved[0])
        country = document.get("country")
        if isinstance(country, str) and len(country) in (2, 3) and country.isalpha():
            country = country.upper()
            match = (
                pycountry.countries.get(alpha_2=country)
                if len(country) == 2
                else pycountry.countries.get(alpha_3=country)
            )
            country = match.alpha_2 if match else country
        else:
            country = None
        return document.get("idDocType"), country

    def with_approval_evidence(self, applicant_id: str, payload: dict) -> dict:
        result = payload.get("reviewResult")
        if (
            payload.get("reviewStatus") != STATUS_COMPLETED
            or not isinstance(result, dict)
            or result.get("reviewAnswer") != REVIEW_GREEN
        ):
            return payload
        steps = self.get_verification_steps(applicant_id)
        case = self.get_aml_case(applicant_id)
        if not isinstance(steps, dict) or not isinstance(case, dict):
            raise ApprovalEvidenceUnavailable("Sumsub approval evidence is unavailable")
        return {**payload, "verificationSteps": steps, "amlCase": case}

    def get_verification_steps(self, applicant_id: str) -> dict:
        return self._make_request("GET", f"/resources/applicants/{applicant_id}/requiredIdDocsStatus")

    def get_aml_case(self, applicant_id: str) -> dict:
        take_slot = getattr(cache, "take_rate_slot", None)
        if take_slot is None:
            raise ApprovalEvidenceUnavailable("Sumsub AML rate limit is unavailable")
        allowed, _ = take_slot(AML_CASE_RATE_KEY, AML_CASE_REQUESTS_PER_MINUTE, 60)
        if not allowed:
            raise ApprovalEvidenceUnavailable("Sumsub AML rate limit is exhausted")
        return self._make_request("GET", f"/resources/api/applicants/{applicant_id}/amlCase")

    def get_applicant_status(self, applicant_id: str) -> Dict[str, Any]:
        response = self._make_request("GET", f"/resources/applicants/{applicant_id}/status")
        logger.info(f"[SUMSUB_CLIENT] Status for {applicant_id}: review answer {self._review_answer(response)}")
        return response

    def _generate_signature(self, method: str, url: str, timestamp: str, body: bytes = b"") -> str:
        data = f"{timestamp}{method.upper()}{url}".encode() + body
        signature = hmac.new(self.secret_key.encode(), data, hashlib.sha256).hexdigest()
        return signature

    def _make_request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, str]] = None,
        files: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        url_path = endpoint
        if params:
            query_string = urlencode(sorted(params.items()))
            url_path = f"{endpoint}?{query_string}"

        url = f"{self.base_url}{url_path}"
        timestamp = str(int(time.time()))

        if files:
            session = requests.Session()
            req = requests.Request(method, url, files=files, data=data or {})
            prepared = session.prepare_request(req)

            body = prepared.body or b""
            if isinstance(body, str):
                body = body.encode()

            signature = self._generate_signature(method, url_path, timestamp, body)

            prepared.headers["X-App-Token"] = self.api_key
            prepared.headers["X-App-Access-Sig"] = signature
            prepared.headers["X-App-Access-Ts"] = timestamp

            response = session.send(prepared, timeout=30)
        else:
            body = b""
            if data:
                body = json.dumps(data).encode()

            signature = self._generate_signature(method, url_path, timestamp, body)

            headers = {
                "X-App-Token": self.api_key,
                "X-App-Access-Sig": signature,
                "X-App-Access-Ts": timestamp,
                "Content-Type": "application/json",
            }
            response = requests.request(method=method, url=url, headers=headers, json=data, timeout=30)

        if not response.ok:
            logger.error(f"SumSub API Error: {response.status_code} for {method} {endpoint}")
            response.raise_for_status()

        return response.json()

    @staticmethod
    def _review_answer(body: Dict[str, Any]) -> str:
        review = body.get("review")
        if not isinstance(review, dict):
            review = body
        result = review.get("reviewResult")
        if not isinstance(result, dict):
            result = {}
        return result.get("reviewAnswer") or review.get("reviewStatus") or "none"

    def get_applicant_data(self, applicant_id: str) -> Dict[str, Any]:
        endpoint = f"/resources/applicants/{applicant_id}/one"

        logger.info(f"[SUMSUB_CLIENT] Fetching applicant data for {applicant_id} from {self.base_url}{endpoint}")
        response = self._make_request("GET", endpoint)

        logger.info(f"[SUMSUB_CLIENT] Applicant data for {applicant_id}: review answer {self._review_answer(response)}")
        return response

    def get_applicant_by_external_id(self, external_user_id: str) -> Dict[str, Any]:
        endpoint = f"/resources/applicants/-;externalUserId={external_user_id}/one"

        logger.info(f"[SUMSUB_CLIENT] Fetching applicant by external ID {external_user_id}")
        response = self._make_request("GET", endpoint)

        logger.info(f"[SUMSUB_CLIENT] Found applicant {response.get('id')} for external ID {external_user_id}")
        return response

    def generate_access_token_for_external_user(self, external_user_id: str, ttl_seconds: int = 1200) -> str:
        params = {"userId": external_user_id, "levelName": self.level_name, "ttlInSecs": str(ttl_seconds)}
        query_string = urlencode(sorted(params.items()))
        endpoint = f"/resources/accessTokens?{query_string}"

        response = self._make_request("POST", endpoint)

        return response.get("token")

    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        if not settings.SUMSUB_WEBHOOK_SECRET:

            logger.error("SUMSUB_WEBHOOK_SECRET not configured; rejecting webhook (cannot verify signature)")
            return False

        expected_signature = hmac.new(settings.SUMSUB_WEBHOOK_SECRET.encode(), payload, hashlib.sha256).hexdigest()

        is_valid = hmac.compare_digest(expected_signature, signature)

        if not is_valid:
            logger.warning("Invalid webhook signature")

        return is_valid
