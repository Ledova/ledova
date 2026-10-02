from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from unittest.mock import patch

from django.db import connections
from django.test import TransactionTestCase

from compliance.models import ComplianceAlert
from compliance.services.identity_screening import raise_screening_alert
from shared.db import use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import an_account

MATCH = {
    "provider": "kycaid",
    "applicant_id": "5ca1ab1e0000400080000000000000000a11",
    "verification_id": "5ca1ab1e0000400080000000000000000b22",
    "document_id": None,
    "list_types": ["PEP"],
    "databases": ["OPEN_SANC_PEPS"],
    "accuracy": None,
    "matched_person": {},
}


class ScopedScreeningMatchAlertTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.account = an_account("screening-match", account_number="ACC-SCREEN-RACE", account_status="active")

    def test_concurrent_deliveries_of_one_match_raise_one_alert(self):
        create = ComplianceAlert.objects.create
        arrivals, guard, second = [], Lock(), Event()

        def contended(**fields):
            with guard:
                arrivals.append(fields["triggered_rule"])
                first = len(arrivals) == 1
            if first:
                second.wait(timeout=2)
            else:
                second.set()
            return create(**fields)

        def deliver(_):
            try:
                with use_operator():
                    return raise_screening_alert(self.account, dict(MATCH))
            finally:
                connections.close_all()

        with patch.object(ComplianceAlert.objects, "create", contended):
            with ThreadPoolExecutor(max_workers=2) as pool:
                raised = list(pool.map(deliver, range(2)))

        with use_operator():
            self.assertEqual(ComplianceAlert.objects.filter(user_account=self.account).count(), 1)
        self.assertEqual(sum(alert is not None for alert in raised), 1)
