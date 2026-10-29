import {
  REGISTER_CORRECTION_COPY,
  appointmentForRegisterStep,
  type OwnCompanyAppointment,
  type RegisterEntry,
  type RegisterStep,
  type TokenHoldersResponse,
  formatDate,
} from '@ledova/shared';
import type { Tone } from '@components/Ledger';

export type RegisterSteps = Partial<Record<RegisterStep, OwnCompanyAppointment>>;

export const STAGE_TONES: Record<string, Tone> = {
  submitted: 'waiting',
  approved: 'moving',
  applied: 'done',
  rejected: 'closed',
};

export const DOWNLOAD_FAILED = 'The file could not be downloaded. Try again.';

export const STEP_CHANGED =
  'Your appointment for this step changed or could not be checked. Cancel and start this decision again.';

export function registerSteps(appointments: OwnCompanyAppointment[], company: string): RegisterSteps {
  return {
    prepare: appointmentForRegisterStep(appointments, company, 'prepare'),
    approve: appointmentForRegisterStep(appointments, company, 'approve'),
    apply: appointmentForRegisterStep(appointments, company, 'apply'),
    reject: appointmentForRegisterStep(appointments, company, 'reject'),
  };
}

export function registerMembers(registers: TokenHoldersResponse[]) {
  const members = new Map<string, string | null>();
  for (const { member, name } of registers.flatMap((register) => register.holders))
    if (!members.get(member)) members.set(member, name);
  return members;
}

export function retainedName(snapshot: unknown, fallback: string) {
  const name = (snapshot as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : fallback;
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
