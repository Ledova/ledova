import type { ReactNode } from 'react';

export function QRCodeFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center py-2">
      <div className="flex dark:rounded-lg dark:bg-white dark:p-3">{children}</div>
    </div>
  );
}
