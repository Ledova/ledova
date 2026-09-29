// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => <p>Synthetic signing code</p> }));

import { useCryptoTransferSigning } from '../hooks/useCryptoTransferSigning';
import { TransferSigningFlow } from './TransferSigningFlow';

const wallet = {
  uuid: 'wallet-1',
  address: fixture.signer.address,
  chain: 'base',
  derivationPath: fixture.signer.derivationPath,
  masterFingerprint: '12345678',
} as unknown as Wallet;

let client: QueryClient;

function Sending({ amount, tokenContract }: { amount: string; tokenContract?: string }) {
  const signing = useCryptoTransferSigning({
    wallet,
    toAddress: fixture.native.toAddress,
    amount,
    tokenContract,
    decimals: tokenContract ? 2 : 18,
  });
  return (
    <TransferSigningFlow
      isOpen
      onClose={() => {}}
      transferType={tokenContract ? 'stablecoin' : 'crypto'}
      wallet={wallet}
      toAddress={fixture.native.toAddress}
      amount={amount}
      preparedTransaction={signing.preparedTransaction}
      isPreparing={signing.isPreparing}
      prepareError={signing.prepareError}
      onPrepare={signing.prepare}
      onBroadcast={signing.broadcast}
    />
  );
}

function send(answer: object, amount: string, tokenContract?: string) {
  api.post.mockResolvedValue({ data: answer });
  render(
    <QueryClientProvider client={client}>
      <Sending amount={amount} tokenContract={tokenContract} />
    </QueryClientProvider>,
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

it.each([
  ['native', fixture.native, '0.1', undefined],
  ['token', fixture.token, '1.5', fixture.token.tokenContract],
])(
  'offers the %s transfer for signing when the backend prepared what was entered',
  async (_, answer, amount, token) => {
    send(answer, amount, token);
    expect(
      await screen.findByText('Sign this transfer with your hardware wallet to authorize the transaction.'),
    ).toBeTruthy();
  },
);

it.each([
  ['another recipient', { ...fixture.native, toAddress: `0x${'5'.repeat(40)}` }, '0.1', undefined, 'recipient'],
  ['0.5 ETH for 0.1 entered', { ...fixture.native, amountEth: '0.5' }, '0.1', undefined, 'amount'],
  ['15 tokens for 1.5 entered', { ...fixture.token, amountToken: '15' }, '1.5', fixture.token.tokenContract, 'amount'],
  [
    '1.555 of a two-decimal token',
    { ...fixture.token, amountToken: '1.555' },
    '1.555',
    fixture.token.tokenContract,
    'amount',
  ],
])('refuses %s before offering the transfer for signing', async (_, answer, amount, token, field) => {
  send(answer, amount, token);
  expect(
    await screen.findByText(`The prepared transfer does not match what you entered: the ${field} is different.`),
  ).toBeTruthy();
  expect(screen.queryByText('Sign this transfer with your hardware wallet to authorize the transaction.')).toBeNull();
});
