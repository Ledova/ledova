import type { RegisterDecisionKind, RegisterDeployment } from '../../types';

export const REGISTER_DEPLOYMENT_UNMET_COPY: Record<string, string> = {
  appointment_capability_required: 'Your appointment does not include this step.',
  approval_required: 'Approve this deployment before applying it.',
  approval_lapsed: 'The original approval appointment has ended.',
  already_approved: 'This deployment already has a current approval.',
  reason_required: 'Give a reason for rejection.',
  reason_not_allowed: 'Approval and application take no reason.',
  deployment_decided: 'This deployment has already been admitted or rejected.',
  company_provided_evidence_required: 'This deployment must retain information provided by the company.',
  company_not_active: 'The company must be active before deployment.',
  class_not_draft: 'Only a draft share class can be prepared for deployment.',
  class_deployment_exists: 'This class already has a deployment.',
  class_deployment_changed: 'The original class deployment changed. Refresh its retained outcome.',
  class_identity_changed: 'Company or share-class information no longer matches the captured deployment.',
  deployment_configuration_changed: 'The configured transaction no longer matches the approved deployment intent.',
  register_uninitialized: 'The existing register has not been opened.',
  register_not_empty: 'This register has issued shares. Empty-class deployment cannot mirror these holdings.',
  register_changed: 'The register no longer matches the captured deployment. This original intent cannot be executed.',
  register_unavailable: 'The register could not be read and verified. Retry when it is available.',
  issuer_wallet_unavailable: 'The captured issuer wallet is unavailable.',
  issuer_wallet_changed: 'The captured issuer wallet no longer matches the approved source.',
  source_lock_busy:
    'The original source is temporarily busy. Refresh this deployment; its original request is retained.',
  company_source_expired:
    'The original company approval or application authority ended before signing. The admitted deployment remains held.',
  legacy_source_unavailable: 'The original deployment source is unavailable for unsigned execution.',
};

export const REGISTER_DEPLOYMENT_COPY = {
  TITLE: 'Empty-class deployment',
  PREPARE: 'Prepare deployment',
  EMPTY: 'No company deployment has been prepared for this class.',
  NOTE: 'Prepare the existing share class for an empty chain deployment. This creates no shares and does not mirror a populated register.',
  READ_ONLY_NOTE: 'Preparing, approving and applying needs current company administration or that step.',
  RECOVERY_NOTE:
    'Recover an uncertain receipt with its original request. A queued deployment is not a confirmed contract.',
  ADMITTED_NOTE: 'Application admits one deployment for guarded execution. It does not establish chain completion.',
  PREPARE_FAILED: 'The deployment could not be prepared. Check the outcome before retrying.',
  PROVIDED_BY_COMPANY: 'Company and share-class information is provided by the company.',
  STAGES: { submitted: 'Prepared', approved: 'Approved', applied: 'Admitted', rejected: 'Rejected' } as Record<
    string,
    string
  >,
  DECISIONS: { approve: 'Approve deployment', apply: 'Apply deployment', reject: 'Reject deployment' } as Record<
    RegisterDecisionKind,
    string
  >,
  CONFIRMATIONS: {
    approve:
      'Approve the exact company, share class, captured issuer address, register and transaction intent shown. No shares are issued.',
    apply:
      'Admit this approved deployment once for guarded execution. The contract appears only after confirmation and projection.',
    reject: 'Reject this deployment with the reason given.',
  } as Record<RegisterDecisionKind, string>,
  REJECTION_REASON: 'Reason for rejection',
  PREPARATION_RECEIPT_FAILED:
    'The prepared deployment could not be confirmed. Recover its original receipt before preparing again.',
  DECISION_RECEIPT_FAILED: 'The deployment decision could not be confirmed. Recover its original receipt.',
  PREVIEW_FAILED: 'The deployment decision could not be previewed. Refresh and try again.',
  DECIDE_FAILED: 'The deployment decision response could not be confirmed. Recover its original receipt.',
};

export function registerDeploymentExecutionState(proposal: RegisterDeployment) {
  if (proposal.status !== 'applied') return 'Not admitted';
  const execution = proposal.execution;
  if (execution?.attributionRequired) return 'Attribution required';
  if (execution?.operationStatus === 'reverted') return 'Transaction reverted';
  if (execution?.operationStatus === 'failed') return 'Failed before signing';
  if (execution?.projectedAt) return 'Confirmed and projected';
  if (execution?.operationStatus === 'confirmed') return 'Confirmed; projection pending';
  if (proposal.executionUnmetRequirements.length) return 'Execution held';
  if (!execution?.operationStatus) return 'Admitted; execution pending';
  const states: Record<string, string> = {
    preparing: 'Preparing transaction',
    signed: 'Signed; awaiting confirmation',
  };
  return states[execution.operationStatus.toLowerCase()] ?? execution.operationStatus;
}
