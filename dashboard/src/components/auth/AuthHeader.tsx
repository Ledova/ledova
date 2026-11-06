import type { ReactNode } from 'react';
import { useTabTitle } from '@hooks/useTabTitle';

interface AuthHeaderProps {
  title: ReactNode;
  documentTitle?: string;
  icon?: ReactNode;
  children?: ReactNode;
  review?: boolean;
}

export function AuthHeader({ title, documentTitle, icon, children, review = false }: AuthHeaderProps) {
  useTabTitle(documentTitle ?? (typeof title === 'string' ? title : undefined));
  return (
    <div className={review ? 'text-center mb-8' : 'text-center mb-6'}>
      {icon && (
        <div className={review ? 'flex justify-center mb-4' : 'flex justify-center mb-3'}>
          <div
            className={
              review
                ? 'p-3 rounded-full bg-surface-raised border border-border'
                : 'p-2 rounded-full bg-surface-raised border border-border'
            }
          >
            {icon}
          </div>
        </div>
      )}
      <h1
        className={
          review
            ? 'mb-2 font-display text-3xl tracking-[-0.01em] text-text-primary'
            : 'font-display text-3xl tracking-[-0.01em] text-text-primary'
        }
      >
        {title}
      </h1>
      {children}
    </div>
  );
}
