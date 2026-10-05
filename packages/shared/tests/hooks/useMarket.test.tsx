/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';

import {
  CACHE_TIMING,
  DIRECTORY_ENDPOINTS,
  INVESTOR_CLASSIFICATION_ENDPOINTS,
  TRADING_CONFIG,
  TRADING_ENDPOINTS,
  TRADING_EVENT_INVALIDATION_MAP,
} from '../../src/constants';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useDirectoryTokens } from '../../src/hooks/useDirectory';
import { useInvestorReadinessQuery, useOrderBook, useShareTokens } from '../../src/hooks/useMarket';
import type { InvestorReadiness, OrderBook, ShareToken } from '../../src/types';
import { keepsAfterClosingFor, readsAgainOnReturnOnlyAfter } from '../fixtures/cache-timing';
import { response } from '../fixtures/order-submissions';

const token = { uuid: 'fictional-token', name: 'Ordinary', symbol: 'HEX', lastPrice: '0.29' } as ShareToken;
const book = { sellOrders: [{ price: '0.29', quantity: 3, orders: 1 }], buyOrders: [] } as unknown as OrderBook;
const eligible: InvestorReadiness = {
  account: 'fictional-account',
  isReady: true,
  reasons: [],
};
let client: QueryClient;
let requests: InternalAxiosRequestConfig[];
let handle: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;
const api = axios.create();
api.defaults.adapter = async (config) => {
  requests.push(config);
  return handle(config);
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function page(results: object[], next: string | null = null) {
  return { count: results.length, results, next, previous: null };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  requests = [];
  handle = async (config) => {
    if (config.url === TRADING_ENDPOINTS.TOKENS.ORDER_BOOK(token.uuid)) return response(config, book);
    if (config.url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY) return response(config, eligible);
    return response(config, page([token]));
  };
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

it('reads every page of listed share classes into the trading tokens cache', async () => {
  handle = async (config) =>
    response(
      config,
      config.params?.page === 2
        ? page([{ ...token, uuid: 'second' }])
        : page([token], 'https://example.test/api/v1/trading/tokens/?page=2'),
    );

  const view = renderHook(() => useShareTokens(), { wrapper });

  await waitFor(() => expect(view.result.current.data).toHaveLength(2));
  expect(requests.map((config) => [config.url, config.params])).toEqual([
    [TRADING_ENDPOINTS.TOKENS.LIST, { page: 1 }],
    [TRADING_ENDPOINTS.TOKENS.LIST, { page: 2 }],
  ]);
  expect(client.getQueryData(['trading', 'tokens'])).toEqual([token, { ...token, uuid: 'second' }]);
});

it('refreshes listed share classes when a Market change refreshes every trading read', async () => {
  const view = renderHook(() => useShareTokens(), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual([token]));

  handle = async (config) => response(config, page([{ ...token, lastPrice: '0.31' }]));
  await act(() => client.invalidateQueries({ queryKey: ['trading'] }));

  await waitFor(() => expect(view.result.current.data![0]!.lastPrice).toBe('0.31'));
});

it('reads no order book until a share class is chosen, then keeps its body under that class', async () => {
  const view = renderHook(({ uuid }) => useOrderBook(uuid), {
    wrapper,
    initialProps: { uuid: undefined as string | undefined },
  });
  await act(async () => {});
  expect(view.result.current.fetchStatus).toBe('idle');
  expect(requests).toEqual([]);

  view.rerender({ uuid: token.uuid });

  await waitFor(() => expect(view.result.current.data).toEqual(book));
  expect(requests.map((config) => config.url)).toEqual([TRADING_ENDPOINTS.TOKENS.ORDER_BOOK(token.uuid)]);
  expect(client.getQueryData(['trading', 'orderBook', token.uuid])).toEqual(book);
});

it('re-reads the order book when an order event arrives', async () => {
  const view = renderHook(() => useOrderBook(token.uuid), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(book));

  await act(async () => {
    for (const queryKey of TRADING_EVENT_INVALIDATION_MAP.order_created) await client.invalidateQueries({ queryKey });
  });

  await waitFor(() => expect(requests).toHaveLength(2));
});

it('re-reads the order book on the fallback interval when no event arrives', async () => {
  jest.useFakeTimers();
  const view = renderHook(() => useOrderBook(token.uuid), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(book));
  expect(requests).toHaveLength(1);

  await act(async () => {
    await jest.advanceTimersByTimeAsync(TRADING_CONFIG.ORDER_BOOK_FALLBACK_INTERVAL / 2);
  });
  expect(requests).toHaveLength(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(TRADING_CONFIG.ORDER_BOOK_FALLBACK_INTERVAL / 2);
  });

  await waitFor(() => expect(requests).toHaveLength(2));
});

it('reads account readiness as its body and refreshes it with Verification', async () => {
  const view = renderHook(() => useInvestorReadinessQuery(), { wrapper });
  await waitFor(() => expect(view.result.current.data).toEqual(eligible));
  expect(requests.map((config) => config.url)).toEqual([INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY]);

  handle = async (config) => response(config, { ...eligible, isReady: false, reasons: ['actor_not_ready'] });
  await act(() => client.invalidateQueries({ queryKey: ['investor-eligibility'] }));

  await waitFor(() => expect(view.result.current.data?.isReady).toBe(false));
});

const eligibilityReads = () =>
  requests.filter((config) => config.url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY);

it('agrees with Directory on account readiness from one read when the Market reads it first', async () => {
  const market = renderHook(() => useInvestorReadinessQuery(), { wrapper });
  await waitFor(() => expect(market.result.current.isSuccess).toBe(true));

  const directory = renderHook(() => useDirectoryTokens(), { wrapper });

  await waitFor(() => expect(directory.result.current.tokens).toEqual([token]));
  expect(directory.result.current.isReady).toBe(true);
  expect(market.result.current.data).toEqual(eligible);
  expect(eligibilityReads()).toHaveLength(1);
});

it('agrees with Directory on account readiness from one read when Directory reads it first', async () => {
  const directory = renderHook(() => useDirectoryTokens(), { wrapper });
  await waitFor(() => expect(directory.result.current.tokens).toEqual([token]));

  const market = renderHook(() => useInvestorReadinessQuery(), { wrapper });

  await waitFor(() => expect(market.result.current.isSuccess).toBe(true));
  expect(market.result.current.data).toEqual(eligible);
  expect(directory.result.current.isReady).toBe(true);
  expect(eligibilityReads()).toHaveLength(1);
});

it('reads the server-bounded catalogue during pending readiness and never invents admission from a ready account', async () => {
  let finish!: (value: AxiosResponse) => void;
  handle = async (config) =>
    config.url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : response(config, page([]));
  const directory = renderHook(() => useDirectoryTokens(), { wrapper });
  await waitFor(() =>
    expect(requests.map((config) => config.url)).toEqual([
      INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY,
      DIRECTORY_ENDPOINTS.TOKENS.LIST,
    ]),
  );
  expect(directory.result.current.isLoading).toBe(true);
  expect(directory.result.current.tokens).toEqual([]);
  await act(async () => {
    finish(response(requests[0]!, eligible));
  });
  await waitFor(() => expect(directory.result.current.isLoading).toBe(false));
  expect(directory.result.current.isReady).toBe(true);
  expect(directory.result.current.tokens).toEqual([]);
});

const readsOf = (url: string) => () => requests.filter((config) => config.url === url).length;

it('counts listed share classes current for five minutes and keeps them two minutes after the Market closes', async () => {
  jest.useFakeTimers();
  const view = renderHook(() => useShareTokens(), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

  await readsAgainOnReturnOnlyAfter(CACHE_TIMING.DEFAULT_STALE_TIME, readsOf(TRADING_ENDPOINTS.TOKENS.LIST));
  await keepsAfterClosingFor(CACHE_TIMING.DEFAULT_GC_TIME, client, ['trading', 'tokens'], view.unmount);
});

it('counts the order book current for two minutes while the Market is in the background', async () => {
  jest.useFakeTimers();
  const view = renderHook(() => useOrderBook(token.uuid), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

  await readsAgainOnReturnOnlyAfter(
    CACHE_TIMING.SHORT_STALE_TIME,
    readsOf(TRADING_ENDPOINTS.TOKENS.ORDER_BOOK(token.uuid)),
  );
});

it('counts account readiness current for two minutes', async () => {
  jest.useFakeTimers();
  const view = renderHook(() => useInvestorReadinessQuery(), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

  await readsAgainOnReturnOnlyAfter(
    CACHE_TIMING.SHORT_STALE_TIME,
    readsOf(INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY),
  );
});
