import { useContext, useEffect, useId, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Link, type To } from 'react-router-dom';
import { PageActionsTarget, PageBack, PageTitle, type PageBackLink } from './PageTitle';
import { InSignedInFrame } from './InSignedInFrame';

interface PageProps {
  actions?: ReactNode;
  back?: Partial<PageBackLink>;
  documentTitle?: string;
  lede?: string;
  loading?: boolean;
  narrow?: boolean;
  children?: ReactNode;
}

export function Page({ actions, back, documentTitle, lede, loading = false, narrow = false, children }: PageProps) {
  const title = useContext(PageTitle);
  const parent = useContext(PageBack);
  const link = { ...parent, ...back };
  const inFrame = useContext(InSignedInFrame);
  const ledeId = useId();
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const tabTitle = documentTitle ?? title;
  useEffect(() => {
    if (!tabTitle) return;
    document.title = `${tabTitle} · Ledova`;
    return () => {
      document.title = 'Ledova';
    };
  }, [tabTitle]);

  return (
    <PageActionsTarget.Provider value={actionsTarget}>
      <div
        className={`${inFrame ? 'ml-0' : 'mx-auto'} ${narrow ? 'max-w-4xl' : inFrame ? 'max-w-7xl' : 'max-w-6xl'} flex w-full min-w-0 flex-col gap-4 px-4 pb-16 sm:gap-5 sm:px-6 md:gap-6 lg:px-8`}
      >
        <header>
          <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
            <h1
              tabIndex={-1}
              aria-describedby={lede ? ledeId : undefined}
              className="font-display text-3xl tracking-[-0.01em] text-text-primary focus:outline-none"
            >
              {title}
            </h1>
            <div ref={setActionsTarget} className="flex flex-wrap items-center gap-2 empty:hidden">
              {link.to && link.label && <PageLink to={link.to} state={link.state} label={link.label} />}
              {actions}
            </div>
          </div>
          {lede && (
            <p id={ledeId} className="break-words text-sm text-text-muted">
              {lede}
            </p>
          )}
        </header>
        {loading ? (
          <div role="status" aria-label="Loading" className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-subtle border-t-brand" />
          </div>
        ) : (
          children
        )}
      </div>
    </PageActionsTarget.Provider>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  const target = useContext(PageActionsTarget);
  return target ? createPortal(children, target) : null;
}

interface ActionContent {
  icon?: ReactNode;
  label: string;
  context?: string;
  primary?: boolean;
}

type PageActionProps = ActionContent & {
  ref?: Ref<HTMLButtonElement>;
  describedBy?: string;
  destructive?: boolean;
  pressed?: boolean;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
} & ({ type: 'submit'; form?: string; onClick?: never } | { type?: 'button'; form?: never; onClick: () => void });

const ACTION_LOOKS = {
  primary: 'border-brand-mid bg-brand-mid text-white hover:bg-brand',
  destructive: 'border-error bg-error text-white hover:bg-error-dark',
  pressed: 'border-brand-mid text-brand-light hover:bg-surface-tertiary',
  plain: 'border-border text-text-primary hover:bg-surface-tertiary',
};

const actionClass = (look: string) =>
  `relative inline-flex w-fit items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${look}`;

function ActionText({ icon, label, context }: Omit<ActionContent, 'primary'>) {
  return (
    <>
      {icon}
      <span>{label}</span>
      {context && (
        <>
          {' '}
          <span className="sr-only">({context})</span>
        </>
      )}
    </>
  );
}

export function PageAction({
  ref,
  icon,
  label,
  context,
  describedBy,
  primary = false,
  destructive = false,
  pressed,
  busy = false,
  busyLabel,
  disabled = false,
  type = 'button',
  form,
  onClick,
}: PageActionProps) {
  const look = destructive
    ? ACTION_LOOKS.destructive
    : primary
      ? ACTION_LOOKS.primary
      : pressed
        ? ACTION_LOOKS.pressed
        : ACTION_LOOKS.plain;
  return (
    <button
      ref={ref}
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled || busy}
      aria-pressed={pressed}
      aria-describedby={describedBy}
      className={actionClass(look)}
    >
      <ActionText icon={icon} label={busy && busyLabel ? busyLabel : label} context={context} />
    </button>
  );
}

interface PageLinkProps extends ActionContent {
  to: To;
  state?: unknown;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export function PageLink({ icon, label, context, primary = false, to, state, onClick }: PageLinkProps) {
  return (
    <Link
      to={to}
      state={state}
      onClick={onClick}
      className={actionClass(primary ? ACTION_LOOKS.primary : ACTION_LOOKS.plain)}
    >
      <ActionText icon={icon} label={label} context={context} />
    </Link>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">{children}</div>
  );
}
