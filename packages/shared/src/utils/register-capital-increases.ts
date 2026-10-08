import type {
  RegisterCapitalIncrease,
  RegisterCapitalIncreasePreparation,
  RegisterCapitalIncreaseDecisionPreview,
  RegisterDecideRequest,
} from '../types';
import { requestShares, wholeShares } from './share-quantities';

function coherent(record: RegisterCapitalIncrease) {
  const snapshot = record.snapshot;
  const capital = snapshot.capital;
  const prior = wholeShares(capital.priorAuthorizedTotal);
  const delta = wholeShares(capital.additionalShares);
  const target = wholeShares(capital.newAuthorizedTotal);
  return (
    record.company === snapshot.company.uuid &&
    record.token === snapshot.token.uuid &&
    snapshot.token.chain === 'base' &&
    snapshot.token.decimals === 0 &&
    !!snapshot.token.contractAddress &&
    snapshot.token.authorisedShares === capital.priorAuthorizedTotal &&
    prior !== null &&
    delta !== null &&
    target !== null &&
    target === prior + delta &&
    requestShares(capital.additionalShares) !== null &&
    requestShares(capital.newAuthorizedTotal) !== null &&
    record.additionalShares === capital.additionalShares &&
    record.newAuthorizedTotal === capital.newAuthorizedTotal &&
    record.purpose === capital.purpose &&
    record.boardResolutionReference === capital.boardResolutionReference &&
    record.shareholderApprovalReference === capital.shareholderApprovalReference &&
    typeof record.intentDigest === 'string' &&
    /^[0-9a-f]{64}$/.test(record.intentDigest) &&
    !!record.request &&
    (!record.execution ||
      (record.execution.request === record.request && !!record.execution.execution && !!record.execution.dispatchId)) &&
    (record.status !== 'applied' || (!!record.approvalDecision && !!record.execution))
  );
}

export function isPreparedRegisterCapitalIncrease(
  record: RegisterCapitalIncrease,
  request: RegisterCapitalIncreasePreparation,
  company: string,
  prior: string,
) {
  return (
    coherent(record) &&
    record.uuid === request.operationId &&
    record.operationId === request.operationId &&
    record.company === company &&
    record.token === request.token &&
    record.preparingAppointment === request.appointment &&
    record.authorityEvidence === request.authorityEvidence &&
    record.providedBy === 'company' &&
    record.snapshot.capital.priorAuthorizedTotal === prior &&
    record.additionalShares === String(request.additionalShares) &&
    record.newAuthorizedTotal === String(request.newAuthorizedTotal) &&
    record.purpose === request.purpose &&
    record.boardResolutionReference === request.boardResolutionReference &&
    record.shareholderApprovalReference === (request.shareholderApprovalReference ?? '') &&
    ['submitted', 'applied', 'rejected'].includes(record.status)
  );
}

export function isRegisterCapitalIncreaseDecisionReceipt(
  record: RegisterCapitalIncrease,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterCapitalIncreaseDecisionPreview,
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
        record.snapshot.capital.priorAuthorizedTotal !== preview.priorAuthorizedTotal ||
        record.additionalShares !== preview.additionalShares ||
        record.newAuthorizedTotal !== preview.newAuthorizedTotal))
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

export function registerCapitalIncreaseExecutionState(record: RegisterCapitalIncrease) {
  const execution = record.execution;
  if (!execution) return 'No capital execution admitted';
  if (execution.attributionRequired) return 'Original execution requires attribution; history retained';
  if (execution.operationStatus === 'reverted') return 'Original transaction reverted';
  if (execution.status === 'superseded') return 'Original unsigned increase superseded';
  if (execution.status === 'failed' || execution.operationStatus === 'failed') return 'Original execution failed';
  if (
    execution.status === 'executed' &&
    execution.projectedAt &&
    execution.operationStatus === 'confirmed' &&
    execution.transaction &&
    execution.txHash &&
    execution.blockNumber !== null &&
    execution.blockHash
  )
    return 'Finalised original cap increase projected';
  if (execution.status === 'executed')
    return 'Original execution marked executed; complete original chain receipt unavailable';
  if (execution.operationStatus === 'confirmed')
    return 'Original chain receipt confirmed; finality and projection pending';
  if (execution.operationStatus === 'signed') return 'Original transaction signed; confirmation pending';
  if (record.executionUnmetRequirements.length) return 'Original unsigned execution held';
  if (execution.operationStatus === 'preparing') return 'Original unsigned transaction preparing';
  return 'Original capital increase admitted; execution queued';
}
