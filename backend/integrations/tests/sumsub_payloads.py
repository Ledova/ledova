APPLICANT_ID = "5ca1ab1e0000400080000a11"
AML_CASE_ID = "5ca1ab1e0000400080000b22"

DOCUMENTED_MATCH_STATUSES = ("unknown", "potential_match", "false_positive", "true_positive")
DOCUMENTED_AML_RISK_LABELS = ("adverseMedia", "crime", "pep", "sanctions", "terrorism", "fitnessProbity")


def review(answer="GREEN", status="completed", **result):
    return {
        "reviewId": "SYNTH",
        "attemptId": "SYNTA",
        "attemptCnt": 1,
        "levelName": "basic-kyc-level",
        "createDate": "2026-09-30 01:00:00+0000",
        "reviewDate": "2026-09-30 01:05:00+0000",
        "reviewResult": {"reviewAnswer": answer, **result},
        "reviewStatus": status,
        "priority": 0,
    }


def hit(hit_id, match_status, *risk_labels):
    return {
        "id": hit_id,
        "name": "Synthetic Applicant",
        "entityType": "individual",
        "birthYears": ["1990"],
        "sources": [{"type": "watchlist", "name": "Synthetic screening list"}],
        "review": {"matchStatus": match_status, "whitelisted": False, "modifiedAt": "2026-09-30 01:04:00"},
        "riskLabels": list(risk_labels),
    }


def aml_case(*hits, risk_labels=None, answer="GREEN"):
    if risk_labels is None:
        risk_labels = list(dict.fromkeys(label for each in hits for label in each["riskLabels"]))
    return {
        "id": AML_CASE_ID,
        "createdAt": "2026-09-30 01:03:00",
        "targetEntityType": "applicant",
        "targetEntityId": APPLICANT_ID,
        "vendorAttribution": "Synthetic screening vendor",
        "ongoingMonitoring": {"enabled": True},
        "review": {"reviewAnswer": answer},
        "riskLabels": list(risk_labels),
        "hits": list(hits),
    }


def step(id_doc_type, country, answer="GREEN"):
    return {
        "reviewResult": {"reviewAnswer": answer},
        "country": country,
        "idDocType": id_doc_type,
        "imageIds": [1001, 1002],
        "imageReviewResults": {"1001": {"reviewAnswer": answer}, "1002": {"reviewAnswer": answer}},
    }


def verification_steps(**steps):
    return {"SELFIE": step("SELFIE", "GBR"), **steps}
