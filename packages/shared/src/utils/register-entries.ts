import { REGISTER_ENTRY_COPY } from '../constants';
import { formatDate } from './date';
import { shareChange, shortReference } from './formatting';
import type { RegisterEntry, RegisterEntryChange } from '../types';

type RegisterChange = Pick<RegisterEntryChange, 'member' | 'shares'> & { name?: string | null };

type EntryDates = Pick<RegisterEntry, 'kind' | 'effectiveOn' | 'companyEventOn'>;

export function entryDate(entry: EntryDates) {
  return (['issue', 'transfer'].includes(entry.kind) && entry.companyEventOn) || entry.effectiveOn;
}

export function entryName(entry: EntryDates, format: (date: string) => string = formatDate) {
  const kind = REGISTER_ENTRY_COPY.ENTRY_KINDS[entry.kind] ?? 'Register change';
  return `${kind.toLowerCase()} of ${format(entryDate(entry))}`;
}

export function entryLabel(entry: EntryDates & Pick<RegisterEntry, 'changes'>) {
  const names = entry.changes.flatMap((change) => (change.name ? [change.name] : []));
  const who = names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0];
  return who ? `${entryName(entry)}, ${who}` : entryName(entry);
}

export function entryWithPeople(entry: EntryDates & Pick<RegisterEntry, 'changes'>) {
  const names = [...new Set(entry.changes.flatMap((change) => (change.name ? [change.name] : [])))];
  const who = names.length > 2 ? `${names[0]} and ${names.length - 1} others` : names.join(' and ');
  return who ? `${entryName(entry)} for ${who}` : entryName(entry);
}

export function describeEntry(entry: EntryDates) {
  const kind = REGISTER_ENTRY_COPY.ENTRY_KINDS[entry.kind] ?? 'Register change';
  const date = entryDate(entry);
  return date === entry.effectiveOn
    ? `${kind} · ${formatDate(date)}`
    : `${kind} · ${formatDate(date)} · Ledger date ${formatDate(entry.effectiveOn)}`;
}

export function formatRegisterChanges(changes: RegisterChange[], named: RegisterChange[] = []) {
  const names = new Map(named.map((change) => [change.member, change.name]));
  return changes.map(({ member, shares, name }) => {
    return `${name || names.get(member) || REGISTER_ENTRY_COPY.UNNAMED_MEMBER(shortReference(member))}: ${shareChange(shares)}`;
  });
}
