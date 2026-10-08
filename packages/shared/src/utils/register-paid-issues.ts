import type {
  CompanyShareToken,
  RegisterPaidIssue,
  RegisterPaidIssueSource,
  RegisterPaidIssuePreparation,
  RegisterPaidIssueDecisionPreview,
  RegisterDecideRequest,
} from '../types';
import { requestShares, wholeShares } from './share-quantities';

const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const dated = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const decimal = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);

export function isRegisterPaidIssueSource(source: RegisterPaidIssueSource, company: string, token: string) {
  return (
    source.company === company &&
    source.token === token &&
    !!source.subscription &&
    !!source.offering &&
    /^0x[0-9a-f]{40}$/i.test(source.recipientAddress) &&
    typeof source.recipientName === 'string' &&
    requestShares(source.shares) !== null &&
    requestShares(source.requestedShares) !== null &&
    [source.pricePerShare, source.amountDue, source.moneyHeld].every(decimal) &&
    (source.amountReceived === null || decimal(source.amountReceived)) &&
    (source.refundAmount === null || decimal(source.refundAmount)) &&
    !!source.currency
  );
}

function coherent(record: RegisterPaidIssue) {
  const snapshot = record.snapshot;
  const execution = record.execution;
  return (
    record.company === snapshot.company.uuid &&
    record.token === snapshot.token.uuid &&
    isRegisterPaidIssueSource(snapshot.source, record.company, record.token) &&
    record.subscription === snapshot.source.subscription &&
    record.shares === snapshot.source.shares &&
    snapshot.token.chain === 'base' &&
    /^0x[0-9a-f]{40}$/i.test(snapshot.token.contractAddress) &&
    wholeShares(snapshot.token.authorisedShares) !== null &&
    digest(record.intentDigest) &&
    digest(record.evidenceFingerprint) &&
    !!record.authorityEvidence &&
    (!execution ||
      (execution.request === record.request &&
        !!execution.execution &&
        !!execution.dispatchId &&
        !!execution.registerEntry === !!execution.effectiveOn &&
        (!execution.registerEntry || !!execution.issuance))) &&
    (record.status !== 'applied' || (!!record.request && !!record.approvalDecision && !!execution))
  );
}

export function isPreparedRegisterPaidIssue(
  record: RegisterPaidIssue,
  request: RegisterPaidIssuePreparation,
  source: RegisterPaidIssueSource,
  token: CompanyShareToken | undefined,
) {
  return (
    coherent(record) &&
    !!token &&
    record.uuid === request.operationId &&
    record.operationId === request.operationId &&
    record.company === source.company &&
    record.token === source.token &&
    record.preparingAppointment === request.appointment &&
    record.subscription === request.subscription &&
    record.approvingDirector === request.approvingDirector &&
    record.authorityReference === request.authorityReference &&
    record.reason === request.reason &&
    record.authorityEvidence === request.authorityEvidence &&
    record.providedBy === 'company' &&
    record.snapshot.token.uuid === token.uuid &&
    ['submitted', 'applied', 'rejected'].includes(record.status)
  );
}

export function isRegisterPaidIssueDecisionReceipt(
  record: RegisterPaidIssue,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterPaidIssueDecisionPreview,
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
        record.approvingDirector !== preview.approvingDirector ||
        record.authorityReference !== preview.authorityReference ||
        record.reason !== preview.reason))
  )
    return false;
  if (request.kind === 'apply')
    return (
      record.status === 'applied' &&
      record.reviewedAt === decision.decidedAt &&
      !!record.request &&
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

export function registerPaidIssueExecutionState(record: RegisterPaidIssue) {
  const execution = record.execution;
  if (!execution) return 'No paid issue execution admitted';
  if (!record.request || execution.request !== record.request)
    return 'Original paid issue receipt does not identify this request';
  if (execution.operationStatus === 'reverted') return 'Original transaction reverted';
  if (execution.status === 'cancelled') return 'Original unsigned execution cancelled; paid allocation remains bound';
  if (execution.status === 'failed' || execution.operationStatus === 'failed')
    return 'Original paid issue execution failed';
  if (
    execution.status === 'executed' &&
    execution.issuance &&
    execution.operationId &&
    execution.claimId &&
    execution.transaction &&
    execution.operationStatus === 'confirmed' &&
    hash(execution.txHash) &&
    execution.blockNumber !== null &&
    Number.isSafeInteger(execution.blockNumber) &&
    execution.blockNumber >= 0 &&
    hash(execution.blockHash) &&
    dated(execution.completedAt)
  )
    return execution.registerEntry && execution.effectiveOn
      ? 'Finalised original paid mint recorded in the register'
      : 'Finalised original paid mint; register entry not recorded';
  if (execution.status === 'executed') return 'Original marked executed; complete original mint receipt unavailable';
  if (execution.operationStatus === 'confirmed')
    return 'Original chain receipt confirmed; finality and projection pending';
  if (execution.operationStatus === 'signed') return 'Original transaction signed; confirmation pending';
  if (record.executionUnmetRequirements.length) return 'Original unsigned paid issue held';
  if (execution.operationStatus === 'preparing') return 'Original unsigned transaction preparing';
  return 'Original paid issue admitted; execution queued';
}
