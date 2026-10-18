import type {
  CompanyCapability,
  OwnCompanyAppointment,
  RegisterDecideRequest,
  RegisterDecisionKind,
  RegisterEvidence,
  RegisterEvidenceUpload,
  RegisterProposal,
} from '../types';

export type RegisterStep = 'prepare' | RegisterDecisionKind;

const STEP_CAPABILITY: Record<RegisterStep, CompanyCapability> = {
  prepare: 'prepare',
  approve: 'approve',
  apply: 'apply',
  reject: 'approve',
};

const REGISTER_READ_CAPABILITIES: readonly CompanyCapability[] = [
  'admin',
  'read_register',
  'prepare',
  'approve',
  'apply',
];

export function rowsOf<Row>(value: unknown, text: string[], optional: string[] = []): value is Row[] {
  return (
    Array.isArray(value) &&
    value.every((row: Record<string, unknown> | null) => {
      if (!row || typeof row !== 'object') return false;
      return (
        text.every((key) => typeof row[key] === 'string') &&
        optional.every((key) => row[key] === null || typeof row[key] === 'string')
      );
    })
  );
}

export function appointmentForRegisterStep(appointments: OwnCompanyAppointment[], company: string, step: RegisterStep) {
  return appointments
    .filter(
      (appointment) =>
        appointment.company === company &&
        appointment.status === 'active' &&
        appointment.isEffective &&
        (!appointment.expiresAt || Date.parse(appointment.expiresAt) > Date.now()) &&
        (appointment.capabilities.includes('admin') || appointment.capabilities.includes(STEP_CAPABILITY[step])),
    )
    .sort((left, right) => left.uuid.localeCompare(right.uuid))[0];
}

export function hasCurrentRegisterReadAuthority(appointments: OwnCompanyAppointment[], company: string) {
  return appointments.some(
    (appointment) =>
      appointment.company === company &&
      appointment.status === 'active' &&
      appointment.isEffective &&
      !appointment.revokedAt &&
      (!appointment.expiresAt || Date.parse(appointment.expiresAt) > Date.now()) &&
      REGISTER_READ_CAPABILITIES.some((capability) => appointment.capabilities.includes(capability)),
  );
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

export function isRegisterDecisionReceipt(proposal: RegisterProposal, uuid: string, request: RegisterDecideRequest) {
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
