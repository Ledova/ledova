from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase

from shared.tests.tenants import make_tenant
from tokens.models import RequestStatus, ShareIssuanceRequest
from tokens.tests.retained_issuance_fixtures import approve_retained_request

REVIEWER_WROTE = "Checked the shareholder agreement; the allocation matches clause 4."
NOT_WHITELISTED = "Recipient wallet is not whitelisted. Whitelist it before executing."


def staff_reviewer():
    return get_user_model().objects.create_user(email=f"reviewer-{uuid4()}@example.test", is_staff=True, is_active=True)


class AnExecutedRequestDoesNotSayItWasRefusedTest(TransactionTestCase):

    def setUp(self):
        self.tenant = make_tenant("issuer")
        self.request = ShareIssuanceRequest.objects.create(
            dispatch_id=None,
            token=self.tenant.deployed_token,
            recipient_address="0x" + "b" * 40,
            amount=10000,
            reason="Founder allocation",
            submitted_by=self.tenant.user,
            status=RequestStatus.SUBMITTED,
        )

    def _approved(self, notes=REVIEWER_WROTE):
        approve_retained_request(self.request, staff_reviewer(), notes=notes)
        self.request.refresh_from_db()
        return self.request

    def test_a_refusal_does_not_overwrite_what_the_reviewer_typed(self):
        self._approved()

        self.request.mark_refused(NOT_WHITELISTED)

        self.request.refresh_from_db()
        self.assertEqual(self.request.review_notes, REVIEWER_WROTE)
        self.assertIn(NOT_WHITELISTED, self.request.execution_notes)

    def test_a_failure_does_not_overwrite_it_either(self):
        self._approved()

        self.request.mark_failed("the node timed out")

        self.request.refresh_from_db()
        self.assertEqual(self.request.review_notes, REVIEWER_WROTE)
        self.assertIn("the node timed out", self.request.execution_notes)

    def test_a_refused_then_executed_request_reads_as_executed(self):
        self._approved()
        self.request.mark_refused(NOT_WHITELISTED)
        self.request.refresh_from_db()

        self.request.mark_executed()

        self.request.refresh_from_db()
        self.assertEqual(self.request.status, RequestStatus.EXECUTED)
        self.assertNotIn("Refused", self.request.review_notes)
        self.assertEqual(self.request.review_notes, REVIEWER_WROTE)

    def test_the_refusal_survives_as_history_rather_than_being_erased(self):
        self._approved()
        self.request.mark_refused(NOT_WHITELISTED)
        self.request.refresh_from_db()

        self.request.mark_executed()

        self.request.refresh_from_db()
        lines = self.request.execution_notes.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertIn(f"Refused: {NOT_WHITELISTED}", lines[0])
        self.assertIn("Executed", lines[1])

    def test_every_attempt_is_kept_in_the_order_it_happened(self):
        self._approved()
        self.request.mark_refused(NOT_WHITELISTED)
        self.request.refresh_from_db()
        self.request.mark_failed("the node timed out")
        self.request.refresh_from_db()
        self.request.status = RequestStatus.APPROVED
        self.request.save(update_fields=["status"])

        self.request.mark_executed()

        self.request.refresh_from_db()
        lines = self.request.execution_notes.splitlines()
        self.assertEqual(len(lines), 3)
        self.assertIn("Refused", lines[0])
        self.assertIn("Failed", lines[1])
        self.assertIn("Executed", lines[2])

    def test_each_line_carries_when_it_happened(self):
        self._approved()

        self.request.mark_refused(NOT_WHITELISTED)

        self.request.refresh_from_db()
        stamp = self.request.execution_notes.split(" ")[0]
        self.assertRegex(stamp, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")

    def test_a_later_attempt_keeps_history_written_since_the_request_was_loaded(self):
        self._approved()
        stale_request = ShareIssuanceRequest.objects.get(pk=self.request.pk)
        self.request.mark_refused(NOT_WHITELISTED)

        stale_request.mark_executed()

        self.request.refresh_from_db()
        self.assertEqual(self.request.review_notes, REVIEWER_WROTE)
        self.assertEqual(len(self.request.execution_notes.splitlines()), 2)
        self.assertIn(NOT_WHITELISTED, self.request.execution_notes)
        self.assertTrue(self.request.execution_notes.endswith("Executed"))

    def test_a_request_approved_without_notes_still_records_its_attempt(self):
        self._approved(notes="")

        self.request.mark_refused(NOT_WHITELISTED)

        self.request.refresh_from_db()
        self.assertEqual(self.request.review_notes, "")
        self.assertIn(NOT_WHITELISTED, self.request.execution_notes)
