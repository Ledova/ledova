import { REGISTER_CORRECTION_COPY } from '../constants';
import type { RegisterEntry, RegisterEntryKind } from '../types';
import { formatShortDate } from './date';

export const CERTIFICATE_STATUSES = [
  ['all', 'All'],
  ['can_prepare', 'Can prepare'],
  ['reversed', 'Reversed'],
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number][0];

export const CERTIFICATE_NONE_DUE = 'None due, the entry was reversed';

export function certificateStatus(entry: { correctedBy?: unknown }): Exclude<CertificateStatus, 'all'> {
  return entry.correctedBy ? 'reversed' : 'can_prepare';
}

export function isCertificateEntry(entry: Pick<RegisterEntry, 'kind' | 'sequence'>) {
  return ['issue', 'transfer'].includes(entry.kind) && Number.isSafeInteger(entry.sequence) && entry.sequence > 0;
}

export function canPrepareCertificate(entry: Pick<RegisterEntry, 'kind' | 'sequence' | 'correctedBy'>) {
  return isCertificateEntry(entry) && !entry.correctedBy;
}

export function certificateFacts(
  entry: { kind: string; companyEventOn?: string | null; effectiveOn: string },
  symbol: string | undefined,
) {
  const kind = entry.kind.toLowerCase();
  const companyDated = ['issue', 'transfer'].includes(kind);
  const date = companyDated
    ? formatShortDate(entry.companyEventOn, 'Date not recorded')
    : formatShortDate(entry.effectiveOn);
  const ledgerDate =
    companyDated && entry.effectiveOn !== entry.companyEventOn ? formatShortDate(entry.effectiveOn) : null;
  return {
    entry: `${REGISTER_CORRECTION_COPY.ENTRY_KINDS[kind as RegisterEntryKind] ?? 'Register change'} · ${symbol ?? ''}`,
    date,
    ledgerDate,
    dates: ledgerDate ? `${date} · ledger date ${ledgerDate}` : date,
  };
}

export function certificateContext(entry: Pick<RegisterEntry, 'kind' | 'changes' | 'companyEventOn' | 'effectiveOn'>) {
  const names = entry.changes.map((change) => change.name ?? 'Shareholder').join(' and ');
  return `${names}, ${certificateFacts(entry, undefined).date}`;
}
