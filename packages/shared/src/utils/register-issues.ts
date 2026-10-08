import type {
  RegisterIssue,
  RegisterIssuePreparation,
  RegisterIssueDecisionPreview,
  RegisterDecideRequest,
} from '../types';
import { requestShares, wholeShares } from './share-quantities';

function coherent(record: RegisterIssue) {
  const snapshot = record.snapshot;
  const execution = record.execution;
  return (
    record.company === snapshot.company.uuid &&
    record.token === snapshot.token.uuid &&
    record.member === snapshot.member.uuid &&
    record.nomination === snapshot.wallet.nomination &&
    record.walletApproval === snapshot.wallet.approval &&
    snapshot.member.address.toLowerCase() === snapshot.wallet.address.toLowerCase() &&
    snapshot.token.chain === 'base' &&
    typeof record.shares === 'string' &&
    requestShares(record.shares) !== null &&
    [snapshot.register.issuedSupply, snapshot.register.currentShares, snapshot.token.authorisedShares].every(
      (value) => wholeShares(value) !== null,
    ) &&
    typeof record.intentDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(record.intentDigest) &&
    !!record.request &&
    (!execution ||
      (execution.request === record.request &&
        !!execution.execution &&
        !!execution.dispatchId &&
        !!execution.registerEntry === !!execution.effectiveOn &&
        (!execution.registerEntry || !!execution.issuance))) &&
    (record.status !== 'applied' || (!!record.approvalDecision && !!execution))
  );
}

export function isPreparedRegisterIssue(
  record: RegisterIssue,
  request: RegisterIssuePreparation,
  company: string,
  address: string,
) {
  return (
    coherent(record) &&
    record.uuid === request.operationId &&
    record.operationId === request.operationId &&
    record.company === company &&
    record.preparingAppointment === request.appointment &&
    record.token === request.token &&
    record.member === request.member &&
    record.nomination === request.nomination &&
    record.walletApproval === request.walletApproval &&
    record.shares === request.shares &&
    record.approvingDirector === request.approvingDirector &&
    record.authorityReference === request.authorityReference &&
    record.reason === request.reason &&
    record.termsOn === request.termsOn &&
    record.terms === request.terms &&
    record.acceptanceRequired === request.acceptanceRequired &&
    record.authorityEvidence === request.authorityEvidence &&
    record.termsEvidence === request.termsEvidence &&
    record.acceptanceEvidence === (request.acceptanceEvidence ?? null) &&
    record.providedBy === 'company' &&
    record.snapshot.wallet.address.toLowerCase() === address.toLowerCase() &&
    ['submitted', 'applied', 'rejected'].includes(record.status)
  );
}

export function isRegisterIssueDecisionReceipt(
  record: RegisterIssue,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterIssueDecisionPreview,
) {
  const decision = record.decisions.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (
    !coherent(record) ||
    record.uuid !== uuid ||
    record.operationId !== uuid ||
    !decision ||
    decision.kind !== request.kind ||
    decision.appointment !== request.appointment ||
    decision.digest !== request.previewDigest ||
    decision.reason !== (request.reason ?? '') ||
    (preview &&
      (record.intentDigest !== preview.intentDigest ||
        JSON.stringify(record.snapshot) !== JSON.stringify(preview.snapshot) ||
        record.shares !== preview.shares ||
        record.terms !== preview.terms ||
        record.termsOn !== preview.termsOn ||
        record.acceptanceRequired !== preview.acceptanceRequired ||
        record.approvingDirector !== preview.approvingDirector ||
        record.authorityReference !== preview.authorityReference ||
        record.reason !== preview.reason))
  )
    return false;
  if (request.kind === 'apply')
    return (
      record.status === 'applied' &&
      record.reviewedAt === decision.decidedAt &&
      !!record.execution &&
      !!record.approvalDecision &&
      record.approvalDecision === preview?.approvalDecision
    );
  if (request.kind === 'reject')
    return (
      record.status === 'rejected' &&
      record.reviewedAt === decision.decidedAt &&
      record.rejectionReason === decision.reason
    );
  return ['submitted', 'applied', 'rejected'].includes(record.status);
}

export function registerIssueExecutionState(record: RegisterIssue) {
  const execution = record.execution;
  if (!execution) return 'No issue execution admitted';
  if (execution.operationStatus === 'reverted') return 'Original transaction reverted';
  if (execution.status === 'cancelled') return 'Original unsigned execution cancelled';
  if (execution.status === 'failed' || execution.operationStatus === 'failed') return 'Original execution failed';
  if (execution.status === 'executed' && execution.issuance && execution.registerEntry && execution.effectiveOn)
    return 'Finalised mint recorded in the register';
  if (execution.status === 'executed') return 'Finalised mint; register entry not recorded';
  if (execution.operationStatus === 'confirmed') return 'Chain receipt confirmed; finality and projection pending';
  if (execution.operationStatus === 'signed') return 'Original transaction signed; confirmation pending';
  if (record.executionUnmetRequirements.length) return 'Original unsigned execution held';
  if (execution.operationStatus === 'preparing') return 'Original unsigned transaction preparing';
  return 'Original issue admitted; execution queued';
}
