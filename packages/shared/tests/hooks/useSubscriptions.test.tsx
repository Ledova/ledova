/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { ReactNode } from 'react';

import { CACHE_TIMING, SUBSCRIPTION_ENDPOINTS, WALLET_ENDPOINTS } from '../../src/constants';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useSubscribableWallets, useSubscriptions } from '../../src/hooks/useSubscriptions';
import { readsAgainOnReturnOnlyAfter } from '../fixtures/cache-timing';

const api = { get: jest.fn() };
const listUrl = `https://example.invalid${SUBSCRIPTION_ENDPOINTS.BASE}`;
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function page(results: object[], next: string | null = null) {
  return { data: { results, next, previous: null, count: results.length } };
}

function application(uuid: string) {
  return { uuid, status: 'draft', quantity: 3 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const pageOf = (config?: { params?: { page?: number } }) => config?.params?.page;

beforeEach(() => {
  api.get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

describe('useSubscriptions', () => {
  it('waits for the first page without calling the list empty', async () => {
    const first = deferred<ReturnType<typeof page>>();
    api.get.mockReturnValue(first.promise);
    const view = renderHook(() => useSubscriptions(), { wrapper });

    expect(view.result.current.isLoading).toBe(true);
    expect(view.result.current.subscriptions).toEqual([]);

    await act(async () => first.resolve(page([application('first')])));
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(view.result.current.subscriptions).toEqual([application('first')]);
  });

  it('reads further pages only on request, from the applications list alone', async () => {
    api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) =>
      pageOf(config) === 1 ? page([application('first')], `${listUrl}?page=2`) : page([application('second')]),
    );
    const view = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(view.result.current.hasMore).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(() => view.result.current.loadMore());

    await waitFor(() => expect(view.result.current.subscriptions.map((row) => row.uuid)).toEqual(['first', 'second']));
    expect(view.result.current.hasMore).toBe(false);
    expect(api.get.mock.calls).toEqual([
      [SUBSCRIPTION_ENDPOINTS.BASE, { params: { page: 1 } }],
      [SUBSCRIPTION_ENDPOINTS.BASE, { params: { page: 2 } }],
    ]);
  });

  it('reports a failed first read and recovers on retry', async () => {
    api.get.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(page([application('first')]));
    const view = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(view.result.current.hasError).toBe(true));
    expect(view.result.current.moreFailed).toBe(false);
    expect(view.result.current.subscriptions).toEqual([]);

    await act(() => view.result.current.retry());

    await waitFor(() => expect(view.result.current.hasError).toBe(false));
    expect(view.result.current.subscriptions).toEqual([application('first')]);
  });

  it('keeps known applications when a later page fails, marks the list incomplete, and retries that page', async () => {
    let broken = true;
    api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) => {
      if (pageOf(config) === 1) return page([application('first')], `${listUrl}?page=2`);
      if (broken) throw new Error('Unavailable');
      return page([application('earlier')]);
    });
    const view = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(view.result.current.hasMore).toBe(true));

    await act(async () => {
      await view.result.current.loadMore();
    });

    await waitFor(() => expect(view.result.current.moreFailed).toBe(true));
    expect(view.result.current.hasError).toBe(false);
    expect(view.result.current.subscriptions).toEqual([application('first')]);
    broken = false;
    await act(async () => {
      await view.result.current.loadMore();
    });
    await waitFor(() => expect(view.result.current.moreFailed).toBe(false));
    expect(view.result.current.subscriptions.map((row) => row.uuid)).toEqual(['first', 'earlier']);
    expect(api.get).toHaveBeenLastCalledWith(SUBSCRIPTION_ENDPOINTS.BASE, { params: { page: 2 } });
  });

  it('does not call an empty first page complete while a later page is outstanding', async () => {
    api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) => {
      if (pageOf(config) === 1) return page([], `${listUrl}?page=2`);
      throw new Error('Unavailable');
    });
    const view = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    expect(view.result.current.subscriptions).toEqual([]);
    expect(view.result.current.hasMore).toBe(true);

    await act(async () => {
      await view.result.current.loadMore();
    });
    await waitFor(() => expect(view.result.current.moreFailed).toBe(true));
    expect(view.result.current.subscriptions).toEqual([]);
  });

  it('refuses a next link that does not advance', async () => {
    api.get.mockResolvedValue(page([application('first')], `${listUrl}?page=1`));
    const view = renderHook(() => useSubscriptions(), { wrapper });

    await waitFor(() => expect(view.result.current.hasError).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('keeps the list under the applications key, so an application change refreshes it', async () => {
    api.get.mockResolvedValue(page([application('first')]));
    const view = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(view.result.current.subscriptions).toHaveLength(1));
    expect(client.getQueryData(['subscriptions', 'list'])).toEqual({
      pages: [page([application('first')]).data],
      pageParams: [1],
    });

    api.get.mockRejectedValue(new Error('Unavailable'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['subscriptions'] });
    });

    await waitFor(() => expect(view.result.current.hasError).toBe(true));
    api.get.mockResolvedValue(page([application('first'), application('second')]));
    await act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.subscriptions).toHaveLength(2));
    expect(view.result.current.hasError).toBe(false);
  });

  it('counts the applications current for two minutes', async () => {
    jest.useFakeTimers();
    api.get.mockResolvedValue(page([application('first')]));
    const view = renderHook(() => useSubscriptions(), { wrapper });
    await waitFor(() => expect(view.result.current.subscriptions).toHaveLength(1));

    await readsAgainOnReturnOnlyAfter(CACHE_TIMING.SHORT_STALE_TIME, () => api.get.mock.calls.length);
  });
});

