import { cleanup, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

it('offers every verified wallet to send from when they fill more than one page', async () => {
  const view = await render(
    <QueryClientProvider client={client}>
      <SendFormScreen onDone={jest.fn()} />
    </QueryClientProvider>,
  );

  expect(await view.findByText('Second wallet')).toBeTruthy();
  expect(view.getByText('First wallet')).toBeTruthy();
  expect(view.queryByText('Unverified wallet')).toBeNull();
  expect(get.mock.calls.map(([, config]) => config.params)).toEqual([{ page: 1 }, { page: 2 }]);
});
