from django.test import SimpleTestCase

from integrations.sumsub.client import SumSubService

NO_PEP = {"pep_type": "none", "details": None}


def sumsub(payload):
    return SumSubService().normalize_webhook(payload)


def reviewed(answer, *reject_labels, button_ids=(), **fields):
    review = {"reviewAnswer": answer, "rejectLabels": list(reject_labels), "buttonIds": list(button_ids)}
    return {"type": "applicantReviewed", "reviewStatus": "completed", "reviewResult": review, **fields}


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
