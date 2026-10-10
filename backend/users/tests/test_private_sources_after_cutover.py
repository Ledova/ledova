from django.db import DatabaseError, connections
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, current_alias, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import InvestorClassification, InvestorClassificationStatus
from users.services.investor_classification import evidence_operation
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)


class PrivateSourcesAfterCutoverTest(
    CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def source_snapshot(self):
        with use_operator():
            return list(InvestorClassification.objects.order_by("uuid").values())

    def test_two_genuine_uploads_retain_the_first_private_source_without_granting_eligibility(self):
        first = self.source_snapshot()[0]
        with self.source.evidence_file.open("rb") as stream:
            original_bytes = stream.read()

        second = self.submit_source()

        self.assertNotEqual(second.pk, self.source.pk)
        self.assertEqual(second.status, InvestorClassificationStatus.SUBMITTED)
        with use_operator():
            self.assertEqual(InvestorClassification.objects.get(pk=self.source.pk).status, "submitted")
            self.assertEqual(InvestorClassification.objects.filter(pk=self.source.pk).values().get(), first)
        with self.source.evidence_file.open("rb") as stream:
            self.assertEqual(stream.read(), original_bytes)
        self.assertEqual(self.snapshots()["users.CompanyEligibilityDecision"], [])

    def test_company_acceptance_retains_the_source_as_submitted(self):
        before = self.source_snapshot()

        request, decision = self.accepted()

        self.assertEqual(request.source_id, self.source.pk)
        self.assertEqual(decision.outcome, "accepted")
        self.assertEqual(self.source_snapshot(), before)

    def test_staff_review_urls_refuse_every_retired_transition_and_preserve_private_history(self):
        with use_operator():
            staff, _ = make_investor("retired-source-staff", staff=True)
            staff.is_superuser = True
            staff.save(update_fields=["is_superuser"])
        self.client.force_authenticate(None)
        self.client.force_login(staff)
        before = self.source_snapshot()

        for action in ("verify", "reject", "revoke"):
            url = f"/admin/users/investorclassification/{self.source.pk}/{action}/"
            with self.subTest(action=action):
                for response in (self.client.get(url), self.client.post(url, {"reason": "Synthetic retired action"})):
                    self.assertEqual(response.status_code, 302)
                    self.assertEqual(response["Location"], url + "change/")
        change_url = f"/admin/users/investorclassification/{self.source.pk}/change/"
        self.assertEqual(self.client.post(change_url, {"status": "verified"}).status_code, 403)

        self.assertEqual(self.source_snapshot(), before)

    def test_real_operator_staff_review_command_refuses_at_zero_row_statement_entry(self):
        with use_operator():
            staff, _ = make_investor("retired-source-sql-staff", staff=True)
        before = self.source_snapshot()

        with self.assertRaises(DatabaseError) as raised, self.database_role("operator", staff):
            with evidence_operation("review", source_id=self.source.pk):
                with atomic(), connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "UPDATE users_investorclassification SET status = 'verified', reviewed_by_id = %s "
                        "WHERE uuid = %s AND false",
                        [staff.pk, self.source.pk],
                    )

        self.assertEqual(raised.exception.__cause__.sqlstate, "23514")
        self.assertIn("Staff source review is retired", str(raised.exception))
        self.assertEqual(self.source_snapshot(), before)
