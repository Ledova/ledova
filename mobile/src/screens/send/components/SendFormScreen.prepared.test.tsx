import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getAddressPlaceholder, type Wallet } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { apiClient } from '../../../services/apiClient';
import { SendFormScreen } from './SendFormScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
jest.mock('../../../_mock/mockDataEnabled', () => ({ mockDataEnabled: () => false }));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));
jest.mock('uuid', () => ({ v4: () => '70000000-0000-4000-8000-000000000001' }));

const wallet = {
  uuid: 'wallet-base',
  name: 'Savings',
  address: fixture.signer.address,
  chain: 'base',
  nativeBalance: '20',
  nativeMarketValue: '20',
  verificationStatus: 'VERIFIED',
  signingPreference: 'hardware',
  derivationPath: fixture.signer.derivationPath,
  masterFingerprint: '12345678',
} as Wallet;

let client: QueryClient;
let holdings: object[];

function tokenHolding(quantity: string) {
  return {
    uuid: 'token-holding',
    walletUuid: wallet.uuid,
    chain: 'base',
    quantity,
    assetSymbol: fixture.token.tokenSymbol,
    assetName: 'Repro token',
    marketValue: quantity,
    asset: {
      isActive: true,
      assetType: 'erc20_token',
      decimals: 2,
      contractAddress: fixture.token.tokenContract,
      chainDeployments: [{ chain: 'base', contractAddress: fixture.token.tokenContract, decimals: 2, isActive: true }],
    },
  };
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  holdings = [tokenHolding('1000')];
  (apiClient.get as jest.Mock).mockImplementation(async (url: string) => ({
    data: url.includes('/holdings/') ? holdings : { results: [wallet], count: 1, next: null, previous: null },
  }));
  (apiClient.post as jest.Mock).mockResolvedValue({ data: fixture.token });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it("keeps reviewing a prepared token in its own symbol after the holdings change the form's asset", async () => {
  const view = await render(
    <QueryClientProvider client={client}>
      <SendFormScreen onDone={jest.fn()} wallet={wallet} />
    </QueryClientProvider>,
  );
  await fireEvent.press(await view.findByText(fixture.token.tokenSymbol));
  await fireEvent.changeText(view.getByPlaceholderText(getAddressPlaceholder('BASE')), fixture.native.toAddress);
  await fireEvent.changeText(view.getByPlaceholderText('0.0'), '1.5');
  await fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(await view.findByText(`1.5 ${fixture.token.tokenSymbol}`)).toBeTruthy();

  holdings = [tokenHolding('999')];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['wallet-holdings'] });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(apiClient.get).toHaveBeenLastCalledWith(`/api/wallets/${wallet.uuid}/holdings/`);
  expect(view.getByText(`1.5 ${fixture.token.tokenSymbol}`)).toBeTruthy();
  expect(view.queryByText('1.5 ETH')).toBeNull();
});
