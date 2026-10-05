import type {
  CompanyCapability,
  OwnCompanyAppointment,
  RegisterEvidence,
  RegisterEvidenceUpload,
  RegisterImport,
  RegisterImportDecideRequest,
  RegisterImportDecisionKind,
  RegisterImportMemberRow,
  RegisterImportPreparation,
} from '../types';

export type RegisterImportStep = 'prepare' | RegisterImportDecisionKind;

const STEP_CAPABILITY: Record<RegisterImportStep, CompanyCapability> = {
  prepare: 'prepare',
  approve: 'approve',
  apply: 'apply',
  reject: 'approve',
};

export function registerImportTotals(members: Pick<RegisterImportMemberRow, 'shares'>[]) {
  const total = members.reduce((sum, row) => sum + BigInt(/^\d+$/.test(row.shares) ? row.shares : '0'), 0n);
  return { total: total.toString(), count: members.length };
}

export function appointmentForRegisterImportStep(
  appointments: OwnCompanyAppointment[],
  company: string,
  step: RegisterImportStep,
) {
  return appointments
    .filter(
      (appointment) =>
        appointment.company === company &&
        appointment.isEffective &&
        (appointment.capabilities.includes('admin') || appointment.capabilities.includes(STEP_CAPABILITY[step])),
    )
    .sort((left, right) => left.uuid.localeCompare(right.uuid))[0];
}

export function isRegisterEvidenceReceipt(
  receipt: RegisterEvidence,
  request: Omit<RegisterEvidenceUpload, 'file'>,
  size: number,
) {
  return (
    receipt.company === request.companyId &&
    receipt.appointment === request.appointment &&
    receipt.kind === request.kind &&
    receipt.idempotencyKey === request.idempotencyKey &&
    receipt.fileSize === size &&
    receipt.providedBy === 'company' &&
    /^[0-9a-f]{64}$/.test(receipt.sha256)
  );
}

function sameRows(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isPreparedRegisterImport(proposal: RegisterImport, request: RegisterImportPreparation) {
  return (
    proposal.uuid === request.operationId &&
    proposal.token === request.tokenId &&
    proposal.preparingAppointment === request.appointment &&
    proposal.registerEvidence === request.registerEvidence &&
    proposal.asicEvidence === request.asicEvidence &&
    proposal.asicIssuedTotal === request.asicIssuedTotal &&
    proposal.asicMemberCount === request.asicMemberCount &&
    proposal.asAt === request.asAt &&
    proposal.providedBy === 'company' &&
    sameRows(
      [...proposal.members].sort((left, right) => left.member.localeCompare(right.member)),
      [...request.members].sort((left, right) => left.member.localeCompare(right.member)),
    ) &&
    proposal.formerMembers.length === request.formerMembers.length
  );
}

export function isRegisterImportDecisionReceipt(
  proposal: RegisterImport,
  uuid: string,
  request: RegisterImportDecideRequest,
) {
  const decision = proposal.decisions.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (
    proposal.uuid !== uuid ||
    !decision ||
    decision.kind !== request.kind ||
    decision.appointment !== request.appointment ||
    decision.digest !== request.previewDigest ||
    decision.reason !== (request.reason ?? '')
  )
    return false;
  if (request.kind === 'apply') return proposal.status === 'applied' && proposal.reviewedAt === decision.decidedAt;
  if (request.kind === 'reject')
    return (
      proposal.status === 'rejected' &&
      proposal.reviewedAt === decision.decidedAt &&
      proposal.rejectionReason === decision.reason
    );
  return proposal.status === 'submitted';
}
