import hashlib
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient, APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyDocument,
    CompanySignupTermsAcceptance,
)
from companies.services import transition_company
from companies.services.authority import (
    DECLARATION_VERSION,
    SIGNUP_DECLARATION_TEXT,
    SIGNUP_DECLARATION_VERSION,
)
from companies.services.authority_requests import submit_authority_request
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from shared.db import atomic, use_migrate, use_operator
from shared.tests.core_fixtures import (
    PASSWORD,
    CoreFixtures,
    matching_observation,
    pdf_bytes,
    person,
)
from tokens.models import (
    RegisterExport,
    RegisterGrant,
    RegisterGrantDecision,
    RegisterPersonRegistration,
    RegisterPosition,
    RegisterTransfer,
    RegisterTransferDecision,
    ShareToken,
)
from tokens.services.creation import create_share_token
from tokens.services.holder_identity import identity_at_allotment
from tokens.services.register import MEMBER_AMBIGUOUS, _member_identity
from tokens.services.register_events import record_entry
from tokens.services.register_transfers import _apply as apply_register_transfer
from users.models import FinancialProfile, UserAccount
from users.services.setup import ensure_defaults
from wallets.models import Wallet
from whitelist.models import WhitelistEntry
from whitelist.services.identity import entry_identity, identities_for


def unfinished_signup(label, acn):
    with use_operator():
        user = get_user_model().objects.create_user(
            email=f"{label}@example.test", password=PASSWORD, is_active=True, is_email_verified=True
        )
        profile, account, _, _ = ensure_defaults(user)
        profile.full_name = f"Synthetic {label}"
        profile.confirmed_over_18 = True
        profile.save(update_fields=["full_name", "confirmed_over_18"])
        account.role = "company"
        account.save(update_fields=["role"])
        FinancialProfile.objects.create(user_profile=profile, occupation="Synthetic")
    with use_migrate():
        company = Company.objects.create(owner=user, name=f"Synthetic {label} Pty Ltd", acn=acn)
    return user, profile, account, company


