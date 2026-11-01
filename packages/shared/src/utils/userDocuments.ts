import type { Document, ExtractionStatus, InvestorClassification, UserDocumentType } from '../types';
import { formatDate } from './date';
import { formatMoney } from './distributions';
import { formatCryptoBalance, shortReference } from './formatting';

export const DOCUMENT_TYPE_LABELS: Record<UserDocumentType, string> = {
  payslip: 'Payslip',
  bank_statement: 'Bank statement',
  tax_return: 'Tax return',
  other: 'Other',
};

export function extractionState(status: ExtractionStatus | undefined): {
  label: string;
  tone: 'waiting' | 'moving' | 'done' | 'closed';
} {
  if (!status || status === 'pending') return { label: 'Queued', tone: 'waiting' };
  if (status === 'running') return { label: 'Extracting…', tone: 'moving' };
  if (status === 'succeeded') return { label: 'Extracted', tone: 'done' };
  return { label: 'Failed', tone: 'closed' };
}

const claimLabel = (claim: InvestorClassification) => `${claim.categoryDisplay} · ${formatDate(claim.createdAt)}`;

export function attachedClaimLabel(classification: string, claims: InvestorClassification[]): string {
  const attached = claims.find((claim) => claim.uuid === classification);
  if (!attached) return shortReference(classification);
  const label = claimLabel(attached);
  return claims.some((claim) => claim.uuid !== attached.uuid && claimLabel(claim) === label)
    ? `${label} · ${shortReference(attached.uuid)}`
    : label;
}

export function documentClaimOptions(claims: InvestorClassification[]): { value: string; label: string }[] {
  const submitted = claims.filter((claim) => claim.status === 'submitted');
  return [
    { value: '', label: 'Keep unattached' },
    ...submitted.map((claim) => {
      const label = claimLabel(claim);
      const shared = submitted.filter((other) => claimLabel(other) === label).length > 1;
      return { value: claim.uuid, label: shared ? `${label} · ${shortReference(claim.uuid)}` : label };
    }),
  ];
}

const documentMoney = (raw: string | null) =>
  raw && /^-?\d+(\.\d+)?$/.test(raw) ? formatMoney(formatCryptoBalance(raw, '', 2).trimEnd(), 'AUD') : raw || '—';

export function payslipDetails(
  extraction: Document['latestExtraction'],
): { fields: { label: string; value: string }[]; warnings: string[] } | null {
  if (extraction?.status !== 'succeeded') return null;
  const data = extraction.parsedJson;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const text = (name: string): string | null => {
    const value: unknown = Reflect.get(data, name);
    return typeof value === 'string' ? value : null;
  };
  const warnings: unknown = Reflect.get(data, 'extractionWarnings');
  const confidence: unknown = Reflect.get(data, 'confidence');
  const durationMs = extraction.durationMs;
  return {
    fields: [
      { label: 'Employee', value: text('employeeName') ?? '—' },
      { label: 'Employer', value: text('employerName') ?? '—' },
      { label: 'ABN', value: text('abn') ?? '—' },
      {
        label: 'Pay period',
        value: `${formatDate(text('periodStart'), '—')} → ${formatDate(text('periodEnd'), '—')}`,
      },
      { label: 'Gross pay', value: documentMoney(text('grossPay')) },
      { label: 'Net pay', value: documentMoney(text('netPay')) },
      { label: 'Tax withheld', value: documentMoney(text('taxWithheld')) },
      { label: 'Superannuation', value: documentMoney(text('superannuation')) },
      { label: 'YTD gross', value: documentMoney(text('ytdGross')) },
      { label: 'YTD tax', value: documentMoney(text('ytdTax')) },
      { label: 'Confidence', value: typeof confidence === 'number' ? `${(confidence * 100).toFixed(0)}%` : 'Unknown' },
      ...(durationMs != null ? [{ label: 'Extraction time', value: `${(durationMs / 1000).toFixed(1)}s` }] : []),
    ],
    warnings: Array.isArray(warnings) ? warnings.filter((value): value is string => typeof value === 'string') : [],
  };
}
