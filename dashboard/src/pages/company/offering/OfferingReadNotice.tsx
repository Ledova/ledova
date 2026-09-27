import { PageAction } from '@components/Page';

export interface OfferingRead {
  error: unknown;
  isRefreshing: boolean;
  refetch: () => unknown;
}

export function OfferingReadNotice({ read, label = 'Offering information' }: { read: OfferingRead; label?: string }) {
  if (read.error)
    return (
      <div role="alert" className="space-y-2 text-sm text-text-muted">
        <p>{label} could not be loaded. Try again before continuing.</p>
        <PageAction
          label={`Retry ${label.toLowerCase()}`}
          onClick={() => void read.refetch()}
          disabled={read.isRefreshing}
        />
      </div>
    );
  return read.isRefreshing ? (
    <p role="status" className="text-sm text-text-muted">
      Refreshing {label.toLowerCase()}…
    </p>
  ) : null;
}
