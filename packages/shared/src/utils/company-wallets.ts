import type {
  WalletNomination,
  WalletNominationRequest,
  WalletNominationPreview,
  CompanyWalletInstruction,
  CompanyWalletPreparation,
  CompanyWalletDecisionPreview,
  RegisterDecideRequest,
} from '../types';

export function isWalletNominationReceipt(
  record: WalletNomination,
  request: WalletNominationRequest,
  preview: WalletNominationPreview,
) {
  return (
    record.uuid === request.operationId &&
    record.operationId === request.operationId &&
    record.request === request.request &&
    record.wallet === request.wallet &&
    record.company === preview.company &&
    record.decision === preview.decision &&
    record.address === preview.address &&
    record.chain === 'base' &&
    record.proof === preview.proof &&
    record.proofCompletedAt === preview.proofCompletedAt &&
    record.eligibilityExpiresAt === preview.eligibilityExpiresAt &&
    record.sharingAccepted === true &&
    record.digest === request.previewDigest &&
    /^[0-9a-f]{64}$/.test(record.digest)
  );
}

export function isPreparedCompanyWalletInstruction(
  record: CompanyWalletInstruction,
  request: CompanyWalletPreparation,
) {
  return (
    record.uuid === request.operationId &&
    record.operationId === request.operationId &&
    record.company === request.company &&
    record.snapshot.company.uuid === request.company &&
    record.preparingAppointment === request.appointment &&
    record.action === request.action &&
    record.nomination === (request.nomination ?? null) &&
    record.targetChange === (request.targetChange ?? null) &&
    (request.expiresAt
      ? Number.isFinite(Date.parse(request.expiresAt)) &&
        Date.parse(record.expiresAt ?? '') === Date.parse(request.expiresAt)
      : record.expiresAt === null) &&
    record.snapshot.target.chain === 'base' &&
    record.snapshot.target.expiresAt === record.expiresAt &&
    record.snapshot.source.nomination === record.nomination &&
    record.snapshot.source.targetChange === record.targetChange &&
    record.providedBy === 'company' &&
    /^[0-9a-f]{64}$/.test(record.intentDigest) &&
    ['submitted', 'applied', 'rejected'].includes(record.status) &&
    (record.status !== 'applied' ||
      (!!record.changeId &&
        !!record.approvalDecision &&
        (!record.execution || record.execution.change === record.changeId)))
  );
}

export function isCompanyWalletDecisionReceipt(
  record: CompanyWalletInstruction,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: CompanyWalletDecisionPreview,
) {
  const decision = record.decisions.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (
    record.uuid !== uuid ||
    record.operationId !== uuid ||
    record.company !== record.snapshot.company.uuid ||
    record.nomination !== record.snapshot.source.nomination ||
    record.targetChange !== record.snapshot.source.targetChange ||
    record.expiresAt !== record.snapshot.target.expiresAt ||
    !decision ||
    decision.kind !== request.kind ||
    decision.appointment !== request.appointment ||
    decision.digest !== request.previewDigest ||
    decision.reason !== (request.reason ?? '') ||
    !/^[0-9a-f]{64}$/.test(record.intentDigest) ||
    (preview &&
      (record.intentDigest !== preview.intentDigest ||
        JSON.stringify(record.snapshot) !== JSON.stringify(preview.snapshot)))
  )
    return false;
  if (request.kind === 'apply')
    return (
      record.status === 'applied' &&
      !!record.changeId &&
      !!record.approvalDecision &&
      (!preview || record.approvalDecision === preview.approvalDecision) &&
      record.reviewedAt === decision.decidedAt &&
      (!record.execution || record.execution.change === record.changeId)
    );
  if (request.kind === 'reject')
    return (
      record.status === 'rejected' &&
      record.reviewedAt === decision.decidedAt &&
      record.rejectionReason === decision.reason
    );
  return ['submitted', 'applied', 'rejected'].includes(record.status);
}