describe('useSubscribableWallets', () => {
  const walletsUrl = `https://example.invalid${WALLET_ENDPOINTS.BASE}`;
  const wallet = (uuid: string) => ({ uuid, chain: 'base', verificationStatus: 'VERIFIED' });

  it('reads nothing until a form needs a wallet', async () => {
    api.get.mockResolvedValue(page([wallet('a')]));
    const view = renderHook(({ enabled }) => useSubscribableWallets(enabled), {
      wrapper,
      initialProps: { enabled: false },
    });
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
    expect(view.result.current.wallets).toEqual([]);

    view.rerender({ enabled: true });
    await waitFor(() => expect(view.result.current.wallets).toEqual([wallet('a')]));
  });

  it('reads every page of verified Base wallets', async () => {
    api.get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) =>
      pageOf(config) === 1 ? page([wallet('a')], `${walletsUrl}?page=2`) : page([wallet('b')]),
    );
    const view = renderHook(() => useSubscribableWallets(true), { wrapper });

    await waitFor(() => expect(view.result.current.wallets).toEqual([wallet('a'), wallet('b')]));
    expect(api.get.mock.calls).toEqual([
      [WALLET_ENDPOINTS.BASE, { params: { chain: 'base', verification_status: 'VERIFIED', page: 1 } }],
      [WALLET_ENDPOINTS.BASE, { params: { chain: 'base', verification_status: 'VERIFIED', page: 2 } }],
    ]);
  });

  it('keeps the wallets under the wallets key, so a wallet change refreshes them', async () => {
    api.get.mockResolvedValue(page([wallet('a')]));
    const view = renderHook(() => useSubscribableWallets(true), { wrapper });
    await waitFor(() => expect(view.result.current.wallets).toHaveLength(1));
    expect(client.getQueryData(['wallets', 'base-verified', 'complete'])).toEqual([wallet('a')]);

    api.get.mockResolvedValue(page([wallet('a'), wallet('b')]));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['wallets'] });
    });

    await waitFor(() => expect(view.result.current.wallets).toHaveLength(2));
  });

  it('reports a failed read and recovers on retry', async () => {
    api.get.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(page([wallet('a')]));
    const view = renderHook(() => useSubscribableWallets(true), { wrapper });
    await waitFor(() => expect(view.result.current.hasError).toBe(true));

    await act(() => view.result.current.retry());

    await waitFor(() => expect(view.result.current.hasError).toBe(false));
    expect(view.result.current.wallets).toEqual([wallet('a')]);
  });

  it('counts the wallets current for two minutes', async () => {
    jest.useFakeTimers();
    api.get.mockResolvedValue(page([wallet('a')]));
    const view = renderHook(() => useSubscribableWallets(true), { wrapper });
    await waitFor(() => expect(view.result.current.wallets).toHaveLength(1));

    await readsAgainOnReturnOnlyAfter(CACHE_TIMING.SHORT_STALE_TIME, () => api.get.mock.calls.length);
  });
});
