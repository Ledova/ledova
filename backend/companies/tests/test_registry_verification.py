from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.admin.sites import AdminSite
from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from companies.admin.company import CompanyAdmin
from companies.exceptions import (
    InvalidStatusTransitionException,
    OfficeholderAttestationRequiredException,
    RegistryVerificationRequiredException,
)
from companies.identity import officeholder_declaration
from companies.models import (
    Company,
    CompanyStatus,
    CompanyType,
    RegistryCheckPurpose,
    RegistryCheckStatus,
)
from companies.serializers.company import CompanyUpdateSerializer
from companies.services import transition_company
from companies.services.editing import update_company
from companies.services.registry import begin_registry_check, complete_registry_check
from companies.tests.registry_fixtures import DECLARATION, matching_observation
from companies.tests.test_document_file_access import (
    invite_company_administrator,
    legacy_company_administrators,
)
from integrations.abr.client import RegistryObservation, lookup_company
from shared.db import atomic, current_alias, use_migrate

User = get_user_model()
PROVIDER = "companies.services.registry.lookup_company"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
ACTIVE_ENTRIES = (
    (CompanyStatus.WARNING, "resolve_warning"),
    (CompanyStatus.SUSPENDED, "reinstate"),
)


@override_settings(STORAGES=STORAGES, ABR_AUTH_GUID="")
class CompanyRegistryVerificationTest(TransactionTestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            email="registry-owner@example.test", is_active=True, is_email_verified=True
        )
        self.operator = User.objects.create_superuser(
            email="registry-operator@example.test", password="synthetic-password"
        )
        with use_migrate():
            self.company = Company.objects.create(owner=self.owner, name="Synthetic Example Pty Ltd", acn="123456780")
        appointment = legacy_company_administrators(self.company)[0]
        invite_company_administrator(self.company, appointment, self.operator)
        self.client = APIClient()
        self.lookup = patch(PROVIDER, return_value=matching_observation(self.company)).start()
        self.addCleanup(patch.stopall)
        self.api_url = f"/api/v1/companies/{self.company.pk}/"
        self.admin_url = reverse("admin:companies_company_change", args=[self.company.pk])

    def set_status(self, status):
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status=status)
        self.company.refresh_from_db()

    def transition(self, method, **kwargs):
        self.company = transition_company(
            self.company,
            method,
            actor=self.owner if method in ("submit", "resubmit", "withdraw") else self.operator,
            **kwargs,
        )
        return self.company

    def legacy_recovery_fixture(self):
        self.set_status(CompanyStatus.WARNING)
        with use_migrate():
            self.company.declarant_name = DECLARATION["declarant_name"]
            self.company.board_resolution_reference = DECLARATION["board_resolution_reference"]
            self.company.officeholder_attested_by = self.operator
            self.company.officeholder_attested_at = timezone.now()
            self.company.officeholder_attestation = officeholder_declaration(self.company)
            self.company.save(
                update_fields=[
                    "declarant_name",
                    "board_resolution_reference",
                    "officeholder_attested_by",
                    "officeholder_attested_at",
                    "officeholder_attestation",
                ]
            )

    def admin_action(self, action):
        return reverse("admin:companies_company_transition", args=[self.company.pk, action])

    def status_post(self, status, **data):
        self.client.force_authenticate(self.operator)
        return self.client.post(f"{self.api_url}status/", {"status": status, **data}, format="json")

    def test_technical_retry_records_input_attempt_and_entity_outside_a_transaction(self):
        self.set_status(CompanyStatus.WARNING)

        def observe(**inputs):
            self.assertFalse(connections[current_alias()].in_atomic_block)
            current = Company.objects.get(pk=self.company.pk)
            self.assertEqual(current.status, CompanyStatus.WARNING)
            self.assertEqual(current.registry_status, RegistryCheckStatus.PENDING)
            self.assertIsNone(current.registry_check.completed_at)
            self.assertEqual(inputs, {"acn": "123456780", "abn": ""})
            return matching_observation(current)

        self.lookup.side_effect = observe
        self.transition("retry_registry")
        check = self.company.registry_checks.get()
        self.assertEqual(check.status, RegistryCheckStatus.PASSED)
        self.assertEqual(check.purpose, RegistryCheckPurpose.RETRY)
        self.assertEqual(check.initiated_by, self.operator)
        self.assertEqual(check.requested_name, self.company.name)
        self.assertEqual(check.entity_name, self.company.name)
        self.assertEqual(check.entity_status, "Active")
        self.assertGreaterEqual(check.completed_at, check.started_at)

    def test_technical_retry_refuses_an_outer_transaction_before_any_attempt_or_http(self):
        self.set_status(CompanyStatus.WARNING)
        with self.assertRaises(RuntimeError):
            with atomic():
                self.transition("retry_registry")
        self.lookup.assert_not_called()
        self.assertFalse(self.company.registry_checks.exists())

    def test_legacy_technical_recovery_needs_exact_attestation_and_a_registry_pass(self):
        self.set_status(CompanyStatus.WARNING)
        for declaration in (
            {},
            {**DECLARATION, "attest_officeholder": False},
            {**DECLARATION, "declarant_name": ""},
            {**DECLARATION, "board_resolution_reference": ""},
        ):
            with self.subTest(declaration=declaration):
                with self.assertRaises(OfficeholderAttestationRequiredException):
                    self.transition("resolve_warning", declaration=declaration)
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, CompanyStatus.WARNING)
                self.assertIsNone(self.company.officeholder_attested_at)
        self.lookup.assert_not_called()
        self.transition("resolve_warning", declaration=DECLARATION)
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
        self.assertEqual(self.company.officeholder_attested_by, self.operator)
        self.assertTrue(self.company.has_officeholder_attestation)
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PASSED)
        self.lookup.assert_called_once()

    def test_every_active_entry_requires_fresh_matching_registry_and_attestation(self):
        for predecessor, method in ACTIVE_ENTRIES:
            with self.subTest(method=method):
                self.set_status(predecessor)
                with self.assertRaises(OfficeholderAttestationRequiredException):
                    self.transition(method)
                self.transition(method, declaration=DECLARATION)
                self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
                check = self.company.registry_check
                self.assertEqual(check.purpose, RegistryCheckPurpose.ACTIVATION)
                self.set_status(predecessor)
                with self.assertRaises(RegistryVerificationRequiredException):
                    getattr(self.company, method)()
                self.company.officeholder_attestation = {}
                self.company.save(update_fields=["officeholder_attestation"])
        self.assertEqual(self.lookup.call_count, len(ACTIVE_ENTRIES))

    def test_timeout_after_a_pass_refuses_activation_and_retains_the_failed_attempt(self):
        self.legacy_recovery_fixture()
        self.transition("retry_registry")
        previous = self.company.registry_check
        self.assertEqual(previous.status, RegistryCheckStatus.PASSED)
        self.lookup.return_value = RegistryObservation(reason="timeout")

        response = self.status_post("active")

        self.assertEqual(response.status_code, 400, response.data)
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.WARNING)
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
        self.assertEqual(self.company.registry_reason, "timeout")
        self.assertIsNotNone(self.company.registry_check.completed_at)
        self.assertNotEqual(self.company.registry_check, previous)
        previous.refresh_from_db()
        self.assertEqual(previous.status, RegistryCheckStatus.PASSED)
        self.assertEqual(self.company.registry_checks.count(), 2)
        self.lookup.return_value = matching_observation(self.company)
        self.assertEqual(self.status_post("active").status_code, 200)

    def test_a_new_pending_retry_immediately_replaces_the_previous_pass(self):
        self.legacy_recovery_fixture()
        self.transition("retry_registry")

        def retry(**kwargs):
            current = Company.objects.get(pk=self.company.pk)
            self.assertEqual(current.registry_status, RegistryCheckStatus.PENDING)
            self.assertIsNone(current.registry_checked_at)
            return RegistryObservation(reason="unavailable")

        self.lookup.side_effect = retry
        self.transition("retry_registry")
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)

    def test_unconfigured_technical_retry_records_pending_without_http(self):
        with patch(PROVIDER, side_effect=lookup_company):
            with patch("integrations.abr.client.requests.post") as http:
                self.set_status(CompanyStatus.WARNING)
                self.transition("retry_registry")
                http.assert_not_called()
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
        self.assertEqual(self.company.registry_check.reason, "unconfigured")

    def test_registry_refusals_have_a_matching_positive_control(self):
        self.legacy_recovery_fixture()
        observation = matching_observation(self.company)
        cases = (
            (replace(observation, acn="987654320"), "failed", "identifier_mismatch"),
            (replace(observation, entity_name="Different Pty Ltd"), "failed", "name_mismatch"),
            (replace(observation, entity_name="Synthetic Example"), "failed", "name_mismatch"),
            (replace(observation, entity_status="Cancelled"), "failed", "cancelled"),
            (replace(observation, entity_status="Unknown"), "pending", "unknown_status"),
            (replace(observation, entity_name=""), "pending", "incomplete_identity"),
            (replace(observation, acn=""), "pending", "incomplete_identity"),
            (RegistryObservation(reason="not_found"), "failed", "not_found"),
            (RegistryObservation(reason="invalid_response"), "pending", "invalid_response"),
        )
        for reply, status, reason in cases:
            with self.subTest(reason=reason, reply=reply):
                self.lookup.return_value = reply
                with self.assertRaises(RegistryVerificationRequiredException):
                    self.transition("resolve_warning")
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, CompanyStatus.WARNING)
                self.assertEqual((self.company.registry_status, self.company.registry_reason), (status, reason))
        self.lookup.return_value = replace(observation, entity_name="  SYNTHETIC   EXAMPLE pty Ltd  ")
        self.transition("resolve_warning")
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)

    def test_each_company_type_requires_its_corresponding_registry_type_before_activation(self):
        for company_type, expected, contradictory in (
            (CompanyType.PROPRIETARY, "PRV", "PUB"),
            (CompanyType.PUBLIC, "PUB", "PRV"),
            (CompanyType.UNLISTED_PUBLIC, "PUB", "PRV"),
        ):
            with self.subTest(company_type=company_type):
                with use_migrate():
                    Company.objects.filter(pk=self.company.pk).update(company_type=company_type)
                self.legacy_recovery_fixture()
                observation = matching_observation(self.company)
                self.lookup.return_value = replace(observation, entity_type=contradictory)

                with self.assertRaises(RegistryVerificationRequiredException):
                    self.transition("resolve_warning")

                self.company.refresh_from_db()
                self.assertEqual(self.company.status, CompanyStatus.WARNING)
                self.assertEqual(self.company.registry_status, RegistryCheckStatus.FAILED)
                self.assertEqual(self.company.registry_reason, "entity_type_mismatch")
                self.assertEqual(self.company.registry_check.entity_type, contradictory)
                self.lookup.return_value = replace(observation, entity_type=expected)
                self.transition("resolve_warning")
                self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
                self.assertEqual(self.company.registry_check.entity_type, expected)

    def test_missing_and_unsupported_registry_types_remain_pending_and_refuse_activation(self):
        self.legacy_recovery_fixture()
        observation = matching_observation(self.company)
        for entity_type, reason in (
            ("", "incomplete_identity"),
            ("UNKNOWN", "unknown_entity_type"),
            ("PRV PUB", "unknown_entity_type"),
            ("IND", "unknown_entity_type"),
        ):
            with self.subTest(entity_type=entity_type):
                self.set_status(CompanyStatus.WARNING)
                self.lookup.return_value = replace(observation, entity_type=entity_type)
                with self.assertRaises(RegistryVerificationRequiredException):
                    self.transition("resolve_warning")
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, CompanyStatus.WARNING)
                self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
                self.assertEqual(self.company.registry_reason, reason)
                self.assertEqual(self.company.registry_check.entity_type, entity_type)
        self.set_status(CompanyStatus.WARNING)
        self.lookup.return_value = observation
        self.transition("resolve_warning")
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)

    def test_retired_bulk_and_individual_review_cannot_create_provider_attempts(self):
        self.set_status(CompanyStatus.SUBMITTED)
        with use_migrate():
            second = Company.objects.create(
                owner=self.owner, name="Second Pty Ltd", acn="987654320", status=CompanyStatus.SUBMITTED
            )
        self.client.force_login(self.operator)
        changelist = reverse("admin:companies_company_changelist")
        response = self.client.post(
            changelist,
            {"action": "start_review_action", "_selected_action": [str(self.company.pk), str(second.pk)], "index": 0},
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotContains(self.client.get(changelist), "Start review for selected submitted applications")
        with self.assertRaises(NoReverseMatch):
            self.admin_action("start-review")
        for method in ("get", "post"):
            response = getattr(self.client, method)(
                f"/admin/companies/company/{self.company.pk}/start-review/", {"confirm": True}
            )
            self.assertIn(response.status_code, (302, 404))
        self.lookup.assert_not_called()
        for company in (self.company, second):
            company.refresh_from_db()
            self.assertEqual(company.status, CompanyStatus.SUBMITTED)
            self.assertFalse(company.registry_checks.exists())
        self.set_status(CompanyStatus.WARNING)
        page = self.client.get(self.admin_action("retry-registry"))
        self.assertEqual(page.status_code, 200)
        self.lookup.assert_not_called()
        self.assertEqual(self.client.post(self.admin_action("retry-registry"), {"confirm": True}).status_code, 302)
        self.lookup.assert_called_once_with(acn=self.company.acn, abn="")
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.WARNING)
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PASSED)
        self.assertFalse(second.registry_checks.exists())

    def test_supplied_abn_must_match_and_acn_fallback_does_not_fill_application_abn(self):
        self.legacy_recovery_fixture()
        self.transition("resolve_warning")
        self.assertEqual(self.company.abn, "")
        self.assertEqual(self.company.registry_check.registry_abn, "99123456780")
        self.set_status(CompanyStatus.WARNING)
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(abn="98123456780")
        self.company.refresh_from_db()
        with self.assertRaises(RegistryVerificationRequiredException):
            self.transition("resolve_warning", declaration=DECLARATION)
        self.company.refresh_from_db()
        self.assertEqual(self.company.registry_reason, "identifier_mismatch")

    def test_out_of_order_completion_keeps_the_newer_observation_current(self):
        self.legacy_recovery_fixture()
        with atomic():
            first = begin_registry_check(self.company, RegistryCheckPurpose.RETRY, self.operator)
            second = begin_registry_check(self.company, RegistryCheckPurpose.RETRY, self.operator)
        complete_registry_check(second, RegistryObservation(reason="timeout"))
        complete_registry_check(first, matching_observation(self.company))
        self.company.refresh_from_db()
        self.assertEqual(self.company.registry_check_id, second.pk)
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
        first.refresh_from_db()
        self.assertEqual(first.status, RegistryCheckStatus.PASSED)

    def test_identity_changed_away_and_back_cannot_reuse_an_older_lookup(self):
        self.set_status(CompanyStatus.INFO_REQUIRED)
        with atomic():
            check = begin_registry_check(self.company, RegistryCheckPurpose.RETRY, self.operator)
        update_company(self.company, {"name": "Correction Pty Ltd"}, actor=self.owner)
        update_company(self.company, {"name": self.company.name}, actor=self.owner)
        complete_registry_check(check, matching_observation(self.company))
        self.company.refresh_from_db()
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
        self.assertEqual(self.company.registry_reason, "identity_changed")
        check.refresh_from_db()
        self.assertEqual(check.status, RegistryCheckStatus.PASSED)

    def test_concurrent_lifecycle_change_defeats_a_passing_activation_lookup(self):
        self.legacy_recovery_fixture()

        def observe(**kwargs):
            current = Company.objects.get(pk=self.company.pk)
            transition_company(current, "delist", actor=self.operator, reason="Concurrent decision")
            return matching_observation(current)

        self.lookup.side_effect = observe
        with self.assertRaises(InvalidStatusTransitionException):
            self.transition("resolve_warning")
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.DELISTED)
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
        self.assertEqual(self.company.registry_check.status, RegistryCheckStatus.PASSED)

    def test_attestation_snapshot_refuses_a_changed_declaration_or_identity(self):
        self.legacy_recovery_fixture()
        for field, changed in (
            ("declarant_name", "Other declarant"),
            ("board_resolution_reference", "BR-002"),
            ("name", "Other name"),
        ):
            original = getattr(self.company, field)
            setattr(self.company, field, changed)
            self.assertFalse(self.company.has_officeholder_attestation)
            with self.assertRaises(OfficeholderAttestationRequiredException):
                self.company.resolve_warning()
            setattr(self.company, field, original)
        self.assertTrue(self.company.has_officeholder_attestation)

    def test_concurrent_identity_change_cannot_activate_from_the_previous_name(self):
        self.legacy_recovery_fixture()
        previous_identity = matching_observation(self.company)

        def observe(**kwargs):
            with use_migrate():
                Company.objects.filter(pk=self.company.pk).update(name="Changed during lookup Pty Ltd")
            return previous_identity

        self.lookup.side_effect = observe
        with self.assertRaises(OfficeholderAttestationRequiredException):
            self.transition("resolve_warning")
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.WARNING)
        self.assertEqual(self.company.registry_status, RegistryCheckStatus.PENDING)
        self.assertEqual(self.company.registry_check.status, RegistryCheckStatus.PASSED)

    def test_admin_status_field_cannot_bypass_activation(self):
        self.legacy_recovery_fixture()
        self.client.force_login(self.operator)
        page = self.client.get(self.admin_url)
        form = page.context["adminform"].form
        self.assertNotIn("status", form.fields)
        payload = {name: form[name].value() or "" for name in form.fields}
        for inline in page.context["inline_admin_formsets"]:
            for field in inline.formset.management_form:
                payload[field.html_name] = field.value()
            for inline_form in inline.formset.forms:
                for field in inline_form.hidden_fields():
                    payload[field.html_name] = field.value() or ""
        payload.update(status="active", description="Description saved")
        response = self.client.post(self.admin_url, payload)
        self.assertEqual(response.status_code, 302)
        self.company.refresh_from_db()
        self.assertEqual(self.company.description, "Description saved")
        self.assertEqual(self.company.status, CompanyStatus.WARNING)
        self.assertFalse(self.company.registry_checks.exists())

    def test_stale_api_and_admin_description_saves_preserve_suspension_and_new_attestation(self):
        self.legacy_recovery_fixture()
        self.transition("resolve_warning")
        stale_api = Company.objects.get(pk=self.company.pk)
        stale_admin = Company.objects.get(pk=self.company.pk)
        serializer = CompanyUpdateSerializer(
            stale_api,
            data={"description": "API description"},
            partial=True,
            context={"request": SimpleNamespace(user=self.owner)},
        )
        serializer.is_valid(raise_exception=True)
        self.transition("suspend", reason="Concurrent suspension")
        self.lookup.return_value = RegistryObservation(reason="timeout")
        with self.assertRaises(RegistryVerificationRequiredException):
            self.transition("reinstate", declaration={**DECLARATION, "board_resolution_reference": "New BR-002"})
        self.company.refresh_from_db()
        evidence = (
            self.company.registry_check_id,
            self.company.officeholder_attestation,
            self.company.lifecycle_revision,
        )

        serializer.save()
        model_admin = CompanyAdmin(Company, AdminSite())
        model_admin.save_model(
            SimpleNamespace(user=self.operator),
            stale_admin,
            SimpleNamespace(changed_data=["description"], cleaned_data={"description": "Admin description"}),
            True,
        )

        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.SUSPENDED)
        self.assertEqual(self.company.description, "Admin description")
        self.assertEqual(
            (self.company.registry_check_id, self.company.officeholder_attestation, self.company.lifecycle_revision),
            evidence,
        )

    def test_stale_draft_api_and_admin_identity_edits_are_refused_after_review(self):
        serializer = CompanyUpdateSerializer(
            self.company,
            data={"name": "Edited Pty Ltd"},
            partial=True,
            context={"request": SimpleNamespace(user=self.owner)},
        )
        serializer.is_valid(raise_exception=True)
        stale = Company.objects.get(pk=self.company.pk)
        self.set_status(CompanyStatus.WARNING)
        with self.assertRaises(ValidationError):
            serializer.save()
        model_admin = CompanyAdmin(Company, AdminSite())
        with self.assertRaises(ValidationError):
            model_admin.save_model(
                SimpleNamespace(user=self.operator),
                stale,
                SimpleNamespace(changed_data=["name"], cleaned_data={"name": "Edited Pty Ltd"}),
                True,
            )
        self.company.refresh_from_db()
        self.assertEqual(self.company.name, "Synthetic Example Pty Ltd")
        self.set_status(CompanyStatus.INFO_REQUIRED)
        updated = update_company(stale, {"name": "Edited Pty Ltd"}, actor=self.owner)
        self.assertEqual(updated.name, "Edited Pty Ltd")
        self.assertEqual(updated.registry_status, RegistryCheckStatus.PENDING)

    def test_active_legacy_identity_is_locked_without_revoking_existing_status(self):
        self.set_status(CompanyStatus.ACTIVE)
        self.client.force_authenticate(self.owner)
        response = self.client.patch(self.api_url, {"name": "Different Pty Ltd"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        response = self.client.patch(self.api_url, {"trading_name": "New display name"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.company.refresh_from_db()
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
        self.assertEqual(self.company.name, "Synthetic Example Pty Ltd")
        self.assertIsNone(self.company.officeholder_attested_at)
        self.lookup.return_value = RegistryObservation(reason="timeout")
        self.transition("retry_registry")
        self.assertEqual(self.company.status, CompanyStatus.ACTIVE)
        for entity_type, status in (("PUB", RegistryCheckStatus.FAILED), ("", RegistryCheckStatus.PENDING)):
            self.lookup.return_value = replace(matching_observation(self.company), entity_type=entity_type)
            self.transition("retry_registry")
            self.assertEqual(self.company.registry_status, status)
            self.assertEqual(self.company.status, CompanyStatus.ACTIVE)

    def test_legacy_active_entries_have_a_supported_admin_attestation_recovery(self):
        self.client.force_login(self.operator)
        for predecessor, method in ACTIVE_ENTRIES:
            action = method.replace("_", "-")
            with self.subTest(action=action):
                self.set_status(predecessor)
                with use_migrate():
                    Company.objects.filter(pk=self.company.pk).update(officeholder_attestation={})
                page = self.client.get(self.admin_action(action))
                self.assertContains(page, "Named officeholder making the declaration")
                self.assertEqual(Company.objects.get(pk=self.company.pk).status, predecessor)
                self.lookup.return_value = RegistryObservation(reason="timeout")
                refused = self.client.post(self.admin_action(action), {"confirm": True, **DECLARATION})
                self.assertEqual(refused.status_code, 302)
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, predecessor)
                self.assertTrue(self.company.has_officeholder_attestation)
                self.assertEqual(self.company.registry_reason, "timeout")
                self.lookup.return_value = matching_observation(self.company)
                allowed = self.client.post(self.admin_action(action), {"confirm": True})
                self.assertEqual(allowed.status_code, 302)
                self.company.refresh_from_db()
                self.assertEqual(self.company.status, CompanyStatus.ACTIVE)

    def test_review_details_are_private_and_ordinary_writes_cannot_forge_them(self):
        self.legacy_recovery_fixture()
        self.transition("retry_registry")
        self.client.force_login(self.operator)
        page = self.client.get(self.admin_action("resolve-warning"))
        self.assertContains(page, self.operator.email)
        self.assertContains(page, self.company.name)
        page = self.client.get(self.admin_url)
        self.assertContains(page, DECLARATION["declarant_name"])
        self.assertContains(page, DECLARATION["board_resolution_reference"])
        self.client.logout()
        self.client.force_authenticate(self.owner)
        for path in (self.api_url, "/api/v1/companies/"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn(DECLARATION["declarant_name"], str(response.data))
            self.assertNotIn(DECLARATION["board_resolution_reference"], str(response.data))
            self.assertNotIn(self.operator.email, str(response.data))
        response = self.client.patch(
            self.api_url,
            {
                "registry_status": "passed",
                "officeholder_attestation": {},
                "declarant_name": "Forged",
                "description": "Owner description",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.company.refresh_from_db()
        self.assertEqual(self.company.declarant_name, DECLARATION["declarant_name"])
        self.assertTrue(self.company.has_officeholder_attestation)
        self.assertEqual(self.company.description, "Owner description")
