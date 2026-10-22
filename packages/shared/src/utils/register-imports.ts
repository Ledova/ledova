import type {
  RegisterImport,
  RegisterImportAllotment,
  RegisterImportCurrentMemberRow,
  RegisterImportFormerRow,
  RegisterImportMemberRow,
  RegisterImportPreparation,
  RegisterImportRecord,
  RegisterTransferMember,
  RegisterTransferMembers,
  RegisterAwardRecipient,
} from '../types';
import { rowsOf } from './register-commands';
import { isRegisterImportMemberDocuments } from './register-member-documents';
import { isCalendarDate } from './date';

const MEMBER_TEXT = ['member', 'name', 'residentialAddress', 'shares', 'enteredOn'];
const FORMER_TEXT = ['name', 'residentialAddress', 'shares', 'ceasedOn'];

export function isRegisterImportMembers(value: unknown): value is RegisterTransferMembers {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<RegisterTransferMembers>;
  if (
    !rowsOf<RegisterTransferMember>(
      data.members,
      ['member', 'currentShares'],
      ['name', 'residentialAddress', 'enteredOn', 'lastCeasedOn'],
    ) ||
    !rowsOf<RegisterAwardRecipient>(data.awardRecipients, ['member', 'name', 'residentialAddress'])
  )
    return false;
  return (
    data.members.every(
      (member) =>
        !!member.member.trim() &&
        /^\d+$/.test(member.currentShares) &&
        typeof member.particularsRetained === 'boolean' &&
        typeof member.walletless === 'boolean' &&
        (member.onRegister === undefined || typeof member.onRegister === 'boolean') &&
        (member.hasAwards === undefined || typeof member.hasAwards === 'boolean'),
    ) &&
    data.awardRecipients.every(
      (recipient) => !!recipient.member.trim() && !!recipient.name.trim() && !!recipient.residentialAddress.trim(),
    ) &&
    new Set([...data.members, ...data.awardRecipients].map((member) => member.member)).size ===
      data.members.length + data.awardRecipients.length
  );
}

export function registerImportMoney(value: string) {
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}` : null;
}

function positiveShares(value: string) {
  return /^[1-9]\d{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
}

function allotmentsOf(value: unknown): value is RegisterImportAllotment[] {
  return (
    rowsOf<RegisterImportAllotment>(
      value,
      ['allottedOn', 'shares', 'amountPaid', 'amountUnpaid'],
      ['shareReference', 'certificateReference'],
    ) &&
    value.length <= 10000 &&
    value.every(
      (row) =>
        isCalendarDate(row.allottedOn) &&
        typeof row.fullyPaid === 'boolean' &&
        (row.beneficiallyHeld === null || typeof row.beneficiallyHeld === 'boolean') &&
        positiveShares(row.shares) &&
        registerImportMoney(row.amountPaid) !== null &&
        registerImportMoney(row.amountUnpaid) !== null &&
        row.fullyPaid === (registerImportMoney(row.amountUnpaid) === '0.00'),
    )
  );
}

function currentRowOf(row: RegisterImportMemberRow) {
  if (!positiveShares(row.shares) || !isCalendarDate(row.enteredOn) || !allotmentsOf(row.allotments)) return false;
  if (row.amountPaid === null) return true;
  const shares = row.allotments.reduce((sum, allotment) => sum + BigInt(allotment.shares), 0n);
  const paid = row.allotments.reduce(
    (sum, allotment) => sum + BigInt(registerImportMoney(allotment.amountPaid)!.replace('.', '')),
    0n,
  );
  return (
    row.shares === shares.toString() && row.amountPaid === `${paid / 100n}.${(paid % 100n).toString().padStart(2, '0')}`
  );
}

export function registerImportOf(record: RegisterImportRecord): RegisterImport {
  const { members, formerMembers } = record;
  if (
    !rowsOf<RegisterImportMemberRow>(members, MEMBER_TEXT, ['amountPaid']) ||
    !rowsOf<RegisterImportFormerRow>(formerMembers, FORMER_TEXT) ||
    members.some(
      (row) =>
        (row.allotments !== undefined && !currentRowOf(row)) ||
        (row.documents !== undefined && !isRegisterImportMemberDocuments(row.documents, record.company)) ||
        (record.sourceConfirmed === true && row.allotments === undefined),
    )
  )
    throw new Error('The register import rows could not be read.');
  return { ...record, members, formerMembers };
}

export function registerImportTotals(members: Pick<RegisterImportMemberRow, 'shares'>[]) {
  const total = members.reduce((sum, row) => sum + BigInt(/^\d+$/.test(row.shares) ? row.shares : '0'), 0n);
  return { total: total.toString(), count: members.length };
}

function allotmentRows(rows: RegisterImportAllotment[] | undefined) {
  return rows
    ?.map((row) =>
      JSON.stringify([
        row.allottedOn,
        row.shares,
        row.shareReference,
        row.certificateReference,
        registerImportMoney(row.amountPaid),
        registerImportMoney(row.amountUnpaid),
        row.fullyPaid,
        row.beneficiallyHeld,
      ]),
    )
    .sort();
}

function memberRows(rows: (RegisterImportMemberRow | RegisterImportCurrentMemberRow)[]) {
  return JSON.stringify(
    [...rows]
      .sort((left, right) => left.member.localeCompare(right.member))
      .map((row) => [
        row.member,
        row.name,
        row.residentialAddress,
        row.shares,
        row.enteredOn,
        allotmentRows(row.allotments),
        row.documents?.map((document) => JSON.stringify([document.evidence, document.category])).sort(),
      ]),
  );
}

function formerRows(rows: RegisterImportFormerRow[]) {
  return JSON.stringify(
    rows.map((row) => JSON.stringify([row.name, row.residentialAddress, row.shares, row.ceasedOn])).sort(),
  );
}

export function isPreparedRegisterImport(proposal: RegisterImport, request: RegisterImportPreparation) {
  return (
    proposal.uuid === request.operationId &&
    proposal.token === request.tokenId &&
    proposal.preparingAppointment === request.appointment &&
    proposal.registerEvidence === (request.registerEvidence ?? null) &&
    proposal.asicEvidence === (request.asicEvidence ?? null) &&
    proposal.asicIssuedTotal === (request.asicIssuedTotal ?? null) &&
    proposal.asicMemberCount === (request.asicMemberCount ?? null) &&
    proposal.sourceReference === request.sourceReference &&
    request.sourceConfirmed === true &&
    proposal.sourceConfirmed === true &&
    proposal.authority === 'company_records' &&
    proposal.authorityReference === request.sourceReference &&
    proposal.approvingDirector === '' &&
    proposal.correctionOf === (request.correctionOf ?? null) &&
    proposal.reason === request.reason &&
    proposal.asAt === request.asAt &&
    proposal.providedBy === 'company' &&
    proposal.members.every(currentRowOf) &&
    proposal.members.every(
      (row) => row.documents === undefined || isRegisterImportMemberDocuments(row.documents, proposal.company),
    ) &&
    memberRows(proposal.members) === memberRows(request.members) &&
    formerRows(proposal.formerMembers) === formerRows(request.formerMembers)
  );
}
