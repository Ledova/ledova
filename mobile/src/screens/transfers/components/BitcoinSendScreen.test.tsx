import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { getAddressPlaceholder, type Wallet } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { BitcoinSendScreen } from './BitcoinSendScreen';

jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
jest.mock('../../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));

type Props = ComponentProps<typeof BitcoinSendScreen>;

const RECIPIENT = `tb1q${'4'.repeat(38)}`;
const NOTHING = 'This wallet has nothing to send.';
const BALANCES_FAILED = "This wallet's balances could not be loaded. Try again before continuing.";
const wallet = {
  uuid: 'cold-storage',
  chain: 'bitcoin',
  name: 'Cold storage',
  address: `tb1q${'3'.repeat(38)}`,
  nativeBalance: '0.5',
  nativeMarketValue: '100',
  verificationStatus: 'VERIFIED',
  signingPreference: 'hardware',
} as Wallet;
const prepared = {
  fromAddress: wallet.address,
  toAddress: RECIPIENT,
  amountBtc: '0.01',
  feeBtc: '0.000005',
  totalCostBtc: '0.010005',
  feePerByte: '2',
  estimatedTxSize: 250,
};

let client: QueryClient;
let settleHoldings: (() => void) | null;

function holdingsAnswer(deferred: boolean) {
  settleHoldings = null;
  jest.mocked(apiClient.get).mockImplementation((url: string) => {
    if (!url.includes('/holdings/'))
      return Promise.resolve({ data: { results: [], count: 0, next: null, previous: null } });
    if (!deferred) return Promise.resolve({ data: [] });
    return new Promise((resolve) => {
      settleHoldings = () => resolve({ data: [] });
    });
  });
}

function holdingsFail() {
  jest
    .mocked(apiClient.get)
    .mockImplementation((url: string) =>
      url.includes('/holdings/')
        ? Promise.reject(new Error('Network Error'))
        : Promise.resolve({ data: { results: [], count: 0, next: null, previous: null } }),
    );
}

const navigation = { goBack: jest.fn() } as unknown as Props['navigation'];

function screen(routeWallet: Wallet = wallet, chosen = false) {
  const route = { key: 'transfer', name: 'BitcoinSend', params: { wallet: routeWallet, chosen } } as Props['route'];
  return (
    <QueryClientProvider client={client}>
      <BitcoinSendScreen route={route} navigation={navigation} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  holdingsAnswer(false);
});

afterEach(async () => {
  await cleanup();
  await act(() => settleHoldings?.());
  settleHoldings = null;
  client.clear();
  onlineManager.setOnline(true);
});

async function typeTransfer(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.changeText(view.getByPlaceholderText(getAddressPlaceholder('BTC')), RECIPIENT);
  await fireEvent.changeText(view.getByPlaceholderText('0.0'), '0.01');
}

it('sends bitcoin through the review, the pasted signed transaction and the broadcast', async () => {
  const view = await render(screen());
  await view.findByText('Destination Address');
  await typeTransfer(view);
  jest.mocked(apiClient.post).mockResolvedValueOnce({ data: prepared });
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(await view.findByText('0.01 BTC')).toBeTruthy();
  expect(apiClient.post).toHaveBeenLastCalledWith(`/api/wallets/${wallet.uuid}/prepare-transfer/`, {
    toAddress: RECIPIENT,
    amountBtc: '0.01',
  });

  await fireEvent.press(view.getByRole('button', { name: 'Sign' }));
  await fireEvent.changeText(view.getByPlaceholderText('02000000...'), '0x0200AA');
  jest.mocked(apiClient.post).mockResolvedValueOnce({ data: { txHash: 'a'.repeat(64), status: 'pending' } });
  await fireEvent.press(view.getByRole('button', { name: 'Broadcast' }));
  expect(await view.findByText('Transaction Hash')).toBeTruthy();
  expect(apiClient.post).toHaveBeenLastCalledWith(
    `/api/wallets/${wallet.uuid}/broadcast-transfer/`,
    expect.objectContaining({
      signedTransaction: '0200aa',
      toAddress: RECIPIENT,
      amount: '0.01',
      transactionFee: '0.000005',
    }),
  );
});

it('returns from the review to an empty form for the same wallet, as Wallets > Send (SendFormScreen) does', async () => {
  const view = await render(screen());
  await view.findByText('Destination Address');
  await typeTransfer(view);
  jest.mocked(apiClient.post).mockResolvedValueOnce({ data: prepared });
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await view.findByText('0.01 BTC');
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(await view.findByText('Destination Address')).toBeTruthy();
  expect(view.getByText('Cold storage')).toBeTruthy();
  expect(view.getByPlaceholderText(getAddressPlaceholder('BTC')).props.value).toBe('');
  expect(view.getByPlaceholderText('0.0').props.value).toBe('');
});

it.each([
  ['Cancel', false],
  ['Back', true],
])(
  'refuses a wallet on another network, which only Bitcoin wallets should reach, and leaves with %s',
  async (label, chosen) => {
    const evm = { ...wallet, uuid: 'base-wallet', chain: 'base', address: `0x${'1'.repeat(40)}` } as Wallet;
    const view = await render(screen(evm, chosen));
    expect(view.getByText('This form sends Bitcoin only.')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: label }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(apiClient.get).not.toHaveBeenCalledWith(`/api/wallets/${evm.uuid}/holdings/`);
  },
);

describe('balances it cannot read', () => {
  it('says so instead of offering the fields, and offers them once Try again reads them', async () => {
    holdingsFail();
    const view = await render(screen());
    expect(await view.findByRole('alert')).toHaveTextContent(BALANCES_FAILED);
    expect(view.queryByText('Destination Address')).toBeNull();
    expect(view.queryByText(NOTHING)).toBeNull();
    expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();

    holdingsAnswer(true);
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    expect(await view.findByText('Loading assets...')).toBeTruthy();
    await act(async () => settleHoldings!());

    expect(await view.findByText('Destination Address')).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('keeps Continue unavailable after a failed refresh, holds Try again while it reads them again, and keeps what was typed', async () => {
    const view = await render(screen());
    await view.findByText('Destination Address');
    await typeTransfer(view);
    expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled();

    holdingsFail();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['wallet-holdings'] });
    });
    expect(await view.findByRole('alert')).toHaveTextContent(BALANCES_FAILED);
    expect(view.queryByText('Destination Address')).toBeNull();
    expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();

    holdingsAnswer(true);
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Try again' })).toBeDisabled());
    expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await act(async () => settleHoldings!());
    expect(await view.findByText('Destination Address')).toBeTruthy();
    expect(view.getByPlaceholderText(getAddressPlaceholder('BTC')).props.value).toBe(RECIPIENT);
    expect(view.getByPlaceholderText('0.0').props.value).toBe('0.01');
    expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

it('waits for the balances while offline, rather than saying the wallet has nothing to send', async () => {
  onlineManager.setOnline(false);
  const view = await render(screen());
  await act(async () => {});
  expect(view.getByText('Loading assets...')).toBeTruthy();
  expect(view.queryByText(NOTHING)).toBeNull();
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();

  await act(async () => onlineManager.setOnline(true));
  expect(await view.findByText('Destination Address')).toBeTruthy();
});

describe('a wallet with nothing to send', () => {
  const empty = { ...wallet, nativeBalance: '0', nativeMarketValue: '0' } as Wallet;

  it('says so once its holdings load on first open', async () => {
    holdingsAnswer(true);
    const view = await render(screen(empty));
    expect(await view.findByText('Loading assets...')).toBeTruthy();
    await act(async () => settleHoldings!());
    expect(await view.findByText(NOTHING)).toBeTruthy();
    expect(view.queryByText('Destination Address')).toBeNull();
    expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('says so at once when it is opened again after its holdings loaded', async () => {
    const first = await render(screen(empty));
    await first.findByText(NOTHING);
    await first.unmount();
    const again = await render(screen(empty));
    expect(await again.findByText(NOTHING)).toBeTruthy();
    expect(again.queryByText('Destination Address')).toBeNull();
    expect(again.queryByText('Loading assets...')).toBeNull();
  });

  it.each([
    ['on first open', true],
    ['when opened again', false],
  ])('offers the fields of a funded wallet %s', async (_, deferred) => {
    if (!deferred) {
      const first = await render(screen());
      await first.findByText('Destination Address');
      await first.unmount();
    }
    holdingsAnswer(deferred);
    const view = await render(screen());
    if (deferred) await act(async () => settleHoldings!());
    expect(await view.findByText('Destination Address')).toBeTruthy();
    expect(view.queryByText(NOTHING)).toBeNull();
  });
});

it('prepares the address the field shows, typed quickly while the screen settles and re-renders', async () => {
  holdingsAnswer(true);
  const view = await render(screen());
  await act(async () => settleHoldings!());
  await view.findByText('Destination Address');
  holdingsAnswer(false);
  const typeUpTo = async (from: number, to: number) => {
    await act(async () => {
      for (let length = from; length <= to; length += 1) {
        view.getByPlaceholderText(getAddressPlaceholder('BTC')).props.onChangeText(RECIPIENT.slice(0, length));
      }
    });
  };
  await typeUpTo(1, 2);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallet-holdings'] });
  });
  await typeUpTo(3, 20);
  await view.rerender(screen({ ...wallet }));
  await view.findByText('Destination Address');
  await typeUpTo(21, RECIPIENT.length);
  await view.rerender(screen({ ...wallet }));
  await view.findByText('Destination Address');
  await fireEvent.changeText(view.getByPlaceholderText('0.0'), '0.01');
  expect(view.getByPlaceholderText(getAddressPlaceholder('BTC')).props.value).toBe(RECIPIENT);
  jest.mocked(apiClient.post).mockResolvedValueOnce({ data: prepared });
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(apiClient.post).toHaveBeenLastCalledWith(`/api/wallets/${wallet.uuid}/prepare-transfer/`, {
      toAddress: RECIPIENT,
      amountBtc: '0.01',
    }),
  );
});
