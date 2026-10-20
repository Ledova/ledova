import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import type { Query, QueryKey } from '@tanstack/react-query';
import { failureStatus } from '@ledova/shared';

const SEARCH_DELAY_MS = 300;
const SEARCH_MAX_LENGTH = 100;
export const PAGE_SIZE = 25;

export interface ListParams<F extends string> {
  typed: string;
  type(text: string): void;
  clear(): void;
  search: string;
  filters: Record<F, string>;
  setFilter(name: F, value: string): void;
  page: number;
  setPage(page: number, replace?: boolean): void;
}

export function useListParams<F extends string = never>(filterNames: readonly F[] = []): ListParams<F> {
  const location = useLocation();
  const navigate = useNavigate();
  const latest = useRef<Pick<Location, 'search' | 'hash' | 'state'>>(location);
  useLayoutEffect(() => {
    latest.current = location;
  }, [location]);
  const params = new URLSearchParams(location.search);
  const search = (params.get('q') ?? '').slice(0, SEARCH_MAX_LENGTH);
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
  const update = (changes: Record<string, string>, replace = false) => {
    const { search: current, hash, state } = latest.current;
    const next = new URLSearchParams(current);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    const query = next.toString();
    latest.current = { search: query ? `?${query}` : '', hash, state };
    navigate({ search: latest.current.search, hash }, { replace, state });
  };
  const write = (text: string) => {
    setWritten(text);
    update({ q: text }, true);
  };
  useEffect(() => {
    const text = typed.trim();
    if (text === written) return;
    const timer = setTimeout(() => write(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, written, location.pathname]);
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
    setPage: (next, replace = false) => update({ page: next > 1 ? String(next) : '' }, replace),
  };
}

export function keepWithin<T>(key: QueryKey) {
  return (previous: T | undefined, query: Query<T, Error, T, QueryKey> | undefined) =>
    query && key.every((part, index) => query.queryKey[index] === part) ? previous : undefined;
}

export function retryServerFailures(failures: number, error: unknown) {
  const status = failureStatus(error);
  return !(status !== undefined && status >= 400 && status < 500) && failures < 3;
}

export function useFirstPageWhenGone(list: ListParams<string>, error: unknown) {
  const gone = list.page > 1 && failureStatus(error) === 404;
  useEffect(() => {
    if (gone) list.setPage(1, true);
  }, [gone]);
  return gone;
}
