import { cleanup, render } from '@testing-library/react-native';
import { Interface } from 'ethers';
import type { TransactionData } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { useTransfers } from '../../transfers/useTransfers';
import { encodeEthereumTransaction } from '../../../utils/keystone/urEncoder';
import { preparedTransferTransaction } from '../../../utils/preparedTransfer';
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

function signing(transactionData: TransactionData) {
  jest.mocked(useTransfers).mockReturnValue({
    step: 'sign',
    wallet: { ...wallet, derivationPath: "m/44'/60'/0'/0/0", masterFingerprint: '12345678' },
    wallets: [],
    isLoading: false,
    transferableAssets: [],
    isPreparing: false,
    transactionData,
    selectedAsset: { isNative: false, decimals: 2, contractAddress: fixture.token.tokenContract },
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
}

it('hands the reviewed token transfer to the hardware encoder', async () => {
  signing(fixture.token);
  await render(<SendFormScreen onDone={jest.fn()} />);
  expect(encodeEthereumTransaction).toHaveBeenCalledWith(
    wallet.address,
    preparedTransferTransaction(fixture.token.transaction),
    "m/44'/60'/0'/0/0",
    '12345678',
  );
});

it('shows why it refuses a token transfer that differs from the review, and never builds its code', async () => {
  const stranger = `0x${'5'.repeat(40)}`;
  const data = new Interface(['function transfer(address to, uint256 amount)']).encodeFunctionData('transfer', [
    stranger,
    999999n,
  ]);
  signing({ ...fixture.token, transaction: { ...fixture.token.transaction, data } });
  const view = await render(<SendFormScreen onDone={jest.fn()} />);
  expect(view.getByText('This transaction does not match your review: the recipient is different.')).toBeTruthy();
  expect(encodeEthereumTransaction).not.toHaveBeenCalled();
});
