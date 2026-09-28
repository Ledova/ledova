import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ShareToken, TransferOrder } from '@ledova/shared';
import { TradingScreen } from './index';
import { submittedOrder, wallet } from '../../../../packages/shared/tests/fixtures/order-submissions';

const mockBegin = jest.fn(async () => false);
const mockClose = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockRefetches = Array.from({ length: 8 }, () => jest.fn(async () => undefined));
let mockTokens: ShareToken[];
let mockOrders: TransferOrder[];
let mockTokensError = false;
let mockWalletsError = false;
let mockPending = false;
let mockSaved: { orders: object[]; actions: object[]; settlements: object[]; ordersError: string | null };
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../../services/swapSettlements', () => ({
  settlementWalletMaterial: (value: unknown) => JSON.stringify(value),
}));
jest.mock('./hooks/useTradingEvents', () => ({ useTradingEvents: () => {} }));
jest.mock('./components/OrderSigningModal', () => ({ OrderSigningModal: () => null }));
jest.mock('./components/OrderActionModal', () => ({ OrderActionModal: () => null }));
jest.mock('./components/SwapSettlementModal', () => ({ SwapSettlementModal: () => null }));
jest.mock('@ledova/shared', () => {
  const actual = jest.requireActual('@ledova/shared');
  const state = (pending: object[], error: string | null = null) => ({
    pending,
    active: null,
    error,
    isLoading: false,
    close: mockClose,
    refresh: mockRefresh,
  });
  return {
    ...actual,
    useOrderSubmissions: () => ({ ...state(mockSaved.orders, mockSaved.ordersError), begin: mockBegin }),
    useOrderActions: () => state(mockSaved.actions),
    useSwapSettlements: () => state(mockSaved.settlements),
  };
});
jest.mock('./useTrading', () => ({
  useShareTokens: () => ({
    data: mockTokens,
    isLoading: false,
    isFetching: mockPending,
    isError: mockTokensError,
    error: mockTokensError ? new Error('fictional') : null,
    refetch: mockRefetches[0],
  }),
  useInvestorEligibilityQuery: () => ({ data: { isEligible: true }, refetch: mockRefetches[1] }),
  useUserTradingWallets: () => {
    const f = jest.requireActual('../../../../packages/shared/tests/fixtures/order-submissions');
    return {
      wallets: mockWalletsError ? [] : [f.wallet],
      actionWallets: [f.wallet],
      walletAddresses: [f.wallet.address],
      error: mockWalletsError ? new Error('fictional') : null,
      refetch: mockRefetches[2],
    };
  },
  useAllUserOrders: () => ({ orders: mockOrders, isLoading: false, refetch: mockRefetches[3] }),
  useAllWalletTokenBalances: () => ({ getWalletsWithHoldings: () => [], refetch: mockRefetches[4] }),
  useWalletsWhitelistStatus: () => ({
    isWhitelisted: () => true,
    getStatus: () => ({ status: 'whitelisted', isWhitelisted: true }),
    refetch: mockRefetches[5],
  }),
  useOrderBook: () => ({ data: null, isLoading: false, refetch: mockRefetches[7] }),
}));
jest.mock('./useAtomicSwaps', () => ({ useSwapOrdersMulti: () => ({ data: [], refetch: mockRefetches[6] }) }));
let client: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockTokens = [
    {
      uuid: 'fictional-token',
      symbol: 'SYN',
      name: 'Fictional shares',
      totalSupply: '100',
      lastPrice: '0.29',
    } as ShareToken,
  ];
  mockOrders = [{ ...submittedOrder({ status: 'open' }), tokenName: 'Retained old class' }];
  mockTokensError = false;
  mockWalletsError = false;
  mockPending = false;
  mockSaved = { orders: [], actions: [], settlements: [], ordersError: null };
  mockRefresh.mockClear();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});
