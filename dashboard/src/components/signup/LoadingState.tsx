import type { LoadingStateProps } from '@ledova/shared';
import { AuthLayout } from '@components/AuthLayout';

export default function LoadingState({ message = 'Loading data...', className = '' }: LoadingStateProps) {
  return (
    <AuthLayout>
      <div className={`py-8 text-center ${className}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-text-body mx-auto"></div>
        <p className="mt-4 text-text-muted">{message}</p>
      </div>
    </AuthLayout>
  );
}
