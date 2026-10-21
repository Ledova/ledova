import {
  isCalendarDate,
  registerImportTotals,
  registerImportMoney,
  wholeShares,
  type RegisterImport,
  type RegisterImportAllotment,
  type RegisterImportCurrentMemberRow,
  type RegisterImportFormerRow,
  type TokenHoldersResponse,
  type RegisterTransferMember,
  type CompanyShareTokenListItem,
} from '@ledova/shared';
import type { DocumentDraft } from '@pages/company/ledger/shared/documentAttachmentDraft';

export type AllotmentDraft = Omit<
  RegisterImportAllotment,
  'shareReference' | 'certificateReference' | 'beneficiallyHeld'
> & {
  id: string;
  shareReference: string;
  certificateReference: string;
  beneficiallyHeld: boolean | null;
};

export type MemberDraft = {
  member: string;
  name: string;
  residentialAddress: string;
  shares: string;
  enteredOn: string;
  allotments: AllotmentDraft[];
  documents: DocumentDraft[];
  identityChoice?: 'existing' | 'award' | 'new';
};

export type FormerDraft = { id: string; name: string; residentialAddress: string; shares: string; ceasedOn: string };

export type PreparationDraft = {
  registerFile: File | null;
  asicFile: File | null;
  registerEvidence?: string;
  asicEvidence?: string;
  earlierCopiesNotReused?: boolean;
  asAt: string;
  reference: string;
  reason: string;
  members: MemberDraft[];
  former: FormerDraft[];
  statedTotal: string;
  statedCount: string;
};

function positiveShares(value: string) {
  const shares = wholeShares(value.trim());
  return shares !== null && shares > 0n && shares < 2n ** 256n ? shares.toString() : null;
}

export function allotmentProblems(allotment: AllotmentDraft, asAt: string) {
  const problems: string[] = [];
  if (!isCalendarDate(allotment.allottedOn) || allotment.allottedOn > asAt || positiveShares(allotment.shares) === null)
    problems.push('Enter shares and an allotment date no later than the record date.');
  if (registerImportMoney(allotment.amountPaid) === null || registerImportMoney(allotment.amountUnpaid) === null)
    problems.push('Enter paid and unpaid amounts, using 0 where none is recorded.');
  if (
    registerImportMoney(allotment.amountUnpaid) !== null &&
    allotment.fullyPaid !== (registerImportMoney(allotment.amountUnpaid) === '0.00')
  )
    problems.push('Payment status must agree with the unpaid amount.');
  return problems;
}

export function blankAllotment(): AllotmentDraft {
  return {
    id: crypto.randomUUID(),
    allottedOn: '',
    shares: '',
    shareReference: '',
    certificateReference: '',
    amountPaid: '',
    amountUnpaid: '',
    fullyPaid: true,
    beneficiallyHeld: null,
  };
}

export function blankMember(): MemberDraft {
  return {
    member: crypto.randomUUID(),
    name: '',
    residentialAddress: '',
    shares: '',
    enteredOn: '',
    allotments: [blankAllotment()],
    documents: [],
  };
}

export function initialMembers(register: TokenHoldersResponse, correction?: RegisterImport): MemberDraft[] {
  if (correction)
    return correction.members.map((row) => ({
      member: row.member,
      name: row.name,
      residentialAddress: row.residentialAddress,
      shares: row.shares,
      enteredOn: row.enteredOn,
      documents: (row.documents ?? []).map((document) => ({ ...document, id: crypto.randomUUID(), file: null })),
      allotments: row.allotments?.length
        ? row.allotments.map((allotment) => ({
            ...allotment,
            id: crypto.randomUUID(),
            shareReference: allotment.shareReference ?? '',
            certificateReference: allotment.certificateReference ?? '',
          }))
        : [blankAllotment()],
    }));
  if (!register.initialized) return [blankMember()];
  return register.holders.map((holder) => ({
    member: holder.member,
    name: holder.name ?? '',
    residentialAddress: '',
    documents: [],
    shares: holder.balance,
    enteredOn: holder.enteredOn,
    allotments: [blankAllotment()],
  }));
}

export function memberRows(members: MemberDraft[]): RegisterImportCurrentMemberRow[] {
  return members.map((row) => ({
    member: row.member,
    name: row.name.trim(),
    residentialAddress: row.residentialAddress.trim(),
    shares: positiveShares(row.shares) ?? row.shares.trim(),
    enteredOn: row.enteredOn,
    ...(row.documents.some((document) => document.evidence)
      ? {
          documents: row.documents
            .filter((document) => document.evidence)
            .map(({ evidence, category }) => ({ evidence: evidence!, category })),
        }
      : {}),
    allotments: row.allotments.map((allotment) => {
      return {
        allottedOn: allotment.allottedOn,
        fullyPaid: allotment.fullyPaid,
        beneficiallyHeld: allotment.beneficiallyHeld,
        shares: positiveShares(allotment.shares) ?? allotment.shares.trim(),
        amountPaid: registerImportMoney(allotment.amountPaid) ?? allotment.amountPaid.trim(),
        amountUnpaid: registerImportMoney(allotment.amountUnpaid) ?? allotment.amountUnpaid.trim(),
        shareReference: allotment.shareReference.trim() || null,
        certificateReference: allotment.certificateReference.trim() || null,
      };
    }),
  }));
}

