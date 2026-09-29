import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { formatWalletAddressShort, type Wallet } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { SendFormScreen } from './SendFormScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../../_mock/mockDataEnabled', () => ({ mockDataEnabled: () => false }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));
jest.mock('../../transfers/components/SendForm', () => ({ SendForm: () => null }));
jest.mock('../../../utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: jest.fn() }));
jest.mock('../../../utils/keystone/urDecoder', () => ({ decodeKeystoneSignature: jest.fn() }));

const wallet = (uuid: string, name: string, verificationStatus = 'VERIFIED') => ({
  uuid,
  name,
  address: `0x${uuid.repeat(40)}`,
  chain: 'base',
  verificationStatus,
  nativeBalance: '1',
  marketValue: '1',
});
const get = apiClient.get as jest.Mock;
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) =>
    url.endsWith('/holdings/')
      ? { data: [] }
      : (config?.params?.page ?? 1) === 1
        ? {
            data: {
              results: [wallet('1', 'First wallet'), wallet('3', 'Unverified wallet', 'PENDING')],
              count: 3,
              next: 'https://example.test/api/wallets/?page=2',
              previous: null,
            },
          }
        : { data: { results: [wallet('2', 'Second wallet')], count: 3, next: null, previous: null } },
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

function show({ onDone = jest.fn(), only }: { onDone?: () => void; only?: ReturnType<typeof wallet> } = {}) {
  return render(
    <QueryClientProvider client={client}>
      <SendFormScreen onDone={onDone} wallet={only as Wallet | undefined} />
    </QueryClientProvider>,
  );
}

const LOAD_FAILED = 'Your wallets could not be loaded. Try again before continuing.';

it('offers every verified wallet to send from when they fill more than one page', async () => {
  const view = await show();

  expect(await view.findByText('Second wallet')).toBeTruthy();
  expect(view.getByText('First wallet')).toBeTruthy();
  expect(view.queryByText('Unverified wallet')).toBeNull();
  expect(get.mock.calls.map(([, config]) => config.params)).toEqual([{ page: 1 }, { page: 2 }]);
});

it('lists each wallet as a Wallets row reads, by its name or short address, with its figures labelled', async () => {
  const savings = {
    ...wallet('1', 'Savings'),
    signingPreference: 'hardware',
    lastSyncedAt: new Date().toISOString(),
    nativeBalance: '0.420000000000000000',
    marketValue: '12.5',
  };
  const unnamed = { ...wallet('2', ''), chain: 'bitcoin', address: `tb1q${'2'.repeat(38)}`, nativeBalance: '0.001' };
  get.mockResolvedValue({ data: { results: [savings, unnamed], count: 2, next: null, previous: null } });
  const view = await show();

  const choice = await view.findByRole('button', { name: /Savings/ });
  expect(within(choice).getByText('0.42 ETH').parent).toBe(within(choice).getByText('Balance').parent);
  expect(within(choice).getByText('AUD 12.5').parent).toBe(within(choice).getByText('Estimated value').parent);
  expect(
    within(choice)
      .getAllByRole('img')
      .map((image) => image.props.accessibilityLabel),
  ).toEqual(['Wallet address verified', 'Hardware (self-declared)']);
  expect(within(choice).getByText('just now')).toBeTruthy();
  expect(within(choice).queryByText(savings.address)).toBeNull();
  const short = within(
    view.getByRole('button', { name: new RegExp(formatWalletAddressShort(unnamed.address).replace(/\./g, '\\.')) }),
  );
  expect(short.getByText('0.001 BTC').parent).toBe(short.getByText('Balance').parent);
  expect(view.queryByText(unnamed.address)).toBeNull();
});

it('opens the form for the one wallet Wallets found, with Cancel where Back would lead to a choice never made', async () => {
  const done = jest.fn();
  const view = await show({ onDone: done, only: wallet('1', 'First wallet') });

  expect(view.getByRole('header', { name: 'Send' })).toBeTruthy();
  expect(view.queryByRole('header', { name: 'Select your wallet' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Back' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(done).toHaveBeenCalledTimes(1);
});

it('goes Back to the choice after a wallet was chosen from it', async () => {
  const done = jest.fn();
  const view = await show({ onDone: done });

  await fireEvent.press(await view.findByRole('button', { name: /Second wallet/ }));
  expect(view.getByRole('header', { name: 'Send' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Cancel' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Back' }));

  expect(await view.findByRole('header', { name: 'Select your wallet' })).toBeTruthy();
  expect(done).not.toHaveBeenCalled();
});

it('says the wallets could not be loaded when the read fails, rather than that there are none, and tries again', async () => {
  get.mockRejectedValueOnce(new Error('Request failed with status code 500'));
  const view = await show();

  expect(await view.findByRole('alert')).toHaveTextContent(LOAD_FAILED);
  expect(view.queryByText('No verified wallets found')).toBeNull();
  expect(view.queryByText(/status code 500/)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));

  expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
});

it('hides the wallets it listed when a refresh fails, and holds Try again while it reads them again', async () => {
  const view = await show();
  await view.findByRole('button', { name: /Second wallet/ });
  get.mockRejectedValueOnce(new Error('Request failed with status code 500'));

  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallets'] });
  });

  expect(await view.findByRole('alert')).toHaveTextContent(LOAD_FAILED);
  expect(view.queryByRole('button', { name: /Second wallet/ })).toBeNull();
  const read = get.getMockImplementation()!;
  let settle!: () => void;
  get.mockImplementationOnce(
    (url: string, config?: { params?: { page?: number } }) =>
      new Promise((resolve) => {
        settle = () => resolve(read(url, config));
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Try again' })).toBeDisabled());
  await act(async () => settle());

  expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
});

it('waits for its first read while offline, rather than saying there are no wallets', async () => {
  onlineManager.setOnline(false);
  const view = await show();
  await act(async () => {});

  expect(view.getByText('Loading wallets...')).toBeTruthy();
  expect(view.queryByText('No verified wallets found')).toBeNull();
  expect(get).not.toHaveBeenCalled();
  await act(async () => onlineManager.setOnline(true));

  expect(await view.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
});

it('lists verified wallets under Ethereum, Bitcoin and Base in that order, and none on a network Wallets does not list', async () => {
  get.mockResolvedValue({
    data: {
      results: [
        wallet('1', 'Base wallet'),
        { ...wallet('2', 'Polygon wallet'), chain: 'polygon' },
        { ...wallet('3', 'Cold storage'), chain: 'bitcoin', address: `tb1q${'3'.repeat(38)}` },
        { ...wallet('4', 'Savings'), chain: 'ethereum' },
      ],
      count: 4,
      next: null,
      previous: null,
    },
  });
  const view = await show();

  await view.findByRole('button', { name: /Savings/ });
  expect(view.getAllByText(/^(Ethereum|Bitcoin|Base|Polygon)$/).map((network) => network.props.children)).toEqual([
    'Ethereum',
    'Bitcoin',
    'Base',
  ]);
  expect(view.queryByText('Polygon wallet')).toBeNull();
});

it('says there are none when the only verified wallet is on a network Wallets does not list', async () => {
  get.mockResolvedValue({
    data: { results: [{ ...wallet('2', 'Polygon wallet'), chain: 'polygon' }], count: 1, next: null, previous: null },
  });
  const view = await show();

  expect(await view.findByText('No verified wallets found')).toBeTruthy();
  expect(view.queryByText('Polygon wallet')).toBeNull();
});
