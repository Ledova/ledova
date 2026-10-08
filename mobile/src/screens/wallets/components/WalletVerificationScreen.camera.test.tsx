import React, { useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PermissionResponse } from 'expo-camera';
import { AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY, ApiClientProvider, type Wallet } from '@ledova/shared';
import { ETHSignature } from '@keystonehq/bc-ur-registry-eth';

const mockGetPermission = jest.fn<Promise<PermissionResponse>, []>();
const mockRequestPermission = jest.fn<Promise<PermissionResponse>, []>();
const mockRequestChallenge = jest.fn();
const mockVerifySignature = jest.fn();
const mockGoBack = jest.fn();
const mockParentNavigate = jest.fn();
const mockGetAccessToken = jest.fn<Promise<string | null>, []>();
const mockLockPreference = jest.fn<Promise<string | null>, []>();
const mockNavigation = {
  goBack: mockGoBack,
  canGoBack: () => true,
  getParent: () => ({ navigate: mockParentNavigate }),
};
let mockNomination: { request: string; company: string } | undefined;
let mockScan: ((result: { data: string }) => void) | undefined;
let mockFocused = true;
let mockWallet: Wallet;
const listeners = new Set<(state: AppStateStatus) => void>();
let client: QueryClient;

jest.mock('uuid', () => ({ v4: () => '11111111-1111-4111-8111-111111111111' }));

jest.mock('expo-camera/build/ExpoCameraManager', () => ({
  getCameraPermissionsAsync: () => mockGetPermission(),
  requestCameraPermissionsAsync: () => mockRequestPermission(),
}));
jest.mock('expo-camera', () => {
  const { Camera, useCameraPermissions } = jest.requireActual<typeof import('expo-camera')>('expo-camera');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Camera,
    useCameraPermissions,
    CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: typeof mockScan }) => {
      mockScan = onBarcodeScanned;
      return <View testID="camera-preview" />;
    },
  };
});
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { wallet: mockWallet, nomination: mockNomination } }),
  useIsFocused: () => mockFocused,
}));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  requestVerificationChallenge: (...args: unknown[]) => mockRequestChallenge(...args),
  verifyWalletSignature: (...args: unknown[]) => mockVerifySignature(...args),
  getEligibilityRequest: async () => ({
    data: {
      uuid: 'synthetic-request',
      company: 'synthetic-company',
      userAccount: 'synthetic-account',
      category: 'professional_investor',
      outcome: 'accepted',
      digest: 'a'.repeat(64),
      withdrawal: null,
      decision: {
        uuid: 'synthetic-decision',
        requestDigest: 'a'.repeat(64),
        outcome: 'accepted',
        expiresAt: '2099-01-01T00:00:00Z',
        revocation: null,
      },
    },
  }),
  getWallets: async () => ({ data: { results: [mockWallet], next: null, previous: null, count: 1 } }),
  useUserPreferences: () => ({ userAccount: { uuid: 'synthetic-account' } }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: {} }));
jest.mock('../../../services/secureKeyStorage', () => ({ getSeedPhrase: async () => null }));
jest.mock('../../../services/tokenStorage', () => ({
  getAccessToken: () => mockGetAccessToken(),
  getBiometricLoginState: async () => ({ enabled: false, ready: false }),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: () => mockLockPreference() }));
jest.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [1],
  authenticateAsync: async () => ({ success: true }),
}));

import { invalidateSessionScope } from '../../../services/sessionScope';
import { apiClient } from '../../../services/apiClient';
import { WalletVerificationScreen } from './WalletVerificationScreen';
import { AppLockProvider, useAppLock } from '../../../contexts/AppLockContext';

let currentLock: ReturnType<typeof useAppLock>;

function LockControl() {
  const lock = useAppLock();
  useLayoutEffect(() => {
    currentLock = lock;
  }, [lock]);
  return null;
}

