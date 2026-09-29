import { cleanup, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { WALLET_ENDPOINTS } from '@ledova/shared';
import { CameraAccessContext, createCameraAccess } from '../../../contexts/cameraAccess';
import { apiClient } from '../../../services/apiClient';
import { BuyCryptoModal } from './BuyCryptoModal';

jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  getUserVerificationStatus: () => ({ type: 'verified' }),
  useCurrency: () => ({ formatDisplayCurrency: String }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

const wallet = (uuid: string, name: string) => ({
  uuid,
  name,
  address: `0x${uuid.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'VERIFIED',
  nativeBalance: '1',
  marketValue: '1',
});
const get = apiClient.get as jest.Mock;
let client: QueryClient;

beforeEach(() => {
  AppState.currentState = 'active';
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url !== WALLET_ENDPOINTS.BASE) return { data: { results: [{}], count: 1, next: null, previous: null } };
    return (config?.params?.page ?? 1) === 1
      ? {
          data: {
            results: [wallet('1', 'First wallet')],
            count: 2,
            next: 'https://example.test/api/wallets/?page=2',
            previous: null,
          },
        }
      : { data: { results: [wallet('2', 'Second wallet')], count: 2, next: null, previous: null } };
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
});

function show() {
  const access = createCameraAccess();
  access.setAllowed(true);
  return render(
    <CameraAccessContext.Provider value={access}>
      <QueryClientProvider client={client}>
        <BuyCryptoModal
          visible
          initialAsset="ETH"
          userAccountUuid="synthetic-account"
          onClose={jest.fn()}
          onNavigateToProfile={jest.fn()}
          onNavigateToWebView={jest.fn()}
        />
      </QueryClientProvider>
    </CameraAccessContext.Provider>,
  );
}

it('offers every verified wallet on the chosen network when they fill more than one page, rather than buying into the first', async () => {
  const view = await show();

  expect(await view.findByText('Second wallet')).toBeTruthy();
  expect(view.getByText('First wallet')).toBeTruthy();
  expect(view.getByText('Choose a wallet to receive Ethereum')).toBeTruthy();
  expect(
    get.mock.calls.filter(([url]) => url === WALLET_ENDPOINTS.BASE).map(([, config]) => config.params.page),
  ).toEqual([1, 2]);
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('lists each wallet as a Wallets row reads, with its status, signing preference, balance and value labelled', async () => {
  get.mockImplementation(async (url: string) =>
    url === WALLET_ENDPOINTS.BASE
      ? {
          data: {
            results: [
              { ...wallet('1', 'First wallet'), signingPreference: 'software' },
              {
                ...wallet('2', 'Second wallet'),
                signingPreference: 'hardware',
                nativeBalance: '0.42',
                marketValue: '2',
              },
            ],
            count: 2,
            next: null,
            previous: null,
          },
        }
      : { data: { results: [{}], count: 1, next: null, previous: null } },
  );
  const view = await show();

  const second = await view.findByRole('button', { name: /Second wallet/ });
  expect(within(second).getByText('0.42 ETH').parent).toBe(within(second).getByText('Balance').parent);
  expect(within(second).getByText('2').parent).toBe(within(second).getByText('Estimated value').parent);
  expect(
    within(second)
      .getAllByRole('img')
      .map((image) => image.props.accessibilityLabel),
  ).toEqual(['Wallet address verified', 'Hardware (self-declared)']);
  expect(within(second).queryByText(wallet('2', '').address)).toBeNull();
  const first = view.getByRole('button', { name: /First wallet/ });
  expect(within(first).getByText('1 ETH').parent).toBe(within(first).getByText('Balance').parent);
  expect(within(first).getByRole('img', { name: 'Software (self-declared)' })).toBeTruthy();
});
