from datetime import date, datetime, timezone
from unittest.mock import patch

from rest_framework.test import APITestCase

from companies.models import Company, CompanyStatus
from shared.tests.tenants import make_tenant
from tokens.models import (
    IssuanceStatus,
    ShareIssuance,
    ShareTokenStatus,
)

RECIPIENT = "0x" + "9" * 40
MEMBER = "00000000-0000-4000-8000-000000000001"
HOLDERS = [
    {
        "member": MEMBER,
        "wallets": [{"address": RECIPIENT, "whitelist_status": "Active"}],
        "name": "Register Holder",
        "balance": "5",
        "percentage": 100.0,
        "source": "stored",
        "holder_type": "member",
        "holder_type_display": "Member",
        "entered_on": date(2026, 9, 20),
        "share_class": "DEP",
        "identity_source": "Current profile",
        "residential_address": "1 Register Street",
        "amount_paid": None,
    }
]


class ShareTokenActionTest(APITestCase):
    def setUp(self):
        self.tenant = make_tenant("owner")
        self.client.force_authenticate(self.tenant.user)

    def _activate(self):
        Company.objects.filter(pk=self.tenant.company.pk).update(status=CompanyStatus.ACTIVE)

    @patch("tokens.tasks.deploy_share_token_task")
    def test_owner_deployment_admission_is_retired(self, deploy_task):
        self._activate()
        response = self.client.post(f"/api/v1/tokens/{self.tenant.token.uuid}/deploy/")
        self.assertEqual(response.status_code, 404)
        self.tenant.token.refresh_from_db()
        self.assertEqual(self.tenant.token.status, ShareTokenStatus.DRAFT)
        self.assertIsNone(self.tenant.token.deployment_id)
        deploy_task.defer.assert_not_called()

    def test_duplicate_symbol_is_rejected_by_the_unique_validator(self):
        response = self.client.post(
            "/api/v1/tokens/",
            {"name": "Again", "symbol": self.tenant.token.symbol, "tokenType": "ordinary", "totalSupply": "10"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json(), {"nonFieldErrors": ["The fields company, symbol must make a unique set."]})

    @patch("tokens.views.share_token.stored_register")
    @patch("tokens.views.share_token.share_token_service")
    def test_holders_shapes_and_retired_free_address_issue(self, service_class, register):
        token = self.tenant.deployed_token
        recorded_at = datetime(2026, 9, 20, tzinfo=timezone.utc)
        register.return_value = {
            "rows": HOLDERS,
            "sequence": 1,
            "issued_supply": 5,
            "waiting_effects": 0,
            "former_members": [],
            "reconciliation": None,
            "on_chain": True,
            "recorded_at": recorded_at,
        }

        issue = self.client.post(
            f"/api/v1/tokens/{token.uuid}/issue/",
            {"recipient": RECIPIENT, "amount": 7, "reason": "Owner request", "issuanceType": "additional"},
            format="json",
        )
        self.assertEqual(issue.status_code, 404)
        service_class.create_issuance_request.assert_not_called()

        holders = self.client.get(f"/api/v1/tokens/{token.uuid}/holders/")
        self.assertEqual(holders.status_code, 200)
        self.assertEqual(
            holders.json()["holders"],
            [
                {
                    "member": MEMBER,
                    "wallets": [{"address": RECIPIENT, "whitelistStatus": "Active"}],
                    "name": "Register Holder",
                    "balance": "5",
                    "percentage": 100.0,
                    "source": "stored",
                    "holderType": "member",
                    "enteredOn": "2026-09-20",
                    "shareClass": "DEP",
                    "identitySource": "Current profile",
                }
            ],
        )
        self.assertEqual(
            [holders.json()[key] for key in ("totalHolders", "initialized", "issuedSupply", "waitingEffects")],
            [1, True, "5", 0],
        )
        self.assertEqual(
            [
                holders.json()[key]
                for key in ("formerMembers", "formerMembersAsAt", "formerMembersBlock", "formerMembersStale")
            ],
            [[], None, None, True],
        )
        register.assert_called_once_with(token)

        ledger_token = self.tenant.token
        register.reset_mock()
        register.return_value["rows"] = [{**HOLDERS[0], "share_class": ledger_token.symbol}]
        register.return_value["on_chain"] = False
        ledger = self.client.get(f"/api/v1/tokens/{ledger_token.uuid}/holders/")
        self.assertEqual(ledger.status_code, 200, ledger.content)
        self.assertEqual(
            [
                ledger.json()[key]
                for key in ("formerMembers", "formerMembersAsAt", "formerMembersBlock", "formerMembersStale")
            ],
            [[], "2026-09-20T00:00:00Z", None, False],
        )
        register.assert_called_once_with(ledger_token)

    @patch("tokens.views.share_token.share_token_service")
    def test_detail_actions_keep_filter_params_off_the_token_lookup(self, service_class):
        token = self.tenant.deployed_token
        completed = ShareIssuance.objects.create(
            token=token, recipient_address=RECIPIENT, amount="5", status=IssuanceStatus.COMPLETED
        )
        ShareIssuance.objects.create(token=token, recipient_address=RECIPIENT, amount="3")

        unfiltered = self.client.get(f"/api/v1/tokens/{token.uuid}/issuances/")
        self.assertEqual(unfiltered.status_code, 200)
        self.assertEqual(unfiltered.json()["count"], 2)

        filtered = self.client.get(f"/api/v1/tokens/{token.uuid}/issuances/", {"status": "completed"})
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual([row["uuid"] for row in filtered.json()["results"]], [str(completed.uuid)])
        self.assertEqual(filtered.json()["results"][0]["status"], IssuanceStatus.COMPLETED)

        pending = self.client.get(f"/api/v1/tokens/{token.uuid}/issuances/", {"status": "pending"})
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json()["count"], 1)

        holders = self.client.get(f"/api/v1/tokens/{token.uuid}/holders/", {"search": "zzz", "status": "draft"})
        self.assertEqual(holders.status_code, 200)
        self.assertEqual(holders.json()["token"]["uuid"], str(token.uuid))

        self.assertEqual(self.client.get("/api/v1/tokens/", {"status": "draft"}).json()["count"], 1)
