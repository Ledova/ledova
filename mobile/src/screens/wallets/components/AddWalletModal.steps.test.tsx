import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { importAddressKey, type DerivedAddress, type HardwareWalletImport } from '@ledova/shared';
import { CustomModal } from '../../../components/modal';
import { apiClient } from '../../../services/apiClient';
import { extractFromKeystoneQR } from '../../../utils/keystone/bcurDecoder';
import { AddWalletModal } from './AddWalletModal';
import { SeedAccountSelector } from './SeedAccountSelector';
import { SeedPhraseGenerate } from './SeedPhraseGenerate';

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
const mockGenerate = jest.fn();
jest.mock('../../../services/secureKeyStorage', () => ({
  generateMnemonic: () => mockGenerate(),
  validateMnemonic: () => true,
  computeSeedIdentifier: () => 'fictional-identifier',
  storeSeedPhrase: jest.fn(),
}));
const mockDerived = {
  addresses: [
    { address: '0x' + 'b'.repeat(40), networkType: 'BASE', derivationPath: "m/44'/60'/0'/0/0", addressIndex: 0 },
  ],
  parentKeys: [],
  masterFingerprint: '00000000',
};
jest.mock('../../../utils/softwareWallet', () => ({
  deriveAccountsFromMnemonic: () => JSON.parse(JSON.stringify(mockDerived)),
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
jest.mock('./SeedPhraseGenerate', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    SeedPhraseGenerate: jest.fn(
      ({
        inputMode,
        words,
        onInputModeChange,
      }: {
        inputMode: 'create' | 'import';
        words: string[];
        onInputModeChange: (mode: 'create' | 'import') => void;
      }) => (
        <View>
          <Text>{inputMode === 'create' ? words.join(' ') : 'Import a recovery phrase'}</Text>
          <Pressable onPress={() => onInputModeChange('import')}>
            <Text>Choose import</Text>
          </Pressable>
        </View>
      ),
    ),
  };
});
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
jest.mock('./SeedAccountSelector', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  const { importAddressKey } = jest.requireActual('@ledova/shared');
  return {
    SeedAccountSelector: jest.fn(
      ({
        addresses,
        balances,
        onBack,
      }: {
        addresses: DerivedAddress[];
        balances: Map<string, string>;
        onBack: () => void;
      }) => (
        <View>
          <Text>{balances.get(importAddressKey(addresses[0])) ?? 'Loading...'}</Text>
          <Pressable onPress={onBack}>
            <Text>Back to the phrase check</Text>
          </Pressable>
        </View>
      ),
    ),
  };
});

const address = '0x' + 'a'.repeat(40);
const account: HardwareWalletImport = {
  addresses: [{ address, networkType: 'ETH', addressIndex: 0, derivationPath: "m/44'/60'/0'/0/0" }],
  masterFingerprint: 'fingerprint',
  parentKeys: [{ parentPublicKey: 'public', parentChainCode: 'chain', parentDerivationPath: "m/44'/60'/0'/0" }],
};
const firstPhrase = Array(12).fill('first').join(' ');
const secondPhrase = Array(12).fill('second').join(' ');
const count = (event: string) => mockDialogLifecycle.filter((entry) => entry === event).length;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function renderDialog() {
  return render(
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
}

beforeEach(() => {
  mockDialogLifecycle.length = 0;
  mockGenerate.mockReset().mockReturnValue(firstPhrase);
  jest.mocked(apiClient.post).mockImplementation(async (_url, body) => ({
    data: { userAccount: (body as { userAccount: string }).userAccount, chain: 'ethereum', balances: {} },
  }));
  jest.mocked(extractFromKeystoneQR).mockReturnValue(account);
});
afterEach(async () => {
  await cleanup();
});

it('keeps one mounted dialog while every step replaces its content', async () => {
  const view = await renderDialog();
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

it('generates no recovery phrase on the type or hardware steps', async () => {
  const view = await renderDialog();
  await fireEvent.press(view.getByText('Hardware Wallet'));
  await fireEvent.press(view.getByText('Scan synthetic account'));
  await view.findByText('Import Wallet');
  await fireEvent.press(view.getByText('Cancel'));
  await fireEvent.press(view.getByText('Back'));
  expect(mockGenerate).not.toHaveBeenCalled();

  await fireEvent.press(view.getByText('Software Wallet'));
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(view.getByText(firstPhrase)).toBeTruthy();
});

it('forgets the recovery phrase when the software step is left and shows a fresh one on return', async () => {
  mockGenerate.mockReturnValueOnce(firstPhrase).mockReturnValueOnce(secondPhrase);
  const view = await renderDialog();
  await fireEvent.press(view.getByText('Software Wallet'));
  expect(view.getByText(firstPhrase)).toBeTruthy();
  await fireEvent.press(view.getByText('Back'));
  jest.mocked(SeedPhraseGenerate).mockClear();

  await fireEvent.press(view.getByText('Software Wallet'));
  expect(view.getByText(secondPhrase)).toBeTruthy();
  expect(view.queryByText(firstPhrase)).toBeNull();
  expect(jest.mocked(SeedPhraseGenerate).mock.calls.map(([props]) => props.words.join(' '))).not.toContain(firstPhrase);
  expect(mockGenerate).toHaveBeenCalledTimes(2);
});

it('starts the software step in create mode again after Back', async () => {
  const view = await renderDialog();
  await fireEvent.press(view.getByText('Software Wallet'));
  await fireEvent.press(view.getByText('Choose import'));
  expect(view.getByText('Import a recovery phrase')).toBeTruthy();
  await fireEvent.press(view.getByText('Back'));

  await fireEvent.press(view.getByText('Software Wallet'));
  expect(jest.mocked(SeedPhraseGenerate).mock.calls.at(-1)![0].inputMode).toBe('create');
  expect(view.getByText('Continue')).toBeTruthy();
});

it('discards a balance read that returns after the account step is left', async () => {
  const held: ((value: unknown) => void)[] = [];
  jest.mocked(apiClient.post).mockImplementation(() => new Promise((resolve) => held.push(resolve)));
  const balance = (value: string) => ({
    data: { chain: 'base', balances: { [mockDerived.addresses[0]!.address]: value } },
  });
  const shown = () =>
    jest
      .mocked(SeedAccountSelector)
      .mock.calls.map(([props]) => props.balances.get(importAddressKey(mockDerived.addresses[0] as DerivedAddress)));
  const view = await renderDialog();
  await fireEvent.press(view.getByText('Software Wallet'));
  await fireEvent.press(view.getByText('Continue'));
  await fireEvent.press(view.getByText('Complete fictional confirmation'));
  await fireEvent.press(view.getByText('Verify'));
  await waitFor(() => expect(held).toHaveLength(1));
  expect(view.getByText('Loading...')).toBeTruthy();

  await fireEvent.press(view.getByText('Back to the phrase check'));
  jest.mocked(SeedAccountSelector).mockClear();
  held[0]!(balance('5'));
  await settle();
  await fireEvent.press(view.getByText('Complete fictional confirmation'));
  await fireEvent.press(view.getByText('Verify'));
  await waitFor(() => expect(held).toHaveLength(2));
  held[1]!(balance('7'));
  await settle();

  expect(view.getByText('7 ETH')).toBeTruthy();
  expect(shown()).not.toContain('5 ETH');
});
