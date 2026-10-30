import { AuthLayout } from '@components/auth';

export function AccountUnavailable({
  title = 'We could not load your account',
  onRetry,
}: {
  title?: string;
  onRetry: () => void;
}) {
  return (
    <AuthLayout>
      <div role="alert" className="text-center">
        <h1 className="font-display text-3xl tracking-[-0.01em] text-text-primary">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">Check your connection and try again.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 font-semibold text-brand-light transition-colors hover:text-brand-subtle"
        >
          Try again
        </button>
      </div>
    </AuthLayout>
  );
}

export function SessionUnavailable({ onRetry }: { onRetry: () => void }) {
  return <AccountUnavailable title="We could not check your session" onRetry={onRetry} />;
}
