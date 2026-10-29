import { ELIGIBILITY_OUTCOME_LABELS, INVESTOR_CATEGORY_LABELS, formatDateTime, shortReference } from '@ledova/shared';
import type { CompanyEligibilityRequest } from '@ledova/shared';
import { PageAction } from '@components/Page';

export function RecordsList({
  records,
  select,
  selected,
  disabled = false,
  companyName,
  investor = false,
}: {
  records: CompanyEligibilityRequest[];
  select: (uuid: string) => void;
  selected?: string;
  disabled?: boolean;
  companyName?: (uuid: string) => string | undefined;
  investor?: boolean;
}) {
  const sameAs = (record: CompanyEligibilityRequest) =>
    `${record.company}|${record.category}|${record.outcome}|${formatDateTime(record.submittedAt)}`;
  const counts = new Map<string, number>();
  for (const record of records) counts.set(sameAs(record), (counts.get(sameAs(record)) ?? 0) + 1);
  const submitted = (record: CompanyEligibilityRequest) =>
    `${formatDateTime(record.submittedAt)}${(counts.get(sameAs(record)) ?? 0) > 1 ? ` · ${shortReference(record.uuid)}` : ''}`;
  return records.length === 0 ? (
    <p className="text-sm text-text-muted">No requests yet.</p>
  ) : (
    <ul className="divide-y divide-border-subtle">
      {records.map((record) => (
        <li key={record.uuid} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 text-sm">
            {investor && record.sharedSummary.participantName && (
              <p className="font-medium text-text-primary">{record.sharedSummary.participantName}</p>
            )}
            <p>
              {INVESTOR_CATEGORY_LABELS[record.category]} · {ELIGIBILITY_OUTCOME_LABELS[record.outcome]}
            </p>
            <p className="text-text-muted">Submitted {submitted(record)}</p>
            {companyName && <p>{companyName(record.company) ?? `Company ${shortReference(record.company)}`}</p>}
          </div>
          <PageAction
            label="View request"
            context={`submitted ${submitted(record)}`}
            pressed={selected === record.uuid}
            disabled={disabled}
            onClick={() => select(record.uuid)}
          />
        </li>
      ))}
    </ul>
  );
}
