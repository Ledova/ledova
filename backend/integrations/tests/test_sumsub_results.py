from unittest.mock import patch

from django.test import SimpleTestCase

from integrations.sumsub.client import SumSubService
from integrations.tests.sumsub_payloads import (
    APPLICANT_ID,
    DOCUMENTED_AML_RISK_LABELS,
    DOCUMENTED_MATCH_STATUSES,
    aml_case,
    hit,
    review,
    step,
    verification_steps,
)

NO_PEP = {"pep_type": "none", "details": None}


def sumsub(payload):
    return SumSubService().normalize_webhook(payload)


def reviewed(answer, *reject_labels, button_ids=(), **fields):
    review = {"reviewAnswer": answer, "rejectLabels": list(reject_labels), "buttonIds": list(button_ids)}
    return {"type": "applicantReviewed", "reviewStatus": "completed", "reviewResult": review, **fields}


def approval(case=None, steps=None, reviewed=None):
    service = SumSubService()
    with patch.object(SumSubService, "get_aml_case", return_value=aml_case() if case is None else case), patch.object(
        SumSubService, "get_verification_steps", return_value=verification_steps() if steps is None else steps
    ):
        return service.normalize_webhook(service.with_approval_evidence(APPLICANT_ID, reviewed or review()))


class SumsubPEPEvidenceTest(SimpleTestCase):
    def test_a_pep_rejection_records_the_pep_from_its_documented_reject_label_and_button(self):
        payload = reviewed(
            "RED",
            "COMPROMISED_PERSONS",
            "PEP",
            "SANCTIONS",
            button_ids=("compromisedPersons_sanctionList", "compromisedPersons_pep", "compromisedPersons"),
        )

        self.assertEqual(
            sumsub(payload).pep_data, {"pep_type": "foreign", "details": ["PEP", "compromisedPersons_pep"]}
        )

    def test_the_pep_button_alone_records_the_pep(self):
        payload = reviewed("RED", "COMPROMISED_PERSONS", button_ids=("compromisedPersons_pep",))

        self.assertEqual(sumsub(payload).pep_data, {"pep_type": "foreign", "details": ["compromisedPersons_pep"]})

    def test_reject_labels_that_are_not_a_pep_record_no_pep(self):
        payload = reviewed("RED", "FOREIGNER", "SANCTIONS", "ADVERSE_MEDIA", "CRIMINAL", "WRONG_USER_REGION")

        self.assertEqual(sumsub(payload).pep_data, NO_PEP)

    def test_labels_outside_the_documented_review_fields_record_no_pep(self):
        payload = reviewed(
            "GREEN",
            riskLabels=["domestic_pep"],
            applicantRiskLabels=["foreign_pep"],
        )
        payload["reviewResult"]["riskLabels"] = ["pep_family_member"]

        self.assertEqual(sumsub(payload).pep_data, NO_PEP)


