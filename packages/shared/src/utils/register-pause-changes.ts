import type {
  RegisterPauseChange,
  RegisterPauseChangePreparation,
  RegisterPauseChangeDecisionPreview,
  RegisterDecideRequest,
} from '../types';

const digest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const dated = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

function coherent(record: RegisterPauseChange) {
  return (
    record.company === record.snapshot.company.uuid &&
    record.token === record.snapshot.token.uuid &&
    record.snapshot.token.chain === 'base' &&
    !!record.snapshot.token.contractAddress &&
    typeof record.paused === 'boolean' &&
    typeof record.reason === 'string' &&
    !!record.reason.trim() &&
    record.reason.length <= 1000 &&
    typeof record.authorityReference === 'string' &&
    !!record.authorityReference.trim() &&
    record.authorityReference.length <= 255 &&
    digest(record.intentDigest) &&
    digest(record.evidenceFingerprint) &&
    (!record.execution ||
      (record.execution.submissionId === record.uuid && record.execution.paused === record.paused)) &&
    (record.status !== 'applied' || (!!record.approvalDecision && !!record.execution))
  );
}

export function isPreparedRegisterPauseChange(
  record: RegisterPauseChange,
  request: RegisterPauseChangePreparation,
  company: string,
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
    record.paused === request.paused &&
    record.reason === request.reason &&
    record.authorityReference === request.authorityReference &&
    ['submitted', 'applied', 'rejected'].includes(record.status)
  );
}

export function isRegisterPauseChangeDecisionReceipt(
  record: RegisterPauseChange,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterPauseChangeDecisionPreview,
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
        record.paused !== preview.paused ||
        record.reason !== preview.reason ||
        record.authorityReference !== preview.authorityReference))
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

export function registerPauseChangeExecutionState(record: RegisterPauseChange) {
  const execution = record.execution;
  if (!execution) return 'No pause execution admitted';
  if (execution.submissionId !== record.uuid || execution.paused !== record.paused)
    return 'Original pause receipt does not identify this instruction';
  if (execution.status === 'failed' || execution.operationStatus === 'failed') return 'Original pause execution failed';
  if (execution.operationStatus === 'reverted') return 'Original transaction reverted';
  const observation = execution.observation;
  if (execution.status === 'observed') {
    if (
      dated(execution.completedAt) &&
      observation &&
      Number.isInteger(observation.blockNumber) &&
      observation.blockNumber >= 0 &&
      hash(observation.blockHash) &&
      dated(observation.observedAt) &&
      execution.operationId === null &&
      execution.claimId === null &&
      execution.operationStatus === null &&
      execution.txHash === null &&
      execution.blockNumber === null &&
      execution.blockHash === null &&
      execution.gasUsed === null
    )
      return 'Requested state already observed; no transaction, signature or nonce';
    return 'Original marked observed; complete original no-transaction observation unavailable';
  }
  if (
    execution.status === 'confirmed' &&
    dated(execution.completedAt) &&
    execution.operationId &&
    execution.claimId &&
    execution.operationStatus === 'confirmed' &&
    hash(execution.txHash) &&
    Number.isInteger(execution.blockNumber) &&
    execution.blockNumber !== null &&
    execution.blockNumber >= 0 &&
    hash(execution.blockHash)
  )
    return 'Finalised original pause transaction projected';
  if (execution.status === 'confirmed') return 'Original marked confirmed; complete original chain receipt unavailable';
  if (execution.operationStatus === 'confirmed')
    return 'Original chain receipt confirmed; finality and projection pending';
  if (execution.operationStatus === 'signed') return 'Original transaction signed; confirmation pending';
  if (record.executionUnmetRequirements.length) return 'Original unsigned pause execution held';
  if (execution.operationStatus === 'preparing') return 'Original unsigned transaction preparing';
  return 'Original pause change admitted; outcome unresolved';
}
