import type { ReactNode } from 'react';
import { formatDate } from '@ledova/shared';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="border-b border-border pb-2 font-display text-xl tracking-[-0.01em] text-text-primary">{title}</h2>
      {children}
    </section>
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

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={`h-2 w-2 flex-shrink-0 rounded-full ${MARKS[tone]}`} />
      <span>{children}</span>
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