class RegistryCoreTest(CoreFixtures, APITransactionTestCase):
    def test_company_ownership_summary_and_paged_holders_are_exact_and_current(self):
        overview = "/api/v1/tokens/ownership/"
        summary = self.client.get(overview, {"company": str(self.company.pk)})
        self.assertEqual(summary.status_code, 200, summary.content)
        self.assertEqual(
            (summary.json()["complete"], summary.json()["issuedSupply"], summary.json()["totalHolders"]),
            (True, "100", 1),
        )
        with use_operator():
            second = ShareToken.objects.create(
                company=self.company, name="Synthetic preference shares", symbol="PREF", total_supply="1000"
            )
        unopened = self.client.get(overview, {"company": str(self.company.pk)}).json()
        self.assertEqual(
            (unopened["complete"], unopened["issuedSupply"], unopened["totalHolders"]), (False, None, None)
        )
        payload = self.import_payload_for_ownership(second)
        prepared = self.client.post("/api/v1/tokens/register-imports/", payload, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        self.decision("/api/v1/tokens/register-imports/", prepared.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-imports/", prepared.json()["uuid"], "apply")
        summary = self.client.get(overview, {"company": str(self.company.pk)}).json()
        self.assertEqual((summary["complete"], summary["issuedSupply"], summary["totalHolders"]), (True, "200", 2))
        self.assertEqual(sum(int(row["issuedSupply"]) for row in summary["classes"]), 200)
        self.assertTrue(all(row["recordedAt"] and row["sequence"] == 1 for row in summary["classes"]))
        endpoint = f"/api/v1/tokens/{second.pk}/ownership-holders/"
        first = self.client.get(endpoint, {"sequence": 1, "page_size": 1})
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual((first.json()["count"], len(first.json()["results"])), (2, 1))
        self.assertEqual(
            (first.json()["results"][0]["member"], first.json()["results"][0]["balance"]),
            (str(self.member.pk), "60"),
        )
        self.assertEqual(first.json()["results"][0]["percentage"], "60.00")
        self.assertTrue(first.json()["next"])
        later = self.client.get(endpoint, {"sequence": 1, "page_size": 1, "page": 2}).json()
        self.assertEqual((later["results"][0]["name"], later["results"][0]["balance"]), ("Synthetic Second", "40"))
        found = self.client.get(endpoint, {"sequence": 1, "search": "SECOND synthetic"}).json()
        self.assertEqual((found["count"], found["results"][0]["name"]), (1, "Synthetic Second"))
        empty = self.client.get(endpoint, {"sequence": 1, "search": "missing"}).json()
        self.assertEqual((empty["count"], empty["results"]), (0, []))
        self.assertEqual(self.client.get(endpoint, {"sequence": 1, "search": "x" * 101}).status_code, 400)
        self.assertEqual(self.client.get(endpoint, {"sequence": 1, "page": 0}).status_code, 404)
        identifier = self.prepare_grant()
        self.decision("/api/v1/tokens/register-grants/", identifier, "approve")
        self.decision("/api/v1/tokens/register-grants/", identifier, "apply")
        stale = self.client.get(f"/api/v1/tokens/{self.token.pk}/ownership-holders/", {"sequence": 1})
        self.assertEqual(stale.status_code, 409, stale.content)
        reader, _ = person("ownership-reader")
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.appointment.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.READ_REGISTER],
        )
        appointment = accept_team_invitation(
            requester=reader,
            code=code,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        )
        self.client.force_authenticate(reader)
        self.assertEqual(self.client.get(overview, {"company": str(self.company.pk)}).status_code, 200)
        self.assertEqual(self.client.get(endpoint, {"sequence": 1}).status_code, 200)
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        self.assertEqual(self.client.get(overview, {"company": str(self.company.pk)}).status_code, 404)
        self.assertEqual(self.client.get(endpoint, {"sequence": 1}).status_code, 404)
        self.client.force_authenticate(self.owner)
        revoke_company_appointment(
            requester=self.owner,
            appointment_id=self.appointment.pk,
        )
        self.assertEqual(self.client.get(overview, {"company": str(self.company.pk)}).status_code, 200)
        self.assertEqual(self.client.get(endpoint, {"sequence": 1}).status_code, 200)

    def import_payload_for_ownership(self, token):
        from shared.tests.core_fixtures import import_payload

        payload = import_payload(self.owner, self.appointment, token, member_id=self.member.pk)
        payload["asic_member_count"] = 2
        first = payload["members"][0]
        first["shares"] = "60"
        first["allotments"] = []
        payload["members"].append(
            {
                **first,
                "member": str(uuid4()),
                "name": "Synthetic Second",
                "residential_address": "2 Example Street, Sydney NSW 2000",
                "shares": "40",
            }
        )
        return payload

    def test_unfinished_signup_restarts_with_a_new_email_only_before_company_setup(self):
        def sign_in(user):
            self.client.force_authenticate(user=None)
            response = self.client.post("/api/signin/", {"email": user.email, "password": PASSWORD}, format="json")
            self.assertEqual(response.status_code, 200, response.content)

        starter, profile, account, draft = unfinished_signup("restart-first", "707070700")
        sign_in(starter)
        for payload, message in (
            ({"email": "restart-new@example.test", "current_password": "wrong-password"}, "Current password"),
            ({"email": self.foreign.email, "current_password": PASSWORD}, "Email already registered"),
            ({"email": starter.email, "current_password": PASSWORD}, "already your email"),
        ):
            refused = self.client.post("/api/restart-signup/", payload, format="json")
            self.assertEqual(refused.status_code, 400, refused.content)
            self.assertIn(message, str(refused.json()))
        old_session = self.client.cookies["access"].value
        mail.outbox.clear()
        restarted = self.client.post(
            "/api/restart-signup/", {"email": "restart-new@example.test", "current_password": PASSWORD}, format="json"
        )
        self.assertEqual(restarted.status_code, 200, restarted.content)
        self.assertEqual(restarted.cookies["access"].value, "")
        self.assertEqual([message.to for message in mail.outbox], [["restart-new@example.test"]])
        replayed = APIClient()
        replayed.cookies["access"] = old_session
        self.assertIn(replayed.get("/api/user-profiles/").status_code, (401, 403))
        with use_operator():
            starter.refresh_from_db()
            profile.refresh_from_db()
            account.refresh_from_db()
            self.assertEqual((starter.email, starter.is_email_verified), ("restart-new@example.test", False))
            self.assertEqual((profile.full_name, profile.confirmed_over_18, account.role), (None, False, "investor"))
            self.assertFalse(FinancialProfile.objects.filter(user_profile=profile).exists())
            self.assertTrue(Company.objects.filter(pk=draft.pk, owner=starter).exists())
        submitter, _, _, submitted = unfinished_signup("restart-submitted", "808080800")
        submit_authority_request(
            requester=submitter,
            company_id=submitted.pk,
            idempotency_key=uuid4(),
            requested_capabilities=[CompanyCapability.ADMIN],
            delegatable_capabilities=list(CompanyCapability.values),
        )
        for user, message in ((submitter, "Company setup has been submitted"), (self.owner, "Signup is complete")):
            sign_in(user)
            refused = self.client.post(
                "/api/restart-signup/",
                {"email": "restart-late@example.test", "current_password": PASSWORD},
                format="json",
            )
            self.assertEqual(refused.status_code, 400, refused.content)
            self.assertIn(message, str(refused.json()))
            with use_operator():
                user.refresh_from_db()
                self.assertTrue(user.is_email_verified)
                self.assertNotEqual(user.email, "restart-late@example.test")

    def test_company_registration_records_the_owner_and_contact(self):
        user, profile = person("registration")
        self.client.force_authenticate(user)
        response = self.client.post(
            "/api/v1/companies/",
            {
                "name": "Synthetic New Pty Ltd",
                "acn": "987654320",
                "companyType": "pty",
                "primaryContact": {"firstName": "Ada", "lastName": "Example", "phone": "+61 0400000000"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        company = Company.objects.get(pk=response.json()["company"]["uuid"])
        profile.refresh_from_db()
        self.assertEqual((company.owner_id, company.status, profile.full_name), (user.pk, "draft", "Ada Example"))

    def test_representative_declaration_and_activation_use_current_company_authority(self):
        user, _ = person("representative")
        with use_migrate():
            company = Company.objects.create(owner=user, name="Synthetic Declared Pty Ltd", acn="123456780")
        self.client.force_authenticate(user)
        self.scanner.reset_mock()
        request = {
            "company": str(company.pk),
            "idempotency_key": str(uuid4()),
            "requested_capabilities": ["admin"],
            "delegatable_capabilities": list(CompanyCapability.values),
        }
        with patch("shared.upload_limits.reserve_request") as reserve:
            response = self.client.post("/api/v1/company-authority/requests/", request, format="json")
            replay = self.client.post("/api/v1/company-authority/requests/", request, format="json")
            reserve.assert_not_called()
        self.scanner.assert_not_called()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()["uuid"], response.json()["uuid"])
        self.assertIsNone(response.json()["fileUrl"])
        self.assertEqual(response.json()["fileSize"], 0)
        missing = self.client.get(f"/api/v1/company-authority/requests/{response.json()['uuid']}/file/")
        self.assertEqual(missing.status_code, 404, missing.content)
        declaration = {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": True}
        with patch("companies.services.registry.lookup_company") as lookup:
            admitted = self.client.post(
                f"/api/v1/company-authority/requests/{response.json()['uuid']}/admit/", declaration, format="json"
            )
            lookup.assert_not_called()
        self.assertEqual(admitted.status_code, 200, admitted.content)
        appointment = admitted.json()["appointment"]["uuid"]
        self.assertEqual(admitted.json()["appointment"]["declarationText"], SIGNUP_DECLARATION_TEXT)
        self.assertEqual(admitted.json()["appointment"]["declarationVersion"], SIGNUP_DECLARATION_VERSION)
        accepted_terms = self.client.post(
            f"/api/v1/company-authority/appointments/{appointment}/signup-terms/", declaration, format="json"
        )
        self.assertEqual(accepted_terms.status_code, 200, accepted_terms.content)
        self.assertEqual(accepted_terms.json()["signupTerms"]["declarationText"], SIGNUP_DECLARATION_TEXT)
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 0)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            activated = self.client.post(
                f"/api/v1/companies/{company.pk}/activate/",
                {
                    "declaration_version": DECLARATION_VERSION,
                    "accept_declaration": True,
                    "appointment": appointment,
                    "idempotency_key": str(uuid4()),
                    "lifecycle_revision": company.lifecycle_revision,
                },
                format="json",
            )
        self.assertEqual(activated.status_code, 200, activated.content)
        company.refresh_from_db()
        self.assertEqual(company.status, "active")
        self.assertEqual(CompanyAppointment.objects.get(pk=appointment).appointee_id, user.pk)
        with patch("shared.upload_limits.reserve_request") as reserve:
            uploaded = self.client.post(
                f"/api/v1/companies/{company.pk}/documents/",
                {
                    "document_type": "other",
                    "name": "Company authority document",
                    "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
                },
                format="multipart",
            )
            reserve.assert_called_once_with(user.pk)
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        self.scanner.assert_called_once()
        self.assertEqual(CompanyDocument.objects.get(pk=uploaded.json()["uuid"]).company_id, company.pk)
        invited = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(company.pk),
                "inviter_appointment": appointment,
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.READ_REGISTER],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(invited.status_code, 201, invited.content)

    def test_a_member_without_a_full_name_is_never_named_by_email(self):
        holder, profile = person("core-unnamed")
        address, named_address = "0x" + "ab" * 20, "0x" + "cd" * 20
        with use_migrate():
            profile.full_name = "  "
            profile.residential_address = "1 Synthetic Street"
            profile.save(update_fields=["full_name", "residential_address"])
            entry = WhitelistEntry.objects.create(
                wallet=Wallet.objects.create(
                    user_account=UserAccount.objects.get(user_profile=profile), address=address, chain="base"
                )
            )
            WhitelistEntry.objects.create(
                wallet=Wallet.objects.create(
                    user_account=UserAccount.objects.get(user_profile=self.profile),
                    address=named_address,
                    chain="base",
                )
            )
        with use_operator():
            identity = entry_identity(WhitelistEntry.objects.get(pk=entry.pk))
            stamped = identity_at_allotment(address, chain="base")
            shared = _member_identity([named_address, address], identities_for([named_address, address]), {})
        self.assertEqual((identity.holder_type, identity.name), ("unidentified", ""))
        self.assertFalse(stamped)
        self.assertNotIn(holder.email, (identity.name, stamped.name))
        self.assertEqual(shared, MEMBER_AMBIGUOUS)

    def test_company_status_changes_need_the_staff_change_permission(self):
        staff, _ = person("core-staff")
        with use_migrate():
            get_user_model().objects.filter(pk=staff.pk).update(is_staff=True)
        staff.refresh_from_db()
        self.client.force_authenticate(staff)
        removed = self.client.post(
            f"/api/v1/companies/{self.company.pk}/status/",
            {"status": "suspended", "reason": "Synthetic"},
            format="json",
        )
        self.assertEqual(removed.status_code, 404, removed.content)
        with self.assertRaisesMessage(
            PermissionDenied, "Company recovery requires the current model change permission."
        ):
            transition_company(self.company, "suspend", actor=staff, reason="Synthetic reason")

    def test_company_team_invitation_records_the_invitees_exact_capability(self):
        response = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.READ_REGISTER],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        grant = self.prepare_grant()
        self.client.force_authenticate(self.foreign)
        accepted = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": response.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        appointment = CompanyAppointment.objects.get(company=self.company, appointee=self.foreign)
        self.assertEqual(appointment.capabilities, [CompanyCapability.READ_REGISTER])
        self.assertIsNotNone(appointment.invitation_id)
        holders = self.client.get(f"/api/v1/tokens/{self.token.pk}/holders/")
        self.assertEqual(holders.status_code, 200, holders.content)
        self.assertIn("Synthetic Member", str(holders.json()))
        class_payload = {
            "company": str(self.company.pk),
            "name": "Synthetic delegated shares",
            "symbol": "DEL",
            "total_supply": "1000",
        }
        read_only_class = self.client.post("/api/v1/tokens/", class_payload, format="json")
        self.assertEqual(read_only_class.status_code, 400, read_only_class.content)
        endpoint = f"/api/v1/tokens/register-grants/{grant}/"
        fields = {"appointment": str(appointment.pk), "kind": "approve"}
        preview = self.client.post(f"{endpoint}decision-preview/", fields, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canDecide"])
        self.assertIn("appointment_capability_required", preview.json()["unmetRequirements"])
        approval = self.client.post(
            f"{endpoint}decide/",
            {
                **fields,
                "idempotency_key": str(uuid4()),
                "preview_digest": preview.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(approval.status_code, 400, approval.content)
        issue = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.grant_payload(appointment=str(appointment.pk)),
            format="json",
        )
        self.assertEqual(issue.status_code, 404, issue.content)
        award = self.client.post(
            "/api/v1/tokens/register-awards/",
            self.award_payload(appointment=str(appointment.pk)),
            format="json",
        )
        self.assertEqual(award.status_code, 404, award.content)
        self.assertEqual(RegisterGrant.objects.count(), 1)
        self.assertEqual(RegisterGrantDecision.objects.filter(register_grant_id=grant).count(), 0)
        self.assertIsNone(RegisterGrant.objects.get(pk=grant).register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        refused_terms = self.client.post(
            f"/api/v1/company-authority/appointments/{appointment.pk}/signup-terms/",
            {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(refused_terms.status_code, 404, refused_terms.content)
        self.client.force_authenticate(self.owner)
        resumed_user, resumed_profile = person("resumed-admin")
        with use_operator():
            resumed_profile.is_signup_completed = False
            resumed_profile.save(update_fields=["is_signup_completed"])
        invitation = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": ["admin"],
                "delegatable_capabilities": [],
                "appointment_expires_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        self.client.force_authenticate(resumed_user)
        original = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": invitation.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(original.status_code, 200, original.content)
        original = original.json()
        self.assertIsNone(original["signupTerms"])
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 0)
        endpoint = f"/api/v1/company-authority/appointments/{original['uuid']}/signup-terms/"
        not_accepted = self.client.post(
            endpoint, {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": False}, format="json"
        )
        self.assertEqual(not_accepted.status_code, 400, not_accepted.content)
        acknowledgement = {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": True}
        accepted_terms = self.client.post(endpoint, acknowledgement, format="json")
        retry = self.client.post(endpoint, acknowledgement, format="json")
        self.assertEqual(accepted_terms.status_code, 200, accepted_terms.content)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(accepted_terms.json()["signupTerms"], retry.json()["signupTerms"])
        for field in (
            "uuid",
            "capabilities",
            "delegatableCapabilities",
            "expiresAt",
            "declarationVersion",
            "declarationText",
        ):
            self.assertEqual(accepted_terms.json()[field], original[field])
        receipt = accepted_terms.json()["signupTerms"]
        self.assertEqual(receipt["acceptedProfile"], str(resumed_profile.pk))
        self.assertEqual(receipt["acceptedBy"], resumed_user.pk)
        self.assertEqual(receipt["appointment"], original["uuid"])
        self.assertEqual(receipt["company"], str(self.company.pk))
        self.assertEqual(receipt["declarationText"], SIGNUP_DECLARATION_TEXT)
        self.assertEqual(receipt["declarationVersion"], SIGNUP_DECLARATION_VERSION)
        resumed_profile.refresh_from_db()
        self.assertFalse(resumed_profile.is_signup_completed)
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 1)
        delegated_class = self.client.post("/api/v1/tokens/", class_payload, format="json")
        self.assertEqual(delegated_class.status_code, 201, delegated_class.content)
        self.assertFalse(delegated_class.json()["isOwner"])
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanySignupTermsAcceptance.objects.filter(appointment_id=original["uuid"]).update(
                declaration_text="Changed"
            )
        self.client.force_authenticate(self.owner)
        foreign_terms = self.client.post(endpoint, acknowledgement, format="json")
        self.assertEqual(foreign_terms.status_code, 404, foreign_terms.content)
        revoked = self.client.post(
            f"/api/v1/company-authority/appointments/{original['uuid']}/revoke/", {}, format="json"
        )
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.assertIsNone(revoked.json()["signupTerms"])
        self.client.force_authenticate(resumed_user)
        retained = self.client.get("/api/v1/company-authority/appointments/")
        self.assertEqual(retained.status_code, 200, retained.content)
        self.assertEqual(retained.json()["results"][0]["signupTerms"], receipt)
        revoked_terms = self.client.post(endpoint, acknowledgement, format="json")
        self.assertEqual(revoked_terms.status_code, 404, revoked_terms.content)
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 1)
        class_payload["symbol"] = "PREP"
        revoked_class = self.client.post("/api/v1/tokens/", class_payload, format="json")
        self.assertEqual(revoked_class.status_code, 400, revoked_class.content)
        self.client.force_authenticate(self.owner)
        invitation = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.PREPARE],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        self.client.force_authenticate(resumed_user)
        preparer = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": invitation.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(preparer.status_code, 200, preparer.content)
        prepared_class = self.client.post("/api/v1/tokens/", class_payload, format="json")
        self.assertEqual(prepared_class.status_code, 201, prepared_class.content)
        self.assertFalse(prepared_class.json()["isOwner"])
        foreign_class = self.client.post(
            "/api/v1/tokens/", {**class_payload, "company": str(self.foreign_company.pk)}, format="json"
        )
        self.assertEqual(foreign_class.status_code, 400, foreign_class.content)

        def revoked_creation(**values):
            revoke_company_appointment(requester=self.owner, appointment_id=preparer.json()["uuid"])
            return create_share_token(**values)

        class_payload["symbol"] = "RACE"
        with patch("tokens.serializers.share_token.create_share_token", side_effect=revoked_creation):
            raced = self.client.post("/api/v1/tokens/", class_payload, format="json")
        self.assertEqual(raced.status_code, 404, raced.content)
        self.assertFalse(ShareToken.objects.filter(company=self.company, symbol="RACE").exists())
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        self.client.force_authenticate(self.owner)
        owner_without_authority = self.client.post("/api/v1/tokens/", class_payload, format="json")
        self.assertEqual(owner_without_authority.status_code, 400, owner_without_authority.content)

    def test_walletless_transfer_preserves_issued_shares_and_records_the_recipient(self):
        evidence = self.grant_payload()
        recipient = str(uuid4())
        people_endpoint = "/api/v1/tokens/register-people/"
        person_payload = {
            "operation_id": str(uuid4()),
            "company": str(self.foreign_company.pk),
            "appointment": str(self.foreign_appointment.pk),
            "member": str(uuid4()),
            "name": "Synthetic Prospective Person",
            "residential_address": "4 Example Street, Sydney NSW 2000",
        }
        self.client.force_authenticate(self.foreign)
        first = self.client.post(people_endpoint, person_payload, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertFalse(ShareToken.objects.filter(company=self.foreign_company).exists())
        self.assertFalse(RegisterPosition.objects.filter(member_id=person_payload["member"]).exists())
        self.client.force_authenticate(self.owner)
        hidden = self.client.get(people_endpoint, {"company": str(self.foreign_company.pk)})
        self.assertEqual(hidden.status_code, 404, hidden.content)
        refused = self.client.post(people_endpoint, person_payload, format="json")
        self.assertEqual(refused.status_code, 404, refused.content)
        person_payload.update(
            operation_id=str(uuid4()),
            company=str(self.company.pk),
            appointment=str(self.appointment.pk),
            member=recipient,
            name="Synthetic Recipient",
            residential_address="3 Example Street, Sydney NSW 2000",
        )
        registered = self.client.post(people_endpoint, person_payload, format="json")
        self.assertEqual(registered.status_code, 201, registered.content)
        repeated = self.client.post(people_endpoint, person_payload, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.content)
        changed_person = self.client.post(people_endpoint, {**person_payload, "name": "Changed"}, format="json")
        self.assertEqual(changed_person.status_code, 409, changed_person.content)
        listed = self.client.get(people_endpoint, {"company": str(self.company.pk)})
        self.assertEqual(listed.status_code, 200, listed.content)
        new_person = next(row for row in listed.json()["members"] if row["member"] == recipient)
        self.assertEqual(
            (new_person["currentShares"], new_person["onRegister"], new_person["hasAwards"]), ("0", False, False)
        )
        self.assertFalse(RegisterPosition.objects.filter(member_id=recipient).exists())
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            RegisterPersonRegistration.objects.filter(pk=registered.json()["uuid"]).update(name="Forged")
        endpoint = "/api/v1/tokens/register-transfers/"
        payload = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "token_id": str(self.token.pk),
            "from_member": str(self.member.pk),
            "to_member": recipient,
            "new_member": False,
            "name": "Synthetic Recipient",
            "residential_address": "3 Example Street, Sydney NSW 2000",
            "shares": "25",
            "company_event_on": timezone.now().date().isoformat(),
            "signed_on": timezone.now().date().isoformat(),
            "lodged_on": timezone.now().date().isoformat(),
            "terms": "Non-paid transfer with a signed synthetic instrument",
            "approving_director": "Synthetic Independent Director",
            "authority_reference": "SYNTHETIC-CORE-TRANSFER",
            "reason": "Record the company-approved transfer",
            "authority_evidence": evidence["authority_evidence"],
            "instrument_evidence": evidence["terms_evidence"],
        }
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
        restricted = self.client.post(endpoint, payload, format="json")
        self.assertEqual(restricted.status_code, 400, restricted.content)
        self.assertEqual(restricted.json()["unmetRequirements"], ["class_transfers_restricted"])
        self.assertEqual(RegisterTransfer.objects.count(), 0)
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=True)
        response = self.client.post(endpoint, payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.appointment.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.APPROVE],
        )
        approver = accept_team_invitation(
            requester=self.foreign, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        self.client.force_authenticate(self.foreign)
        self.decision(endpoint, identifier, "approve", appointment=approver)
        self.client.force_authenticate(self.owner)
        approval = RegisterTransferDecision.objects.get(register_transfer_id=identifier, kind="approve")
        fields = {"appointment": str(self.appointment.pk), "kind": "approve", "complete_transfer": True}
        preview = self.client.post(f"{endpoint}{identifier}/decision-preview/", fields, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertTrue(preview.json()["completeTransfer"])
        self.assertEqual(preview.json()["applyAppointment"], str(self.appointment.pk))
        self.assertEqual(
            (preview.json()["company"], preview.json()["token"]), (str(self.company.pk), str(self.token.pk))
        )
        self.assertEqual(preview.json()["instrumentFingerprint"], response.json()["instrumentFingerprint"])
        decision = {
            **fields,
            "idempotency_key": str(uuid4()),
            "preview_digest": preview.json()["previewDigest"],
            "confirmation": True,
        }
        self.assertEqual(
            self.client.post(
                f"{endpoint}{identifier}/decide/", {**decision, "complete_transfer": False}, format="json"
            ).status_code,
            409,
        )
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
        restricted = self.client.post(f"{endpoint}{identifier}/decision-preview/", fields, format="json")
        self.assertEqual(restricted.status_code, 200, restricted.content)
        self.assertFalse(restricted.json()["canDecide"])
        self.assertEqual(restricted.json()["unmetRequirements"], ["class_transfers_restricted"])
        self.assertNotEqual(restricted.json()["previewDigest"], decision["preview_digest"])
        stale = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(RegisterTransferDecision.objects.filter(register_transfer_id=identifier).count(), 1)
        self.assertIsNone(RegisterTransfer.objects.get(pk=identifier).register_entry_id)
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=True)

        def restrict_after_entry(**values):
            entry = record_entry(**values)
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
            return entry

        with patch("tokens.services.register_transfers.record_entry", side_effect=restrict_after_entry):
            refused = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        self.assertEqual(refused.status_code, 409, refused.content)
        self.assertEqual(RegisterTransferDecision.objects.filter(register_transfer_id=identifier).count(), 1)
        self.assertIsNone(RegisterTransfer.objects.get(pk=identifier).register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        self.assertFalse(RegisterPosition.objects.filter(member_id=recipient).exists())
        self.assertTrue(ShareToken.objects.get(pk=self.token.pk).is_transferable)
        self.token.stored_register.refresh_from_db()
        self.assertEqual(self.token.stored_register.sequence, 1)
        applied = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        self.assertEqual(applied.status_code, 200, applied.content)
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
        retry = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        prepared_retry = self.client.post(endpoint, payload, format="json")
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(prepared_retry.status_code, 200, prepared_retry.content)
        self.assertEqual(RegisterTransferDecision.objects.filter(register_transfer_id=identifier).count(), 2)
        approval.refresh_from_db()
        self.assertEqual(approval.appointment_id, approver.pk)
        completion = next(row for row in retry.json()["decisions"] if row["kind"] == "apply")
        self.assertTrue(completion["completeTransfer"])
        self.assertEqual(completion["approvalAppointment"], str(self.appointment.pk))
        self.assertEqual(completion["idempotencyKey"], decision["idempotency_key"])
        self.assertEqual(completion["digest"], decision["preview_digest"])
        self.assertEqual(
            self.client.post(
                f"{endpoint}{identifier}/decide/",
                {**decision, "complete_transfer": False, "kind": "apply"},
                format="json",
            ).status_code,
            409,
        )
        positions = RegisterPosition.objects.filter(register=self.token.stored_register)
        self.assertEqual(positions.get(member=self.member).shares, 75)
        self.assertEqual(positions.get(member_id=recipient).shares, 25)
        self.token.stored_register.refresh_from_db()
        self.assertEqual(int(self.token.stored_register.issued_supply), 100)

        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=True)
        fresh = self.client.post(
            endpoint,
            {
                **payload,
                "operation_id": str(uuid4()),
                "from_member": recipient,
                "to_member": str(self.member.pk),
                "name": "",
                "residential_address": "",
            },
            format="json",
        )
        self.assertEqual(fresh.status_code, 201, fresh.content)
        fresh_id = fresh.json()["uuid"]
        self.client.force_authenticate(self.foreign)
        split = {**fields, "appointment": str(approver.pk)}
        blocked = self.client.post(f"{endpoint}{fresh_id}/decision-preview/", split, format="json")
        self.assertEqual(blocked.status_code, 200, blocked.content)
        self.assertFalse(blocked.json()["canDecide"])
        self.assertEqual(blocked.json()["unmetRequirements"], ["appointment_capability_required"])
        refused = self.client.post(
            f"{endpoint}{fresh_id}/decide/",
            {
                **split,
                "idempotency_key": str(uuid4()),
                "preview_digest": blocked.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertFalse(RegisterTransferDecision.objects.filter(register_transfer_id=fresh_id).exists())
        wrong_actor = self.client.post(
            f"{endpoint}{fresh_id}/decision-preview/",
            {**split, "apply_appointment": str(self.appointment.pk)},
            format="json",
        )
        self.assertEqual(wrong_actor.status_code, 404, wrong_actor.content)
        revoke_company_appointment(requester=self.owner, appointment_id=approver.pk)
        _, code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.appointment.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.APPROVE, CompanyCapability.APPLY],
        )
        application = accept_team_invitation(
            requester=self.foreign, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        split.update(appointment=str(application.pk), apply_appointment=str(application.pk))
        ready = self.client.post(f"{endpoint}{fresh_id}/decision-preview/", split, format="json")
        self.assertTrue(ready.json()["canDecide"], ready.content)
        exact = {
            **split,
            "idempotency_key": str(uuid4()),
            "preview_digest": ready.json()["previewDigest"],
            "confirmation": True,
        }

        def revoke_after_entry(**values):
            entry = record_entry(**values)
            revoke_company_appointment(requester=self.owner, appointment_id=application.pk)
            return entry

        def revoke_after_apply(*args):
            apply_register_transfer(*args)
            revoke_company_appointment(requester=self.owner, appointment_id=application.pk)

        for target, effect in (("record_entry", revoke_after_entry), ("_apply", revoke_after_apply)):
            with patch(f"tokens.services.register_transfers.{target}", side_effect=effect):
                refused = self.client.post(f"{endpoint}{fresh_id}/decide/", exact, format="json")
            self.assertEqual(refused.status_code, 409, refused.content)
            self.assertFalse(RegisterTransferDecision.objects.filter(register_transfer_id=fresh_id).exists())
            self.assertIsNone(RegisterTransfer.objects.get(pk=fresh_id).register_entry_id)
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 75)
        completed = self.client.post(f"{endpoint}{fresh_id}/decide/", exact, format="json")
        self.assertEqual(completed.status_code, 200, completed.content)
        self.assertEqual(completed.json()["stage"], "applied")
        self.assertEqual(len(completed.json()["decisions"]), 2)
        self.assertEqual(
            self.client.post(f"{endpoint}{fresh_id}/decide/", exact, format="json").json()["registerEntry"],
            completed.json()["registerEntry"],
        )
        changed = self.client.post(
            f"{endpoint}{fresh_id}/decide/", {**exact, "apply_appointment": str(approver.pk)}, format="json"
        )
        self.assertEqual(changed.status_code, 409, changed.content)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        self.assertEqual(RegisterPosition.objects.get(member_id=recipient).shares, 0)
        self.token.stored_register.refresh_from_db()
        self.assertEqual((int(self.token.stored_register.issued_supply), self.token.stored_register.sequence), (100, 3))

    def test_company_inspection_copy_serves_and_retains_the_real_register_bytes(self):
        endpoint = f"/api/v1/tokens/{self.token.pk}/register/inspection-copy/"
        preview = self.client.get(endpoint)
        self.assertEqual(preview.status_code, 200, preview.content)
        response = self.client.post(
            endpoint,
            {
                "appointment": preview.json()["appointment"],
                "sourceDigest": preview.json()["sourceDigest"],
                "instruction": "SYNTHETIC-CORE-INSPECTION",
                "requestedOn": timezone.now().date().isoformat(),
                "recipient": "Synthetic Requester",
            },
            format="json",
        )
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        self.assertIn("Synthetic Member", response.content.decode())
        record = RegisterExport.objects.get(token=self.token, kind="inspection_copy", requested_by_id=self.owner.pk)
        self.assertEqual(record.digest, hashlib.sha256(response.content).hexdigest())
        self.assertEqual(record.member_rows, 1)
