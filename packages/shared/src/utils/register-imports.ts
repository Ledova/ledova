import type {
  RegisterImport,
  RegisterImportFormerRow,
  RegisterImportMemberRow,
  RegisterImportPreparation,
  RegisterImportRecord,
} from '../types';
import { rowsOf } from './register-commands';

const MEMBER_TEXT = ['member', 'name', 'residentialAddress', 'shares', 'enteredOn'];
const FORMER_TEXT = ['name', 'residentialAddress', 'shares', 'ceasedOn'];

export function registerImportOf(record: RegisterImportRecord): RegisterImport {
  const { members, formerMembers } = record;
  if (
    !rowsOf<RegisterImportMemberRow>(members, MEMBER_TEXT, ['amountPaid']) ||
    !rowsOf<RegisterImportFormerRow>(formerMembers, FORMER_TEXT)
  )
    throw new Error('The register import rows could not be read.');
  return { ...record, members, formerMembers };
}

export function registerImportTotals(members: Pick<RegisterImportMemberRow, 'shares'>[]) {
  const total = members.reduce((sum, row) => sum + BigInt(/^\d+$/.test(row.shares) ? row.shares : '0'), 0n);
  return { total: total.toString(), count: members.length };
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
