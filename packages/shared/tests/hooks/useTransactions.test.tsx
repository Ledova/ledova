/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { ReactNode } from 'react';

import { CACHE_TIMING, TRANSACTION_ENDPOINTS, WALLET_ENDPOINTS } from '../../src/constants';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useTransactions } from '../../src/hooks/useTransactions';
import { keepsAfterClosingFor, readsAgainOnReturnOnlyAfter } from '../fixtures/cache-timing';

type Params = Record<string, unknown>;
type Read = (params: Params) => Promise<unknown>;

const api = { get: jest.fn() };
const wallet = { uuid: 'wallet-one', name: 'Primary wallet', address: `0x${'a'.repeat(40)}`, chain: 'base' };
const secondWallet = { ...wallet, uuid: 'wallet-two', name: 'Reserve wallet', address: `0x${'b'.repeat(40)}` };
const entry = (uuid: string, status = 'pending') => ({ uuid, status, amount: '1', chain: 'base' });
let client: QueryClient;
let activity: Read;
let wallets: Read;

function page(results: object[], next: string | null = null, count = results.length) {
  return { data: { results, next, previous: null, count } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

const reads = (url: string) =>
  api.get.mock.calls.filter(([called]) => called === url).map(([, config]) => config.params);
const activityReads = () => reads(TRANSACTION_ENDPOINTS.BASE);
const later = (page: number) => `https://example.invalid${TRANSACTION_ENDPOINTS.BASE}?page=${page}`;

async function loaded() {
  const view = renderHook(() => useTransactions(), { wrapper });
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  activity = async () => page([entry('entry-one')]);
  wallets = async () => page([wallet]);
  api.get.mockReset().mockImplementation((url: string, config?: { params?: Params }) => {
    if (url === TRANSACTION_ENDPOINTS.BASE) return activity(config?.params ?? {});
    if (url === WALLET_ENDPOINTS.BASE) return wallets(config?.params ?? {});
    throw new Error(`Unexpected read ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

it('reads history independently of the wallet filter, one page at a time', async () => {
  const held = deferred<ReturnType<typeof page>>();
  wallets = () => held.promise;
  const view = await loaded();

  expect(view.result.current.transactions).toEqual([entry('entry-one')]);
  expect(view.result.current.walletsLoading).toBe(true);
  expect(activityReads()).toEqual([expect.objectContaining({ page: 1 })]);
  expect(view.result.current.hasActiveFilters).toBe(false);

  await act(async () => held.resolve(page([])));
  await waitFor(() => expect(view.result.current.walletsLoading).toBe(false));
  expect(view.result.current.wallets).toEqual([]);
  expect(view.result.current.transactions).toHaveLength(1);
});

it('reads every filter wallet page into its own cache without touching the wallets cache', async () => {
  client.setQueryData(['wallets'], page([wallet]));
  wallets = async (params) => (params.page === 1 ? page([wallet], later(2)) : page([secondWallet]));
  const view = await loaded();

  await waitFor(() => expect(view.result.current.wallets).toEqual([wallet, secondWallet]));
  expect(reads(WALLET_ENDPOINTS.BASE)).toEqual([{ page: 1 }, { page: 2 }]);
  expect(client.getQueryData(['wallets', 'activity-filter'])).toEqual([wallet, secondWallet]);
  expect(client.getQueryData(['wallets'])).toEqual(page([wallet]));
});

it('reports failed filter wallets without hiding history, drops stale wallets and retries', async () => {
  const view = await loaded();
  await waitFor(() => expect(view.result.current.wallets).toEqual([wallet]));

  wallets = async (params) => {
    if (params.page === 2) throw new Error('offline');
    return page([wallet], later(2));
  };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallets', 'activity-filter'] });
  });
  await waitFor(() => expect(view.result.current.walletsFailed).toBe(true));
  expect(view.result.current.wallets).toEqual([]);
  expect(view.result.current.transactions).toHaveLength(1);
  expect(view.result.current.hasError).toBe(false);

  wallets = async () => page([secondWallet]);
  await act(() => view.result.current.retryWallets());
  await waitFor(() => expect(view.result.current.wallets).toEqual([secondWallet]));
  expect(view.result.current.walletsFailed).toBe(false);
});

it('holds draft filters until applied, then sends only supported fields with whole local days', async () => {
  const view = await loaded();

  act(() =>
    view.result.current.updateFilters({
      wallet: secondWallet.uuid,
      direction: 'incoming',
      chain: 'base',
      start_date: '2026-09-01',
      end_date: '2026-09-02',
    }),
  );
  expect(view.result.current.filters.direction).toBe('incoming');
  expect(view.result.current.hasActiveFilters).toBe(false);
  expect(activityReads()).toHaveLength(1);

  act(() => view.result.current.applyFilters());

  await waitFor(() => expect(activityReads()).toHaveLength(2));
  expect(activityReads()[1]).toEqual({
    wallet: secondWallet.uuid,
    direction: 'incoming',
    chain: 'base',
    start_date: new Date('2026-09-01T00:00:00').toISOString(),
    end_date: new Date('2026-09-02T23:59:59.999').toISOString(),
    page: 1,
  });
  expect(view.result.current.appliedFilters).toEqual(view.result.current.filters);
  expect(view.result.current.hasActiveFilters).toBe(true);
});

it('clears draft and applied filters together and returns to the unfiltered history', async () => {
  activity = async (params) => page(params.direction === 'outgoing' ? [] : [entry('entry-one')]);
  const view = await loaded();
  act(() => view.result.current.updateFilters({ direction: 'outgoing' }));
  act(() => view.result.current.applyFilters());
  await waitFor(() => expect(view.result.current.transactions).toEqual([]));

  act(() => view.result.current.clearFilters());

  expect(view.result.current.filters).toEqual({});
  expect(view.result.current.appliedFilters).toEqual({});
  expect(view.result.current.hasActiveFilters).toBe(false);
  await waitFor(() => expect(view.result.current.transactions).toEqual([entry('entry-one')]));
});

it('reads a later page on request and counts from the first page', async () => {
  activity = async (params) =>
    params.page === 1 ? page([entry('entry-one')], later(2), 2) : page([entry('entry-two')], null, 2);
  const view = await loaded();
  expect(view.result.current.hasNextPage).toBe(true);
  expect(view.result.current.totalCount).toBe(2);

  await act(async () => {
    await view.result.current.loadMore();
  });

  await waitFor(() =>
    expect(view.result.current.transactions.map((row) => row.uuid)).toEqual(['entry-one', 'entry-two']),
  );
  expect(view.result.current.hasNextPage).toBe(false);
  expect(activityReads().map((params) => params.page)).toEqual([1, 2]);
});

it('keeps known rows when a later page fails, marks the history incomplete and retries that page', async () => {
  let broken = true;
  activity = async (params) => {
    if (params.page === 1) return page([entry('entry-one')], later(2));
    if (broken) throw new Error('offline');
    return page([entry('entry-two', 'confirmed')]);
  };
  const view = await loaded();

  await act(async () => {
    await view.result.current.loadMore();
  });
  await waitFor(() => expect(view.result.current.moreFailed).toBe(true));
  expect(view.result.current.hasError).toBe(false);
  expect(view.result.current.transactions).toEqual([entry('entry-one')]);

  broken = false;
  await act(async () => {
    await view.result.current.loadMore();
  });
  await waitFor(() => expect(view.result.current.transactions).toHaveLength(2));
  expect(view.result.current.moreFailed).toBe(false);
  expect(activityReads().at(-1)?.page).toBe(2);
});

it('does not call an empty first page complete while a later page is outstanding', async () => {
  activity = async (params) => (params.page === 1 ? page([], later(2)) : page([entry('entry-one')]));
  const view = await loaded();

  expect(view.result.current.transactions).toEqual([]);
  expect(view.result.current.hasNextPage).toBe(true);
});

it('reports a failed first read and recovers on retry', async () => {
  activity = async () => {
    throw new Error('offline');
  };
  const view = await loaded();
  expect(view.result.current.hasError).toBe(true);
  expect(view.result.current.transactions).toEqual([]);

  activity = async () => page([entry('entry-one')]);
  await act(() => view.result.current.retry());

  await waitFor(() => expect(view.result.current.hasError).toBe(false));
  expect(view.result.current.transactions).toEqual([entry('entry-one')]);
});

it('refuses a next link that does not advance', async () => {
  activity = async () => page([entry('entry-one')], later(1));
  const view = await loaded();

  expect(view.result.current.hasError).toBe(true);
  expect(activityReads()).toHaveLength(1);
});

it('keeps history under the all-transactions key, so a wallet sync refreshes it', async () => {
  const view = await loaded();
  expect(client.getQueryData(['all-transactions', {}])).toEqual({
    pages: [page([entry('entry-one')])],
    pageParams: [1],
  });

  activity = async () => page([entry('entry-one', 'confirmed')]);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['all-transactions'] });
  });

  await waitFor(() => expect(view.result.current.transactions).toEqual([entry('entry-one', 'confirmed')]));
  expect(activityReads()).toHaveLength(2);
});

it('reports a failed refresh until a successful retry', async () => {
  const view = await loaded();
  activity = async () => {
    throw new Error('offline');
  };

  await act(async () => {
    await client.invalidateQueries({ queryKey: ['all-transactions'] });
  });
  await waitFor(() => expect(view.result.current.hasError).toBe(true));

  activity = async () => page([entry('entry-one', 'reorged')]);
  await act(() => view.result.current.retry());
  await waitFor(() => expect(view.result.current.hasError).toBe(false));
  expect(view.result.current.transactions).toEqual([entry('entry-one', 'reorged')]);
});

it('does not read a further page while the history is being read again, so the refresh completes', async () => {
  activity = async () => page([entry('entry-one')], later(2));
  const view = await loaded();
  const refreshed = deferred<ReturnType<typeof page>>();
  activity = () => refreshed.promise;

  let refreshing!: Promise<unknown>;
  act(() => {
    refreshing = view.result.current.retry();
  });
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(true));
  await act(async () => {
    await view.result.current.loadMore();
  });

  expect(activityReads().map((params) => params.page)).toEqual([1, 1]);
  await act(async () => {
    refreshed.resolve(page([entry('entry-one', 'confirmed')], later(2)));
    await refreshing;
  });
  await waitFor(() => expect(view.result.current.isRefreshing).toBe(false));
  expect(view.result.current.transactions).toEqual([entry('entry-one', 'confirmed')]);
  expect(view.result.current.hasError).toBe(false);
});

it('counts the history current for thirty seconds and keeps it five minutes after Activity closes', async () => {
  jest.useFakeTimers();
  const view = await loaded();

  await readsAgainOnReturnOnlyAfter(CACHE_TIMING.VERY_SHORT_STALE_TIME, () => activityReads().length);
  await keepsAfterClosingFor(CACHE_TIMING.MEDIUM_GC_TIME, client, ['all-transactions', {}], view.unmount);
});

it('counts the filter wallets current for five minutes', async () => {
  jest.useFakeTimers();
  const view = await loaded();
  await waitFor(() => expect(view.result.current.walletsLoading).toBe(false));

  await readsAgainOnReturnOnlyAfter(CACHE_TIMING.DEFAULT_STALE_TIME, () => reads(WALLET_ENDPOINTS.BASE).length);
});
