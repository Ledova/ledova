/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';

import { CACHE_TIMING, TRADING_ENDPOINTS, TRADING_EVENT_INVALIDATION_MAP } from '../../src/constants';
import { useSwapOrdersMulti } from '../../src/hooks/useAtomicSwaps';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import type { SwapOrder, Wallet } from '../../src/types';
import { selectSwapSettlement } from '../../src/utils/swap-settlement-validation';
import { keepsAfterClosingFor, readsAgainOnReturnOnlyAfter } from '../fixtures/cache-timing';
import { response, wallet as baseWallet } from '../fixtures/order-submissions';
import {
  settlementFixture as fixture,
  settlementListRow,
  settlementOwner as owner,
  settlementResponse,
} from '../fixtures/swap-settlements';

const first = '0x1111111111111111111111111111111111111111';
const second = '0x2222222222222222222222222222222222222222';
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

function partyWallet(role: 'seller' | 'buyer'): Wallet {
  const party = fixture.get_body.swapOrder.settlementContext[role];
  return {
    ...baseWallet,
    uuid: party.walletUuid,
    userAccount: party.ownerAccountUuid,
    address: party.address,
    chain: 'base',
  };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  requests = [];
  handle = async (config) => response(config, page([]));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

it('reads every page for each wallet and lists a trade visible from both wallets once', async () => {
  const swap = settlementListRow();
  handle = async (config) =>
    response(
      config,
      config.params?.page === 2
        ? page([{ ...swap, uuid: 'second-trade' }])
        : page([swap], 'https://example.test/api/v1/trading/swaps/?page=2'),
    );

  const view = renderHook(() => useSwapOrdersMulti([first, second]), { wrapper });

  await waitFor(() => expect(view.result.current.data).toHaveLength(2));
  expect(view.result.current.data!.map((listed) => listed.uuid)).toEqual([swap.uuid, 'second-trade']);
  expect(requests.map((config) => [config.url, config.params])).toEqual(
    expect.arrayContaining([
      [TRADING_ENDPOINTS.SWAPS.LIST, { wallet_address: first, page: 1 }],
      [TRADING_ENDPOINTS.SWAPS.LIST, { wallet_address: first, page: 2 }],
      [TRADING_ENDPOINTS.SWAPS.LIST, { wallet_address: second, page: 1 }],
      [TRADING_ENDPOINTS.SWAPS.LIST, { wallet_address: second, page: 2 }],
    ]),
  );
  expect(requests).toHaveLength(4);
});

it.each([false, true])(
  'keeps both unsigned sides of a trade listed from both wallets (reverse=%s)',
  async (reverse) => {
    const current = settlementResponse();
    const row = settlementListRow(current);
    const wallets = [partyWallet('seller'), partyWallet('buyer')];
    if (reverse) wallets.reverse();
    handle = async (config) => response(config, { results: [row] });

    const view = renderHook(() => useSwapOrdersMulti(wallets.map((candidate) => candidate.address)), { wrapper });

    await waitFor(() => expect(view.result.current.data).toHaveLength(1));
    expect(requests).toHaveLength(2);
    const listed = view.result.current.data![0]!;
    expect(listed).not.toHaveProperty('settlementContext');
    expect(selectSwapSettlement(listed, owner, wallets).selection.orderUuid).toBe(current.swapOrder.sellOrderUuid);
    expect(selectSwapSettlement({ ...listed, sellerHasSigned: true }, owner, wallets).selection.orderUuid).toBe(
      current.swapOrder.buyOrderUuid,
    );
  },
);

it('reads nothing until there is a wallet to ask about', async () => {
  const view = renderHook(({ addresses }) => useSwapOrdersMulti(addresses), {
    wrapper,
    initialProps: { addresses: [] as string[] },
  });

  await act(async () => {});
  expect(view.result.current.fetchStatus).toBe('idle');
  expect(view.result.current.data).toBeUndefined();
  expect(requests).toEqual([]);

  view.rerender({ addresses: [first] });
  await waitFor(() => expect(view.result.current.data).toEqual([]));
  expect(requests).toHaveLength(1);
});

it('keeps the trades under the swaps key that trading events refresh', async () => {
  const swap: SwapOrder = settlementListRow();
  handle = async (config) => response(config, page([swap]));
  const view = renderHook(() => useSwapOrdersMulti([first]), { wrapper });
  await waitFor(() => expect(view.result.current.data).toHaveLength(1));
  expect(client.getQueryData(['trading', 'swaps', 'multi', [first]])).toEqual([swap]);

  handle = async (config) => response(config, page([{ ...swap, status: 'completed' }]));
  await act(async () => {
    for (const queryKey of TRADING_EVENT_INVALIDATION_MAP.swap_signed) await client.invalidateQueries({ queryKey });
  });

  await waitFor(() => expect(view.result.current.data![0]!.status).toBe('completed'));
  expect(requests).toHaveLength(2);
});

it('counts trades current for two minutes and keeps them two minutes after the Market closes', async () => {
  jest.useFakeTimers();
  handle = async (config) => response(config, page([settlementListRow()]));
  const view = renderHook(() => useSwapOrdersMulti([first]), { wrapper });
  await waitFor(() => expect(view.result.current.isSuccess).toBe(true));

  await readsAgainOnReturnOnlyAfter(CACHE_TIMING.SHORT_STALE_TIME, () => requests.length);
  await keepsAfterClosingFor(
    CACHE_TIMING.DEFAULT_GC_TIME,
    client,
    ['trading', 'swaps', 'multi', [first]],
    view.unmount,
  );
});
