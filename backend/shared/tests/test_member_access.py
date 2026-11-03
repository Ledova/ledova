from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.db import IntegrityError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.services.administration import company_operation
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
    RegisterParticularsChange,
    ShareToken,
)
from tokens.services.company_pack_history import (
    particulars_change_records,
    particulars_changes,
)


class MemberAccessTest(CoreFixtures, APITransactionTestCase):
    @override_settings(DASHBOARD_BASE_URL="https://dashboard.example.test")
    def test_exact_walletless_association_own_entitlement_holdings_and_revocation(self):
        told = self.enterContext(patch("tokens.services.member_events.defer"))
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
        self.assertEqual(own["Cache-Control"], "private, no-store")
        self.assertIsNone(own.json()["ownership"])
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
        self.client.force_authenticate(self.owner)
        selections = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/")
        self.assertEqual(selections.status_code, 200, selections.content)
        self.assertEqual(selections.json()["awardRecipients"], [])
        recipient = next(row for row in selections.json()["members"] if row["member"] == award["member"])
        profile_name = self.foreign_profile.full_name
        self.assertEqual(
            (recipient["name"], recipient["residentialAddress"], recipient["onRegister"], recipient["followsProfile"]),
            (profile_name, award["residential_address"], False, True),
        )
        particulars = "/api/v1/tokens/register-particulars-changes/"
        company_edit = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "member": award["member"],
            "name": "Synthetic Company Rename",
            "residential_address": award["residential_address"],
            "expected": {"name": profile_name, "residential_address": award["residential_address"]},
        }
        refused = self.client.post(particulars, company_edit, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("Ledova profile", refused.content.decode())
        proposal = self.client.post(
            "/api/v1/tokens/register-grants/", self.linked_grant_payload(award, name=profile_name), format="json"
        )
        self.assertEqual(proposal.status_code, 201, proposal.content)
        self.decision("/api/v1/tokens/register-grants/", proposal.json()["uuid"], "approve")
        applied, _ = self.decision("/api/v1/tokens/register-grants/", proposal.json()["uuid"], "apply")
        issue_entry = applied.json()["registerEntry"]
        self.assertEqual(
            [(call.kwargs["user_id"], call.kwargs["title"], call.kwargs["data"]) for call in told.call_args_list],
            [
                (
                    str(self.foreign.pk),
                    "Shares issued",
                    {"type": "holding", "event": "issued", "token": str(self.token.pk), "record": association},
                )
            ],
        )
        self.client.force_authenticate(self.foreign)
        own = self.client.get(record_endpoint).json()
        self.assertEqual((own["classes"][0]["shares"], own["awards"][0]["issuedShares"]), ("25", "25"))
        self.assertIsNone(own["classes"][0]["amountPaid"])
        company_endpoint = f"/api/v1/companies/{self.company.pk}/"
        sharing = {"share_ownership_with_members": True}
        self.assertEqual(self.client.patch(company_endpoint, sharing, format="json").status_code, 404)
        self.client.force_authenticate(self.owner)
        enabled = self.client.patch(company_endpoint, sharing, format="json")
        self.assertEqual(enabled.status_code, 200, enabled.content)
        self.assertTrue(enabled.json()["shareOwnershipWithMembers"])
        self.assertEqual(enabled.json()["ownershipSharingChangedBy"], self.owner.pk)
        self.assertIsNotNone(enabled.json()["ownershipSharingChangedAt"])
        self.client.force_authenticate(self.foreign)
        overview = self.client.get(record_endpoint).json()["ownership"]
        self.assertEqual((overview["issuedSupply"], overview["totalHolders"]), ("125", 2))
        self.assertEqual((overview["classes"][0]["ownShares"], overview["classes"][0]["issuedSupply"]), ("25", "125"))
        self.assertEqual(
            set(overview), {"company", "companyName", "asAt", "complete", "issuedSupply", "totalHolders", "classes"}
        )
        self.assertNotIn(str(self.member.pk), str(overview))
        self.assertNotIn("Synthetic Member", str(overview))
        self.assertNotIn("evidence", str(overview))
        self.assertEqual(
            self.client.get("/api/v1/tokens/ownership/", {"company": str(self.company.pk)}).status_code, 404
        )
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/{self.token.pk}/ownership-holders/", {"sequence": 2}).status_code, 404
        )
        self.client.force_authenticate(self.owner)
        disabled = self.client.patch(company_endpoint, {"share_ownership_with_members": False}, format="json")
        self.assertEqual(disabled.status_code, 200, disabled.content)
        self.client.force_authenticate(self.foreign)
        self.assertIsNone(self.client.get(record_endpoint).json()["ownership"])
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(company_endpoint, sharing, format="json").status_code, 200)
        self.client.force_authenticate(self.foreign)
        entries = self.client.get(f"{record_endpoint}entries/?token={self.token.pk}").json()["entries"]
        self.assertEqual([(item["uuid"], item["delta"]) for item in entries], [(issue_entry, "25")])
        self.assertNotIn(str(self.member.pk), str(entries))
        self.assertNotIn("changes", str(entries))
        self.client.force_authenticate(self.owner)
        later = self.vesting_payload(award["operation_id"], shares="1")
        self.assertEqual(
            self.client.post("/api/v1/tokens/register-award-vestings/", later, format="json").status_code, 201
        )
        self.assertEqual(
            told.call_args.kwargs["data"],
            {"type": "award", "event": "vested", "award": award["operation_id"], "record": association},
        )
        self.client.force_authenticate(self.foreign)
        profile_endpoint = f"/api/user-profiles/{self.foreign_profile.pk}/"
        moved = {"full_name": "Synthetic Linked Member", "residential_address": "9 Profile Street, Sydney NSW 2000"}
        self.assertEqual(self.client.patch(profile_endpoint, moved, format="json").status_code, 200)
        self.assertEqual(self.client.patch(profile_endpoint, moved, format="json").status_code, 200)
        own = self.client.get(record_endpoint).json()
        self.assertEqual((own["name"], own["residentialAddress"]), (moved["full_name"], moved["residential_address"]))
        with company_operation(self.foreign, self.company.pk, "member_particulars_profile"):
            with self.assertRaises(IntegrityError), atomic():
                forged = RegisterParticularsChange.objects.create(
                    company=self.company,
                    member=self.member,
                    member_association_id=association,
                    name=moved["full_name"],
                    residential_address=moved["residential_address"],
                    as_at=timezone.now().date(),
                    evidence_fingerprint="",
                    evidence_snapshot={},
                    submitted_by=self.foreign,
                    reviewed_by=self.foreign,
                    status="applied",
                )
                RegisterMemberParticulars.objects.filter(member=self.member).update(
                    name=forged.name,
                    residential_address=forged.residential_address,
                    as_at=forged.as_at,
                    source_import=None,
                    source_change=forged,
                )
        self.client.force_authenticate(self.owner)
        history = self.client.get(particulars, {"member": award["member"]}).json()["results"]
        self.assertEqual(
            [(row["providedBy"], row["preparingAppointment"], row["name"]) for row in history],
            [("member", None, moved["full_name"]), ("member", None, profile_name)],
        )
        self.assertEqual([row["previousParticulars"]["name"] for row in history], [profile_name, award["name"]])
        self.assertEqual([(row["submittedBy"], row["reviewedBy"]) for row in history], [(None, None), (None, None)])
        requests_endpoint = "/api/v1/tokens/member-certificate-requests/"
        certificate = {"operation_id": str(uuid4()), "association": association, "entry": issue_entry}
        self.assertEqual(self.client.get(requests_endpoint).status_code, 404)
        self.assertEqual(self.client.post(requests_endpoint, certificate, format="json").status_code, 405)
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
            self.client.patch(profile_endpoint, {"full_name": "Synthetic Unlinked"}, format="json").status_code, 200
        )
        with use_operator():
            packed = particulars_changes(particulars_change_records(self.company))
        self.assertEqual([row["reviewer"] for row in packed if row["provided_by"] == "member"], [None, None])
        self.client.force_authenticate(self.owner)
        company_edit.update(
            operation_id=str(uuid4()),
            expected={"name": moved["full_name"], "residential_address": moved["residential_address"]},
        )
        changed = self.client.post(particulars, company_edit, format="json")
        self.assertEqual((changed.status_code, changed.json()["providedBy"]), (201, "company"), changed.content)
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
        after = self.vesting_payload(award["operation_id"], shares="1")
        self.assertEqual(
            self.client.post("/api/v1/tokens/register-award-vestings/", after, format="json").status_code, 201
        )
        self.assertEqual(told.call_count, 2)
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
        self.client.force_authenticate(copied_user)
        incomplete = self.client.get(copied_endpoint).json()["ownership"]
        self.assertFalse(incomplete["complete"])
        self.assertIsNone(incomplete["issuedSupply"])
        unopened = next(row for row in incomplete["classes"] if row["uuid"] == str(token.pk))
        self.assertIsNone(unopened["ownShares"])
        self.client.force_authenticate(self.owner)
        copied = import_payload(self.owner, self.appointment, token, member_id=copied_award["member"])
        copied["members"][0].update(
            name=copied_profile.full_name, residential_address=copied_award["residential_address"]
        )
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
        self.assertEqual((own["member"], own["name"]), (copied_award["member"], copied_profile.full_name))
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
