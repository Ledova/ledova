import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SeedPhraseSetup } from './SeedPhraseSetup';
import { invalidateSessionScope } from '../../../services/sessionScope';

let mockModalClose: () => void;
jest.mock('../../../components/modal', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    CustomModal: ({
      children,
      onClose,
      onConfirm,
      confirmLabel,
      showFooter,
    }: {
      children: React.ReactNode;
      onClose: () => void;
      onConfirm?: () => void;
      confirmLabel?: string;
      showFooter?: boolean;
    }) => {
      mockModalClose = onClose;
      return (
        <View>
          {children}
          {showFooter && onConfirm && (
            <Pressable
              onPress={() => {
                onConfirm();
              }}
            >
              <Text>{confirmLabel}</Text>
            </Pressable>
          )}
        </View>
      );
    },
  };
});
jest.mock('./SeedAccountSelector', () => {
  const { Pressable, Text, View } = jest.requireActual('react-native');
  return {
    SeedAccountSelector: ({ onConfirm, storeError }: { onConfirm: () => void; storeError: string | null }) => (
      <View>
        {storeError && <Text>{storeError}</Text>}
        <Pressable
          onPress={() => {
            onConfirm();
          }}
        >
          <Text>Create Wallet</Text>
        </Pressable>
      </View>
    ),
  };
});
const mockStore = jest.fn();
const mockAuthenticate = jest.fn();
const mockData = {
  addresses: [
    { address: '0x' + 'a'.repeat(40), networkType: 'BASE', derivationPath: "m/44'/60'/0'/0/0", addressIndex: 0 },
  ],
  parentKeys: [],
  masterFingerprint: '00000000',
};
jest.mock('../../../services/secureKeyStorage', () => ({
  generateMnemonic: () => Array(12).fill('fictional').join(' '),
  validateMnemonic: () => true,
  computeSeedIdentifier: () => 'fictional-identifier',
  storeSeedPhrase: (...args: unknown[]) => mockStore(...args),
}));
jest.mock('../../../utils/softwareWallet', () => ({ deriveAccountsFromMnemonic: () => mockData }));
jest.mock('expo-local-authentication', () => ({ authenticateAsync: () => mockAuthenticate() }));
jest.mock('../../../hooks/useFetchBalances', () => ({
  useFetchBalances: () => ({ balances: new Map(), fetchBalances: mockStoreBalances }),
}));
const mockStoreBalances = async () => {};
jest.mock('./SeedPhraseGenerate', () => ({ SeedPhraseGenerate: () => null }));
jest.mock('./SeedPhraseConfirm', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    SeedPhraseConfirm: ({ onAnswerChange }: { onAnswerChange: (index: number, text: string) => void }) => (
      <Pressable
        onPress={() => {
          for (let i = 0; i < 3; i++) onAnswerChange(i, 'fictional');
        }}
      >
        <Text>Complete fictional confirmation</Text>
      </Pressable>
    ),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mockStore.mockReset().mockResolvedValue(undefined);
  mockAuthenticate.mockReset().mockResolvedValue({ success: true });
});
afterEach(async () => {
  await cleanup();
});

async function prepared(onComplete: React.ComponentProps<typeof SeedPhraseSetup>['onComplete'], onClose = jest.fn()) {
  const view = await render(
    <SeedPhraseSetup
      visible
      onComplete={onComplete}
      onClose={onClose}
      onCancel={jest.fn()}
      readBlocked={false}
      notice={null}
    />,
  );
  await fireEvent.press(view.getByText('Continue'));
  await fireEvent.press(view.getByText('Complete fictional confirmation'));
  await fireEvent.press(view.getByText('Verify'));
  return view;
}

it('awaits wallet registration and keeps account selection when it is refused', async () => {
  const write = deferred<void>();
  const close = jest.fn();
  const complete = jest.fn().mockReturnValueOnce(write.promise).mockResolvedValue(undefined);
  const view = await prepared(complete, close);
  await fireEvent.press(view.getByText('Create Wallet'));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  expect(view.getByText('Securing your wallet...')).toBeTruthy();
  await act(() => mockModalClose());
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    write.reject(new Error('Fictional registration refused'));
    await write.promise.catch(() => undefined);
  });
  await waitFor(() => expect(view.getByText('Fictional registration refused')).toBeTruthy());
  expect(view.getByText('Create Wallet')).toBeTruthy();
  await fireEvent.press(view.getByText('Create Wallet'));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  expect(complete.mock.calls[1][0]).toEqual(mockData.addresses);
});

it('does not store a recovery phrase or register addresses after the authentication session changes', async () => {
  const auth = deferred<{ success: boolean }>();
  mockAuthenticate.mockReturnValue(auth.promise);
  const complete = jest.fn();
  const view = await prepared(complete);
  await fireEvent.press(view.getByText('Create Wallet'));
  await waitFor(() => expect(mockAuthenticate).toHaveBeenCalledTimes(1));
  await act(async () => {
    invalidateSessionScope();
    auth.resolve({ success: true });
    await auth.promise;
  });
  expect(mockStore).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
