import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Query, QueryKey } from '@tanstack/react-query';
import { failureStatus } from '@ledova/shared';

export const SEARCH_DELAY_MS = 300;
export const PAGE_SIZE = 25;

export interface ListParams<F extends string> {
  typed: string;
  type(text: string): void;
  clear(): void;
  search: string;
  filters: Record<F, string>;
  setFilter(name: F, value: string): void;
  page: number;
  setPage(page: number): void;
}

export function useListParams<F extends string = never>(filterNames: readonly F[] = []): ListParams<F> {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const [typed, setTyped] = useState(search);
  const [written, setWritten] = useState(search);
  const [seen, setSeen] = useState(search);
  if (search !== seen) {
    setSeen(search);
    if (search !== written) {
      setWritten(search);
      setTyped(search);
    }
  }
  const update = (changes: Record<string, string>, replace = false) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [name, value] of Object.entries(changes)) {
          if (value) next.set(name, value);
          else next.delete(name);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace },
    );
  const write = (text: string) => {
    setWritten(text);
    update({ q: text }, true);
  };
  useEffect(() => {
    const text = typed.trim();
    if (text === written) return;
    const timer = setTimeout(() => write(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, written]);
  return {
    typed,
    type: setTyped,
    clear: () => {
      setTyped('');
      write('');
    },
    search,
    filters: Object.fromEntries(filterNames.map((name) => [name, params.get(name) ?? ''])) as Record<F, string>,
    setFilter: (name, value) => update({ [name]: value }),
    page,
    setPage: (next) => update({ page: next > 1 ? String(next) : '' }),
  };
}

export function keepWithin<T>(key: QueryKey) {
  return (previous: T | undefined, query: Query<T, Error, T, QueryKey> | undefined) =>
    query && key.every((part, index) => query.queryKey[index] === part) ? previous : undefined;
}

export function retryUnlessGone(failures: number, error: unknown) {
  return failureStatus(error) !== 404 && failures < 3;
}

export function useFirstPageWhenGone(list: ListParams<string>, error: unknown) {
  const gone = list.page > 1 && failureStatus(error) === 404;
  useEffect(() => {
    if (gone) list.setPage(1);
  }, [gone]);
}
