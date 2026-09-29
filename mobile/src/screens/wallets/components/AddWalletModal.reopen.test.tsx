import React from 'react';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useWallets } from '../useWallets';
import { AddWalletModal } from './AddWalletModal';

jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
const mockGenerate = jest.fn();
jest.mock('../../../services/secureKeyStorage', () => ({
  generateMnemonic: () => mockGenerate(),
  validateMnemonic: () => true,
  computeSeedIdentifier: () => 'fictional-identifier',
  storeSeedPhrase: async () => undefined,
}));
jest.mock('../../../utils/softwareWallet', () => ({
  deriveAccountsFromMnemonic: () => ({
    addresses: [
      { address: '0x' + 'c'.repeat(40), networkType: 'BASE', derivationPath: "m/44'/60'/0'/0/0", addressIndex: 0 },
    ],
    parentKeys: [],
    masterFingerprint: '00000000',
  }),
}));
jest.mock('expo-local-authentication', () => ({ authenticateAsync: async () => ({ success: true }) }));
jest.mock('./SeedPhraseConfirm', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    SeedPhraseConfirm: ({ onAnswerChange }: { onAnswerChange: (index: number, text: string) => void }) => (
      <Pressable
        onPress={() => {
          for (let i = 0; i < 3; i++) onAnswerChange(i, 'first');
        }}
      >
        <Text>Complete fictional confirmation</Text>
      </Pressable>
    ),
  };
});

const crud = { isLoading: false, isRefreshing: false, hasError: false, createWallet: jest.fn(async () => undefined) };

function Wallets() {
  const form = useWallets(crud as unknown as Parameters<typeof useWallets>[0]);
  return (
    <>
      <Pressable onPress={form.openAddModal}>
        <Text>Open add wallet</Text>
      </Pressable>
      <AddWalletModal
        visible={form.showAddModal}
        isLoading={form.isCreating}
        readBlocked={false}
        notice={null}
        error={form.createError}
        onRetry={jest.fn()}
        onClose={form.closeAddModal}
        onSubmit={form.handleCreateWallet}
        onBatchSubmit={form.handleBatchCreateWallets}
        onSoftwareWalletCreate={form.handleSoftwareWalletCreate}
      />
    </>
  );
}

beforeEach(() => {
  mockGenerate.mockReset().mockReturnValue(Array(12).fill('first').join(' '));
});
afterEach(async () => {
  await cleanup();
});

it('reopens at the type step without a recovery phrase or a focus move after a software wallet is added', async () => {
  const view = await render(<Wallets />);
  await fireEvent.press(view.getByText('Open add wallet'));
  await fireEvent.press(view.getByText('Software Wallet'));
  await fireEvent.press(view.getByText('Continue'));
  await fireEvent.press(view.getByText('Complete fictional confirmation'));
  await fireEvent.press(view.getByText('Verify'));
  await fireEvent.press(view.getByText('Create Wallet'));
  await waitFor(() => expect(view.queryByRole('header', { name: 'Add wallet' })).toBeNull());
  expect(crud.createWallet).toHaveBeenCalledTimes(1);
  const phrases = mockGenerate.mock.calls.length;
  const focusMoves = jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.length;

  await fireEvent.press(view.getByText('Open add wallet'));
  expect(view.getByText('Software Wallet')).toBeTruthy();
  expect({
    phrases: mockGenerate.mock.calls.length,
    focusMoves: jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls.length,
  }).toEqual({ phrases, focusMoves });
});
