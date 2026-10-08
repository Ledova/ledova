// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { verifyMessage } from 'ethers';
import {
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  ApiClientProvider,
  requestVerificationChallenge,
  verifyWalletSignature,
} from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { useWalletVerification } from './useWalletVerification';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError } from 'axios';
import apiClient from '@services/apiClient';
import * as signer from '@utils/softwareWallet/localSigner';

vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  requestVerificationChallenge: vi.fn(),
  verifyWalletSignature: vi.fn(),
}));

const requestChallengeMock = vi.mocked(requestVerificationChallenge);
const verifySignatureMock = vi.mocked(verifyWalletSignature);

const HARDHAT_MNEMONIC = 'test test test test test test test test test test test junk';
const HARDHAT_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const HARDHAT_ACCOUNT_1 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const CHALLENGE = 'Ledova Wallet Verification\n\nAddress: 0xf39F\nTimestamp: 1\nNonce: abc\n';

const typedWallet = (address: string, overrides: Partial<Wallet> = {}) =>
  ({
    uuid: 'wallet-uuid',
    userAccount: 'account-uuid',
    address,
    chain: 'base',
    verificationStatus: 'PENDING',
    nativeBalance: '0',
    nativeMarketValue: '0',
    marketValue: '0',
    ...overrides,
  }) as Wallet;

const createHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile-uuid', userAccount: { uuid: 'account-uuid', role: 'investor' } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <ApiClientProvider client={apiClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientProvider>
  );
  return { wrapper, queryClient };
};

