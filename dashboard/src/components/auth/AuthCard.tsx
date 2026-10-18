import type { ReactNode } from 'react';

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}
