import type { ReactNode } from 'react';
import { formatDate, shareCount } from '@ledova/shared';

export function IssueSummary({
  name,
  kind,
  shares,
  amount,
  companyEventOn,
  status,
}: {
  name: string;
  kind: string;
  shares: string;
  amount?: string;
  companyEventOn?: string | null;
  status: ReactNode;
}) {
  return (
    <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
      <div className="min-w-0 space-y-1">
        <dt className="text-text-muted">Recipient</dt>
        <dd className="space-y-1 break-words">
          <h3 className="text-base font-medium">{name}</h3>
          <p className="text-text-muted">{kind}</p>
        </dd>
      </div>
      <div className="min-w-0 space-y-1">
        <dt className="text-text-muted">Shares</dt>
        <dd className="space-y-1 break-words tabular-nums">
          <p className="font-medium">{shareCount(shares)}</p>
          {amount && <p className="text-text-muted">{amount}</p>}
        </dd>
      </div>
      <div className="min-w-0 space-y-1">
        <dt className="text-text-muted">Company issue date</dt>
        <dd className="break-words font-medium tabular-nums">{formatDate(companyEventOn, 'Not recorded')}</dd>
      </div>
      <div className="min-w-0 space-y-1">
        <dt className="text-text-muted">Status</dt>
        <dd className="space-y-1">{status}</dd>
      </div>
    </dl>
  );
}