const granted: PermissionResponse = {
  status: 'granted' as PermissionResponse['status'],
  granted: true,
  canAskAgain: true,
  expires: 'never',
};
const undetermined: PermissionResponse = {
  ...granted,
  status: 'undetermined' as PermissionResponse['status'],
  granted: false,
};
const signatureBytes = Buffer.alloc(65, 1);
const signatureQR = new ETHSignature(signatureBytes).toUREncoder(1000).nextPart();

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  mockWallet = {
    uuid: 'synthetic-wallet',
    userAccount: 'synthetic-account',
    address: '0x' + 'a'.repeat(40),
    chain: 'base',
    signingPreference: 'hardware',
    derivationPath: "m/44'/60'/0'/0/0",
    masterFingerprint: 'aabbccdd',
    verificationStatus: 'PENDING',
    verificationChallenge: null,
    verificationSignature: null,
    verifiedAt: null,
    lastSyncedAt: null,
    nativeBalance: '0',
    nativeMarketValue: '0',
    marketValue: '0',
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
  };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'synthetic-profile', userAccount: { uuid: 'synthetic-account' } },
  });
  mockRequestChallenge.mockReset().mockImplementation(async () => ({
    data: { challenge: 'synthetic-verification-challenge', walletAddress: mockWallet.address },
  }));
  mockVerifySignature
    .mockReset()
    .mockResolvedValue({ data: { success: true, verificationStatus: 'VERIFIED', verifiedAt: '2026-10-07T00:00:00Z' } });
  mockGetPermission.mockReset().mockResolvedValue(granted);
  mockGetAccessToken.mockReset().mockResolvedValue(null);
  mockLockPreference.mockReset().mockResolvedValue('false');
  mockRequestPermission.mockReset().mockResolvedValue(granted);
  mockFocused = true;
  mockNomination = undefined;
  mockScan = undefined;
  AppState.currentState = 'active';
  listeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
    if (event === 'change') listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AppLockProvider>
      <LockControl />
      <ApiClientProvider client={apiClient}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ApiClientProvider>
    </AppLockProvider>
  );
}

async function openScanner() {
  const view = await render(<WalletVerificationScreen />, { wrapper });
  await waitFor(() => expect(view.queryByText('Refresh own wallet')).toBeNull());
  await fireEvent.press(view.getByText('Start'));
  await waitFor(() => expect(view.getByText('Continue')).toBeTruthy());
  await fireEvent.press(view.getByText('Continue'));
  return view;
}

async function changeAppState(state: AppStateStatus) {
  await act(() => {
    AppState.currentState = state;
    listeners.forEach((listener) => listener(state));
  });
}

it('requests an undetermined permission only after continuing from the challenge', async () => {
  mockGetPermission.mockResolvedValue(undetermined);
  const view = await render(<WalletVerificationScreen />, { wrapper });
  expect(view.getByText('Start')).toBeTruthy();
  expect(mockRequestPermission).not.toHaveBeenCalled();
  await waitFor(() => expect(view.queryByText('Refresh own wallet')).toBeNull());
  await fireEvent.press(view.getByText('Start'));
  await waitFor(() => expect(view.getByText('Continue')).toBeTruthy());
  expect(mockRequestPermission).not.toHaveBeenCalled();
  expect(view.queryByTestId('camera-preview')).toBeNull();

  await fireEvent.press(view.getByText('Continue'));
  expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('camera-preview')).toBeTruthy();
}, 15_000);

it('decodes a real signature once and does not submit retained frames after success', async () => {
  const view = await openScanner();
  const retained = mockScan!;
  await act(() => {
    retained({ data: signatureQR });
    retained({ data: signatureQR });
  });
  await waitFor(() => expect(view.getByText('Verification Successful!')).toBeTruthy());
  expect(mockVerifySignature.mock.calls).toEqual([
    [
      {},
      'synthetic-wallet',
      { signature: '0x' + signatureBytes.toString('hex') },
      expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function), ledovaSessionEpoch: expect.any(Number) }),
    ],
  ]);
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await changeAppState('background');
  await changeAppState('active');
  await act(() => retained({ data: signatureQR }));
  expect(mockVerifySignature).toHaveBeenCalledTimes(1);
});

it('keeps scanning after an unsupported code and accepts the following valid signature', async () => {
  const view = await openScanner();
  const scan = mockScan!;
  await act(() => scan({ data: 'ordinary-qr-control' }));
  const guidance = view.queryByText(/This QR code is not a supported signature/);
  expect(mockVerifySignature).not.toHaveBeenCalled();
  expect(view.getByTestId('camera-preview')).toBeTruthy();
  await act(() => scan({ data: signatureQR }));
  await waitFor(() => expect(mockVerifySignature).toHaveBeenCalledTimes(1));
  expect(guidance).toBeTruthy();
});

