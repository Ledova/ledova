import { AuthLayout } from '@components/auth';

export function LoadingState({ message }: { message: string }) {
  return (
    <AuthLayout>
      <div role="status" className="py-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-text-body mx-auto"></div>
        <p className="mt-4 text-text-muted">{message}</p>
      </div>
    </AuthLayout>
  );
}
