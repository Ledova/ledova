// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

import { useCryptoTransferSigning } from './useCryptoTransferSigning';

const wallet = { uuid: 'wallet-1', address: fixture.signer.address, chain: 'base' } as unknown as Wallet;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  ['ETH', '0.2500000000000000000000', { ...fixture.native, amountEth: '0.2500000000000000000000' }, undefined, '0.25'],
  ['a two-decimal token', '1.5000', { ...fixture.token, amountToken: '1.5000' }, fixture.token.tokenContract, '1.5'],
])(
  'declares %s in canonical form when it broadcasts, although the zeros typed past the decimals were prepared',
  async (_, amount, answer, tokenContract, declared) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useCryptoTransferSigning({
          wallet,
          toAddress: fixture.native.toAddress,
          amount,
          tokenContract,
          decimals: tokenContract ? 2 : 18,
        }),
      { wrapper },
    );
    api.post.mockResolvedValueOnce({ data: answer });
    act(() => result.current.prepare());
    await waitFor(() => expect(result.current.preparedTransaction).not.toBeNull());
    api.post.mockResolvedValueOnce({ data: { txHash: `0x${'a'.repeat(64)}`, status: 'pending' } });
    await act(async () => {
      await result.current.broadcast('0xsigned');
    });
    expect(api.post).toHaveBeenLastCalledWith(
      `/api/wallets/${wallet.uuid}/broadcast-transfer/`,
      expect.objectContaining({ amount: declared, signedTransaction: '0xsigned' }),
    );
  },
);