it('renders retained order history with no current listed classes or trading wallets', async () => {
  mockTokens = [];
  mockWalletsError = true;
  const view = await render(<TradingScreen />, { wrapper });
  expect(view.getByText('Retained old class')).toBeTruthy();
  expect(view.getByText('Your orders')).toBeTruthy();
  expect(view.queryByText('New buy order — SYN')).toBeNull();
});
it.each(['failure', 'refresh'] as const)(
  'preserves an open draft and holds submission during class %s',
  async (mode) => {
    const view = await render(<TradingScreen />, { wrapper });
    await fireEvent.press(view.getByText('New buy order — SYN'));
    await fireEvent.changeText(view.getByLabelText('Quantity'), '3');
    mockTokensError = mode === 'failure';
    mockPending = mode === 'refresh';
    await view.rerender(<TradingScreen />);
    expect(view.getByLabelText('Quantity').props.value).toBe('3');
    await fireEvent.press(view.getByText('Buy'));
    expect(mockBegin).not.toHaveBeenCalled();
    mockTokensError = false;
    mockPending = false;
    await view.rerender(<TradingScreen />);
    await fireEvent.press(view.getByText('Buy'));
    expect(mockBegin).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, walletUuid: wallet.uuid }), wallet);
  },
);
it('uses the current order record in an already open details dialog', async () => {
  const view = await render(<TradingScreen />, { wrapper });
  await fireEvent.press(view.getByRole('button', { name: `Details for order ${mockOrders[0].uuid}` }));
  expect(view.getByText('Modify Order')).toBeTruthy();
  mockOrders = [{ ...mockOrders[0], status: 'cancelled' }];
  await view.rerender(<TradingScreen />);
  expect(view.queryByText('Modify Order')).toBeNull();
  mockOrders = [];
  await view.rerender(<TradingScreen />);
  expect(view.getByText('This order is unavailable. Refresh your orders to retry.')).toBeTruthy();
});
it('refreshes every independent trading read from pull to refresh', async () => {
  const view = await render(<TradingScreen />, { wrapper });
  const scroll = view.getByTestId('market-screen');
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
  for (const refetch of mockRefetches) expect(refetch).toHaveBeenCalledTimes(1);
});
it('leaves Saved work off the screen when nothing is saved on this device', async () => {
  const view = await render(<TradingScreen />, { wrapper });
  expect(view.getByText('Trades awaiting signatures')).toBeTruthy();
  expect(view.queryByText('Saved work')).toBeNull();
  expect(view.queryByRole('button', { name: 'Refresh saved work' })).toBeNull();
});
it('shows a failed saved read in Saved work with one refresh for every saved list', async () => {
  mockSaved.ordersError = 'Saved orders could not be read. Please try again.';
  const view = await render(<TradingScreen />, { wrapper });
  expect(view.getByText('Saved work')).toBeTruthy();
  expect(view.getByRole('alert').props.children).toBe('Saved orders could not be read. Please try again.');
  await fireEvent.press(view.getByRole('button', { name: 'Refresh saved work' }));
  expect(mockRefresh).toHaveBeenCalledTimes(3);
});
it('lists saved work after the trades awaiting signatures', async () => {
  mockSaved.orders = [{ submissionId: 'fictional-order', walletUuid: wallet.uuid }];
  mockSaved.actions = [{ actionId: 'fictional-action', purpose: 'cancel' }];
  mockSaved.settlements = [
    { swapUuid: 'fictional-swap', walletUuid: wallet.uuid, kind: 'approval', txHash: '0xfictional' },
  ];
  const view = await render(<TradingScreen />, { wrapper });
  expect(
    view
      .getAllByRole('header')
      .map((header) => header.props.children)
      .slice(-2),
  ).toEqual(['Trades awaiting signatures', 'Saved work']);
  expect(view.getByRole('button', { name: 'Check saved order 1' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Check cancellation 1' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Check saved settlement 1' })).toBeTruthy();
  expect(view.getByText('Unconfirmed approval: 0xfictional')).toBeTruthy();
});
