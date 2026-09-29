// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => <p>Synthetic signing code</p> }));

import { useCryptoTransferSigning } from '../hooks/useCryptoTransferSigning';
import { TransferSigningFlow } from './TransferSigningFlow';

const RECIPIENT = `0x${'b'.repeat(40)}`;
const STABLECOIN = `0x${'5'.repeat(40)}`;
const REFUSAL =
  'The recipient has no current approval with any company, so it cannot receive TUSD. ' +
  'Check the address, or ask the recipient to have their wallet approved.';

const wallet = {
  uuid: 'wallet-1',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
} as unknown as Wallet;

let client: QueryClient;

function SendingTheStablecoin() {
  const signing = useCryptoTransferSigning({ wallet, toAddress: RECIPIENT, amount: '5', tokenContract: STABLECOIN });
  return (
    <TransferSigningFlow
      isOpen
      onClose={() => {}}
      transferType="stablecoin"
      wallet={wallet}
      token={{ symbol: 'TUSD', name: 'Test Dollar' }}
      toAddress={RECIPIENT}
      amount="5"
      preparedTransaction={signing.preparedTransaction}
      isPreparing={signing.isPreparing}
      prepareError={signing.prepareError}
      onPrepare={signing.prepare}
      onBroadcast={signing.broadcast}
    />
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

it('shows the approval refusal the backend returns when a stablecoin transfer is prepared', async () => {
  api.post.mockRejectedValue(
    Object.assign(new Error('Request failed with status code 403'), {
      response: { status: 403, data: { detail: REFUSAL, code: 'stablecoin_approval_required' } },
    }),
  );

  render(
    <QueryClientProvider client={client}>
      <SendingTheStablecoin />
    </QueryClientProvider>,
  );

  expect(await screen.findByText(REFUSAL)).toBeTruthy();
  expect(api.post).toHaveBeenCalledOnce();
  expect(api.post.mock.calls[0][0]).toBe('/api/wallets/wallet-1/prepare-transfer/');
  expect(api.get).not.toHaveBeenCalled();
});
