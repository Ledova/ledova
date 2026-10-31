import { useContext, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CaretRightIcon } from '@phosphor-icons/react';
import { formatDate } from '@ledova/shared';
import { InSignedInFrame } from './InSignedInFrame';
import { PageAction } from './Page';

export function Section({ title, header, children }: { title: string; header?: ReactNode; children: ReactNode }) {
  const inFrame = useContext(InSignedInFrame);
  return (
    <section
      className={`flex flex-col border border-border bg-surface-raised p-4 [&_p:not(.flex,.text-right,.truncate)]:max-w-prose ${inFrame ? 'min-w-0 gap-4 rounded-2xl sm:p-6' : 'gap-2 rounded-xl sm:p-5'}`}
    >
      {header ?? <h2 className="break-words font-display text-xl tracking-[-0.01em] text-text-primary">{title}</h2>}
      {children}
    </section>
  );
}

export function LinkRow({
  to,
  state,
  label,
  context,
  aside,
  children,
}: {
  to: string;
  state?: Record<string, string>;
  label: string;
  context?: string;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="group relative flex items-center justify-between gap-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <Link
          to={to}
          state={state}
          className="break-words font-medium text-text-primary after:absolute after:inset-0 group-hover:text-brand-light"
        >
          {label}
          {context && (
            <>
              {' '}
              <span className="sr-only">({context})</span>
            </>
          )}
        </Link>
        {children}
      </div>
      {aside}
      <CaretRightIcon aria-hidden="true" className="shrink-0 text-text-muted group-hover:text-brand-light" />
    </div>
  );
}

export function MoreToggle({
  open,
  controls,
  disabled = false,
  onToggle,
  children,
}: {
  open: boolean;
  controls: string;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      disabled={disabled}
      onClick={onToggle}
      className="relative w-fit text-left text-sm text-brand-light after:absolute after:inset-x-0 after:-inset-y-3 hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
    >
      {children}
    </button>
  );
}

export function ShowMore({
  show,
  hide,
  defaultOpen = false,
  children,
}: {
  show: string;
  hide: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <>
      <MoreToggle open={open} controls={id} onToggle={() => setOpen((shown) => !shown)}>
        {open ? hide : show}
      </MoreToggle>
      <div id={id} hidden={!open} className="flex flex-col gap-3">
        {children}
      </div>
    </>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border-subtle">{children}</dl>;
}

export function Fact({
  label,
  numeric = false,
  children,
}: {
  label: ReactNode;
  numeric?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className={`break-words text-sm font-medium${numeric ? ' tabular-nums' : ''}`}>{children}</dd>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-6">
      <dt className="min-w-0 break-words text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm tabular-nums text-text-primary">{children}</dd>
    </div>
  );
}

export type Tone = 'waiting' | 'moving' | 'done' | 'closed';

const MARKS: Record<Tone, string> = {
  waiting: 'border border-text-muted',
  moving: 'bg-brand-mid/50',
  done: 'bg-brand-mid',
  closed: 'bg-text-muted',
};

export function Status({ tone, mark, children }: { tone: Tone; mark?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full ${MARKS[tone]}`} />
      <span>
        {mark && <span aria-hidden="true">{`${mark} `}</span>}
        {children}
      </span>
    </span>
  );
}

export function Outcome({ children }: { children?: ReactNode }) {
  return (
    <p role="status" className="flex items-baseline gap-2 text-sm text-text-primary empty:sr-only">
      {children ? (
        <>
          <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 translate-y-[-1px] rounded-full ${MARKS.done}`} />
          <span>{children}</span>
        </>
      ) : null}
    </p>
  );
}

export function Failure({ id, children }: { id?: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-sm text-error-light">
      {children}
    </p>
  );
}

export function Loading({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="py-3 text-sm text-text-muted">
      {children}
    </p>
  );
}

export function LoadError({
  retry,
  busy = false,
  children,
}: {
  retry: () => unknown;
  busy?: boolean;
  children: ReactNode;
}) {
  const sentence = useId();
  return (
    <div role="alert" className="flex flex-col gap-3 py-3">
      <p id={sentence} className="text-sm text-text-primary">
        {children}
      </p>
      <div className="flex justify-end">
        <PageAction label="Try again" describedBy={sentence} onClick={() => void retry()} disabled={busy} />
      </div>
    </div>
  );
}

export interface TimelineEvent {
  label: string;
  at: string;
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="flex flex-col">
      {events.map((event) => (
        <li key={`${event.label}-${event.at}`} className="flex items-baseline gap-3 py-2">
          <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 translate-y-[-1px] rounded-full bg-brand-mid" />
          <span className="flex-1 text-sm text-text-primary">{event.label}</span>
          <time dateTime={event.at} className="text-sm tabular-nums text-text-muted">
            {formatDate(event.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
