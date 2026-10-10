import ast
from unittest import TestLoader, TestSuite

from django.conf import settings
from django.core.management.base import CommandError

from shared.db import APP_ALIAS, MIGRATE_ALIAS, OPERATOR_ALIAS
from shared.test_runner import LedovaTestRunner

SCOPED_TEST_LABELS = (
    "blockchain.tests.test_fresh_signer_scoped.ScopedFreshSignerTest",
    "blockchain.tests.test_monitor_scoped.ScopedMonitorObservationsTest",
    "companies.tests.test_authority_admission_scoped.ScopedCompanyAuthorityAdmissionTest",
    "companies.tests.test_authority_request_withdrawal_scoped.ScopedCompanyAuthorityRequestWithdrawalTest",
    "companies.tests.test_authority_requests_scoped.ScopedCompanyAuthorityRequestTest",
    "companies.tests.test_company_activation_scoped.ScopedCompanyActivationTest",
    "companies.tests.test_document_review_scoped.ScopedCompanyDocumentReviewTest",
    "companies.tests.test_legacy_owner_appointments_scoped.ScopedCompanyLegacyOwnerAppointmentTest",
    "companies.tests.test_team_invitations_scoped.ScopedCompanyTeamInvitationTest",
    "documents.tests.test_evidence_under_scoped_roles.ScopedSupportingEvidenceTest",
    "documents.tests.test_extraction_under_scoped_roles.ScopedDocumentExtractionTest",
    "shared.tests.test_cross_tenant_routes_under_rls.TheMatrixRunsOnTheConnectionTheRouterChoosesTest",
    "shared.tests.test_scoped_harness.ADecoratedServiceRollsBackOnTheConnectionItRanOnTest",
    "shared.tests.test_scoped_harness.TheScopedHarnessIsActuallyScopedTest",
    "shared.tests.test_scoped_requests.AuthRequestsUseTheAppRoleTest",
    "shared.tests.test_scoped_requests.LockedUpdatesUseTheAppRoleTest",
    "shared.tests.test_scoped_requests.RequestTransactionsUseTheAppRoleTest",
    "shareholders.tests.test_distributions_scoped.ScopedDistributionTest",
    "shareholders.tests.test_resolutions_scoped.ScopedResolutionTest",
    "tokens.tests.test_capital_execution_scoped.ScopedCapitalExecutionTest",
    "tokens.tests.test_company_pack.ScopedCompanyPackTest",
    "tokens.tests.test_deployment_under_scoped_roles.ScopedTokenDeploymentTest",
    "tokens.tests.test_former_member_privacy.ScopedFormerMemberPrivacyTest",
    "tokens.tests.test_issuance_execution_scoped.ScopedIssuanceExecutionTest",
    "tokens.tests.test_operator_execution.OperatorExecutionFromScopedContextTest",
    "tokens.tests.test_pause_scoped.ScopedPauseRecoveryTest",
    "tokens.tests.test_register_corrections.ScopedRegisterCorrectionTest",
    "tokens.tests.test_register_events_scoped.ScopedRegisterFoundationTest",
    "tokens.tests.test_register_export_audit.ScopedRegisterExportAuditTest",
    "tokens.tests.test_register_grants.ScopedRegisterGrantsTest",
    "tokens.tests.test_register_imports.ScopedRegisterImportTest",
    "tokens.tests.test_register_instructions.ScopedRegisterInstructionTest",
    "tokens.tests.test_register_openings_scoped.ScopedRegisterOpeningTest",
    "tokens.tests.test_register_particulars.ScopedRegisterParticularsTest",
    "tokens.tests.test_register_reconciliation.ScopedRegisterReconciliationTest",
    "tokens.tests.test_register_snapshot_scoped.ScopedRegisterSnapshotTest",
    "tokens.tests.test_register_transfers.ScopedRegisterTransfersTest",
    "tokens.tests.test_swap_approval_under_scoped_roles.ScopedSwapApprovalTest",
    "tokens.tests.test_swap_execution_storage.ScopedSwapExecutionAppStorageTest",
    "users.tests.test_company_eligibility_scoped.ScopedCompanyEligibilityRequestTest",
    "users.tests.test_notification_tasks_scoped.NotificationTasksUseRecipientRolesTest",
    "wallets.tests.test_confirmation_under_split_roles.ImportedConfirmationUsesSeparateRolesTest",
    "wallets.tests.test_holding_share_class.ScopedHoldingShareClassTest",
    "wallets.tests.test_sync_under_scoped_roles.ScopedWalletSyncTest",
    "whitelist.tests.test_company_wallet_instructions.ScopedCompanyWalletInstructionTest",
)


def cases_in(suite):
    for item in suite:
        if isinstance(item, TestSuite):
            yield from cases_in(item)
        else:
            yield item


def declared_scoped_classes():
    labels = set()
    for path in settings.BASE_DIR.glob("*/tests/test*.py"):
        module = ".".join(path.relative_to(settings.BASE_DIR).with_suffix("").parts)
        for node in ast.parse(path.read_text()).body:
            if isinstance(node, ast.ClassDef) and any(
                getattr(base, "id", getattr(base, "attr", None)) == "RunsOnTheScopedConnection" for base in node.bases
            ):
                labels.add(f"{module}.{node.name}")
    return labels


class ScopedTestRunner(LedovaTestRunner):
    @classmethod
    def add_arguments(cls, parser):
        super().add_arguments(parser)
        parser.add_argument("--require-scoped-coverage", action="store_true")

    def __init__(self, *args, require_scoped_coverage=False, **kwargs):
        self.require_scoped_coverage = require_scoped_coverage
        super().__init__(*args, **kwargs)

    def build_suite(self, test_labels=None, **kwargs):
        suite = super().build_suite(test_labels or SCOPED_TEST_LABELS, **kwargs)
        if self.require_scoped_coverage:
            if settings.RLS_AMBIENT_ALIAS != APP_ALIAS or not {APP_ALIAS, MIGRATE_ALIAS, OPERATOR_ALIAS} <= set(
                settings.DATABASES
            ):
                raise CommandError("The scoped suite requires the app ambient alias and all three database connections")
            difference = declared_scoped_classes() ^ set(SCOPED_TEST_LABELS)
            if difference:
                raise CommandError(f"The scoped class inventory and required labels differ: {sorted(difference)}")
            expected = list(cases_in(TestLoader().loadTestsFromNames(SCOPED_TEST_LABELS)))
            present = {case.id() for case in cases_in(suite)}
            missing = {case.id() for case in expected} - present
            empty = {
                label for label in SCOPED_TEST_LABELS if not any(case.id().startswith(label + ".") for case in expected)
            }
            if missing or empty:
                raise CommandError(f"Required scoped tests are missing: {sorted(missing | empty)}")
            skipped = [case.id() for case in expected if getattr(case, "__unittest_skip__", False)]
            if skipped:
                raise CommandError(f"Required scoped tests are marked skipped: {skipped}")
        return suite

    def run_suite(self, suite, **kwargs):
        result = super().run_suite(suite, **kwargs)
        if self.require_scoped_coverage and result.skipped:
            raise CommandError(f"The required scoped suite skipped {len(result.skipped)} test(s)")
        return result
