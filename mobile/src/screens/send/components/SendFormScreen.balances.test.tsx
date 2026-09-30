import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAddressPlaceholder, type Wallet } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { SendFormScreen } from './SendFormScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));
jest.mock('uuid', () => ({ v4: () => '70000000-0000-4000-8000-000000000001' }));

const BALANCES_FAILED = "This wallet's balances could not be loaded. Try again before continuing.";
const FORBIDDEN = 'You do not have permission to perform this action.';
const wallet = {
  uuid: 'wallet-base',
  name: 'Savings',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
  nativeBalance: '20',
  nativeMarketValue: '20',
  verificationStatus: 'VERIFIED',
  signingPreference: 'hardware',
} as Wallet;

let client: QueryClient;
let holdingsRead: () => Promise<unknown>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  holdingsRead = async () => ({ data: [] });
  jest
    .mocked(apiClient.get)
    .mockImplementation((url: string) =>
      url.includes('/holdings/')
        ? holdingsRead()
        : Promise.resolve({ data: { results: [wallet], count: 1, next: null, previous: null } }),
    );
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function show() {
  return render(
    <QueryClientProvider client={client}>
      <SendFormScreen onDone={jest.fn()} wallet={wallet} />
    </QueryClientProvider>,
  );
}

it("says the wallet's balances could not be loaded, in the server's words when it gives them, and reads them again", async () => {
  holdingsRead = () => Promise.reject({ response: { status: 403, data: { detail: FORBIDDEN } } });
  const view = await show();
  expect(await view.findByRole('alert')).toHaveTextContent(FORBIDDEN);
  expect(view.queryByText('Destination Address')).toBeNull();
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();

  holdingsRead = async () => ({ data: [] });
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));

  expect(await view.findByText('Destination Address')).toBeTruthy();
  expect(view.queryByRole('alert')).toBeNull();
});

it('keeps Continue unavailable after a failed refresh of the balances, holding Try again while it reads them again', async () => {
  const view = await show();
  await view.findByText('Destination Address');
  await fireEvent.changeText(view.getByPlaceholderText(getAddressPlaceholder('BASE')), `0x${'2'.repeat(40)}`);
  await fireEvent.changeText(view.getByPlaceholderText('0.0'), '1');
  expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled();

  holdingsRead = () => Promise.reject(new Error('Network Error'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallet-holdings'] });
  });
  expect(await view.findByRole('alert')).toHaveTextContent(BALANCES_FAILED);
  expect(view.queryByText('Destination Address')).toBeNull();
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();

  let settle!: () => void;
  holdingsRead = () =>
    new Promise((resolve) => {
      settle = () => resolve({ data: [] });
    });
  await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Try again' })).toBeDisabled());
  expect(view.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await act(async () => settle());

  expect(await view.findByText('Destination Address')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled();
});
