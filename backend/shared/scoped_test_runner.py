import ast
from unittest import TestLoader, TestSuite

from django.conf import settings
from django.core.management.base import CommandError
from django.test.runner import DiscoverRunner

from shared.db import APP_ALIAS, MIGRATE_ALIAS, OPERATOR_ALIAS

SCOPED_TEST_LABELS = (
    "users.tests.test_company_eligibility_fresh_signup.ScopedCompanyEligibilityFreshSignupTest",
    "users.tests.test_company_eligibility_cutover_migrations.ScopedCompanyEligibilityCutoverUpgradeTest",
    "users.tests.test_company_eligibility_cutover_migrations.ScopedCompanyEligibilitySubscriptionCutoverReversalTest",
    "users.tests.test_company_eligibility_cutover_migrations.ScopedCompanyEligibilityTradingCutoverReversalTest",
    "users.tests.test_company_eligibility_cutover_migrations.ScopedCompanyEligibilitySourceCutoverReversalTest",
    "whitelist.tests.test_eligibility_loss_producers_scoped.ScopedEligibilityLossProducerTest",
    "whitelist.tests.test_company_eligibility_invalidation_scoped.ScopedCompanyEligibilityInvalidationTest",
    "shared.tests.test_seed_company_eligibility.ScopedSyntheticCompanyEligibilityTest",
    "shared.tests.test_company_eligibility_fixture.ScopedCompanyEligibilityFixtureTest",
    "users.tests.test_private_sources_after_cutover.ScopedPrivateSourcesAfterCutoverTest",
    "users.tests.test_investor_eligibility.ScopedAccountStandingMatrixTest",
    "whitelist.tests.test_admin_eligibility_read.ScopedWhitelistAdminEligibilityReadTest",
    "users.tests.test_company_eligibility_read_consumers_scoped.ScopedCompanyEligibilityReadConsumerTest",
    "tokens.tests.test_company_eligibility_trading_stream_scoped.ScopedCompanyEligibilityTradingStreamTest",
    "tokens.tests.test_company_eligibility_trading_admission.ScopedCompanyEligibilityTradingAdmissionTest",
    "tokens.tests.test_company_eligibility_trading_admission.ScopedCompanyEligibilityTradingAdmissionSQLTest",
    (
        "offerings.tests.test_company_eligibility_subscription_admission_scoped."
        "ScopedCompanyEligibilitySubscriptionAdmissionTest"
    ),
    (
        "offerings.tests.test_company_eligibility_subscription_admission_scoped."
        "ScopedCompanyEligibilitySubscriptionServiceTest"
    ),
    (
        "offerings.tests.test_company_eligibility_subscription_admission_scoped."
        "ScopedCompanyEligibilitySubscriptionRecoveryTest"
    ),
    (
        "offerings.tests.test_company_eligibility_subscription_admission_scoped."
        "ScopedCompanyEligibilitySubscriptionGuardTest"
    ),
    "users.tests.test_company_eligibility_consumption_scoped.ScopedCompanyEligibilityConsumptionTest",
    "users.tests.test_company_eligibility_scoped.ScopedCompanyEligibilityRequestTest",
    "users.tests.test_company_eligibility_scoped.ScopedCompanyEligibilityCategoryTest",
    "users.tests.test_company_eligibility_scoped.ScopedCompanyEligibilityGuardTest",
    "users.tests.test_company_eligibility_contention.ScopedCompanyEligibilityContentionTest",
    "shared.tests.test_cross_tenant_routes.ScopedCompanyEligibilityRouteMatrixTest",
    "companies.tests.test_company_activation_scoped.ScopedCompanyActivationTest",
    "companies.tests.test_company_administration.ScopedCompanyAdministrationTest",
    "companies.tests.test_wallet_edit_lock_order.ScopedCompanyWalletLockOrderTest",
    "companies.tests.test_legacy_owner_appointments_scoped.ScopedCompanyLegacyOwnerAppointmentTest",
    "companies.tests.test_team_invitations_scoped.ScopedCompanyTeamInvitationTest",
    "companies.tests.test_authority_admission_scoped.ScopedCompanyAuthorityAdmissionTest",
    "companies.tests.test_authority_admission_guards_scoped.ScopedCompanyAuthorityAdmissionGuardTest",
    "companies.tests.test_authority_request_withdrawal_scoped.ScopedCompanyAuthorityRequestWithdrawalTest",
    "companies.tests.test_authority_requests_scoped.ScopedCompanyAuthorityRequestTest",
    "companies.tests.test_authority_request_capability_guard_scoped.ScopedAuthorityRequestCapabilityGuardTest",
    "tokens.tests.test_trading_retention.ScopedTradingRetentionTest",
    "offerings.tests.test_application_retention.ScopedApplicationRetentionTest",
    "offerings.tests.test_subscription_api.ScopedSubscriptionIssuerReadTest",
    "blockchain.tests.test_fresh_signer_scoped.ScopedFreshSignerTest",
    "companies.tests.test_document_review_scoped.ScopedCompanyDocumentReviewTest",
    "tokens.tests.test_register_corrections.ScopedRegisterCorrectionTest",
    "tokens.tests.test_register_correction_authority.ScopedRegisterCorrectionAuthorityTest",
    "tokens.tests.test_register_correction_authority.ScopedRegisterCorrectionDecisionGuardTest",
    "tokens.tests.test_register_grants.ScopedRegisterGrantsTest",
    "tokens.tests.test_register_transfers.ScopedRegisterTransfersTest",
    "tokens.tests.test_register_particulars.ScopedRegisterParticularsTest",
    "tokens.tests.test_register_particulars_authority.ScopedRegisterParticularsAuthorityTest",
    "tokens.tests.test_register_particulars_authority.ScopedRegisterParticularsDecisionGuardTest",
    "tokens.tests.test_register_access.ScopedRegisterAccessByAppointmentTest",
    "tokens.tests.test_register_entries.ScopedRegisterEntriesTest",
    "tokens.tests.test_register_openings_scoped.ScopedRegisterOpeningTest",
    "tokens.tests.test_register_opening_authority.ScopedRegisterOpeningAuthorityTest",
    "tokens.tests.test_register_opening_authority.ScopedRegisterOpeningDecisionGuardTest",
    "tokens.tests.test_register_opening_holders.ScopedRegisterOpeningHoldersTest",
    "tokens.tests.test_register_link_authority.ScopedRegisterWalletLinkAuthorityTest",
    "tokens.tests.test_register_link_authority.ScopedRegisterWalletLinkDecisionGuardTest",
    "tokens.tests.test_register_reconciliation.ScopedRegisterReconciliationTest",
    "tokens.tests.test_register_acknowledgement_authority.ScopedRegisterAcknowledgementAuthorityTest",
    "tokens.tests.test_register_acknowledgement_authority.ScopedRegisterAcknowledgementGuardTest",
    "tokens.tests.test_register_export_audit.ScopedRegisterExportAuditTest",
    "tokens.tests.test_market_admin.ScopedMarketAdminTest",
    "tokens.tests.test_register_notice_figures.ScopedNoticeFiguresTest",
    "tokens.tests.test_company_pack.ScopedCompanyPackTest",
    "tokens.tests.test_company_pack_publications.ScopedCompanyPackPublicationsTest",
    "tokens.tests.test_register_imports.ScopedRegisterImportTest",
    "tokens.tests.test_register_import_authority.ScopedRegisterImportAuthorityTest",
    "tokens.tests.test_register_import_authority.ScopedRegisterImportDecisionGuardTest",
    "tokens.tests.test_register_instructions.ScopedRegisterInstructionTest",
    "tokens.tests.test_register_instructions.ScopedTransferInstructionTest",
    "tokens.tests.test_register_snapshot_scoped.ScopedRegisterSnapshotTest",
    "tokens.tests.test_register_events_scoped.ScopedRegisterFoundationTest",
    "shareholders.tests.test_publications_scoped.ScopedPublicationTest",
    "shareholders.tests.test_resolutions_scoped.ScopedResolutionTest",
    "shareholders.tests.test_distributions_scoped.ScopedDistributionTest",
    "tokens.tests.test_nav_scoped.ScopedNAVRecoveryTest",
    "tokens.tests.test_pause_scoped.ScopedPauseRecoveryTest",
    "whitelist.tests.test_change_scoped.ScopedWhitelistChangeTest",
    "tokens.tests.test_mint_request_scoped.ScopedMintRequestRecoveryTest",
    "tokens.tests.test_capital_execution_scoped.ScopedCapitalExecutionTest",
    "tokens.tests.test_issuance_execution_scoped.ScopedIssuanceExecutionTest",
    "shared.tests.test_scoped_harness.TheScopedHarnessIsActuallyScopedTest",
    "shared.tests.test_scoped_harness.ADecoratedServiceRollsBackOnTheConnectionItRanOnTest",
    "users.tests.test_account_type_under_the_app_role.ChoosingAnAccountTypeUnderTheAppRoleTest",
    "users.tests.test_account_export.ScopedAccountExportEvidenceTest",
    "shared.tests.test_cross_tenant_routes_under_rls.TheMatrixRunsOnTheConnectionTheRouterChoosesTest",
    "shared.tests.test_scoped_requests.AuthRequestsUseTheAppRoleTest",
    "shared.tests.test_scoped_requests.RequestTransactionsUseTheAppRoleTest",
    "shared.tests.test_scoped_requests.LockedUpdatesUseTheAppRoleTest",
    "wallets.tests.test_confirmation_under_split_roles.ImportedConfirmationUsesSeparateRolesTest",
    "compliance.tests.test_durable_screening.ScopedDurableScreeningTest",
    "compliance.tests.test_crypto_screening_results.ScopedScreeningLockTest",
    "compliance.tests.test_identity_screening.ScopedScreeningMatchAlertTest",
    "wallets.tests.test_sync_under_scoped_roles.ScopedWalletSyncTest",
    "tokens.tests.test_deployment_under_scoped_roles.ScopedTokenDeploymentTest",
    "tokens.tests.test_deployment_lock_order.ScopedDeploymentLockOrderTest",
    "tokens.tests.test_swap_approval_under_scoped_roles.ScopedSwapApprovalTest",
    "tokens.tests.test_operator_execution.OperatorExecutionFromScopedContextTest",
    "tokens.tests.test_market_reads_scoped.ScopedMarketReadsTest",
    "offerings.tests.test_directory_documents_scoped.ScopedDirectoryDocumentsTest",
    "offerings.tests.test_published_documents_stay_scoped.ScopedPublishedDocumentsStayTest",
    "users.tests.test_classification_issuer_scoped.ScopedClassificationIssuerTest",
    "tokens.tests.test_modification_refusals.ScopedModificationRefusalTest",
    "shared.tests.test_cross_tenant_routes.ScopedOrderActionRouteMatrixTest",
    "tokens.tests.test_order_actions.ScopedOrderActionRecoveryTest",
    "tokens.tests.test_order_action_processes.ScopedOrderActionProcessTest",
    "tokens.tests.test_swap_settlement_context.ScopedSwapSettlementRouteTest",
    "tokens.tests.test_settlement_chain_agreement.ScopedSettlementChainAgreementTest",
    "tokens.tests.test_swap_approval_submissions.ScopedSwapApprovalSubmissionTest",
    "tokens.tests.test_swap_execution_recovery.ScopedSwapExecutionRecoveryTest",
    "tokens.tests.test_swap_execution_storage.ScopedSwapExecutionAppStorageTest",
    "tokens.tests.test_swap_authority_lock_order.ScopedSwapAuthorityLockOrderTest",
    "tokens.tests.test_swap_finality.ScopedSwapFinalityTest",
    "tokens.tests.test_swap_finality.ScopedHistoricalSwapFinalityProcessTest",
    "tokens.tests.test_swap_process_concurrency.ScopedSwapWorkersUseOneCurrentClaimTest",
    "tokens.tests.test_signature_admission_processes.ScopedSignatureAdmissionProcessesTest",
    "tokens.tests.test_legacy_swap_hold.ScopedLegacySwapHoldTest",
    "tokens.tests.test_swap_parent_identity.ScopedSwapParentIdentityTest",
    "tokens.tests.test_order_submissions.ScopedOrderSubmissionRecoveryTest",
    "tokens.tests.test_cross_account_matching.ScopedCrossAccountMatchingTest",
    "tokens.tests.test_cross_account_matching.ScopedCrossAccountMatchingProcessTest",
    "tokens.tests.test_the_book_never_crosses.ScopedHeldAcrossAccountsTest",
    "tokens.tests.test_order_submission_processes.ScopedOrderSubmissionProcessTest",
    "tokens.tests.test_swap_expiry_processes.ScopedExpiryProcessesRespectExecutionClaimsTest",
    "tokens.tests.test_swap_expiry.ScopedSwapExpiryTaskWiringTest",
    "tokens.tests.test_swap_recovery_journey.ScopedSwapRecoveryJourneyTest",
    "tokens.tests.test_matching_wallet_locks.ScopedMatchingWalletLockTest",
    "wallets.tests.test_confirmation_locking.ScopedConfirmationLockingTest",
    "wallets.tests.test_history_preservation.ScopedHistoryPreservationTest",
    "wallets.tests.test_submission_durability.ScopedSubmissionDurabilityTest",
    "wallets.tests.test_submission_recovery.ScopedSubmissionRecoveryTest",
    "wallets.tests.test_submission_intrinsic_gas.ScopedSubmissionIntrinsicGasTest",
    "wallets.tests.test_submission_nonce.ScopedSubmissionNonceTest",
    "wallets.tests.test_receipt_fencing.ScopedReceiptFencingTest",
    "wallets.tests.test_receipt_metadata.ScopedReceiptMetadataTest",
    "wallets.tests.test_bitcoin_submission.ScopedBitcoinSubmissionTest",
    "wallets.tests.test_bitcoin_submission_recovery.ScopedBitcoinSubmissionRecoveryTest",
    "wallets.tests.test_global_submission_identity.ScopedGlobalSubmissionIdentityTest",
    "wallets.tests.test_chain_observations.ScopedChainObservationTest",
    "wallets.tests.test_wallet_finality.ScopedWalletFinalityTest",
    "wallets.tests.test_bitcoin_finality.ScopedBitcoinFinalityTest",
    "wallets.tests.test_token_finality.ScopedTokenFinalityTest",
    "wallets.tests.test_transaction_notifications.ScopedTransactionNotificationTest",
    "wallets.tests.test_disabled_native_settlement.ScopedDisabledNativeSettlementTest",
    "tokens.tests.test_former_member_privacy.ScopedFormerMemberPrivacyTest",
    "documents.tests.test_evidence_under_scoped_roles.ScopedSupportingEvidenceTest",
    "wallets.tests.test_network_identity.ScopedWalletNetworkIdentityTest",
    "wallets.tests.test_holding_share_class.ScopedHoldingShareClassTest",
    "wallets.tests.test_paused_class_transfer_refusal.ScopedPausedClassTransferRefusalTest",
    "wallets.tests.test_stablecoin_approvals.ScopedStablecoinApprovalTest",
    "blockchain.tests.test_monitor_scoped.ScopedMonitorObservationsTest",
    "users.tests.test_notification_tasks_scoped.NotificationTasksUseRecipientRolesTest",
    "users.tests.test_identity_apply_race.ScopedIdentityApplyRaceTest",
    "users.tests.test_identity_lock_order.ScopedIdentityLockOrderTest",
    "offerings.tests.test_allotment_lock_order.ScopedAllotmentLockOrderTest",
    "documents.tests.test_extraction_under_scoped_roles.ScopedDocumentExtractionTest",
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


class ScopedTestRunner(DiscoverRunner):
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
