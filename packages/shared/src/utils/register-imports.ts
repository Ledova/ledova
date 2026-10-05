import type {
  CompanyCapability,
  OwnCompanyAppointment,
  RegisterEvidence,
  RegisterEvidenceUpload,
  RegisterImport,
  RegisterImportDecideRequest,
  RegisterImportDecisionKind,
  RegisterImportFormerRow,
  RegisterImportMemberRow,
  RegisterImportPreparation,
  RegisterImportRecord,
} from '../types';

export type RegisterImportStep = 'prepare' | RegisterImportDecisionKind;

const MEMBER_TEXT = ['member', 'name', 'residentialAddress', 'shares', 'enteredOn'];
const FORMER_TEXT = ['name', 'residentialAddress', 'shares', 'ceasedOn'];

function rowsOf<Row>(value: unknown, text: string[], optional: string[] = []): value is Row[] {
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

export function registerImportOf(record: RegisterImportRecord): RegisterImport {
  const { members, formerMembers } = record;
  if (
    !rowsOf<RegisterImportMemberRow>(members, MEMBER_TEXT, ['amountPaid']) ||
    !rowsOf<RegisterImportFormerRow>(formerMembers, FORMER_TEXT)
  )
    throw new Error('The register import rows could not be read.');
  return { ...record, members, formerMembers };
}

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

function memberRows(rows: RegisterImportMemberRow[]) {
  return JSON.stringify(
    [...rows]
      .sort((left, right) => left.member.localeCompare(right.member))
      .map((row) => [row.member, row.name, row.residentialAddress, row.shares, row.enteredOn, row.amountPaid]),
  );
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
    memberRows(proposal.members) === memberRows(request.members) &&
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
