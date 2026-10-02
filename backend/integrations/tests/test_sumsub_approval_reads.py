from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from requests.exceptions import HTTPError

from integrations.sumsub.client import ApprovalEvidenceUnavailable, SumSubService
from integrations.tests.sumsub_payloads import (
    APPLICANT_ID,
    aml_case,
    hit,
    review,
    step,
    verification_steps,
)

AML_CASE_ENDPOINT = f"/resources/api/applicants/{APPLICANT_ID}/amlCase"
STEPS_ENDPOINT = f"/resources/applicants/{APPLICANT_ID}/requiredIdDocsStatus"


class SumsubApprovalReadsTest(SimpleTestCase):
    def setUp(self):
        self.limit = SimpleNamespace(take_rate_slot=Mock(return_value=(True, 0)))
        shared_cache = patch("integrations.sumsub.client.cache", self.limit)
        shared_cache.start()
        self.addCleanup(shared_cache.stop)
        self.answers = {
            STEPS_ENDPOINT: verification_steps(IDENTITY=step("PASSPORT", "GBR")),
            AML_CASE_ENDPOINT: aml_case(hit("hit-1", "true_positive", "pep")),
        }
        request = patch.object(SumSubService, "_make_request", side_effect=self.answer)
        self.request = request.start()
        self.addCleanup(request.stop)

    def answer(self, method, endpoint, **kwargs):
        answer = self.answers.get(endpoint, aml_case())
        if isinstance(answer, Exception):
            raise answer
        return answer

    def read(self, payload):
        return SumSubService().with_approval_evidence(APPLICANT_ID, payload)

    def requested(self):
        return [call.args for call in self.request.call_args_list]

    def test_an_approval_is_read_with_its_verification_steps_and_then_its_aml_case(self):
        normalised = SumSubService().normalize_webhook(self.read(review()))

        self.assertEqual(self.requested(), [("GET", STEPS_ENDPOINT), ("GET", AML_CASE_ENDPOINT)])
        self.assertEqual(normalised.review_result, "GREEN")
        self.assertEqual((normalised.document_type, normalised.document_country), ("PASSPORT", "GB"))
        self.assertEqual(normalised.pep_data["pep_type"], "unknown")

    def test_a_result_that_is_not_an_approval_reads_nothing_more(self):
        for payload in (
            review("RED", rejectLabels=["PEP"], reviewRejectType="FINAL"),
            review("GREEN", status="awaitingService"),
            review("GREEN", status="onHold"),
            {"reviewStatus": "completed"},
            {"reviewStatus": "completed", "reviewResult": "GREEN"},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.read(payload), payload)
        self.assertEqual(self.requested(), [])
        self.limit.take_rate_slot.assert_not_called()

    def test_every_aml_case_read_takes_a_slot_of_one_limit_of_ten_a_minute_shared_by_all_applicants(self):
        self.read(review())
        SumSubService().get_aml_case("5ca1ab1e0000400080000c33")

        first, second = self.limit.take_rate_slot.call_args_list
        self.assertEqual(first.args[1:], (10, 60))
        self.assertEqual(first.args, second.args)

    def test_with_the_limit_spent_no_aml_case_is_read(self):
        self.limit.take_rate_slot.return_value = (False, 42)

        with self.assertRaises(ApprovalEvidenceUnavailable):
            self.read(review())

        self.assertNotIn(("GET", AML_CASE_ENDPOINT), self.requested())

    def test_without_the_shared_limit_no_aml_case_is_read(self):
        with patch("integrations.sumsub.client.cache", SimpleNamespace()):
            with self.assertRaises(ApprovalEvidenceUnavailable):
                self.read(review())

        self.assertNotIn(("GET", AML_CASE_ENDPOINT), self.requested())

    def test_a_failed_verification_steps_read_spends_no_aml_case_slot(self):
        self.answers[STEPS_ENDPOINT] = HTTPError("503 synthetic")

        with self.assertRaises(HTTPError):
            self.read(review())

        self.limit.take_rate_slot.assert_not_called()
        self.assertEqual(self.requested(), [("GET", STEPS_ENDPOINT)])

    def test_a_failed_aml_case_read_is_not_read_as_an_answer(self):
        self.answers[AML_CASE_ENDPOINT] = HTTPError("429 synthetic")

        with self.assertRaises(HTTPError):
            self.read(review())
