import { REGISTER_CORRECTION_COPY, type RegisterEntry, type TokenHoldersResponse, formatDate } from '@ledova/shared';

export function registerMembers(registers: TokenHoldersResponse[]) {
  const members = new Map<string, string | null>();
  for (const { member, name } of registers.flatMap((register) => register.holders))
    if (!members.get(member)) members.set(member, name);
  return members;
}

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
