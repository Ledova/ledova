import { useId, useRef, type ReactNode } from 'react';
import { formatShareCount } from '@ledova/shared';
import { FIELD_BASE, LABEL } from '@components/fieldClass';
import { PageAction } from '@components/Page';
import { PAGE_SIZE, type ListParams } from '@hooks/useListParams';

export type Noun = readonly [string, string];

const counted = (count: number, [one, many]: Noun) => `${formatShareCount(String(count))} ${count === 1 ? one : many}`;

export interface Column {
  label: string;
  detail?: string;
  align?: 'right';
}

export function Table({ caption, columns, children }: { caption: string; columns: Column[]; children: ReactNode }) {
  return (
    <div className="relative max-w-full overflow-x-auto rounded-xl border border-border-subtle">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-tertiary text-xs text-text-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`px-4 py-3 font-medium ${column.align === 'right' ? 'text-right' : ''}`}
              >
                {column.hidden ? <span className="sr-only">{column.label}</span> : column.label}
                {column.detail && <span className="sr-only"> {column.detail}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">{children}</tbody>
      </table>
    </div>
  );
}

export function ListSearch({
  label,
  hint,
  list,
  noun,
  count,
  filtered = false,
  children,
}: {
  label: string;
  hint?: string;
  list: ListParams<string>;
  noun: Noun;
  count: number | undefined;
  filtered?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor={`${id}search`} className={LABEL}>
            {label}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              ref={field}
              id={`${id}search`}
              type="search"
              value={list.typed}
              maxLength={100}
              autoComplete="off"
              data-1p-ignore
              aria-describedby={hint ? `${id}hint` : undefined}
              className={`${FIELD_BASE} [&::-webkit-search-cancel-button]:hidden`}
              onChange={(event) => list.type(event.target.value)}
            />
            {(list.typed || list.search) && (
              <PageAction
                label="Clear"
                context={label}
                onClick={() => {
                  list.clear();
                  field.current?.focus();
                }}
              />
            )}
          </div>
          {hint && (
            <p id={`${id}hint`} className="mt-1 text-xs text-text-muted">
              {hint}
            </p>
          )}
        </div>
        {children}
      </div>
      <p role="status" className="text-sm text-text-muted">
        {count === undefined || !(list.search || filtered)
          ? ''
          : `${count === 0 ? `No ${noun[1]}` : counted(count, noun)} ${count === 1 ? 'matches' : 'match'}${list.search ? ' your search' : ''}.`}
      </p>
    </div>
  );
}

export function Pager({
  label,
  list,
  noun,
  count,
  busy = false,
}: {
  label: string;
  list: ListParams<string>;
  noun: Noun;
  count: number;
  busy?: boolean;
}) {
  if (count === 0) return null;
  const pages = Math.ceil(count / PAGE_SIZE);
  const page = Math.min(list.page, pages);
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, count);
  return (
    <nav aria-label={label} aria-busy={busy} className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm tabular-nums text-text-muted">
        {busy
          ? `Loading ${noun[1]}…`
          : `${formatShareCount(String(first))}–${formatShareCount(String(last))} of ${counted(count, noun)}`}
      </p>
      {pages > 1 && (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PageAction label="Previous" context={label} disabled={page === 1} onClick={() => list.setPage(page - 1)} />
          <span className="text-sm tabular-nums text-text-muted">
            Page {formatShareCount(String(page))} of {formatShareCount(String(pages))}
          </span>
          <PageAction label="Next" context={label} disabled={page === pages} onClick={() => list.setPage(page + 1)} />
        </div>
      )}
    </nav>
  );
}

export function LoadMore({
  noun,
  hasMore,
  failed,
  loading,
  disabled = false,
  onLoad,
}: {
  noun: Noun;
  hasMore: boolean;
  failed: boolean;
  loading: boolean;
  disabled?: boolean;
  onLoad: () => void;
}) {
  if (failed)
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="text-sm text-text-primary">More {noun[1]} could not be loaded. The list is incomplete.</p>
        <PageAction label={`Try more ${noun[1]} again`} onClick={onLoad} disabled={disabled} />
      </div>
    );
  return hasMore ? (
    <PageAction
      label={`Load more ${noun[1]}`}
      busy={loading}
      busyLabel={`Loading ${noun[1]}…`}
      onClick={onLoad}
      disabled={disabled}
    />
  ) : null;
}
