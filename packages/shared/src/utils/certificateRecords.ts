import type { RegisterEntry } from '../types';

export const CERTIFICATE_STATUSES = [
  ['all', 'All'],
  ['can_prepare', 'Can prepare'],
  ['reversed', 'Reversed'],
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number][0];

export const CERTIFICATE_STATES: Record<Exclude<CertificateStatus, 'all'>, string> = {
  can_prepare: 'Can prepare',
  reversed: 'None due, the entry was reversed',
};

export function certificateStatus(entry: { correctedBy?: unknown }): Exclude<CertificateStatus, 'all'> {
  return entry.correctedBy ? 'reversed' : 'can_prepare';
}

export function isCertificateEntry(entry: Pick<RegisterEntry, 'kind' | 'sequence'>) {
  return ['issue', 'transfer'].includes(entry.kind) && Number.isSafeInteger(entry.sequence) && entry.sequence > 0;
}

export function canPrepareCertificate(entry: Pick<RegisterEntry, 'kind' | 'sequence' | 'correctedBy'>) {
  return isCertificateEntry(entry) && !entry.correctedBy;
}
