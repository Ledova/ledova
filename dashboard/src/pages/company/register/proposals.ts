import {
  REGISTER_CORRECTION_COPY,
  appointmentForRegisterStep,
  formatShareCount,
  type OwnCompanyAppointment,
  type RegisterEntry,
  type RegisterStep,
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

export function retainedName(snapshot: unknown, fallback: string) {
  const name = (snapshot as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : fallback;
}

export function describeEntry(entry: Pick<RegisterEntry, 'kind' | 'sequence' | 'effectiveOn'>) {
  const kind = REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind] ?? entry.kind;
  return `${kind} · Entry ${entry.sequence} · Effective ${entry.effectiveOn}`;
}

export function shareCount(shares: string) {
  return `${formatShareCount(shares)} ${shares === '1' ? 'share' : 'shares'}`;
}
