import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import type { HardwareWalletImport } from '@ledova/shared';
import { CustomModal } from '../../../components/modal';
import { apiClient } from '../../../services/apiClient';
import { extractFromKeystoneQR } from '../../../utils/keystone/bcurDecoder';
import { AddWalletModal } from './AddWalletModal';

const mockDialogLifecycle: string[] = [];
jest.mock('../../../components/modal', () => {
  const { useEffect } = jest.requireActual('react');
  const { Pressable, Text, View } = jest.requireActual('react-native');
  function MockDialogContent({ children }: { children: React.ReactNode }) {
    useEffect(() => {
      mockDialogLifecycle.push('content mounted');
      return () => {
        mockDialogLifecycle.push('content unmounted');
      };
    }, []);
    return <View>{children}</View>;
  }
  function MockCustomModal({
    visible,
    contentKey,
    children,
    onClose,
    showFooter,
    cancelLabel = 'Cancel',
    onCancel,
    confirmLabel,
    onConfirm,
  }: {
    visible: boolean;
    contentKey?: React.Key;
    children: React.ReactNode;
    onClose: () => void;
    showFooter?: boolean;
    cancelLabel?: string;
    onCancel?: () => void;
    confirmLabel?: string;
    onConfirm?: () => void;
  }) {
    useEffect(() => {
      mockDialogLifecycle.push('modal mounted');
      return () => {
        mockDialogLifecycle.push('modal unmounted');
      };
    }, []);
    return visible ? (
      <View>
        <MockDialogContent key={contentKey}>{children}</MockDialogContent>
        {showFooter && (
          <Pressable onPress={onCancel ?? onClose}>
            <Text>{cancelLabel}</Text>
          </Pressable>
        )}
        {showFooter && onConfirm && (
          <Pressable onPress={onConfirm}>
            <Text>{confirmLabel}</Text>
          </Pressable>
        )}
      </View>
    ) : null;
  }
  return { CustomModal: jest.fn(MockCustomModal) };
});
jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../../utils/keystone/bcurDecoder', () => ({ extractFromKeystoneQR: jest.fn() }));
jest.mock('../../../services/secureKeyStorage', () => ({
  generateMnemonic: () => Array(12).fill('fictional').join(' '),
  validateMnemonic: () => true,
  computeSeedIdentifier: () => 'fictional-identifier',
  storeSeedPhrase: jest.fn(),
}));
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
const account: HardwareWalletImport = {
  addresses: [{ address, networkType: 'ETH', addressIndex: 0, derivationPath: "m/44'/60'/0'/0/0" }],
  masterFingerprint: 'fingerprint',
  parentKeys: [{ parentPublicKey: 'public', parentChainCode: 'chain', parentDerivationPath: "m/44'/60'/0'/0" }],
};
const count = (event: string) => mockDialogLifecycle.filter((entry) => entry === event).length;

beforeEach(() => {
  mockDialogLifecycle.length = 0;
  jest.mocked(apiClient.post).mockImplementation(async (_url, body) => ({
    data: { userAccount: (body as { userAccount: string }).userAccount, chain: 'ethereum', balances: {} },
  }));
  jest.mocked(extractFromKeystoneQR).mockReturnValue(account);
});
afterEach(async () => {
  await cleanup();
});

it('keeps one mounted dialog while every step replaces its content', async () => {
  const view = await render(
    <AddWalletModal
      visible
      isLoading={false}
      readBlocked={false}
      notice={null}
      error={null}
      onRetry={jest.fn()}
      onClose={jest.fn()}
      onSubmit={jest.fn()}
      onBatchSubmit={jest.fn()}
      onSoftwareWalletCreate={jest.fn()}
    />,
  );
  await fireEvent.press(view.getByText('Hardware Wallet'));
  await fireEvent.press(view.getByText('Scan synthetic account'));
  await view.findByText('Import Wallet');
  await fireEvent.press(view.getByText('Cancel'));
  expect(view.getByText('Enter wallet details or scan a QR code')).toBeTruthy();
  await fireEvent.press(view.getByText('Back'));
  await fireEvent.press(view.getByText('Software Wallet'));
  expect(view.getByText('Continue')).toBeTruthy();
  await fireEvent.press(view.getByText('Back'));
  expect(view.getByText('Hardware Wallet')).toBeTruthy();

  expect(count('modal mounted')).toBe(1);
  expect(count('modal unmounted')).toBe(0);
  expect(count('content mounted')).toBe(7);
  expect(jest.mocked(CustomModal).mock.calls.every(([props]) => props.visible)).toBe(true);
});
