import { cleanup, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatWalletAddressShort } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { SendFormScreen } from './SendFormScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
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
  get.mockImplementation(async (_url: string, config?: { params?: { page?: number } }) =>
    (config?.params?.page ?? 1) === 1
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
});

function show() {
  return render(
    <QueryClientProvider client={client}>
      <SendFormScreen onDone={jest.fn()} />
    </QueryClientProvider>,
  );
}

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
