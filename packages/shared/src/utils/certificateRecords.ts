import type { MemberCertificateRequest } from '../types/domain/member-access';

export const CERTIFICATE_STATUSES = [
  ['all', 'All'],
  ['can_prepare', 'Can prepare'],
  ['reversed', 'Reversed'],
  ['not_requested', 'Not requested'],
  ['requested', 'Requested'],
  ['withdrawn', 'Withdrawn'],
  ['fulfilled', 'Fulfilled'],
  ['not_applicable', 'Not applicable'],
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number][0];

export function certificateStatus(
  row: {
    uuid: string;
    company?: { correctedBy?: unknown };
    own?: { kind: string; delta: string; correctedBy?: unknown };
  },
  requests: readonly MemberCertificateRequest[],
  token: string | undefined,
): CertificateStatus {
  const entry = row.company ?? row.own!;
  const latest = requests.find((request) => request.entry === row.uuid && request.token === token);
  if (latest) return latest.status;
  if (entry.correctedBy) return 'reversed';
  if (row.own && ['issue', 'transfer'].includes(row.own.kind.toLowerCase()) && BigInt(row.own.delta) > 0n)
    return 'not_requested';
  return row.company ? 'can_prepare' : 'not_applicable';
}
