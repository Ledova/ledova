import { useContext, type ReactNode } from 'react';
import { PageTitle } from './PageTitle';

interface PageProps {
  actions?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}

export function Page({ actions, loading = false, children }: PageProps) {
  const title = useContext(PageTitle);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-16 sm:gap-5 sm:px-6 md:gap-6 lg:px-8">
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
        <h1 className="font-display text-3xl tracking-[-0.01em] text-text-primary">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {loading ? (
        <div role="status" aria-label="Loading" className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-subtle border-t-brand" />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

interface PageActionProps {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  primary?: boolean;
  disabled?: boolean;
}

const ACTION_LOOKS = {
  primary: 'border-brand-mid bg-brand-mid text-white hover:bg-brand',
  active: 'border-brand-mid text-brand-light hover:bg-surface-tertiary',
  plain: 'border-border text-text-primary hover:bg-surface-tertiary',
};

export function PageAction({
  icon,
  label,
  onClick,
  active = false,
  primary = false,
  disabled = false,
}: PageActionProps) {
  const look = primary ? ACTION_LOOKS.primary : active ? ACTION_LOOKS.active : ACTION_LOOKS.plain;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${look}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
