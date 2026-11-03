import { REGISTER_CORRECTION_COPY } from '../constants';
import { formatDate } from './date';
import { shareChange, shortReference } from './formatting';
import type {
  RegisterCorrection,
  RegisterCorrectionChange,
  RegisterCorrectionPreparation,
  RegisterCorrectionRecord,
  RegisterDecideRequest,
  RegisterEntry,
  RegisterEntryChange,
} from '../types';
import { isRegisterDecisionReceipt, rowsOf } from './register-commands';

type RegisterChange = Pick<RegisterEntryChange, 'member' | 'shares'> & { name?: string | null };

type EntryDates = Pick<RegisterEntry, 'kind' | 'effectiveOn' | 'companyEventOn'>;

export function entryDate(entry: EntryDates) {
  return (['issue', 'transfer'].includes(entry.kind) && entry.companyEventOn) || entry.effectiveOn;
}

export function entryName(entry: EntryDates) {
  const kind = REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind] ?? 'Register change';
  return `${kind.toLowerCase()} of ${formatDate(entryDate(entry))}`;
}

export function entryLabel(entry: EntryDates & Pick<RegisterEntry, 'changes'>) {
  const names = entry.changes.flatMap((change) => (change.name ? [change.name] : []));
  const who = names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0];
  return who ? `${entryName(entry)}, ${who}` : entryName(entry);
}

export function describeEntry(entry: EntryDates) {
  const kind = REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind] ?? 'Register change';
  const date = entryDate(entry);
  return date === entry.effectiveOn
    ? `${kind} · ${formatDate(date)}`
    : `${kind} · ${formatDate(date)} · Ledger date ${formatDate(entry.effectiveOn)}`;
}

export function entryInverse(entry: Pick<RegisterEntry, 'changes'>) {
  return entry.changes.map((change) => ({ ...change, shares: (-BigInt(change.shares)).toString() }));
}

export function registerCorrectionOf(record: RegisterCorrectionRecord): RegisterCorrection {
  const { changes } = record;
  if (!rowsOf<RegisterCorrectionChange>(changes, ['member', 'shares']))
    throw new Error(REGISTER_CORRECTION_COPY.CHANGES_UNREADABLE);
  return { ...record, changes };
}

export function isPreparedRegisterCorrection(proposal: RegisterCorrection, request: RegisterCorrectionPreparation) {
  return (
    proposal.uuid === request.operationId &&
    proposal.corrects === request.correctsId &&
    proposal.preparingAppointment === request.appointment &&
    proposal.authorityEvidence === request.authorityEvidence &&
    proposal.effectiveOn === request.effectiveOn &&
    proposal.authority === request.authority &&
    proposal.approvingDirector === (request.approvingDirector ?? '') &&
    proposal.authorityReference === request.authorityReference &&
    proposal.reason === request.reason &&
    proposal.providedBy === 'company'
  );
}

export function isRegisterCorrectionDecisionReceipt(
  proposal: RegisterCorrection,
  uuid: string,
  request: RegisterDecideRequest,
) {
  return isRegisterDecisionReceipt(proposal, uuid, request) && (request.kind !== 'apply' || !!proposal.appliedEntry);
}

export function formatRegisterChanges(changes: RegisterChange[], named: RegisterChange[] = []) {
  const names = new Map(named.map((change) => [change.member, change.name]));
  return changes.map(({ member, shares, name }) => {
    return `${name || names.get(member) || REGISTER_CORRECTION_COPY.UNNAMED_MEMBER(shortReference(member))}: ${shareChange(shares)}`;
  });
}
