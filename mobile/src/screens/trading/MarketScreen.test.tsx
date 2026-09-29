import type { PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ShareToken, TransferOrder } from '@ledova/shared';
import { TradingScreen } from './index';
import { submittedOrder, wallet } from '../../../../packages/shared/tests/fixtures/order-submissions';

const mockBegin = jest.fn(async () => false);
const mockClose = jest.fn();
const mockRefreshOrders = jest.fn(async () => undefined);
const mockRefreshActions = jest.fn(async () => undefined);
const mockRefreshSettlements = jest.fn(async () => undefined);
const mockRefetches = Array.from({ length: 8 }, () => jest.fn(async () => undefined));
let mockTokens: ShareToken[];
let mockOrders: TransferOrder[];
let mockTokensError = false;
let mockWalletsError = false;
let mockPending = false;
let mockSaved: Record<'orders' | 'actions' | 'settlements', { pending: object[]; error: string | null }>;
jest.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../../services/swapSettlements', () => ({
  settlementWalletMaterial: (value: unknown) => JSON.stringify(value),
}));
jest.mock('./hooks/useTradingEvents', () => ({ useTradingEvents: () => {} }));
jest.mock('./components/OrderSigningModal', () => ({ OrderSigningModal: () => null }));
jest.mock('./components/OrderActionModal', () => ({ OrderActionModal: () => null }));
jest.mock('./components/SwapSettlementModal', () => ({ SwapSettlementModal: () => null }));
jest.mock('./components/OrdersCard', () => {
  const { OrdersCard } = jest.requireActual<typeof import('./components/OrdersCard')>('./components/OrdersCard');
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  const { settlementListRow } = jest.requireActual<
    typeof import('../../../../packages/shared/tests/fixtures/swap-settlements')
  >('../../../../packages/shared/tests/fixtures/swap-settlements');
  return {
    OrdersCard: (props: Parameters<typeof OrdersCard>[0]) => (
      <>
        <OrdersCard {...props} />
        <Pressable accessibilityRole="button" onPress={() => props.onSignSwap(settlementListRow())}>
          <Text>Sign a listed trade</Text>
        </Pressable>
      </>
    ),
  };
});
jest.mock('@ledova/shared', () => {
  const actual = jest.requireActual('@ledova/shared');
  const state = (list: { pending: object[]; error: string | null }, refresh: () => Promise<undefined>) => ({
    pending: list.pending,
    active: null,
    error: list.error,
    isLoading: false,
    close: mockClose,
    refresh,
  });
  return {
    ...actual,
    useOrderSubmissions: () => ({ ...state(mockSaved.orders, mockRefreshOrders), begin: mockBegin }),
    useOrderActions: () => state(mockSaved.actions, mockRefreshActions),
    useSwapSettlements: () => state(mockSaved.settlements, mockRefreshSettlements),
    useShareTokens: () => ({
      data: mockTokens,
      isLoading: false,
      isFetching: mockPending,
      isError: mockTokensError,
      error: mockTokensError ? new Error('fictional') : null,
      refetch: mockRefetches[0],
    }),
    useInvestorEligibilityQuery: () => ({ data: { isEligible: true }, refetch: mockRefetches[1] }),
    useOrderBook: () => ({ data: null, isLoading: false, refetch: mockRefetches[7] }),
    useSwapOrdersMulti: () => ({ data: [], refetch: mockRefetches[6] }),
  };
});
jest.mock('./useTrading', () => ({
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
}));
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
  mockSaved = {
    orders: { pending: [], error: null },
    actions: { pending: [], error: null },
    settlements: { pending: [], error: null },
  };
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
it('refreshes every independent trading read and every saved list from pull to refresh', async () => {
  const view = await render(<TradingScreen />, { wrapper });
  const scroll = view.getByTestId('market-screen');
  await act(async () => {
    await scroll.props.refreshControl.props.onRefresh();
  });
  for (const refetch of [...mockRefetches, mockRefreshOrders, mockRefreshActions, mockRefreshSettlements])
    expect(refetch).toHaveBeenCalledTimes(1);
});
it('leaves Saved work off the screen when nothing is saved on this device', async () => {
  const view = await render(<TradingScreen />, { wrapper });
  expect(view.getByText('Trades awaiting signatures')).toBeTruthy();
  expect(view.queryByText('Saved work')).toBeNull();
  expect(view.queryByRole('button', { name: 'Refresh saved work' })).toBeNull();
});
it.each([
  ['orders', 'Saved orders could not be read. Please try again.'],
  ['actions', 'Saved cancellations and changes could not be read. Please try again.'],
  ['settlements', 'Saved settlements could not be read. Please try again.'],
] as const)('shows Saved work when the saved %s cannot be read', async (list, message) => {
  mockSaved[list].error = message;
  const view = await render(<TradingScreen />, { wrapper });
  expect(view.getByText('Saved work')).toBeTruthy();
  expect(view.getByRole('alert').props.children).toBe(message);
});
it('shows Saved work when a listed trade cannot be opened for signing', async () => {
  const view = await render(<TradingScreen />, { wrapper });
  expect(view.queryByText('Saved work')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Sign a listed trade' }));
  expect(view.getByText('Saved work')).toBeTruthy();
  expect(view.getByRole('alert').props.children).toBe(
    'This settlement cannot be opened with the current account and wallet.',
  );
});
it('reads each saved list once more from Refresh saved work', async () => {
  mockSaved.orders.pending = [{ submissionId: 'fictional-order', walletUuid: wallet.uuid }];
  const view = await render(<TradingScreen />, { wrapper });
  await fireEvent.press(view.getByRole('button', { name: 'Refresh saved work' }));
  for (const refresh of [mockRefreshOrders, mockRefreshActions, mockRefreshSettlements])
    expect(refresh).toHaveBeenCalledTimes(1);
});
it('lists saved work after the trades awaiting signatures', async () => {
  mockSaved.orders.pending = [{ submissionId: 'fictional-order', walletUuid: wallet.uuid }];
  mockSaved.actions.pending = [{ actionId: 'fictional-action', purpose: 'cancel' }];
  mockSaved.settlements.pending = [
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
