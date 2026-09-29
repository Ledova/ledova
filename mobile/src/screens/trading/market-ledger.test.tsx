import { Action } from '../../components/Ledger';
import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrderBook, ShareToken, TransferOrder, WhitelistStatus } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { allMarketPages, marketAmount, marketQuantity } from './marketData';
import { useAllUserOrders, useShareTokens, useUserTradingWallets, useWalletsWhitelistStatus } from './useTrading';
import { useSwapOrdersMulti } from './useAtomicSwaps';
import { OrdersCard } from './components/OrdersCard';
import { MarketList } from './components/MarketList';
import { CreateOrderModal } from './components/CreateOrderModal';
import { OrderDetailModal } from './components/OrderDetailModal';
import {
  deferred,
  response,
  submittedOrder,
  wallet,
  accountUuid,
} from '../../../../packages/shared/tests/fixtures/order-submissions';

jest.mock('../../components/Ledger', () => {
  const actual = jest.requireActual('../../components/Ledger');
  return { ...actual, Action: jest.fn(actual.Action) };
});
jest.mock('../../services/apiClient', () => ({ apiClient: jest.requireActual('axios').default.create() }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
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
const page = <T,>(results: T[], next: string | null = null) => ({
  count: results.length,
  results,
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
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('calculates exact AUD cents and never represents unsafe numeric shares as exact', () => {
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
])('rejects incomplete pagination for %s', async (next) => {
  await expect(allMarketPages(async () => ({ data: page([order], next) }))).rejects.toThrow();
});
it('loads owned orders without a listed class or wallet, through all pages', async () => {
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
  const view = await renderHook(() => useAllUserOrders(), { wrapper });
  await waitFor(() => expect(view.result.current.orders).toHaveLength(2));
  expect(requests).toEqual([
    ['/api/v1/trading/orders/', undefined],
    ['/api/v1/trading/orders/', { page: 2 }],
  ]);
  expect(client.getQueryData(['trading', 'userOrders', 'all', accountUuid])).toHaveLength(2);
});
it('hides stale owned orders on failed refresh and restores after retry', async () => {
  let failing = false;
  apiClient.defaults.adapter = async (config) => {
    if (failing) throw new Error('fictional refusal');
    return response(config, page([order]));
  };
  const view = await renderHook(() => useAllUserOrders(), { wrapper });
  await waitFor(() => expect(view.result.current.orders).toHaveLength(1));
  failing = true;
  await act(async () => {
    await view.result.current.refetch();
  });
  await waitFor(() => expect(view.result.current.error).toBeTruthy());
  expect(view.result.current.orders).toEqual([]);
  failing = false;
  await act(async () => {
    await view.result.current.refetch();
  });
  await waitFor(() => expect(view.result.current.orders).toHaveLength(1));
});
it('loads every trading wallet in its account cache and hides stale wallets on failure', async () => {
  let failing = false;
  apiClient.defaults.adapter = async (config) => {
    if (failing) throw new Error('fictional refusal');
    return response(
      config,
      page(
        config.params?.page === 2 ? [wallet] : [],
        config.params?.page === 2 ? null : 'https://example.test/?page=2',
      ),
    );
  };
  const view = await renderHook(() => useUserTradingWallets(), { wrapper });
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
it('loads every class and swap page and deduplicates records across wallets', async () => {
  apiClient.defaults.adapter = async (config) =>
    response(
      config,
      page(
        config.params?.page === 2 ? [{ ...token, uuid: 'second' }] : [token],
        config.params?.page === 2 ? null : 'https://example.test/?page=2',
      ),
    );
  const tokens = await renderHook(() => useShareTokens(), { wrapper });
  await waitFor(() => expect(tokens.result.current.data).toHaveLength(2));
  const swaps = await renderHook(
    () => useSwapOrdersMulti([wallet.address, '0x2222222222222222222222222222222222222222']),
    { wrapper },
  );
  await waitFor(() => expect(swaps.result.current.data).toHaveLength(2));
});
it('makes cached allowlist status unavailable during refresh and after refusal', async () => {
  let failing = false;
  const held = deferred<void>();
  let holding = false;
  apiClient.defaults.adapter = async (config) => {
    if (holding) await held.promise;
    if (failing) throw new Error('fictional refusal');
    return response(config, { isWhitelisted: true, status: 'whitelisted' });
  };
  const view = await renderHook(() => useWalletsWhitelistStatus('0xtoken', [wallet.address]), { wrapper });
  await waitFor(() => expect(view.result.current.isWhitelisted(wallet.address)).toBe(true));
  holding = true;
  let refreshing: Promise<unknown> | undefined;
  await act(async () => {
    refreshing = view.result.current.refetch();
  });
  await waitFor(() => expect(view.result.current.isLoading).toBe(true));
  expect(view.result.current.isWhitelisted(wallet.address)).toBe(false);
  failing = true;
  await act(async () => {
    held.resolve();
    await refreshing;
  });
  await waitFor(() => expect(view.result.current.error).toBeTruthy());
  expect(view.result.current.getStatus(wallet.address)).toBeUndefined();
});
it('keeps recorded orders visible with no class and disables stale actions', async () => {
  const props = {
    tokenSymbol: null,
    orderBook: null,
    isLoadingOrderBook: false,
    userOrders: [order],
    isLoadingUserOrders: false,
    onCancelOrder: jest.fn(),
    onEditOrder: jest.fn(),
    onViewOrder: jest.fn(),
    swaps: [],
    isLoadingSwaps: false,
    wallets: [],
    settlementOwner: null,
    onSignSwap: jest.fn(),
  };
  const view = await render(<OrdersCard {...props} />);
  expect(view.getByText('Share class unavailable')).toBeTruthy();
  await fireEvent.press(view.getByText('Modify'));
  expect(props.onEditOrder).toHaveBeenCalledWith(order);
  await fireEvent.press(view.getByText('Cancel order'));
  await view.rerender(<OrdersCard {...props} ordersBlocked />);
  await fireEvent.press(view.getByText('Yes, cancel'));
  expect(props.onCancelOrder).not.toHaveBeenCalled();
  await view.rerender(<OrdersCard {...props} />);
  await fireEvent.press(view.getByText('Yes, cancel'));
  expect(props.onCancelOrder).toHaveBeenCalledWith(order.uuid);
  await view.rerender(<OrdersCard {...props} ordersError={new Error('fictional')} />);
  expect(view.queryByText('Share class unavailable')).toBeNull();
  expect(view.getByText('Retry your orders')).toBeTruthy();
});
it('sets For sale and Wanted apart as headed blocks with rules between entries only', async () => {
  const entry = { price: '0.29', quantity: 3, orders: 1 };
  const view = await render(
    <OrdersCard
      tokenSymbol="HEX"
      orderBook={{ sellOrders: [entry, { ...entry, price: '0.31' }], buyOrders: [] } as unknown as OrderBook}
      isLoadingOrderBook={false}
      userOrders={[]}
      isLoadingUserOrders={false}
      onCancelOrder={jest.fn()}
      onEditOrder={jest.fn()}
      onViewOrder={jest.fn()}
      swaps={[]}
      isLoadingSwaps={false}
      wallets={[]}
      settlementOwner={null}
      onSignSwap={jest.fn()}
    />,
  );
  const forSale = view.getByRole('header', { name: 'For sale' }).parent!;
  expect(forSale).toHaveStyle({ gap: 12 });
  const [, list] = forSale.children;
  const [first, rule, second] = (list as typeof forSale).children;
  expect((list as typeof forSale).children).toHaveLength(3);
  expect(rule).toHaveStyle({ height: 1 });
  expect(first).toHaveStyle({ paddingVertical: 14, gap: 8 });
  expect(second).not.toHaveStyle({ borderBottomWidth: 1 });
  expect(view.getAllByText('Price per share')).toHaveLength(2);
  const wanted = view.getByRole('header', { name: 'Wanted' }).parent!;
  expect(wanted).toHaveStyle({ gap: 12 });
  expect(wanted.children[1]).toBe(view.getByText('No orders listed.'));
  expect(forSale.parent!.children).toContain(wanted);
});
it('displays exact authorised shares and hides stale class choices on error', async () => {
  const props = {
    tokens: [token],
    selectedTokenUuid: null,
    onSelectToken: jest.fn(),
    isLoading: false,
    isEligible: true,
  };
  const view = await render(<MarketList {...props} />);
  expect(view.getByText('9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText('Authorised shares')).toBeTruthy();
  expect(view.queryByText('Issued shares')).toBeNull();
  await view.rerender(<MarketList {...props} error={new Error('fictional')} />);
  expect(view.queryByText('9,007,199,254,740,993')).toBeNull();
  expect(view.getByText('Retry share classes')).toBeTruthy();
});
function formProps() {
  return {
    visible: true,
    onClose: jest.fn(),
    token,
    orderType: 'buy' as const,
    wallets: [wallet],
    walletsWithHoldings: [],
    onSubmit: jest.fn(async () => false),
    submissionError: null,
    isWalletWhitelisted: () => true,
    getWhitelistStatus: (address: string) =>
      ({ address, isWhitelisted: true, status: 'whitelisted' }) as WhitelistStatus,
    isLoadingWhitelistStatus: false,
  };
}
it.each(['1.5', '-1', '9223372036854775808', '1e3'])('refuses invalid whole-share quantity %s', async (quantity) => {
  const props = formProps();
  const view = await render(<CreateOrderModal {...props} />);
  await fireEvent.changeText(view.getByLabelText('Quantity'), quantity);
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).not.toHaveBeenCalled();
});
it('requires a positive cent price and minimum not above quantity', async () => {
  const props = formProps();
  const view = await render(<CreateOrderModal {...props} />);
  await fireEvent.changeText(view.getByLabelText('Quantity'), '3');
  for (const price of ['0', '0.291', '10000000000000000', '-1']) {
    await fireEvent.changeText(view.getByLabelText('Price per share'), price);
    await fireEvent.press(view.getByText('Buy'));
  }
  await fireEvent.changeText(view.getByLabelText('Price per share'), '0.29');
  await fireEvent.changeText(view.getByLabelText('Minimum fill quantity'), '4');
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getByLabelText('Minimum fill quantity'), '2');
  expect(view.getByText('AUD 0.87')).toBeTruthy();
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ quantity: 3, minQuantity: 2, pricePerShare: '0.29' }),
  );
});
it('sends large quantities and minimum as exact strings', async () => {
  const props = formProps();
  const view = await render(<CreateOrderModal {...props} />);
  await fireEvent.changeText(view.getByLabelText('Quantity'), '9007199254740993');
  await fireEvent.changeText(view.getByLabelText('Minimum fill quantity'), '9007199254740992');
  expect(view.getByText('AUD 2,612,087,783,874,887.97')).toBeTruthy();
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ quantity: '9007199254740993', minQuantity: '9007199254740992', pricePerShare: '0.29' }),
  );
});
it('retains fields on failed reads and price changes without switching a missing wallet', async () => {
  const props = formProps();
  const view = await render(<CreateOrderModal {...props} />);
  await fireEvent.changeText(view.getByLabelText('Quantity'), '3');
  await view.rerender(<CreateOrderModal {...props} blocked wallets={[]} token={{ ...token, lastPrice: '0.50' }} />);
  expect(view.getByLabelText('Quantity').props.value).toBe('3');
  expect(view.getByLabelText('Price per share').props.value).toBe('0.29');
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).not.toHaveBeenCalled();
  const other = { ...wallet, uuid: 'other', name: 'Other wallet' };
  await view.rerender(<CreateOrderModal {...props} wallets={[other]} />);
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Other wallet'));
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ walletUuid: 'other', quantity: 3 }));
});
it('latches pending submission and guards Android Back, backdrop and Cancel, retaining a refused draft', async () => {
  const held = deferred<boolean>();
  const props = { ...formProps(), onSubmit: jest.fn(() => held.promise) };
  const view = await render(<CreateOrderModal {...props} />);
  await fireEvent.changeText(view.getByLabelText('Quantity'), '3');
  const press = jest
    .mocked(Action)
    .mock.calls.filter(([props]) => props.label === 'Buy')
    .at(-1)![0].onPress;
  await act(async () => {
    press();
    press();
  });
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
  await fireEvent(view.getByTestId('modal-Wanted · HEX'), 'requestClose');
  await fireEvent.press(view.getByTestId('modal-backdrop-Wanted · HEX', { includeHiddenElements: true }));
  await fireEvent.press(view.getByText('Cancel'));
  expect(props.onClose).not.toHaveBeenCalled();
  await act(async () => {
    held.resolve(false);
  });
  expect(view.getByLabelText('Quantity').props.value).toBe('3');
  await fireEvent.press(view.getByText('Cancel'));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
it('requires current allowlist and sufficient exact sell holdings', async () => {
  const props = formProps();
  const view = await render(
    <CreateOrderModal
      {...props}
      orderType="sell"
      walletsWithHoldings={[{ walletAddress: wallet.address, balance: '2' }]}
    />,
  );
  await fireEvent.changeText(view.getByLabelText('Quantity'), '3');
  await fireEvent.press(view.getByText('Sell'));
  expect(props.onSubmit).not.toHaveBeenCalled();
  await view.rerender(
    <CreateOrderModal
      {...props}
      orderType="sell"
      walletsWithHoldings={[{ walletAddress: wallet.address, balance: '4' }]}
      isLoadingWhitelistStatus
    />,
  );
  await fireEvent.press(view.getByText('Sell'));
  expect(props.onSubmit).not.toHaveBeenCalled();
  await view.rerender(
    <CreateOrderModal
      {...props}
      orderType="sell"
      walletsWithHoldings={[{ walletAddress: wallet.address, balance: '4' }]}
      isWalletWhitelisted={() => false}
    />,
  );
  await fireEvent.press(view.getByText('Sell'));
  expect(props.onSubmit).not.toHaveBeenCalled();
  await view.rerender(
    <CreateOrderModal
      {...props}
      orderType="sell"
      walletsWithHoldings={[{ walletAddress: wallet.address, balance: '4' }]}
    />,
  );
  await fireEvent.press(view.getByText('Sell'));
  expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, orderType: 'sell' }));
});
it('removes stale detail actions when the current order disappears', async () => {
  const props = { visible: true, onClose: jest.fn(), order, onModify: jest.fn(), onCancel: jest.fn() };
  const view = await render(<OrderDetailModal {...props} />);
  expect(view.getByText('Modify Order')).toBeTruthy();
  await view.rerender(<OrderDetailModal {...props} order={null} />);
  expect(view.queryByText('Modify Order')).toBeNull();
  expect(view.getByRole('alert')).toBeTruthy();
});

it('retries unavailable allowlist status inside the open draft without discarding its fields', async () => {
  const props = { ...formProps(), onRetry: jest.fn() };
  const view = await render(
    <CreateOrderModal {...props} isWalletWhitelisted={() => false} getWhitelistStatus={() => undefined} />,
  );
  await fireEvent.changeText(view.getByLabelText('Quantity'), '7');
  await fireEvent.changeText(view.getByLabelText('Minimum fill quantity'), '2');
  await fireEvent.press(view.getByText('Retry allowlist check'));
  expect(props.onRetry).toHaveBeenCalledTimes(1);
  await view.rerender(<CreateOrderModal {...props} />);
  expect(view.getByLabelText('Quantity').props.value).toBe('7');
  expect(view.getByLabelText('Minimum fill quantity').props.value).toBe('2');
  await fireEvent.press(view.getByText('Buy'));
  expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 7, minQuantity: 2 }));
});
