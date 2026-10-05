import {
  registerImportTotals,
  wholeShares,
  type RegisterImportFormerRow,
  type RegisterImportMemberRow,
  type TokenHoldersResponse,
} from '@ledova/shared';

export type Authority = 'director_resolution' | 'court_order';

export type MemberDraft = {
  member: string;
  name: string;
  residentialAddress: string;
  shares: string;
  enteredOn: string;
  amountPaid: string;
};

export type FormerDraft = { id: string; name: string; residentialAddress: string; shares: string; ceasedOn: string };

export type PreparationDraft = {
  registerFile: File | null;
  asicFile: File | null;
  asAt: string;
  authority: Authority;
  director: string;
  reference: string;
  reason: string;
  members: MemberDraft[];
  former: FormerDraft[];
  statedTotal: string;
  statedCount: string;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,2})?$/;

export function positiveShares(value: string) {
  const shares = wholeShares(value.trim());
  return shares !== null && shares > 0n ? shares.toString() : null;
}

export function blankMember(): MemberDraft {
  return { member: crypto.randomUUID(), name: '', residentialAddress: '', shares: '', enteredOn: '', amountPaid: '' };
}

export function blankFormer(): FormerDraft {
  return { id: crypto.randomUUID(), name: '', residentialAddress: '', shares: '', ceasedOn: '' };
}

export function initialMembers(register: TokenHoldersResponse): MemberDraft[] {
  if (!register.initialized) return [blankMember()];
  return register.holders.map((holder) => ({
    member: holder.member,
    name: holder.name ?? '',
    residentialAddress: '',
    shares: holder.balance,
    enteredOn: '',
    amountPaid: '',
  }));
}

export function memberRows(members: MemberDraft[]): RegisterImportMemberRow[] {
  return members.map((row) => ({
    member: row.member,
    name: row.name.trim(),
    residentialAddress: row.residentialAddress.trim(),
    shares: positiveShares(row.shares) ?? row.shares.trim(),
    enteredOn: row.enteredOn,
    amountPaid: row.amountPaid.trim() || null,
  }));
}

export function formerRows(former: FormerDraft[]): RegisterImportFormerRow[] {
  return former.map((row) => ({
    name: row.name.trim(),
    residentialAddress: row.residentialAddress.trim(),
    shares: positiveShares(row.shares) ?? row.shares.trim(),
    ceasedOn: row.ceasedOn,
  }));
}

export function statedFigures(draft: PreparationDraft) {
  const total = wholeShares(draft.statedTotal.trim());
  const count = /^\d+$/.test(draft.statedCount.trim()) ? Number(draft.statedCount.trim()) : null;
  return total === null || count === null || !Number.isSafeInteger(count) ? null : { total: total.toString(), count };
}

export function figuresDiffer(draft: PreparationDraft) {
  const stated = statedFigures(draft);
  const imported = registerImportTotals(memberRows(draft.members));
  return stated !== null && (stated.total !== imported.total || stated.count !== imported.count);
}

export function preparationProblems(draft: PreparationDraft, today: string) {
  const problems: string[] = [];
  const dated = (day: string) => DAY.test(day) && day <= draft.asAt;
  const incomplete = (row: { name: string; residentialAddress: string; shares: string }) =>
    !row.name.trim() || !row.residentialAddress.trim() || positiveShares(row.shares) === null;
  if (!draft.registerFile || !draft.asicFile) problems.push('Choose the current share register and the ASIC extract.');
  if (!DAY.test(draft.asAt) || draft.asAt > today) problems.push('Enter a register date that is not in the future.');
  if (draft.authority === 'director_resolution' && !draft.director.trim())
    problems.push('Name the approving director for a resolution.');
  if (!draft.reference.trim() || !draft.reason.trim()) problems.push('Give the authority reference and the reason.');
  if (draft.members.length === 0) problems.push('The import needs at least one current member.');
  if (draft.members.some((row) => incomplete(row) || !dated(row.enteredOn)))
    problems.push(
      "Complete each current member's name, residential address, shares and a date entered no later than the " +
        'register date.',
    );
  if (draft.members.some((row) => row.amountPaid.trim() && !MONEY.test(row.amountPaid.trim())))
    problems.push('Enter each amount paid as a plain amount such as 250.00, or leave it blank when it is not known.');
  if (draft.former.some((row) => incomplete(row) || !dated(row.ceasedOn)))
    problems.push(
      "Complete each former member's name, residential address, shares and a date ceased no later than the register " +
        'date.',
    );
  if (!statedFigures(draft)) problems.push("State the ASIC extract's issued shares and member count for this class.");
  return problems;
}