describe('useWalletVerification', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    requestChallengeMock.mockReset();
    verifySignatureMock.mockReset();
    requestChallengeMock.mockImplementation(
      async (_api, wallet) =>
        ({
          data: { challenge: CHALLENGE, walletAddress: wallet === 'wallet-uuid' ? HARDHAT_ACCOUNT_0 : '' },
        }) as never,
    );
    verifySignatureMock.mockResolvedValue({
      data: { success: true, verificationStatus: 'VERIFIED', verifiedAt: '2026-10-07T00:00:00Z' },
    } as never);
  });

  it('refuses a hardware verification when the wallet carries no hardware data', async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWalletVerification(), { wrapper });

    await act(async () => {
      await result.current.startVerification(typedWallet(HARDHAT_ACCOUNT_0), 'hardware');
    });

    expect(result.current.verificationError).toContain('Missing hardware wallet data');
    expect(requestChallengeMock).not.toHaveBeenCalled();
  });

  it('accepts the same wallet for seed-phrase verification and asks for a challenge', async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWalletVerification(), { wrapper });

    await act(async () => {
      await result.current.startVerification(
        typedWallet(HARDHAT_ACCOUNT_0, { verificationStatus: 'VERIFIED' }),
        'software',
      );
    });

    await waitFor(() => expect(result.current.verificationStep).toBe('sign-software'));
    expect(requestChallengeMock).toHaveBeenCalledTimes(1);
    expect(result.current.verificationError).toBeNull();
  });

  it('refuses a seed phrase that does not derive the wallet address, without submitting it', async () => {
    requestChallengeMock.mockResolvedValue({
      data: { challenge: CHALLENGE, walletAddress: HARDHAT_ACCOUNT_1 },
    } as never);
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWalletVerification(), { wrapper });

    await act(async () => {
      await result.current.startVerification(typedWallet(HARDHAT_ACCOUNT_1), 'software');
    });
    await waitFor(() => expect(result.current.verificationStep).toBe('sign-software'));

    await act(async () => {
      await result.current.signWithSeedPhrase(HARDHAT_MNEMONIC);
    });

    expect(result.current.verificationError).toContain('does not match this wallet address');
    expect(verifySignatureMock).not.toHaveBeenCalled();
  });

  it('signs the challenge locally and submits a 0x signature for the matching address', async () => {
    const { wrapper, queryClient } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useWalletVerification(), { wrapper });

    await act(async () => {
      await result.current.startVerification(typedWallet(HARDHAT_ACCOUNT_0), 'software');
    });
    await waitFor(() => expect(result.current.verificationStep).toBe('sign-software'));

    await act(async () => {
      await result.current.signWithSeedPhrase(HARDHAT_MNEMONIC);
    });

    await waitFor(() => expect(verifySignatureMock).toHaveBeenCalledTimes(1));

    const [, walletUuid, payload] = verifySignatureMock.mock.calls[0];
    expect(walletUuid).toBe('wallet-uuid');
    expect(payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(verifyMessage(CHALLENGE, payload.signature).toLowerCase()).toBe(HARDHAT_ACCOUNT_0.toLowerCase());

    await waitFor(() => expect(result.current.verificationStep).toBe('success'));
    expect(invalidate.mock.calls).toEqual([[{ queryKey: ['wallets'] }]]);
  });

  it('honours an explicit derivation path stored on the wallet', async () => {
    requestChallengeMock.mockResolvedValue({
      data: { challenge: CHALLENGE, walletAddress: HARDHAT_ACCOUNT_1 },
    } as never);
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWalletVerification(), { wrapper });
    const wallet = typedWallet(HARDHAT_ACCOUNT_1, { derivationPath: "m/44'/60'/0'/0/1" });

    await act(async () => {
      await result.current.startVerification(wallet, 'software');
    });
    await waitFor(() => expect(result.current.verificationStep).toBe('sign-software'));

    await act(async () => {
      await result.current.signWithSeedPhrase(HARDHAT_MNEMONIC);
    });

    await waitFor(() => expect(verifySignatureMock).toHaveBeenCalledTimes(1));
  });

  it.each(['account', 'session', 'closed'] as const)(
    'refuses the original challenge transport and callback when verification is %s',
    async (change) => {
      const { wrapper, queryClient } = createHarness();
      let resolve!: (value: never) => void;
      requestChallengeMock.mockReturnValue(new Promise((done) => (resolve = done)));
      const { result, unmount } = renderHook(() => useWalletVerification(), { wrapper });
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.startVerification(typedWallet(HARDHAT_ACCOUNT_0), 'software');
      });
      await waitFor(() => expect(requestChallengeMock).toHaveBeenCalledOnce());
      const guard = requestChallengeMock.mock.calls[0][2]!.ledovaSubmissionGuard!;
      expect(() => guard()).not.toThrow();
      act(() => {
        if (change === 'closed') unmount();
        else if (change === 'session') {
          queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
          queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
        } else {
          queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, {
            data: { userProfile: 'profile-other', userAccount: { uuid: 'account-other', role: 'investor' } },
          });
        }
      });
      expect(() => guard()).toThrow(/session changed|no longer|Reopen/);
      await act(async () => {
        resolve({ data: { challenge: CHALLENGE, walletAddress: HARDHAT_ACCOUNT_0 } } as never);
        await pending;
      });
      expect(verifySignatureMock).not.toHaveBeenCalled();
      if (change !== 'closed') expect(result.current.verificationChallenge).toBeNull();
    },
  );

  it('blocks the actual challenge redispatch after an account change during CSRF refresh', async () => {
    const actual = await vi.importActual<typeof import('@ledova/shared')>('@ledova/shared');
    requestChallengeMock.mockImplementation(actual.requestVerificationChallenge);
    const previous = apiClient.defaults.adapter;
    let release!: () => void;
    const auth = new Promise<void>((done) => (release = done));
    const calls: string[] = [];
    apiClient.defaults.adapter = async (config) => {
      calls.push(`${config.method} ${config.url}`);
      if (config.method === 'get') {
        await auth;
        return { data: { valid: true }, status: 200, statusText: 'OK', headers: {}, config };
      }
      throw new AxiosError('Synthetic CSRF expiry', undefined, config, undefined, {
        data: { detail: 'CSRF Failed: synthetic' },
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config,
      });
    };
    try {
      const { wrapper, queryClient } = createHarness();
      const { result } = renderHook(() => useWalletVerification(), { wrapper });
      let pending!: Promise<void>;
      act(() => {
        pending = result.current.startVerification(typedWallet(HARDHAT_ACCOUNT_0), 'software');
      });
      await waitFor(() => expect(calls.some((call) => call.startsWith('get '))).toBe(true));
      act(() =>
        queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'profile-other', userAccount: { uuid: 'account-other', role: 'investor' } },
        }),
      );
      await act(async () => {
        release();
        await pending;
      });
      expect(calls.filter((call) => call.startsWith('post '))).toHaveLength(1);
      expect(result.current.verificationChallenge).toBeNull();
      expect(verifySignatureMock).not.toHaveBeenCalled();
    } finally {
      apiClient.defaults.adapter = previous;
    }
  });

  it('refuses signature submission when the selected company request changes during local signing', async () => {
    let release!: (value: string) => void;
    vi.spyOn(signer, 'signEthereumMessage').mockReturnValue(new Promise((done) => (release = done)));
    let selected = 'original-company-request';
    const guard = () => {
      if (selected !== 'original-company-request') throw new Error('The selected company request changed.');
    };
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useWalletVerification(undefined, guard), { wrapper });
    await act(async () => {
      await result.current.startVerification(typedWallet(HARDHAT_ACCOUNT_0), 'software');
    });
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.signWithSeedPhrase(HARDHAT_MNEMONIC);
    });
    await waitFor(() => expect(signer.signEthereumMessage).toHaveBeenCalledOnce());
    selected = 'different-company-request';
    await act(async () => {
      release(`0x${'1'.repeat(130)}`);
      await pending;
    });
    expect(verifySignatureMock).not.toHaveBeenCalled();
    expect(result.current.verificationSuccess).toBe(false);
    expect(result.current.verificationError).toContain('selected company request changed');
  });
});
