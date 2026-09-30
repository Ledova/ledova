import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAddressPlaceholder, type Wallet } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { TransferFormScreen } from './TransferFormScreen';

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

type Props = ComponentProps<typeof TransferFormScreen>;

const RECIPIENT = `tb1q${'4'.repeat(38)}`;
const NOTHING = 'This wallet has nothing to send.';
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

function screen(chosen: Wallet = wallet) {
  const route = { key: 'transfer', name: 'TransferDetails', params: { wallet: chosen } } as Props['route'];
  const navigation = { goBack: jest.fn() } as unknown as Props['navigation'];
  return (
    <QueryClientProvider client={client}>
      <TransferFormScreen route={route} navigation={navigation} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  holdingsAnswer(false);
});

afterEach(async () => {
  await cleanup();
  client.clear();
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

it('returns from the review to the form for the same wallet', async () => {
  const view = await render(screen());
  await view.findByText('Destination Address');
  await typeTransfer(view);
  jest.mocked(apiClient.post).mockResolvedValueOnce({ data: prepared });
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  await view.findByText('0.01 BTC');
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));
  expect(await view.findByText('Destination Address')).toBeTruthy();
  expect(view.getByText('Cold storage')).toBeTruthy();
});

it('refuses a wallet on another network, which only Bitcoin wallets should reach', async () => {
  const evm = { ...wallet, uuid: 'base-wallet', chain: 'base', address: `0x${'1'.repeat(40)}` } as Wallet;
  const view = await render(screen(evm));
  expect(view.getByText('This form sends Bitcoin only.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  expect(apiClient.get).not.toHaveBeenCalledWith(`/api/wallets/${evm.uuid}/holdings/`);
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
