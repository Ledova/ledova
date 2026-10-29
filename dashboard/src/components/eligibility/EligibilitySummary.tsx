import {
  CERTIFIER_BODY_LABELS,
  INVESTOR_CATEGORY_LABELS,
  formatDate,
  formatDateTime,
  type CompanyEligibilitySharedSummary,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';

const summaryLabels = {
  participantName: 'Investor',
  category: 'Category',
  company: 'Company',
  submittedAt: 'Source submitted',
  requestedExpiresAt: 'Requested expiry',
  certificateIssuedAt: 'Certificate issued',
  certifierName: 'Certifier',
  certifierBody: 'Certifier body',
  certifierMembershipNumber: 'Certifier membership',
} satisfies Partial<Record<keyof CompanyEligibilitySharedSummary, string>>;

function shown(key: string, value: unknown, summary: CompanyEligibilitySharedSummary, companyName?: string) {
  const text = String(value);
  if (key === 'company') return companyName;
  if (key === 'submittedAt' || key === 'requestedExpiresAt') return formatDateTime(text);
  if (key === 'certificateIssuedAt') return formatDate(text);
  if (key === 'category') return INVESTOR_CATEGORY_LABELS[summary.category];
  if (key === 'certifierBody' && summary.certifierBody) return CERTIFIER_BODY_LABELS[summary.certifierBody];
  return text;
}

export function EligibilitySummary({
  summary,
  companyName,
}: {
  summary: CompanyEligibilitySharedSummary;
  companyName?: string;
}) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{summary.declarationText}</p>
      <Rows>
        {Object.entries(summaryLabels).map(([key, label]) => {
          const value = summary[key as keyof CompanyEligibilitySharedSummary];
          const text = value === undefined || value === null ? undefined : shown(key, value, summary, companyName);
          return text?.trim() ? (
            <Row key={key} label={label}>
              <span className="break-words">{text}</span>
            </Row>
          ) : null;
        })}
      </Rows>
    </>
  );
}
