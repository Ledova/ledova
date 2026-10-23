from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from integrations.sendgrid_email import SendGridClient
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import (
    CoreFixtures,
    import_payload,
    person,
    retained_evidence,
)
from tokens.models import (
    MemberAssociation,
    MemberInvitation,
    RegisterEvidenceKind,
    RegisterMember,
    RegisterMemberParticulars,
    ShareToken,
)


class MemberAccessTest(CoreFixtures, APITransactionTestCase):
    @override_settings(DASHBOARD_BASE_URL="https://dashboard.example.test")
    def test_exact_walletless_association_own_entitlement_holdings_requests_and_revocation(self):
        award = self.award_payload()
        response = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        vesting = self.client.post(
            "/api/v1/tokens/register-award-vestings/", self.vesting_payload(award["operation_id"]), format="json"
        )
        self.assertEqual(vesting.status_code, 201, vesting.content)
        end_evidence = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        end_payload = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "award": award["operation_id"],
            "unvested_shares": "1",
            "vested_shares": "0",
            "company_event_on": timezone.now().date().isoformat(),
            "reason": "Company ends selected unvested rights",
            "evidence": str(end_evidence.pk),
        }
        ended = self.client.post("/api/v1/tokens/register-award-ends/", end_payload, format="json")
        self.assertEqual(ended.status_code, 201, ended.content)
        payload = self.invitation_payload(member=award["member"], intended_email=" CORE-FOREIGN@EXAMPLE.TEST ")
        email_endpoint = "/api/v1/tokens/member-invitations/send-email/"
        with patch("tokens.services.member_access.sendgrid_client.send_email") as delivery:
            self.client.force_authenticate(self.foreign)
            self.assertEqual(self.client.post(email_endpoint, payload, format="json").status_code, 404)
            delivery.assert_not_called()
            self.client.force_authenticate(self.owner)
            with override_settings(DASHBOARD_BASE_URL="https://dashboard.example.test?redirect=untrusted"):
                invalid_url = self.client.post(email_endpoint, payload, format="json")
                self.assertEqual(invalid_url.status_code, 503, invalid_url.content)
            delivery.assert_not_called()
            with override_settings(SENDGRID_API_KEY=""), patch(
                "integrations.sendgrid_email.client.send_mail", return_value=0
            ):
                delivery.side_effect = SendGridClient().send_email
                failed = self.client.post(email_endpoint, payload, format="json")
            self.assertEqual(failed.status_code, 503, failed.content)
            with use_operator():
                self.assertTrue(MemberInvitation.objects.filter(pk=payload["operation_id"]).exists())
            first_email = delivery.call_args.kwargs
            delivery.side_effect = None
            delivery.return_value = {"success": True}
            issued = self.client.post(email_endpoint, payload, format="json")
            self.assertEqual(issued.status_code, 200, issued.content)
            self.assertEqual(delivery.call_args.kwargs, first_email)
            self.assertEqual(first_email["to_email"], self.foreign.email)
            self.assertIn("View invitation", first_email["html_content"])
            link = next(
                line for line in first_email["text_content"].splitlines() if line.startswith("View invitation: ")
            )
            self.assertTrue(link.startswith("View invitation: https://dashboard.example.test/member-invitation#"))
            invitation_code = link.rsplit("#", 1)[1]
            self.assertEqual(len(invitation_code), 43)
            changed = self.client.post(email_endpoint, {**payload, "intended_email": self.owner.email}, format="json")
            self.assertEqual(changed.status_code, 409, changed.content)
            self.assertEqual(delivery.call_count, 2)
            replay = self.client.post(email_endpoint, payload, format="json")
            self.assertEqual(replay.status_code, 200, replay.content)
            self.assertEqual(delivery.call_args.kwargs, first_email)
            with patch("tokens.services.member_access.timezone.now", return_value=timezone.now() + timedelta(days=8)):
                expired_send = self.client.post(email_endpoint, payload, format="json")
            self.assertEqual(expired_send.status_code, 400, expired_send.content)
            self.assertEqual(delivery.call_count, 3)
        self.assertEqual(issued.json()["intendedEmail"], self.foreign.email)
        self.assertEqual(issued.json()["emailDelivery"], "accepted")
        self.assertNotIn("code", issued.json())
        self.assertNotIn(
            "code", self.client.get(f"/api/v1/tokens/member-invitations/{payload['operation_id']}/").json()
        )
        preview_endpoint = "/api/v1/tokens/member-invitations/preview/"
        self.assertEqual(self.client.post(preview_endpoint, {"code": invitation_code}, format="json").status_code, 400)
        self.client.force_authenticate(self.foreign)
        preview = self.client.post(preview_endpoint, {"code": invitation_code}, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["company"], {"uuid": str(self.company.pk), "name": self.company.name})
        self.assertEqual(preview.json()["member"], {"uuid": award["member"], "name": award["name"]})
        self.assertEqual(preview.json()["status"], "pending")
        self.assertEqual(preview["Cache-Control"], "private, no-store")
        with use_operator():
            self.assertFalse(MemberAssociation.objects.exists())
        self.foreign.is_email_verified = False
        self.assertEqual(self.client.post(preview_endpoint, {"code": invitation_code}, format="json").status_code, 403)
        self.foreign.is_email_verified = True
        with patch("tokens.services.member_access.timezone.now", return_value=timezone.now() + timedelta(days=8)):
            expired = self.client.post(preview_endpoint, {"code": invitation_code}, format="json")
        self.assertEqual(expired.status_code, 400, expired.content)
        acceptance = {
            "code": invitation_code,
            "user_account": str(self.foreign_profile.user_account.pk),
            "confirmation": True,
        }
        accepted = self.client.post("/api/v1/tokens/member-invitations/accept/", acceptance, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(
            self.client.post(preview_endpoint, {"code": invitation_code}, format="json").json()["status"], "accepted"
        )
        association = accepted.json()["uuid"]
        self.assertEqual(
            self.client.post("/api/v1/tokens/member-invitations/accept/", acceptance, format="json").json()["uuid"],
            association,
        )
        record_endpoint = f"/api/v1/tokens/member-records/{association}/"
        own = self.client.get(record_endpoint)
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual(own.json()["classes"], [])
        self.assertEqual((own.json()["awards"][0]["shares"], own.json()["awards"][0]["vestedShares"]), ("30", "25"))
        self.assertEqual(own.json()["awards"][0]["issuedShares"], "0")
        own_award = own.json()["awards"][0]
        self.assertEqual(
            (
                own_award["endedUnvestedShares"],
                own_award["remainingUnissuedShares"],
                own_award["unvestedRemainingShares"],
            ),
            ("1", "29", "4"),
        )
        self.assertEqual(own_award["ends"][0]["uuid"], end_payload["operation_id"])
        self.assertNotIn("evidence", str(own_award["ends"]))
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/register-award-ends/{end_payload['operation_id']}/file/").status_code, 404
        )
        self.assertNotIn("evidence", str(own.json()).lower())
        request_payload = {
            "operation_id": str(uuid4()),
            "association": association,
            "name": "Synthetic Updated Employee",
            "residential_address": "8 Example Street, Sydney NSW 2000",
            "confirmation": True,
        }
        requested = self.client.post("/api/v1/tokens/member-particulars-requests/", request_payload, format="json")
        self.assertEqual(requested.status_code, 201, requested.content)
        request_id = requested.json()["uuid"]
        self.assertEqual(requested.json()["status"], "submitted")
        self.assertEqual(
            self.client.post("/api/v1/tokens/member-particulars-requests/", request_payload, format="json").status_code,
            200,
        )
        with use_operator():
            self.assertEqual(
                RegisterMemberParticulars.objects.get(member_id=award["member"]).name, "Synthetic Employee"
            )
        self.client.force_authenticate(self.owner)
        selections = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/")
        self.assertEqual(selections.status_code, 200, selections.content)
        self.assertEqual(selections.json()["awardRecipients"], [])
        recipient = next(row for row in selections.json()["members"] if row["member"] == award["member"])
        self.assertEqual((recipient["name"], recipient["onRegister"]), (award["name"], False))
        proposal = self.client.post("/api/v1/tokens/register-grants/", self.linked_grant_payload(award), format="json")
        self.assertEqual(proposal.status_code, 201, proposal.content)
        self.decision("/api/v1/tokens/register-grants/", proposal.json()["uuid"], "approve")
        applied, _ = self.decision("/api/v1/tokens/register-grants/", proposal.json()["uuid"], "apply")
        issue_entry = applied.json()["registerEntry"]
        supporting = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        self.client.force_authenticate(self.foreign)
        own = self.client.get(record_endpoint).json()
        self.assertEqual((own["classes"][0]["shares"], own["awards"][0]["issuedShares"]), ("25", "25"))
        self.assertIsNone(own["classes"][0]["amountPaid"])
        entries = self.client.get(f"{record_endpoint}entries/?token={self.token.pk}").json()["entries"]
        self.assertEqual([(item["uuid"], item["delta"]) for item in entries], [(issue_entry, "25")])
        self.assertNotIn(str(self.member.pk), str(entries))
        self.assertNotIn("changes", str(entries))
        self.client.force_authenticate(self.owner)
        change = self.client.post(
            f"/api/v1/tokens/member-particulars-requests/{request_id}/prepare/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "supporting_evidence": str(supporting.pk),
                "as_at": timezone.now().date().isoformat(),
                "reason": "Record the member-confirmed particulars",
            },
            format="json",
        )
        self.assertEqual(change.status_code, 201, change.content)
        self.assertEqual(change.json()["memberRequest"], request_id)
        self.decision("/api/v1/tokens/register-particulars-changes/", change.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-particulars-changes/", change.json()["uuid"], "apply")
        self.client.force_authenticate(self.foreign)
        status = self.client.get(f"/api/v1/tokens/member-particulars-requests/{request_id}/")
        self.assertEqual(status.json()["status"], "applied")
        self.assertEqual(self.client.get(record_endpoint).json()["name"], request_payload["name"])
        certificate = {"operation_id": str(uuid4()), "association": association, "entry": issue_entry}
        requested = self.client.post("/api/v1/tokens/member-certificate-requests/", certificate, format="json")
        self.assertEqual(requested.status_code, 201, requested.content)
        self.assertEqual(requested.json()["status"], "requested")
        self.assertNotIn("file", requested.json())
        certificate_id = requested.json()["uuid"]
        withdrawal = {"idempotency_key": str(uuid4())}
        withdrawn = self.client.post(
            f"/api/v1/tokens/member-certificate-requests/{certificate_id}/withdraw/", withdrawal, format="json"
        )
        self.assertEqual(withdrawn.status_code, 200, withdrawn.content)
        self.assertEqual(withdrawn.json()["status"], "withdrawn")
        self.assertEqual(
            self.client.post(
                f"/api/v1/tokens/member-certificate-requests/{certificate_id}/withdraw/", withdrawal, format="json"
            ).status_code,
            200,
        )
        self.client.force_authenticate(self.owner)
        revocation = {
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
            "reason": "Synthetic association revoked",
        }
        revoked = self.client.post(
            f"/api/v1/tokens/member-associations/{association}/revoke/", revocation, format="json"
        )
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.assertFalse(revoked.json()["current"])
        with use_operator():
            self.assertEqual(MemberAssociation.objects.count(), 1)
            self.assertEqual(MemberInvitation.objects.count(), 1)
            with self.assertRaises(IntegrityError), atomic():
                MemberAssociation.objects.filter(pk=association).update(current=True)
        self.client.force_authenticate(self.foreign)
        self.assertEqual(self.client.post(preview_endpoint, {"code": invitation_code}, format="json").status_code, 400)
        self.assertEqual(self.client.get(record_endpoint).status_code, 404)
        self.assertEqual(self.client.get("/api/v1/tokens/member-records/").json()["count"], 0)
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/member-certificate-requests/{certificate_id}/").json()["status"],
            "withdrawn",
        )
        copied_user, copied_profile = person("copied-award-recipient")
        self.client.force_authenticate(self.owner)
        copied_award = self.award_payload(name="Synthetic Copied Employee")
        recorded = self.client.post("/api/v1/tokens/register-awards/", copied_award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        invitation = self.client.post(
            "/api/v1/tokens/member-invitations/",
            self.invitation_payload(member=copied_award["member"], intended_email=copied_user.email),
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        with patch("tokens.services.member_access.sendgrid_client.send_email") as delivery:
            legacy_retry = self.client.post(
                email_endpoint,
                self.invitation_payload(
                    operation_id=invitation.json()["uuid"],
                    member=copied_award["member"],
                    intended_email=copied_user.email,
                ),
                format="json",
            )
            self.assertEqual(legacy_retry.status_code, 409, legacy_retry.content)
            delivery.assert_not_called()
        self.client.force_authenticate(copied_user)
        accepted = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {
                "code": invitation.json()["code"],
                "user_account": str(copied_profile.user_account.pk),
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        copied_association = accepted.json()["uuid"]
        copied_endpoint = f"/api/v1/tokens/member-records/{copied_association}/"
        self.assertEqual(self.client.get(copied_endpoint).json()["classes"], [])
        self.client.force_authenticate(self.owner)
        created = self.client.post(
            "/api/v1/tokens/",
            {
                "company": str(self.company.pk),
                "name": "Copied ordinary shares",
                "symbol": "COPY",
                "total_supply": "1000",
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        token = ShareToken.objects.get(pk=created.json()["uuid"])
        copied = import_payload(self.owner, self.appointment, token, member_id=copied_award["member"])
        copied["members"][0].update(name=copied_award["name"], residential_address=copied_award["residential_address"])
        endpoint = "/api/v1/tokens/register-imports/"
        prepared = self.client.post(endpoint, copied, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        self.decision(endpoint, prepared.json()["uuid"], "approve")
        _, applied = self.decision(endpoint, prepared.json()["uuid"], "apply")
        self.assertEqual(
            self.client.post(f"{endpoint}{prepared.json()['uuid']}/decide/", applied, format="json").status_code, 200
        )
        members = self.client.get(f"/api/v1/tokens/{token.pk}/register/members/").json()["members"]
        self.assertIn(
            (copied_award["member"], "100", True),
            [(row["member"], row["currentShares"], row["onRegister"]) for row in members],
        )
        self.client.force_authenticate(copied_user)
        own = self.client.get(copied_endpoint).json()
        self.assertEqual((own["member"], own["name"]), (copied_award["member"], copied_award["name"]))
        self.assertEqual((own["classes"][0]["shares"], own["classes"][0]["enteredOn"]), ("100", "2020-01-01"))
        self.assertEqual(own["awards"][0]["issuedShares"], "0")
        entries = self.client.get(f"{copied_endpoint}entries/?token={token.pk}").json()["entries"]
        self.assertEqual([(row["kind"], row["delta"]) for row in entries], [("opening", "100")])
        with use_operator():
            self.assertEqual(
                MemberAssociation.objects.get(pk=copied_association).member,
                RegisterMember.objects.get(pk=copied_award["member"]).pk,
            )
            self.assertEqual(MemberInvitation.objects.filter(member=copied_award["member"]).count(), 1)