class SumsubApprovalTest(SimpleTestCase):
    def test_an_approval_read_without_its_aml_case_records_no_result(self):
        with self.assertLogs("integrations.sumsub.client", level="WARNING"):
            normalised = sumsub(review())

        self.assertEqual((normalised.verification_status, normalised.review_result), ("pending", None))
        self.assertFalse(normalised.is_verified)

    def test_an_approval_read_with_its_aml_case_is_recorded(self):
        normalised = approval()

        self.assertEqual((normalised.verification_status, normalised.review_result), ("completed", "GREEN"))
        self.assertTrue(normalised.is_verified)
        self.assertEqual(normalised.pep_data, NO_PEP)

    def test_an_approved_applicant_with_a_confirmed_pep_hit_is_recorded_as_the_pep_the_policy_accepts(self):
        normalised = approval(aml_case(hit("hit-1", "true_positive", "pep", "adverseMedia")))

        self.assertEqual(normalised.review_result, "GREEN")
        self.assertEqual(
            normalised.pep_data,
            {
                "pep_type": "unknown",
                "approved_by_provider": True,
                "details": [{"id": "hit-1", "matchStatus": "true_positive", "riskLabels": ["pep", "adverseMedia"]}],
            },
        )

    def test_a_pep_hit_counts_unless_it_was_cleared_as_not_the_applicant(self):
        counted = {"unknown": True, "potential_match": True, "true_positive": True, "false_positive": False}
        for match_status in DOCUMENTED_MATCH_STATUSES:
            with self.subTest(match_status=match_status):
                pep_type = approval(aml_case(hit("hit-1", match_status, "pep"))).pep_data["pep_type"]
                self.assertEqual(pep_type, "unknown" if counted[match_status] else "none")
        self.assertEqual(approval(aml_case(hit("hit-1", "no_match", "pep"))).pep_data, NO_PEP)
        unreviewed = {key: value for key, value in hit("hit-1", "unknown", "pep").items() if key != "review"}
        self.assertEqual(approval(aml_case(unreviewed)).pep_data["pep_type"], "unknown")

    def test_only_the_pep_hits_are_the_evidence(self):
        case = aml_case(
            hit("hit-1", "true_positive", "sanctions"),
            hit("hit-2", "false_positive", "pep"),
            hit("hit-3", "potential_match", "PEP"),
        )

        self.assertEqual(
            approval(case).pep_data,
            {
                "pep_type": "unknown",
                "approved_by_provider": True,
                "details": [{"id": "hit-3", "matchStatus": "potential_match", "riskLabels": ["PEP"]}],
            },
        )

    def test_hits_without_the_pep_label_record_no_pep(self):
        labels = [label for label in DOCUMENTED_AML_RISK_LABELS if label != "pep"]
        case = aml_case(*(hit(f"hit-{index}", "true_positive", label) for index, label in enumerate(labels)))

        self.assertEqual(approval(case).pep_data, NO_PEP)

    def test_an_aml_case_that_lists_no_hits_counts_its_own_pep_label(self):
        case = {key: value for key, value in aml_case(risk_labels=["pep"]).items() if key != "hits"}

        self.assertEqual(
            approval(case).pep_data,
            {"pep_type": "unknown", "approved_by_provider": True, "details": [{"riskLabels": ["pep"]}]},
        )
        self.assertEqual(approval({**case, "riskLabels": ["crime"]}).pep_data, NO_PEP)


class SumsubIdentityDocumentTest(SimpleTestCase):
    def document(self, steps):
        normalised = approval(steps=steps)
        return normalised.document_type, normalised.document_country

    def test_the_approved_identity_document_is_recorded_with_its_issuing_country_as_a_two_letter_code(self):
        self.assertEqual(self.document(verification_steps(IDENTITY=step("PASSPORT", "GBR"))), ("PASSPORT", "GB"))
        self.assertEqual(self.document(verification_steps(IDENTITY=step("DRIVERS", "AUS"))), ("DRIVERS", "AU"))

    def test_a_passport_is_preferred_among_the_approved_identity_documents(self):
        steps = verification_steps(IDENTITY=step("DRIVERS", "AUS"), IDENTITY2=step("PASSPORT", "NZL"))

        self.assertEqual(self.document(steps), ("PASSPORT", "NZ"))

    def test_a_document_that_was_not_approved_is_not_recorded(self):
        steps = verification_steps(IDENTITY=step("PASSPORT", "GBR", answer="RED"), IDENTITY3=step("ID_CARD", "AUS"))

        self.assertEqual(self.document(steps), ("ID_CARD", "AU"))
        self.assertEqual(
            self.document(verification_steps(IDENTITY=step("PASSPORT", "GBR", answer="RED"))), (None, None)
        )

    def test_steps_other_than_identity_documents_are_not_recorded(self):
        steps = verification_steps(
            PROOF_OF_RESIDENCE=step("UTILITY_BILL", "GBR"), APPLICANT_DATA=step("PASSPORT", "GBR")
        )

        self.assertEqual(self.document(steps), (None, None))

    def test_a_country_code_without_an_iso_match_is_kept_and_a_malformed_one_is_not(self):
        self.assertEqual(self.document(verification_steps(IDENTITY=step("PASSPORT", "XKX"))), ("PASSPORT", "XKX"))
        for malformed in (None, "", "GB-ENG", "1AB", 826):
            with self.subTest(country=malformed):
                self.assertEqual(
                    self.document(verification_steps(IDENTITY=step("PASSPORT", malformed))), ("PASSPORT", None)
                )

    def test_the_applicants_own_country_and_nationality_are_not_read_as_the_documents(self):
        payload = {
            **review("RED", rejectLabels=["FORGERY"]),
            "fixedInfo": {"country": "GBR", "nationality": "GBR", "idDocType": "PASSPORT"},
            "info": {"country": "GBR", "nationality": "GBR", "idDocs": [{"idDocType": "PASSPORT", "country": "GBR"}]},
        }

        normalised = sumsub(payload)

        self.assertEqual((normalised.document_type, normalised.document_country), (None, None))