export function canOpenEmptyRegister(
  register: TokenHoldersResponse,
  token: Pick<CompanyShareTokenListItem, 'uuid' | 'status' | 'contractAddress' | 'chain' | 'deployedAt'>,
) {
  return (
    token.uuid === register.token.uuid &&
    token.status === 'draft' &&
    token.contractAddress === null &&
    token.chain === null &&
    token.deployedAt === null &&
    register.token.status === 'draft' &&
    register.initialized === false &&
    register.issuedSupply === null &&
    register.holders.length === 0 &&
    register.totalHolders === 0 &&
    register.formerMembers.length === 0 &&
    (register.waitingEffects === null || register.waitingEffects === 0)
  );
}

export function memberIdentityProblems(
  members: MemberDraft[],
  known: RegisterTransferMember[],
  preserveParticulars: boolean,
) {
  const problems: string[] = [];
  if (new Set(members.map((row) => row.member)).size !== members.length)
    problems.push('Each company shareholder can appear only once in this class. Combine their allotments in one row.');
  members.forEach((row, index) => {
    const member = known.find((candidate) => candidate.member === row.member);
    const recipient = member?.onRegister === false ? member : undefined;
    if (row.identityChoice === 'existing' && !member)
      problems.push(
        `Shareholder ${index + 1}: the existing company member is no longer available. Refresh before continuing.`,
      );
    if (row.identityChoice === 'award' && !member)
      problems.push(`Shareholder ${index + 1}: the award recipient is no longer available. Refresh before continuing.`);
    if (known.length && !member && row.identityChoice !== 'new')
      problems.push(
        `Shareholder ${index + 1}: choose an existing company shareholder or explicitly choose a new shareholder.`,
      );
    if (recipient && (row.name !== recipient.name || row.residentialAddress !== recipient.residentialAddress))
      problems.push(
        `Shareholder ${index + 1}: keep the award recipient’s recorded name and address when recording their first shares.`,
      );
    if (
      preserveParticulars &&
      member &&
      !recipient &&
      ((member.name && row.name !== member.name) ||
        (member.residentialAddress && row.residentialAddress !== member.residentialAddress))
    )
      problems.push(
        `Shareholder ${index + 1}: keep the existing company name and address. Correct company particulars from Register separately.`,
      );
  });
  return problems;
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
  const total = draft.statedTotal.trim() ? wholeShares(draft.statedTotal.trim()) : undefined;
  const count = draft.statedCount.trim()
    ? /^\d+$/.test(draft.statedCount.trim())
      ? Number(draft.statedCount.trim())
      : null
    : undefined;
  return total === null || count === null || (count !== undefined && !Number.isSafeInteger(count))
    ? null
    : { total: total?.toString(), count };
}

export function figuresDiffer(draft: PreparationDraft) {
  const stated = statedFigures(draft);
  const imported = registerImportTotals(draft.members);
  return stated?.total !== undefined && stated.total !== imported.total;
}

export function preparationProblems(draft: PreparationDraft, today: string, emptyOpeningAllowed = false) {
  const problems: string[] = [];
  const dated = (day: string) => isCalendarDate(day) && day <= draft.asAt;
  const incomplete = (row: { name: string; residentialAddress: string; shares: string }) =>
    !row.name.trim() || !row.residentialAddress.trim() || positiveShares(row.shares) === null;
  if (!dated(draft.asAt) || draft.asAt > today) problems.push('Enter a record date no later than today (UTC).');
  if (!draft.reference.trim()) problems.push('The record attribution is unavailable. Reload the setup and try again.');
  if (!draft.reason.trim()) problems.push('Give a reason for correcting the mirror.');
  if (draft.members.length === 0 && (!emptyOpeningAllowed || draft.former.length > 0))
    problems.push('Add at least one current shareholder.');
  draft.members.forEach((row, index) => {
    const label = `Shareholder ${index + 1}`;
    if (incomplete(row) || !dated(row.enteredOn))
      problems.push(
        `${label}: enter a name, address, shares and original membership date no later than the record date.`,
      );
    if (row.allotments.length === 0) problems.push(`${label}: add the allotments underlying this holding.`);
    let total = 0n;
    row.allotments.forEach((allotment, at) => {
      const prefix = `${label}, allotment ${at + 1}`;
      const shares = positiveShares(allotment.shares);
      if (shares !== null) total += BigInt(shares);
      problems.push(...allotmentProblems(allotment, draft.asAt).map((problem) => `${prefix}: ${problem}`));
    });
    const shares = positiveShares(row.shares);
    if (shares !== null && total !== BigInt(shares))
      problems.push(`${label}: allotment shares must add up to the current holding.`);
  });
  if (draft.former.some((row) => incomplete(row) || !dated(row.ceasedOn)))
    problems.push('Complete any former shareholder details copied from the source record.');
  if ((draft.statedTotal.trim() || draft.statedCount.trim()) && !draft.asicFile && !draft.asicEvidence)
    problems.push('Attach the optional ASIC extract when entering its comparison figures.');
  if (!statedFigures(draft)) problems.push('Enter valid whole-number comparison figures or leave them blank.');
  return problems;
}
