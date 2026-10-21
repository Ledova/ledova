import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatShareCount,
  type CompanyEligibilitySharedSummary,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';

const summaryLabels = {
  category: 'Category',
  source: 'Evidence source',
  userAccount: 'Participant account',
  company: 'Exact company',
  submittedAt: 'Source submitted',
  requestedExpiresAt: 'Requested expiry',
  certificateIssuedAt: 'Certificate issued',
  certifierName: 'Certifier',
  certifierBody: 'Certifier body',
  certifierMembershipNumber: 'Certifier membership',
  associatedCompany: 'Associated company',
  offering: 'Approved offering',
  token: 'Share class',
  quantity: 'Whole-share quantity',
  pricePerShare: 'Price per share',
  priceCurrency: 'Currency',
  amountAud: 'Amount (AUD)',
  offeringTermsDigest: 'Offering terms digest',
} satisfies Partial<Record<keyof CompanyEligibilitySharedSummary, string>>;

function shown(key: string, value: unknown, summary: CompanyEligibilitySharedSummary) {
  const text = String(value);
  if (key === 'submittedAt' || key === 'requestedExpiresAt') return formatDateTime(text);
  if (key === 'certificateIssuedAt') return formatDate(text);
  if (key === 'quantity') return formatShareCount(text);
  if (key === 'pricePerShare' && summary.priceCurrency) return formatMoney(text, summary.priceCurrency);
  if (key === 'amountAud') return formatMoney(text, 'AUD');
  return text;
}

export function EligibilitySummary({ summary }: { summary: CompanyEligibilitySharedSummary }) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{summary.declarationText}</p>
      <Rows>
        {Object.entries(summaryLabels).map(([key, label]) => {
          const value = summary[key as keyof CompanyEligibilitySharedSummary];
          return value === undefined || value === null ? null : (
            <Row key={key} label={label}>
              <span className="break-all">{shown(key, value, summary)}</span>
            </Row>
          );
        })}
      </Rows>
      {summary.offeringTerms !== undefined && (
        <div>
          <p className="text-sm text-text-muted">Exact offering terms</p>
          <pre className="whitespace-pre-wrap break-all text-sm text-text-primary">
            {JSON.stringify(summary.offeringTerms, null, 2)}
          </pre>
        </div>
      )}
    </>
  );
}
