import React, { useLayoutEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  WALLET_ENDPOINTS,
  AUTH_ENDPOINTS,
  type Wallet,
  type CompanyEligibilityRequest,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope } from '../../services/sessionScope';
import { useWalletVerification } from './useWalletVerification';

const mockAccess = jest.fn<Promise<string | null>, []>();
const mockSeed = jest.fn<Promise<string | null>, [string]>();
const mockSign = jest.fn<Promise<string>, [string, string, string]>();
jest.mock('../../services/tokenStorage', () => ({
  getAccessToken: () => mockAccess(),
  getRefreshToken: async () => 'synthetic-refresh',
  captureRefreshSession: async () => 1,
  storeTokens: async () => undefined,
  clearTokens: async () => undefined,
}));
jest.mock('../../services/secureKeyStorage', () => ({ getSeedPhrase: (key: string) => mockSeed(key) }));
jest.mock('../../utils/softwareWallet', () => ({
  signEthereumMessage: (...args: [string, string, string]) => mockSign(...args),
  signBitcoinMessage: (...args: [string, string, string]) => mockSign(...args),
}));

const originalAdapter = apiClient.defaults.adapter;
const originalBase = apiClient.defaults.baseURL;
const originalEnvironment = process.env.EXPO_PUBLIC_API_URL;
let client: QueryClient;
let sent: InternalAxiosRequestConfig[];
let selected: Wallet;
let own: Wallet[];
let failOwnRead: boolean;
let challengeWait: ReturnType<typeof deferred<string>> | null;
let refreshWait: ReturnType<typeof deferred<void>> | null;
let signatureRefused: boolean;
let malformedProof: 'challenge' | 'result' | null;
let eligibility: CompanyEligibilityRequest;
let nomination: { request: string; company: string } | undefined;
let current: ReturnType<typeof useWalletVerification>;

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Harness({ wallet, context = nomination }: { wallet: Wallet; context?: typeof nomination }) {
  const verification = useWalletVerification({ wallet, nomination: context });
  useLayoutEffect(() => {
    current = verification;
  }, [verification]);
  return null;
}

function response(config: InternalAxiosRequestConfig, data: unknown) {
  return { config, data, status: 200, statusText: 'OK', headers: {} };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'synthetic-profile', userAccount: { uuid: 'synthetic-account' } },
  });
  selected = {
    uuid: 'synthetic-wallet',
    userAccount: 'synthetic-account',
    address: '0x' + 'a'.repeat(40),
    chain: 'base',
    signingPreference: 'software',
    derivationPath: "m/44'/60'/0'/0/0",
    masterFingerprint: 'aabbccdd',
    verificationStatus: 'VERIFIED',
    verificationChallenge: null,
    verificationSignature: null,
    verifiedAt: null,
    lastSyncedAt: null,
    nativeBalance: '0',
    nativeMarketValue: '0',
    marketValue: '0',
    createdAt: '2026-10-07T00:00:00Z',
    updatedAt: '2026-10-07T00:00:00Z',
  };
  eligibility = {
    uuid: 'synthetic-request',
    company: 'synthetic-company',
    userAccount: 'synthetic-account',
    source: 'synthetic-source',
    category: 'professional_investor',
    sharedSummary: {
      category: 'professional_investor',
      source: 'synthetic-source',
      company: 'synthetic-company',
      userAccount: 'synthetic-account',
      declarationText: 'Synthetic declaration',
      submittedAt: '2026-10-07T00:00:00Z',
      requestedExpiresAt: '2099-01-01T00:00:00Z',
    },
    digest: 'a'.repeat(64),
    evidenceHash: 'b'.repeat(64),
    sourceFingerprint: 'c'.repeat(64),
    idempotencyKey: 'synthetic-request-key',
    version: '1',
    outcome: 'accepted',
    submittedAt: '2026-10-07T00:00:00Z',
    submittedBy: 1,
    requestedExpiresAt: '2099-01-01T00:00:00Z',
    withdrawal: null,
    decision: {
      uuid: 'synthetic-decision',
      appointment: 'synthetic-appointment',
      decidedAt: '2026-10-07T00:00:00Z',
      decidedBy: 2,
      digest: 'a'.repeat(64),
      requestDigest: 'a'.repeat(64),
      expiresAt: '2099-01-01T00:00:00Z',
      idempotencyKey: 'synthetic-decision-key',
      outcome: 'accepted',
      reason: '',
      revocation: null,
    },
  };
  nomination = undefined;
  own = [selected];
  sent = [];
  failOwnRead = false;
  challengeWait = null;
  refreshWait = null;
  signatureRefused = false;
  malformedProof = null;
  mockAccess.mockReset().mockResolvedValue('synthetic-access');
  mockSeed.mockReset().mockResolvedValue('synthetic seed control');
  mockSign.mockReset().mockResolvedValue('0xsynthetic-signature');
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';
  apiClient.defaults.baseURL = process.env.EXPO_PUBLIC_API_URL;
  apiClient.defaults.adapter = async (config) => {
    sent.push(config);
    if (config.method === 'get' && config.url === `/api/v1/company-eligibility/requests/${eligibility.uuid}/`)
      return response(config, eligibility);
    if (config.method === 'get' && config.url === WALLET_ENDPOINTS.BASE) {
      if (failOwnRead) throw new AxiosError('Synthetic unavailable wallet read', AxiosError.ERR_NETWORK, config);
      return response(config, { count: own.length, next: null, results: own });
    }
    if (config.url === WALLET_ENDPOINTS.REQUEST_VERIFICATION(selected.uuid))
      return response(config, {
        challenge: challengeWait ? await challengeWait.promise : 'synthetic challenge',
        walletAddress: malformedProof === 'challenge' ? 'wrong address' : selected.address,
      });
    if (config.url === WALLET_ENDPOINTS.VERIFY_SIGNATURE('synthetic-wallet')) {
      if (signatureRefused) {
        signatureRefused = false;
        throw new AxiosError('Synthetic expired bearer', undefined, config, undefined, {
          ...response(config, {}),
          status: 401,
        });
      }
      return response(config, {
        success: malformedProof !== 'result',
        verificationStatus: 'VERIFIED',
        verifiedAt: '2026-10-07T00:00:00Z',
      });
    }
    if (config.url === AUTH_ENDPOINTS.TOKEN_REFRESH) {
      if (refreshWait) await refreshWait.promise;
      return response(config, { access: 'synthetic-new-access', refresh: 'synthetic-new-refresh' });
    }
    throw new Error(`Unexpected proof request ${config.url}`);
  };
});

