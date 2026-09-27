import type { CompanyStatus } from '@ledova/shared';
import { Status, type Tone } from '@components/Ledger';
import { PageAction } from '@components/Page';
import type { useCompany } from './hooks/useCompany';

export type CompanyRead = Pick<ReturnType<typeof useCompany>, 'error' | 'isRefreshing' | 'refetch'>;

export function CompanyStatusMark({ status, label }: { status: CompanyStatus; label: string }) {
  const tone: Tone =
    status === 'active' || status === 'approved'
      ? 'done'
      : status === 'submitted' || status === 'review'
        ? 'moving'
        : status === 'draft' || status === 'info_required' || status === 'warning'
          ? 'waiting'
          : 'closed';
  return <Status tone={tone}>{label}</Status>;
}

export function CompanyReadNotice({ read }: { read: CompanyRead }) {
  if (read.error)
    return (
      <div role="alert" className="space-y-2 text-sm text-text-muted">
        <p>Company information could not be loaded. Try again before continuing.</p>
        <PageAction
          label="Retry company information"
          onClick={() => void read.refetch()}
          disabled={read.isRefreshing}
        />
      </div>
    );
  return read.isRefreshing ? (
    <p role="status" className="text-sm text-text-muted">
      Refreshing company information…
    </p>
  ) : null;
}
