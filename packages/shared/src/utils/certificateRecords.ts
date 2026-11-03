export const CERTIFICATE_STATUSES = [
  ['all', 'All'],
  ['can_prepare', 'Can prepare'],
  ['reversed', 'Reversed'],
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number][0];

export function certificateStatus(entry: { correctedBy?: unknown }): Exclude<CertificateStatus, 'all'> {
  return entry.correctedBy ? 'reversed' : 'can_prepare';
}