afterEach(async () => {
  await cleanup();
  client.clear();
  apiClient.defaults.adapter = originalAdapter;
  apiClient.defaults.baseURL = originalBase;
  process.env.EXPO_PUBLIC_API_URL = originalEnvironment;
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );
}

async function open() {
  const view = await render(<Harness wallet={selected} />, { wrapper });
  await waitFor(() => expect(current.ready).toBe(true));
  return view;
}

const signaturePosts = () =>
  sent.filter((config) => config.url === WALLET_ENDPOINTS.VERIFY_SIGNATURE('synthetic-wallet'));

it('refreshes a VERIFIED own wallet with its original challenge, local signature and guarded bearer POST', async () => {
  await open();
  await act(() => current.autoVerify());
  await waitFor(() => expect(current.verificationSuccess).toBe(true));
  expect(mockSeed).toHaveBeenCalledWith('aabbccdd');
  expect(mockSign).toHaveBeenCalledWith('synthetic seed control', selected.derivationPath, 'synthetic challenge');
  expect(signaturePosts()).toHaveLength(1);
  expect(JSON.parse(String(signaturePosts()[0].data))).toEqual({ signature: '0xsynthetic-signature' });
  expect(signaturePosts()[0].headers.Authorization).toBe('Bearer synthetic-access');
  expect(signaturePosts()[0].ledovaSubmissionGuard).toEqual(expect.any(Function));
  expect(signaturePosts()[0].ledovaSessionEpoch).toEqual(expect.any(Number));
});

it.each(['account', 'address', 'chain'] as const)(
  'refuses a route wallet whose authoritative own %s differs',
  async (field) => {
    own = [{ ...selected, [field === 'account' ? 'userAccount' : field]: field === 'chain' ? 'ethereum' : 'foreign' }];
    await render(<Harness wallet={selected} />, { wrapper });
    await waitFor(() => expect(sent.some((config) => config.method === 'get')).toBe(true));
    await act(() => current.autoVerify());
    expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
    expect(mockSeed).not.toHaveBeenCalled();
  },
);

it.each([
  ['challenge', 'actor'],
  ['seed', 'account'],
  ['sign', 'wallet'],
  ['seed', 'epoch'],
  ['sign', 'unmount'],
] as const)('refuses old proof work after pending %s and %s scope loss', async (phase, loss) => {
  const view = await open();
  const seed = deferred<string | null>();
  const sign = deferred<string>();
  if (phase === 'challenge') challengeWait = deferred<string>();
  if (phase === 'seed') mockSeed.mockReturnValue(seed.promise);
  if (phase === 'sign') mockSign.mockReturnValue(sign.promise);
  await act(() => current.autoVerify());
  await waitFor(() =>
    expect(
      phase === 'challenge'
        ? sent.some((config) => config.method === 'post')
        : phase === 'seed'
          ? mockSeed.mock.calls.length
          : mockSign.mock.calls.length,
    ).toBeTruthy(),
  );
  if (loss === 'actor' || loss === 'account')
    await act(() =>
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: {
          userProfile: loss === 'actor' ? 'another-profile' : 'synthetic-profile',
          userAccount: { uuid: loss === 'account' ? 'another-account' : 'synthetic-account' },
        },
      }),
    );
  if (loss === 'wallet') {
    selected = { ...selected, address: '0x' + 'b'.repeat(40) };
    own = [selected];
    await view.rerender(<Harness wallet={selected} />);
  }
  if (loss === 'epoch') await act(() => invalidateSessionScope());
  if (loss === 'unmount') await view.unmount();
  await act(async () => {
    challengeWait?.resolve('synthetic challenge');
    seed.resolve('synthetic seed control');
    sign.resolve('0xsynthetic-signature');
    await Promise.resolve();
  });
  expect(signaturePosts()).toHaveLength(0);
  expect(current.verificationSuccess).toBe(false);
});