it('rejects a callback after Back and keeps the next scan step usable', async () => {
  const view = await openScanner();
  const previous = mockScan!;
  await fireEvent.press(view.getByText('Back'));
  await act(() => previous({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await fireEvent.press(view.getByText('Continue'));
  await act(() => previous({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
  await act(() => mockScan!({ data: signatureQR }));
  await waitFor(() => expect(mockVerifySignature).toHaveBeenCalledTimes(1));
});

it('rejects a callback after the verification screen unmounts', async () => {
  const view = await openScanner();
  expect(view.getByTestId('camera-preview')).toBeTruthy();
  const retained = mockScan!;
  await view.unmount();
  await act(() => retained({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
});

it('pauses for a covered route and rejects its old callback when focused again', async () => {
  const view = await openScanner();
  const retained = mockScan!;
  mockFocused = false;
  await view.rerender(<WalletVerificationScreen />);
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await act(() => retained({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<WalletVerificationScreen />);
  await act(() => retained({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
  await act(() => mockScan!({ data: signatureQR }));
  await waitFor(() => expect(mockVerifySignature).toHaveBeenCalledTimes(1));
});

it('refreshes settings while scanning and ignores background events', async () => {
  const view = await openScanner();
  const retained = mockScan!;
  await changeAppState('background');
  await act(() => retained({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
  mockGetPermission.mockResolvedValue({ ...undetermined, canAskAgain: false });
  await changeAppState('active');
  expect(view.getByText(/Please enable it in settings/)).toBeTruthy();
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await changeAppState('background');
  mockGetPermission.mockResolvedValue(granted);
  await changeAppState('active');
  await act(() => mockScan!({ data: signatureQR }));
  await waitFor(() => expect(mockVerifySignature).toHaveBeenCalledTimes(1));
  expect(mockRequestPermission).not.toHaveBeenCalled();
});

it.each(['get', 'request'] as const)('shows a native %s failure with a usable Back action', async (operation) => {
  mockGetPermission.mockResolvedValue(undetermined);
  const failing = operation === 'get' ? mockGetPermission : mockRequestPermission;
  failing.mockRejectedValue(new Error('synthetic-permission-failure'));
  const view = await openScanner();
  expect(view.getByText(/Camera permission is unavailable/)).toBeTruthy();
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await fireEvent.press(view.getByText('Back'));
  expect(view.getByText('Continue')).toBeTruthy();
  expect(failing).toHaveBeenCalledTimes(1);
});

it.each(['hardware', 'software'] as const)('titles the %s wallet check once, on its card', async (preference) => {
  mockWallet = { ...mockWallet, signingPreference: preference };
  const view = await render(<WalletVerificationScreen />, { wrapper });
  await waitFor(() => expect(view.getByRole('header', { name: 'Verify Wallet' })).toBeTruthy());
  expect(view.getAllByText('Verify Wallet')).toHaveLength(1);
  expect(view.queryByText('Verify Wallet Ownership')).toBeNull();
  if (preference === 'software')
    await waitFor(() =>
      expect(view.getByText('This wallet seed is unavailable. Restore it before continuing.')).toBeTruthy(),
    );
});

it('does not involve the camera when verifying a software wallet', async () => {
  mockWallet.signingPreference = 'software';
  const view = await render(<WalletVerificationScreen />, { wrapper });
  await waitFor(() => expect(mockRequestChallenge).toHaveBeenCalledTimes(1));
  expect(mockRequestPermission).not.toHaveBeenCalled();
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await waitFor(() =>
    expect(view.getByText('This wallet seed is unavailable. Restore it before continuing.')).toBeTruthy(),
  );
});

it('keeps the verification step and challenge through app lock without submitting paused frames', async () => {
  mockLockPreference.mockResolvedValue('true');
  mockGetAccessToken.mockResolvedValue('synthetic-session');
  const now = jest.spyOn(Date, 'now').mockReturnValue(10000);
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } }, { updatedAt: 10000 });
  client.setQueryData(
    USER_PREFERENCES_QUERY_KEY,
    { data: { userProfile: 'synthetic-profile', userAccount: { uuid: 'synthetic-account' } } },
    { updatedAt: 10000 },
  );
  const view = await openScanner();
  const retained = mockScan!;
  await changeAppState('background');
  now.mockReturnValue(13001);
  await changeAppState('active');
  expect(currentLock.isLocked).toBe(true);
  expect(view.queryByTestId('camera-preview')).toBeNull();
  await act(() => retained({ data: signatureQR }));
  expect(mockVerifySignature).not.toHaveBeenCalled();
  await act(async () => {
    expect(await currentLock.unlock()).toBe(true);
  });
  expect(view.getByTestId('camera-preview')).toBeTruthy();
  expect(mockRequestChallenge).toHaveBeenCalledTimes(1);
  expect(mockRequestPermission).not.toHaveBeenCalled();
  await act(() => {
    retained({ data: signatureQR });
    mockScan!({ data: signatureQR });
  });
  await waitFor(() => expect(view.getByText('Verification Successful!')).toBeTruthy());
  expect(mockVerifySignature.mock.calls).toEqual([
    [
      {},
      'synthetic-wallet',
      { signature: '0x' + signatureBytes.toString('hex') },
      expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function), ledovaSessionEpoch: expect.any(Number) }),
    ],
  ]);
});

it.each(['actor', 'account', 'wallet', 'epoch', 'same-id session'] as const)(
  'drops the old private verification step and refuses its late challenge after %s changes',
  async (change) => {
    let resolve!: (value: { data: { challenge: string } }) => void;
    const pending = new Promise<{ data: { challenge: string } }>((done) => {
      resolve = done;
    });
    mockRequestChallenge.mockReturnValueOnce(pending);
    const view = await render(<WalletVerificationScreen />, { wrapper });
    await waitFor(() => expect(view.queryByText('Refresh own wallet')).toBeNull());
    await fireEvent.press(view.getByText('Start'));
    await waitFor(() => expect(mockRequestChallenge).toHaveBeenCalledTimes(1));
    const config = mockRequestChallenge.mock.calls[0][2];
    if (change === 'actor' || change === 'account')
      await act(() =>
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: {
            userProfile: change === 'actor' ? 'another-profile' : 'synthetic-profile',
            userAccount: { uuid: change === 'account' ? 'another-account' : 'synthetic-account' },
          },
        }),
      );
    if (change === 'wallet') {
      mockWallet = { ...mockWallet, uuid: 'another-wallet', address: '0x' + 'b'.repeat(40) };
      await view.rerender(<WalletVerificationScreen />);
    }
    if (change === 'epoch') await act(() => invalidateSessionScope());
    if (change === 'same-id session')
      await act(() => {
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
      });
    expect(() => config.ledovaSubmissionGuard()).toThrow();
    await act(async () => {
      resolve({ data: { challenge: 'private old challenge' } });
      await pending;
    });
    expect(view.queryByText('Continue')).toBeNull();
    expect(view.queryByText('Verification Successful!')).toBeNull();
    expect(mockVerifySignature).not.toHaveBeenCalled();
    if (change !== 'account') {
      await waitFor(() => expect(view.queryByText('Refresh own wallet')).toBeNull());
      await fireEvent.press(view.getByText('Start'));
      await waitFor(() => expect(view.getByText('Continue')).toBeTruthy());
      expect(mockRequestChallenge).toHaveBeenCalledTimes(2);
    }
  },
);

it('returns a refreshed nominated wallet proof to the existing own eligibility destination', async () => {
  mockNomination = { request: 'synthetic-request', company: 'synthetic-company' };
  const view = await openScanner();
  await act(() => mockScan!({ data: signatureQR }));
  await waitFor(() => expect(view.getByText('Verification Successful!')).toBeTruthy());
  await waitFor(() => expect(mockParentNavigate).toHaveBeenCalledWith('Home', { screen: 'ParticipantEligibility' }), {
    timeout: 2500,
  });
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  expect(mockVerifySignature).toHaveBeenCalledTimes(1);
});
