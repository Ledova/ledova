import { PageAction } from '@components/Page';

export function Loading() {
  return (
    <p role="status" className="py-3 text-sm text-text-muted">
      Loading your register…
    </p>
  );
}

export function Unavailable({ retry, busy }: { retry: () => void; busy: boolean }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-3">
      <p className="text-sm text-text-muted">We couldn&apos;t load the complete register.</p>
      <PageAction label="Try again" onClick={retry} disabled={busy} />
    </div>
  );
}
