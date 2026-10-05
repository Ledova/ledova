import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { CaretRightIcon } from '@phosphor-icons/react';
import { formatDate } from '@ledova/shared';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
      <h2 className="break-words font-display text-xl tracking-[-0.01em] text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function LinkRow({
  to,
  label,
  context,
  aside,
  children,
}: {
  to: string;
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
          className="break-words font-medium text-text-primary after:absolute after:inset-0 group-hover:text-brand-mid"
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
      <CaretRightIcon aria-hidden="true" className="shrink-0 text-text-muted group-hover:text-brand-mid" />
    </div>
  );
}

export function SwitchRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{label}</p>
        {description && (
          <p id={descriptionId} className="text-sm text-text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}

export function Disclosure({
  ref,
  summary,
  open,
  onToggle,
  region = false,
  children,
}: {
  ref?: Ref<HTMLButtonElement>;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  region?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <button
        ref={ref}
        type="button"
        id={`${id}summary`}
        aria-expanded={open}
        aria-controls={`${id}detail`}
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-start gap-3 py-4 text-left"
      >
        <CaretRightIcon
          aria-hidden="true"
          className={`mt-0.5 shrink-0 text-text-muted group-hover:text-brand-mid ${open ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 flex-1">{summary}</span>
      </button>
      <div
        id={`${id}detail`}
        role={region ? 'region' : undefined}
        aria-labelledby={region ? `${id}summary` : undefined}
        hidden={!open}
        className="pb-4 pl-7"
      >
        {open && children}
      </div>
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border-subtle">{children}</dl>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5">
      <dt className="flex-shrink-0 text-sm text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular-nums text-text-primary">{children}</dd>
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
