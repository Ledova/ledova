import { act, cleanup, render } from '@testing-library/react-native';
import { Interface } from 'ethers';
import type { TransactionData } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { useTransfers } from '../../transfers/useTransfers';
import { encodeEthereumTransaction } from '../../../utils/keystone/urEncoder';
import { decodeKeystoneSignature } from '../../../utils/keystone/urDecoder';
import { preparedTransferTransaction } from '../../../utils/preparedTransfer';
import { SendFormScreen } from './SendFormScreen';

const mockNavigation = { navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../transfers/useTransfers', () => ({ useTransfers: jest.fn() }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
const mockScanners: { title: string; onScan: (data: string) => void }[] = [];
jest.mock('../../../components/qr', () => ({
  QRScanner: (props: { title: string; onScan: (data: string) => void }) => {
    mockScanners.push(props);
    return null;
  },
  QRDisplay: () => null,
}));
jest.mock('../../transfers/components/SendForm', () => ({ SendForm: () => null }));
const mockSoftware: { asset?: object }[] = [];
jest.mock('../../transfers/components/SoftwareSignTransaction', () => ({
  SoftwareSignTransaction: (props: { asset?: object }) => {
    mockSoftware.push(props);
    return null;
  },
}));
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

const TOKEN = { isNative: false, decimals: 2, symbol: 'AUDY', contractAddress: fixture.token.tokenContract };
const NATIVE = { isNative: true, decimals: 18, symbol: 'ETH' };

function signing(transactionData: TransactionData, signingPreference = 'hardware') {
  showing('sign', transactionData, signingPreference, TOKEN);
}

function showing(
  step: string,
  transactionData: TransactionData,
  signingPreference: string,
  preparedAsset: object,
  selectedAsset: object = preparedAsset,
) {
  jest.mocked(useTransfers).mockReturnValue({
    step,
    wallet: { ...wallet, signingPreference, derivationPath: "m/44'/60'/0'/0/0", masterFingerprint: '12345678' },
    wallets: [],
    isLoading: false,
    transferableAssets: [],
    isPreparing: false,
    transactionData,
    preparedAsset,
    selectedAsset,
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
}

it('hands the hardware encoder the token transfer checked in the decimals of the asset it was prepared for', async () => {
  signing({ ...fixture.token, tokenDecimals: 6 });
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

it('shows why it refuses a scanned token-transfer signature, checked against the wallet address', async () => {
  jest.mocked(encodeEthereumTransaction).mockReturnValue({ urString: 'ur:eth-sign-request/synthetic' } as never);
  jest.mocked(decodeKeystoneSignature).mockImplementation(() => {
    throw new Error('The scanned signature is not for this network.');
  });
  signing(fixture.token);
  const view = await render(<SendFormScreen onDone={jest.fn()} />);
  const scanner = mockScanners.filter(({ title }) => title === 'Scan Signed Transaction').at(-1)!;
  await act(async () => scanner.onScan('ur:eth-signature/synthetic'));
  expect(view.getByText('The scanned signature is not for this network.')).toBeTruthy();
  expect(decodeKeystoneSignature).toHaveBeenCalledWith(
    'ur:eth-signature/synthetic',
    preparedTransferTransaction(fixture.token.transaction),
    wallet.address,
  );
});

it('hands the software signer the asset the transfer was prepared for, not the response', async () => {
  signing({ ...fixture.token, tokenDecimals: 6 }, 'software');
  await render(<SendFormScreen onDone={jest.fn()} />);
  expect(mockSoftware.at(-1)?.asset).toBe(TOKEN);
});

it.each([
  ['token', fixture.token, TOKEN, '1.5 AUDY'],
  ['native', fixture.native, NATIVE, '0.1 ETH'],
])('reviews a %s amount in the symbol of the asset it was prepared for', async (_, transactionData, asset, shown) => {
  showing('review', transactionData as TransactionData, 'hardware', asset);
  const view = await render(<SendFormScreen onDone={jest.fn()} />);
  expect(view.getByText(shown)).toBeTruthy();
  expect(view.queryByText(/R779/)).toBeNull();
});

it('keeps reviewing, encoding and signing the prepared token after the holdings reset the chosen asset to ETH', async () => {
  showing('review', fixture.token, 'hardware', TOKEN, NATIVE);
  const view = await render(<SendFormScreen onDone={jest.fn()} />);
  expect(view.getByText('1.5 AUDY')).toBeTruthy();
  expect(view.queryByText('1.5 ETH')).toBeNull();
  jest.mocked(encodeEthereumTransaction).mockClear();
  showing('sign', fixture.token, 'hardware', TOKEN, NATIVE);
  await render(<SendFormScreen onDone={jest.fn()} />);
  expect(encodeEthereumTransaction).toHaveBeenCalledWith(
    wallet.address,
    preparedTransferTransaction(fixture.token.transaction),
    "m/44'/60'/0'/0/0",
    '12345678',
  );
  showing('sign', fixture.token, 'software', TOKEN, NATIVE);
  await render(<SendFormScreen onDone={jest.fn()} />);
  expect(mockSoftware.at(-1)?.asset).toBe(TOKEN);
});

it('shows why it refuses a token transfer prepared for another asset, and never builds its code', async () => {
  showing('sign', fixture.token, 'hardware', { ...TOKEN, contractAddress: `0x${'5'.repeat(40)}` });
  const view = await render(<SendFormScreen onDone={jest.fn()} />);
  expect(
    view.getByText('This transaction does not match your review: it calls a different token contract.'),
  ).toBeTruthy();
  expect(encodeEthereumTransaction).not.toHaveBeenCalled();
});
