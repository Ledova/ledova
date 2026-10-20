import { AuthLayout } from '@components/auth';

interface ErrorStateProps {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Error loading data',
  message = 'We encountered an issue while loading required data.',
  retryLabel = 'Retry',
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <AuthLayout>
      <div className={`mx-auto w-full max-w-md py-8 text-center ${className}`}>
        <h2 className="text-lg font-light mb-4 text-error-light">{title}</h2>
        <p className="text-text-muted mb-4">{message}</p>
        <button
          onClick={onRetry}
          className="bg-surface-tertiary hover:bg-surface-disabled text-text-primary font-light py-2 px-4 rounded-md transition-colors"
        >
          {retryLabel}
        </button>
      </div>
    </AuthLayout>
  );
}
