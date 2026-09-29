import { cleanup, render } from '@testing-library/react-native';
import { useTransfers } from '../../transfers/useTransfers';
import { SendFormScreen } from './SendFormScreen';

const mockNavigation = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../transfers/useTransfers', () => ({ useTransfers: jest.fn() }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
jest.mock('../../../components/qr', () => ({ QRScanner: () => null, QRDisplay: () => null }));
jest.mock('../../transfers/components/SendForm', () => ({ SendForm: () => null }));
jest.mock('../../../utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: jest.fn() }));
jest.mock('../../../utils/keystone/urDecoder', () => ({ decodeKeystoneSignature: jest.fn() }));

const wallet = {
  uuid: 'base-wallet',
  chain: 'base',
  address: `0x${'1'.repeat(40)}`,
  name: 'Savings',
  signingPreference: 'hardware',
};

function transfers(step: string) {
  jest.mocked(useTransfers).mockReturnValue({
    step,
    wallet: step === 'select-wallet' ? null : wallet,
    wallets: [],
    isLoading: false,
    transferableAssets: [],
    isPreparing: false,
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
}

afterEach(async () => {
  await cleanup();
});

it.each([
  ['select-wallet', 'Select your wallet'],
  ['enter-details', 'Send'],
])('titles the %s step once, on its card', async (step, title) => {
  transfers(step);
  const view = await render(<SendFormScreen onDone={jest.fn()} />);
  expect(view.getAllByText(title)).toHaveLength(1);
  expect(view.getByRole('header', { name: title })).toBeTruthy();
});