it('checks the original owner again after secure bearer retrieval before actual challenge dispatch', async () => {
  await open();
  const bearer = deferred<string | null>();
  mockAccess.mockReturnValue(bearer.promise);
  await act(() => current.requestChallenge());
  await waitFor(() => expect(mockAccess).toHaveBeenCalledTimes(2));
  await act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'synthetic-profile', userAccount: { uuid: 'another-account' } },
    }),
  );
  await act(async () => {
    bearer.resolve('synthetic-access');
    await Promise.resolve();
  });
  expect(sent.filter((config) => config.method === 'post')).toHaveLength(0);
  expect(current.verificationChallenge).toBeNull();
});

it('refuses redispatch of the original signature after a 401 refresh changes the account', async () => {
  await open();
  signatureRefused = true;
  refreshWait = deferred<void>();
  await act(() => current.autoVerify());
  await waitFor(() => expect(sent.some((config) => config.url === AUTH_ENDPOINTS.TOKEN_REFRESH)).toBe(true));
  await act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'synthetic-profile', userAccount: { uuid: 'another-account' } },
    }),
  );
  await act(async () => {
    refreshWait!.resolve();
    await Promise.resolve();
  });
  expect(signaturePosts()).toHaveLength(1);
  expect(current.verificationSuccess).toBe(false);
});

it('preserves the original challenge through a same-owner failed read and blocks signing until a healthy read', async () => {
  await open();
  await act(() => current.requestChallenge());
  await waitFor(() => expect(current.verificationChallenge).toBe('synthetic challenge'));
  failOwnRead = true;
  await act(async () => {
    await current.refresh();
  });
  await act(() => current.verifySignature('0xsynthetic-signature'));
  expect(signaturePosts()).toHaveLength(0);
  expect(current.verificationChallenge).toBe('synthetic challenge');
  failOwnRead = false;
  await act(async () => {
    await current.refresh();
  });
  await act(() => current.verifySignature('0xsynthetic-signature'));
  await waitFor(() => expect(current.verificationSuccess).toBe(true));
  expect(signaturePosts()).toHaveLength(1);
});

it.each(['challenge', 'result'] as const)(
  'refuses malformed %s proof completion without claiming success',
  async (phase) => {
    await open();
    malformedProof = phase;
    await act(() => current.autoVerify());
    await waitFor(() => expect(current.verificationError).toBeTruthy());
    expect(current.verificationSuccess).toBe(false);
    expect(signaturePosts()).toHaveLength(phase === 'challenge' ? 0 : 1);
  },
);

it('refreshes proof for the captured accepted GENERAL request without sharing or nominating a wallet', async () => {
  nomination = { request: eligibility.uuid, company: eligibility.company };
  await open();
  await act(() => current.autoVerify());
  await waitFor(() => expect(current.verificationSuccess).toBe(true));
  expect(signaturePosts()).toHaveLength(1);
  expect(sent.filter((config) => config.method === 'post').map((config) => config.url)).toEqual([
    WALLET_ENDPOINTS.REQUEST_VERIFICATION(selected.uuid),
    WALLET_ENDPOINTS.VERIFY_SIGNATURE(selected.uuid),
  ]);
});

it.each(['eligibility loss', 'company change'] as const)(
  'refuses pending local proof after captured %s',
  async (loss) => {
    nomination = { request: eligibility.uuid, company: eligibility.company };
    const view = await open();
    const seed = deferred<string | null>();
    mockSeed.mockReturnValue(seed.promise);
    await act(() => current.autoVerify());
    await waitFor(() => expect(mockSeed).toHaveBeenCalledTimes(1));
    if (loss === 'eligibility loss') {
      eligibility = { ...eligibility, outcome: 'revoked' };
      await act(async () => {
        await current.refresh();
      });
    } else {
      nomination = { ...nomination, company: 'another-company' };
      await view.rerender(<Harness wallet={selected} context={nomination} />);
    }
    await act(async () => {
      seed.resolve('synthetic seed control');
      await seed.promise;
    });
    expect(mockSign).not.toHaveBeenCalled();
    expect(signaturePosts()).toHaveLength(0);
    expect(current.verificationSuccess).toBe(false);
  },
);
