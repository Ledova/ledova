/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useLaterPages } from '../../src/hooks';

type Page = { rows: string[]; next: number | null };

let client: QueryClient;
let reads: number[];
let read: (page: number) => Promise<Page>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function useList(name = 'notices') {
  const queryKey = ['list', name];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      reads.push(pageParam);
      return read(pageParam);
    },
    getNextPageParam: (last: Page) => last.next ?? undefined,
    initialPageParam: 1,
  });
  const pages = useLaterPages(queryKey, query);
  return { rows: query.data?.pages.flatMap((page) => page.rows) ?? [], isRefreshing: query.isFetching, ...pages };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function laterPageFailed(name?: string) {
  read = async (page) => {
    if (page === 2) throw new Error('offline');
    return { rows: ['first'], next: 2 };
  };
  const view = renderHook(() => useList(name), { wrapper });
  await waitFor(() => expect(view.result.current.rows).toEqual(['first']));
  await act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.moreFailed).toBe(true));
  return view;
}

function readHeld() {
  const held = deferred<Page>();
  read = () => held.promise;
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = client.invalidateQueries({ queryKey: ['list'] });
  });
  return {
    finish: (page: Page) =>
      act(async () => {
        held.resolve(page);
        await refreshing;
      }),
  };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  reads = [];
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('keeps the rows and the later-page failure while the list is read again, then offers the next page', async () => {
  const view = await laterPageFailed();

  const refresh = readHeld();
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(true));
  expect(view.result.current.hasError).toBe(false);
  expect(view.result.current.moreFailed).toBe(true);
  expect(view.result.current.rows).toEqual(['first']);

  await refresh.finish({ rows: ['first', 'newer'], next: 2 });
  await waitFor(() => expect(view.result.current.rows).toEqual(['first', 'newer']));
  expect(view.result.current.moreFailed).toBe(false);
  expect(view.result.current.hasError).toBe(false);
});

it('shows a refresh that fails as a first-page failure, including while it is retried', async () => {
  const view = await laterPageFailed();
  read = async () => {
    throw new Error('offline');
  };

  await act(async () => {
    await client.invalidateQueries({ queryKey: ['list'] });
  });
  await waitFor(() => expect(view.result.current.hasError).toBe(true));
  expect(view.result.current.moreFailed).toBe(false);

  readHeld();
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(true));
  expect(view.result.current.hasError).toBe(true);
  expect(view.result.current.moreFailed).toBe(false);
});

it('shows a refresh that throws the later page’s own error again as a first-page failure', async () => {
  const offline = new Error('offline');
  read = async (page) => {
    if (page === 2) throw offline;
    return { rows: ['first'], next: 2 };
  };
  const view = renderHook(() => useList(), { wrapper });
  await waitFor(() => expect(view.result.current.rows).toEqual(['first']));
  await act(() => view.result.current.loadMore());
  await waitFor(() => expect(view.result.current.moreFailed).toBe(true));
  read = async () => {
    throw offline;
  };

  await act(async () => {
    await client.invalidateQueries({ queryKey: ['list'] });
  });

  await waitFor(() => expect(view.result.current.hasError).toBe(true));
  expect(view.result.current.moreFailed).toBe(false);
});

it('does not take another list’s first-page failure for this list’s later-page failure', async () => {
  await laterPageFailed('notices');
  read = async () => {
    throw new Error('offline');
  };

  const other = renderHook(() => useList('applications'), { wrapper });

  await waitFor(() => expect(other.result.current.hasError).toBe(true));
  expect(other.result.current.moreFailed).toBe(false);
});

it('shows a first-page failure after the list is reset as a first-page failure, and reads it again', async () => {
  const view = await laterPageFailed();
  read = async () => {
    throw new Error('offline');
  };

  await act(async () => {
    await client.resetQueries({ queryKey: ['list'] });
  });

  await waitFor(() => expect(view.result.current.hasError).toBe(true));
  expect(view.result.current.moreFailed).toBe(false);
  expect(view.result.current.rows).toEqual([]);
  read = async () => ({ rows: ['first'], next: 2 });
  await act(async () => {
    await client.refetchQueries({ queryKey: ['list'] });
  });
  await waitFor(() => expect(view.result.current.rows).toEqual(['first']));
  expect(view.result.current.hasError).toBe(false);
});

it('still knows the later-page failure when the list is shown again and read afresh', async () => {
  const first = await laterPageFailed();
  first.unmount();
  const held = deferred<Page>();
  read = () => held.promise;

  const again = renderHook(() => useList(), { wrapper });

  await waitFor(() => expect(again.result.current.isRefreshing).toBe(true));
  expect(again.result.current.hasError).toBe(false);
  expect(again.result.current.moreFailed).toBe(true);
  expect(again.result.current.rows).toEqual(['first']);
  await act(async () => held.resolve({ rows: ['first'], next: 2 }));
});

it('reads nothing more while the list is being read, or once there is no later page', async () => {
  read = async () => ({ rows: ['first'], next: 2 });
  const view = renderHook(() => useList(), { wrapper });
  await waitFor(() => expect(view.result.current.rows).toEqual(['first']));

  const refresh = readHeld();
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(true));
  await act(() => view.result.current.loadMore());
  expect(reads).toEqual([1, 1]);

  await refresh.finish({ rows: ['first'], next: null });
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(false));
  await act(() => view.result.current.loadMore());
  expect(reads).toEqual([1, 1]);
});
