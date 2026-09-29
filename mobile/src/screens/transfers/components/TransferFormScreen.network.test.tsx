import type { ComponentProps } from 'react';
import { act, render } from '@testing-library/react-native';
import type { TransactionData } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { TransferFormScreen } from './TransferFormScreen';
import { useTransfers } from '../useTransfers';
import { encodeEthereumTransaction } from '../../../utils/keystone/urEncoder';
import { decodeKeystoneSignature } from '../../../utils/keystone/urDecoder';
import { preparedTransferTransaction } from '../../../utils/preparedTransfer';

jest.mock('../useTransfers', () => ({ useTransfers: jest.fn() }));
jest.mock('../../../utils/keystone/urEncoder', () => ({
  encodeEthereumTransaction: jest.fn(() => ({ urString: 'ur:base-transaction' })),
}));
jest.mock('../../../utils/keystone/urDecoder', () => ({ decodeKeystoneSignature: jest.fn() }));
jest.mock('../../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => children,
}));
const mockScanners: { title: string; onScan: (data: string) => void }[] = [];
jest.mock('../../../components/qr', () => ({
  QRScanner: (props: { title: string; onScan: (data: string) => void }) => {
    mockScanners.push(props);
    return null;
  },
  QRDisplay: () => null,
}));
jest.mock('./SoftwareSignTransaction', () => ({ SoftwareSignTransaction: () => null }));
jest.mock('./SignTransaction', () => ({
  SignTransaction: ({
    urEncodedTransaction,
    error,
  }: {
    urEncodedTransaction: string | null;
    error?: string | null;
  }) => {
    const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return <Text>{error || urEncodedTransaction || 'No QR'}</Text>;
  },
}));

const wallet = {
  uuid: 'base-wallet',
  chain: 'base',
  address: `0x${'1'.repeat(40)}`,
  derivationPath: "m/44'/60'/0'/0/0",
  masterFingerprint: '12345678',
};
const base = { ...fixture.native, transaction: { ...fixture.native.transaction, chainId: 84532 } };

async function signing(transactionData: TransactionData) {
  jest.mocked(useTransfers).mockReturnValue({
    wallet,
    step: 'sign',
    transactionData,
    selectedAsset: { isNative: true, decimals: 18 },
    selectWallet: jest.fn(),
    reset: jest.fn(),
  } as unknown as ReturnType<typeof useTransfers>);
  const route = { key: 'transfer', name: 'TransferDetails', params: { wallet } } as ComponentProps<
    typeof TransferFormScreen
  >['route'];
  const navigation = { goBack: jest.fn() } as unknown as ComponentProps<typeof TransferFormScreen>['navigation'];
  return render(<TransferFormScreen route={route} navigation={navigation} />);
}

it('passes the reviewed Base transaction and wallet derivation data to the hardware encoder', async () => {
  const view = await signing(base);
  expect(view.getByText('ur:base-transaction')).toBeTruthy();
  expect(view.getAllByText('Send')).toHaveLength(1);
  expect(view.getByRole('header', { name: 'Send' })).toBeTruthy();
  expect(encodeEthereumTransaction).toHaveBeenCalledWith(
    wallet.address,
    preparedTransferTransaction(base.transaction),
    wallet.derivationPath,
    wallet.masterFingerprint,
  );
});

it('shows why it refuses a transaction that differs from the review, and never builds its code', async () => {
  const view = await signing({ ...base, transaction: { ...base.transaction, value: '500000000000000000' } });
  expect(view.getByText('This transaction does not match your review: the amount is different.')).toBeTruthy();
  expect(encodeEthereumTransaction).not.toHaveBeenCalled();
});

it('shows why it refuses a scanned signature, which it checks against the wallet address', async () => {
  jest.mocked(decodeKeystoneSignature).mockImplementation(() => {
    throw new Error('The scanned signature is not from this wallet.');
  });
  const view = await signing(base);
  const scanner = mockScanners.filter(({ title }) => title === 'Scan Signed Transaction').at(-1)!;
  await act(async () => scanner.onScan('ur:eth-signature/synthetic'));
  expect(view.getByText('The scanned signature is not from this wallet.')).toBeTruthy();
  expect(decodeKeystoneSignature).toHaveBeenCalledWith(
    'ur:eth-signature/synthetic',
    preparedTransferTransaction(base.transaction),
    wallet.address,
  );
});
