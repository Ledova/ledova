// @vitest-environment jsdom

import type { ComponentProps, PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { type AxiosInstance } from 'axios';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { orderActionStore } from '@services/orderActions';
import { orderSubmissionStore } from '@services/orderSubmissions';
import { swapSettlementStore } from '@services/swapSettlements';
import { TradingPage } from './index';
import {
  accountUuid,
  owner,
  response,
  submissionId,
  userUuid,
  wallet,
  walletUuid,
} from '../../../../packages/shared/tests/fixtures/order-submissions';
import { actionId, orderUuid } from '../../../../packages/shared/tests/fixtures/order-actions';

vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => null }));
vi.mock('./components/MarketOverview', () => ({ MarketOverview: () => null }));
vi.mock('./components/PlaceOrderPanel', () => ({ PlaceOrderPanel: () => null }));
vi.mock('./components/OrderSigningFlow', () => ({ OrderSigningFlow: () => null }));
vi.mock('./components/OrdersPanel', async (importOriginal) => {
  const { OrdersPanel } = await importOriginal<typeof import('./components/OrdersPanel')>();
  const { settlementListRow } = await import('../../../../packages/shared/tests/fixtures/swap-settlements');
  return {
    OrdersPanel: (props: ComponentProps<typeof OrdersPanel>) => (
      <>
        <OrdersPanel {...props} />
        <button onClick={() => props.onSignSwap(settlementListRow())}>Sign a trade listed for another account</button>
      </>
    ),
  };
});
vi.mock('./hooks/useTradingEvents', () => ({ useTradingEvents: () => {} }));
vi.mock('./hooks/useAtomicSwaps', () => ({ useSwapOrdersMulti: () => ({ data: [], isLoading: false }) }));
vi.mock('./useTrading', async () => {
  const f = await import('../../../../packages/shared/tests/fixtures/order-submissions');
  return {
    useShareTokens: () => ({ data: [{ uuid: f.tokenUuid, name: 'Synthetic', symbol: 'SYN' }] }),
    useInvestorEligibilityQuery: () => ({ data: { isEligible: true } }),
    useUserTradingWallets: () => ({
      wallets: [f.wallet],
      actionWallets: [f.wallet],
      walletAddresses: [f.wallet.address],
    }),
    useWalletsWhitelistStatus: () => ({ getStatus: () => ({ status: 'whitelisted' }), isLoading: false }),
    useOrderBook: () => ({ data: null, isLoading: false }),
    useTrading: () => ({ userOrders: [], isLoadingUserOrders: false, getWalletsWithHoldings: () => [] }),
  };
});

const settlement = {
  version: 1 as const,
  ...owner,
  orderUuid,
  swapUuid: '80000000-0000-4000-8000-000000000001',
  walletUuid,
  settlementDigest: `0x${'cd'.repeat(32)}`,
  kind: 'signature' as const,
  signerAddress: wallet.address,
};
let client: QueryClient;
let api: AxiosInstance;

function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function spyOnEverySavedList() {
  return [
    vi.spyOn(orderSubmissionStore, 'list'),
    vi.spyOn(orderActionStore, 'list'),
    vi.spyOn(swapSettlementStore, 'list'),
  ];
}
function headings() {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
}
async function savedWork() {
  const section = (await screen.findByRole('heading', { name: 'Saved work' })).closest('section')!;
  const refresh = within(section).getByRole('button', { name: 'Refresh saved work' }) as HTMLButtonElement;
  await waitFor(() => expect(refresh.disabled).toBe(false));
  return { section, refresh };
}

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: userUuid, userAccount: { uuid: accountUuid } },
  });
  api = axios.create();
  api.defaults.adapter = async (config) =>
    response(config, client.getQueryData<{ data: unknown }>(USER_PREFERENCES_QUERY_KEY)!.data);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('leaves Saved work off the page once every saved list has been read and holds nothing', async () => {
  const reads = spyOnEverySavedList();
  render(<TradingPage />, { wrapper });
  await waitFor(() => reads.forEach((read) => expect(read).toHaveBeenCalledWith(owner)));
  await act(async () => {
    await Promise.all(reads.map((read) => read.mock.results[0]!.value));
  });
  expect(headings()).toContain('Trades awaiting signatures');
  expect(screen.queryByRole('heading', { name: 'Saved work' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh saved work' })).toBeNull();
});

it('lists saved work after the trades awaiting signatures and refreshes every saved list', async () => {
  await orderSubmissionStore.create(owner, walletUuid);
  await orderActionStore.persist(orderActionStore.reserve(owner, orderUuid, 'modify'));
  await swapSettlementStore.save(settlement);
  const reads = spyOnEverySavedList();
  render(<TradingPage />, { wrapper });
  const { section, refresh } = await savedWork();
  expect(headings().slice(-2)).toEqual(['Trades awaiting signatures', 'Saved work']);
  expect(within(section).getByRole('button', { name: 'Check saved order 1' })).toBeTruthy();
  expect(within(section).getByRole('button', { name: 'Check change 1' })).toBeTruthy();
  expect(within(section).getByRole('button', { name: 'Check saved trade signature 1' })).toBeTruthy();
  await orderSubmissionStore.create(owner, walletUuid);
  const before = reads.map((read) => read.mock.calls.length);
  fireEvent.click(refresh);
  reads.forEach((read, index) => expect(read.mock.calls.length).toBe(before[index]! + 1));
  expect(await within(section).findByRole('button', { name: 'Check saved order 2' })).toBeTruthy();
});

it.each([
  {
    list: 'orders',
    key: `ledova.order-submissions.v1.${userUuid}.${accountUuid}.${walletUuid}.${submissionId}`,
    message: 'Saved orders could not be read. Please try again.',
  },
  {
    list: 'cancellations and changes',
    key: `ledova.order-actions.v1.${userUuid}.${accountUuid}.${orderUuid}.modify.${actionId}`,
    message: 'Saved cancellations and changes could not be read. Please try again.',
  },
  {
    list: 'trade signatures',
    key: `ledova.swap-settlements.v1.${userUuid}.${accountUuid}.${orderUuid}.${settlement.swapUuid}.${walletUuid}`,
    message: 'Saved settlements could not be read. Please try again.',
  },
])(
  'shows Saved work when the saved $list cannot be read, and leaves once a retry finds nothing',
  async ({ key, message }) => {
    localStorage.setItem(key, 'not a saved record');
    render(<TradingPage />, { wrapper });
    const { section, refresh } = await savedWork();
    expect(within(section).getByRole('alert').textContent).toBe(message);
    localStorage.removeItem(key);
    fireEvent.click(refresh);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Saved work' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('shows Saved work with the refusal when a trade cannot be opened for signing', async () => {
  const reads = spyOnEverySavedList();
  render(<TradingPage />, { wrapper });
  await waitFor(() => reads.forEach((read) => expect(read).toHaveBeenCalledWith(owner)));
  expect(screen.queryByRole('heading', { name: 'Saved work' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign a trade listed for another account' }));
  const { section } = await savedWork();
  expect(within(section).getByRole('alert').textContent).toBe(
    'The trade details did not match the selected account and wallet.',
  );
});
