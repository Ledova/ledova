// @vitest-environment jsdom

import { createRef, type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ShareToken, TransferOrder } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { allMarketPages, marketAmount, marketQuantity } from './marketData';
import { useShareTokens, useTrading, useUserTradingWallets } from './useTrading';
import { useSwapOrdersMulti } from './hooks/useAtomicSwaps';
import { OrdersPanel } from './components/OrdersPanel';
import { MarketOverview } from './components/MarketOverview';
import { OrderForm, type OrderFormRef } from './components/OrderForm';
import { PlaceOrderPanel } from './components/PlaceOrderPanel';
import {
  deferred,
  response,
  submittedOrder,
  wallet,
  accountUuid,
} from '../../../../packages/shared/tests/fixtures/order-submissions';
vi.mock('@services/apiClient', async () => ({ default: (await import('axios')).default.create() }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useUserPreferences: () => ({ userAccount: { uuid: '20000000-0000-4000-8000-000000000001' }, isLoading: false }),
}));
let client: QueryClient;
const token = {
  uuid: 'fictional-token',
  name: 'Ordinary',
  companyName: 'Harbour Example',
  symbol: 'HEX',
  totalSupply: '9007199254740993',
  lastPrice: '0.29',
} as ShareToken;
const page = <T,>(rows: T[], next: string | null = null) => ({
  count: rows.length,
  results: rows,
  next,
  previous: null,
});
const order: TransferOrder = { ...submittedOrder({ status: 'open' }), tokenName: null, tokenSymbol: null };
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('calculates exact AUD cents and never presents unsafe numeric shares as exact', () => {
  expect(marketAmount('0.29', 9007199254740991)).toBe('AUD\u00a02,612,087,783,874,887.39');
  expect(marketAmount('9999999999999999.99', 2)).toBe('AUD\u00a019,999,999,999,999,999.98');
  expect(marketQuantity(9007199254740992)).toBe('Unavailable');
  expect(marketAmount('1.00', 9007199254740992)).toBe('Unavailable');
});
it.each([
  'https://example.test/?page=1',
  'https://example.test/?page=1.5',
  'https://example.test/?page=wat',
  'https://example.test/?cursor=x',
])('refuses incomplete pagination for %s', async (next) => {
  await expect(allMarketPages(async () => ({ data: page([order], next) }))).rejects.toThrow();
});
it('reads owned orders without a wallet or listed class, through every page', async () => {
  const requests: unknown[] = [];
  apiClient.defaults.adapter = async (config) => {
    requests.push([config.url, config.params]);
    return response(
      config,
      page(
        config.params?.page === 2 ? [{ ...order, uuid: 'second' }] : [order],
        config.params?.page === 2 ? null : 'https://example.test/?page=2',
      ),
    );
  };
  const view = renderHook(() => useTrading(), { wrapper });
  await waitFor(() => expect(view.result.current.userOrders).toHaveLength(2));
  expect(requests).toEqual([
    ['/api/v1/trading/orders/', undefined],
    ['/api/v1/trading/orders/', { page: 2 }],
  ]);
});
it('suppresses previously loaded orders on failed refresh and restores them after retry', async () => {
  let failing = false;
  apiClient.defaults.adapter = async (config) => {
    if (failing) throw new Error('fictional read failure');
    return response(config, page([order]));
  };
  const view = renderHook(() => useTrading(), { wrapper });
  await waitFor(() => expect(view.result.current.userOrders).toHaveLength(1));
  failing = true;
  await act(async () => {
    await view.result.current.refreshOrders();
  });
  await waitFor(() => expect(view.result.current.ordersError).toBeTruthy());
  expect(view.result.current.userOrders).toEqual([]);
  failing = false;
  await act(async () => {
    await view.result.current.refreshOrders();
  });
  await waitFor(() => expect(view.result.current.userOrders).toHaveLength(1));
});
it('loads every trading wallet under the account cache and removes stale signing wallets on failure', async () => {
  let failing = false;
  apiClient.defaults.adapter = async (config) => {
    if (failing) throw new Error('fictional failure');
    return response(
      config,
      page(
        config.params?.page === 2 ? [wallet] : [],
        config.params?.page === 2 ? null : 'https://example.test/?page=2',
      ),
    );
  };
  const view = renderHook(() => useUserTradingWallets(), { wrapper });
  await waitFor(() => expect(view.result.current.wallets).toEqual([wallet]));
  expect(client.getQueryData(['wallets', accountUuid, 'trading'])).toEqual({ data: { results: [wallet] } });
  failing = true;
  await act(async () => {
    await view.result.current.refetch();
  });
  await waitFor(() => expect(view.result.current.error).toBeTruthy());
  expect(view.result.current.wallets).toEqual([]);
  expect(view.result.current.actionWallets).toEqual([]);
});
it('completes token and swap lists and deduplicates a trade visible from both wallets', async () => {
  apiClient.defaults.adapter = async (config) =>
    response(
      config,
      page(
        config.params?.page === 2 ? [{ ...token, uuid: 'second' }] : [token],
        config.params?.page === 2 ? null : 'https://example.test/?page=2',
      ),
    );
  const tokens = renderHook(() => useShareTokens(), { wrapper });
  await waitFor(() => expect(tokens.result.current.data).toHaveLength(2));
  const swaps = renderHook(() => useSwapOrdersMulti([wallet.address, '0x2222222222222222222222222222222222222222']), {
    wrapper,
  });
  await waitFor(() => expect(swaps.result.current.data).toHaveLength(2));
});
it('keeps recorded orders visible without any currently selected share class', () => {
  const edit = vi.fn();
  const cancel = vi.fn();
  render(
    <OrdersPanel
      tokenSymbol={null}
      orderBook={null}
      isLoadingOrderBook={false}
      userOrders={[order]}
      isLoadingUserOrders={false}
      onCancelOrder={cancel}
      onEditOrder={edit}
      swaps={[]}
      isLoadingSwaps={false}
      wallets={[]}
      settlementOwner={null}
      onSignSwap={vi.fn()}
    />,
  );
  expect(screen.getByText('Share class unavailable')).toBeTruthy();
  fireEvent.click(screen.getByTitle('Modify'));
  expect(edit).toHaveBeenCalledWith(order);
  fireEvent.click(screen.getByTitle('Cancel'));
  fireEvent.click(screen.getByText('Yes'));
  expect(cancel).toHaveBeenCalledWith(order.uuid);
});
it('keeps listed supply exact and hides stale listed classes on a read error', () => {
  const props = {
    tokens: [token],
    selectedTokenUuid: null,
    onSelectToken: vi.fn(),
    isLoading: false,
    isEligible: true,
  };
  const view = render(<MarketOverview {...props} />);
  expect(screen.getByText('9,007,199,254,740,993')).toBeTruthy();
  expect(screen.getByText('Authorised shares')).toBeTruthy();
  expect(screen.queryByText('Issued shares')).toBeNull();
  view.rerender(<MarketOverview {...props} error={new Error('fictional failure')} />);
  expect(screen.queryByText('9,007,199,254,740,993')).toBeNull();
  expect(screen.getByText('Retry share classes')).toBeTruthy();
});
it('refuses fractional, out-of-range and overprecise order inputs before submitting and computes an exact total', () => {
  const submit = vi.fn();
  const ref = createRef<OrderFormRef>();
  render(
    <OrderForm
      ref={ref}
      token={token}
      orderType="buy"
      wallets={[wallet]}
      defaultWalletUuid={wallet.uuid}
      onSubmit={submit}
    />,
  );
  for (const quantity of ['1.5', '9223372036854775808']) {
    fireEvent.change(screen.getByLabelText('Quantity (shares)'), { target: { value: quantity } });
    act(() => ref.current?.submit());
  }
  fireEvent.change(screen.getByLabelText('Quantity (shares)'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Price per share (AUD)'), { target: { value: '0.291' } });
  act(() => ref.current?.submit());
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Price per share (AUD)'), { target: { value: '0.29' } });
  expect(screen.getByText('AUD 0.87')).toBeTruthy();
  act(() => ref.current?.submit());
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, pricePerShare: '0.29' }));
});
it('checks the chosen wallet allowlist and preserves a refused pending draft through Escape and read failures', async () => {
  const other = { ...wallet, uuid: 'other', address: '0x2222222222222222222222222222222222222222' };
  const pending = deferred<boolean>();
  const submit = vi.fn(() => pending.promise);
  const props = {
    token,
    wallets: [wallet, other],
    walletsWithHoldings: [],
    onSubmit: submit,
    onNewOrder: vi.fn(),
    onDismiss: vi.fn(),
    submissionError: null,
    isWalletWhitelisted: true,
    isWhitelistStatusUnknown: false,
    isLoadingWhitelistStatus: false,
    getWalletWhitelistStatus: (address: string) => ({
      status: 'whitelisted' as const,
      isWhitelisted: address === wallet.address,
      address,
    }),
  };
  const view = render(<PlaceOrderPanel {...props} />);
  fireEvent.click(screen.getByText('New buy order — HEX'));
  fireEvent.change(screen.getByLabelText('Quantity (shares)'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Delivery wallet'), { target: { value: other.uuid } });
  expect((screen.getByRole('button', { name: 'Place Buy Order' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Delivery wallet'), { target: { value: wallet.uuid } });
  fireEvent.click(screen.getByText('Place Buy Order'));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByLabelText('Quantity (shares)')).toBeTruthy();
  await act(async () => pending.resolve(false));
  view.rerender(<PlaceOrderPanel {...props} readsUnavailable />);
  expect((screen.getByLabelText('Quantity (shares)') as HTMLInputElement).value).toBe('3');
  expect((screen.getByRole('button', { name: 'Place Buy Order' }) as HTMLButtonElement).disabled).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
});

it('opens orders from content-width actions and states a missing allowlist entry as a warning, not a box', () => {
  render(
    <PlaceOrderPanel
      token={token}
      wallets={[wallet]}
      walletsWithHoldings={[]}
      onSubmit={vi.fn(async () => true)}
      onNewOrder={vi.fn()}
      onDismiss={vi.fn()}
      submissionError={null}
      isLoadingWhitelistStatus={false}
      getWalletWhitelistStatus={(address) => ({ status: 'not_whitelisted', isWhitelisted: false, address })}
    />,
  );
  const sell = screen.getByRole('button', { name: 'New sell order — HEX' });
  const buy = screen.getByRole('button', { name: 'New buy order — HEX' });
  for (const action of [sell, buy]) expect(action.className).toMatch(/\bw-fit\b/);
  fireEvent.click(buy);
  const dialog = screen.getByRole('dialog', { name: 'Buy HEX' });
  const warning = within(dialog).getByRole('heading', { level: 3, name: 'Wallet Not Allowlisted' });
  expect(warning.className).toContain('text-warning-light');
  expect(warning.closest('[class*="bg-warning"]')).toBeNull();
  expect(within(dialog).getByText(/must add your wallet to the allowlist/)).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: 'Place Buy Order' }) as HTMLButtonElement).disabled).toBe(true);
});

it('sends supported large share quantities as exact strings without rounding', () => {
  const submit = vi.fn();
  const ref = createRef<OrderFormRef>();
  render(
    <OrderForm
      ref={ref}
      token={token}
      orderType="buy"
      wallets={[wallet]}
      defaultWalletUuid={wallet.uuid}
      onSubmit={submit}
    />,
  );
  fireEvent.change(screen.getByLabelText('Quantity (shares)'), { target: { value: '9007199254740993' } });
  expect(screen.getByText('AUD 2,612,087,783,874,887.97')).toBeTruthy();
  act(() => ref.current?.submit());
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ quantity: '9007199254740993', pricePerShare: '0.29' }));
});
