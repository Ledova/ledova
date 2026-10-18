import type { CompanyEligibilityRequest } from '@ledova/shared';
import { PageAction } from '@components/Page';

export function RecordsList({
  records,
  select,
  selected,
}: {
  records: CompanyEligibilityRequest[];
  select: (uuid: string) => void;
  selected?: string;
}) {
  return records.length === 0 ? (
    <p>No requests recorded.</p>
  ) : (
    <ul className="divide-y divide-border-subtle">
      {records.map((record) => (
        <li key={record.uuid} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 text-sm">
            <p className="break-all">{record.uuid}</p>
            <p>
              {record.category} · {record.outcome}
            </p>
            <p className="break-all">Company {record.company}</p>
          </div>
          <PageAction
            label={`View request ${record.uuid}`}
            active={selected === record.uuid}
            onClick={() => select(record.uuid)}
          />
        </li>
      ))}
    </ul>
  );
}
