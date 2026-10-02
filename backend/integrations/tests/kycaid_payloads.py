import base64
import hashlib
import hmac
import json

APPLICANT_ID = "5ca1ab1e0000400080000000000000000a11"
VERIFICATION_ID = "5ca1ab1e0000400080000000000000000b22"
FORM_ID = "5ca1ab1e0000400080000000000000000c33"
FORM_TOKEN = "5ca1ab1e0000400080000000000000000d44"
REQUEST_ID = "5ca1ab1e0000400080000000000000000e55"
DOCUMENT_ID = "5ca1ab1e0000400080000000000000000f66"
API_TOKEN = "synthetic-kycaid-token"

DOCUMENTED_VERIFICATION_STATUSES = ("unused", "pending", "completed")
DOCUMENTED_APPLICANT_STATUSES = ("pending", "valid", "invalid")
DOCUMENTED_DECLINE_REASONS = (
    "AGE_RESTRICTION",
    "ANONYMIZING_NETWORK",
    "BAD_QUALITY",
    "COMPROMISED_PERSON",
    "COMPULSION",
    "DIFFERENT_FACES",
    "DOCUMENT_DAMAGED",
    "DOCUMENT_INCOMPLETE",
    "DUPLICATE",
    "EDITED_DOCUMENT",
    "EXPIRED_DOCUMENT",
    "EXPIRES_LESS_3_MONTHS",
    "FAKE_DOCUMENT",
    "FRAUDULENT",
    "IP_MISMATCH",
    "LIMIT_REACHED_OTP",
    "MULTIPLE_PERSON",
    "NO_SELFIE",
    "OTHER",
    "PROHIBITED_JURISDICTION",
    "QES_MISMATCH",
    "TAX_ID_REQUIRED",
    "WRONG_DOB",
    "WRONG_DOCUMENT",
    "WRONG_INFO",
    "WRONG_NAME",
)


def applicant(**fields):
    return {
        "applicant_id": APPLICANT_ID,
        "external_applicant_id": "synthetic-external-id",
        "type": "PERSON",
        "created_at": "2026-09-30 01:00:00",
        "profile_status": "valid",
        "profile_comment": None,
        "first_name": "Synthetic",
        "last_name": "Applicant",
        "residence_country": "AU",
        "nationality": "AU",
        "dob": "1990-01-01",
        "pep": False,
        "decline_reasons": [],
        "addresses": [],
        "documents": [],
        "verification_status": "valid",
        "verifications_count": 1,
        **fields,
    }


def check(verified, *decline_reasons):
    return {"verified": verified, "comment": "", "decline_reasons": list(decline_reasons)}


def verification_completed(status="completed", verified=True, verifications=None, **fields):
    if verifications is None:
        verifications = {"profile": check(verified), "document": check(verified)}
    return {
        "type": "VERIFICATION_COMPLETED",
        "request_id": REQUEST_ID,
        "verification_id": VERIFICATION_ID,
        "applicant_id": APPLICANT_ID,
        "form_id": FORM_ID,
        "form_token": FORM_TOKEN,
        "status": status,
        "verified": verified,
        "verifications": verifications,
        "verification_statuses": {
            "duplicates": [],
            "ludoman": None,
            "agreed_with_tc": None,
            "face_match_confidence": None,
        },
        "verification_attempts_left": None,
        **fields,
    }


def status_changed(verification_status):
    return {
        "type": "VERIFICATION_STATUS_CHANGED",
        "verification_status": verification_status,
        "applicant_id": APPLICANT_ID,
        "external_applicant_id": "synthetic-external-id",
        "form_id": FORM_ID,
        "form_token": FORM_TOKEN,
        "verification_id": VERIFICATION_ID,
        "verification_attempts_left": None,
        "request_id": REQUEST_ID,
    }


def database_screening(list_types, databases, **fields):
    return {
        "type": "DATABASE_SCREENING",
        "document_id": DOCUMENT_ID,
        "applicant_id": APPLICANT_ID,
        "external_applicant_id": "synthetic-external-id",
        "verification_id": VERIFICATION_ID,
        "databases": list(databases),
        "list_types": list(list_types),
        **fields,
    }


def signed(payload):
    body = json.dumps(payload).encode()
    signature = hmac.new(API_TOKEN.encode(), base64.b64encode(body), hashlib.sha512).hexdigest()
    return body, signature
