import { ELIGIBILITY_OUTCOME_LABELS, INVESTOR_CATEGORY_LABELS, formatDateTime, shortReference } from '@ledova/shared';
import type { CompanyEligibilityRequest } from '@ledova/shared';
import { PageAction } from '@components/Page';

export function RecordsList({
  records,
  select,
  selected,
  disabled = false,
  companyName,
}: {
  records: CompanyEligibilityRequest[];
  select: (uuid: string) => void;
  selected?: string;
  disabled?: boolean;
  companyName?: (uuid: string) => string | undefined;
}) {
  return records.length === 0 ? (
    <p className="text-sm text-text-muted">No requests yet.</p>
  ) : (
    <ul className="divide-y divide-border-subtle">
      {records.map((record) => (
        <li key={record.uuid} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 text-sm">
            <p>
              {INVESTOR_CATEGORY_LABELS[record.category]} · {ELIGIBILITY_OUTCOME_LABELS[record.outcome]}
            </p>
            <p className="text-text-muted">Submitted {formatDateTime(record.submittedAt)}</p>
            {companyName && <p>{companyName(record.company) ?? `Company ${shortReference(record.company)}`}</p>}
          </div>
          <PageAction
            label="View request"
            context={`submitted ${formatDateTime(record.submittedAt)}`}
            pressed={selected === record.uuid}
            disabled={disabled}
            onClick={() => select(record.uuid)}
          />
        </li>
      ))}
    </ul>
  );
}
