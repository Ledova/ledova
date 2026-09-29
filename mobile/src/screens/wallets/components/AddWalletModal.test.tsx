import { cleanup, fireEvent, render } from '@testing-library/react-native';
import type { HardwareWalletImport } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { extractFromKeystoneQR } from '../../../utils/keystone/bcurDecoder';
import { AddWalletModal } from './AddWalletModal';

jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../../utils/keystone/bcurDecoder', () => ({ extractFromKeystoneQR: jest.fn() }));
jest.mock('../../../components/qr', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    AnimatedQRScanner: ({ onComplete }: { onComplete: (data: string) => void }) => (
      <Pressable onPress={() => onComplete('ur:crypto-account/synthetic')}>
        <Text>Scan synthetic account</Text>
      </Pressable>
    ),
  };
});

const address = '0x' + 'a'.repeat(40);
const data: HardwareWalletImport = {
  addresses: [{ address, networkType: 'ETH', addressIndex: 0, derivationPath: "m/44'/60'/0'/0/0" }],
  masterFingerprint: 'fingerprint',
  parentKeys: [{ parentPublicKey: 'public', parentChainCode: 'chain', parentDerivationPath: "m/44'/60'/0'/0" }],
};

beforeEach(() => {
  jest.mocked(apiClient.post).mockImplementation(async (_url, body) => ({
    data: {
      userAccount: (body as { userAccount: string }).userAccount,
      chain: (body as { chain: string }).chain,
      balances: {},
    },
  }));
  jest.mocked(extractFromKeystoneQR).mockReturnValue(data);
});
afterEach(async () => {
  await cleanup();
});

it('titles every step Add wallet and ends the account step with the selector row alone', async () => {
  const close = jest.fn();
  const view = await render(
    <AddWalletModal
      visible
      isLoading={false}
      readBlocked={false}
      notice={null}
      error={null}
      onRetry={jest.fn()}
      onClose={close}
      onSubmit={jest.fn()}
      onBatchSubmit={jest.fn()}
    />,
  );
  expect(view.getByRole('header', { name: 'Add wallet' })).toBeTruthy();
  await fireEvent.press(view.getByText('Hardware Wallet'));
  expect(view.getByRole('header', { name: 'Add wallet' })).toBeTruthy();
  const back = view.getByRole('button', { name: 'Back' });
  expect(back.parent!.children).toEqual([back, view.getByRole('button', { name: 'Add Wallet' })]);
  await fireEvent.press(view.getByText('Scan synthetic account'));
  const cancel = await view.findByRole('button', { name: 'Cancel' });
  expect(view.getByRole('header', { name: 'Add wallet' })).toBeTruthy();
  expect(cancel.parent!.children).toEqual([cancel, view.getByRole('button', { name: 'Import Wallet' })]);
  expect(view.queryByRole('button', { name: 'Close' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  expect(close).toHaveBeenCalledTimes(1);
});
