import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Wallet } from '@ledova/shared';
import fixture from '../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { apiClient } from '../../services/apiClient';
import { SendForm } from './components/SendForm';
import { useTransfers } from './useTransfers';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));
jest.mock('../../_mock/mockDataEnabled', () => ({ mockDataEnabled: () => false }));

const wallet = {
  uuid: 'wallet-base',
  address: fixture.signer.address,
  chain: 'base',
  nativeBalance: '20',
  nativeMarketValue: '20',
  verificationStatus: 'VERIFIED',
} as Wallet;

type Transfer = ReturnType<typeof useTransfers>;

let client: QueryClient;
let holdings: object[];

function tokenHolding(quantity: string, decimals: number) {
  return {
    uuid: 'token-holding',
    walletUuid: wallet.uuid,
    chain: 'base',
    quantity,
    assetSymbol: fixture.token.tokenSymbol,
    assetName: 'Repro token',
    marketValue: quantity,
    asset: {
      isActive: true,
      assetType: 'erc20_token',
      decimals,
      contractAddress: fixture.token.tokenContract,
      chainDeployments: [{ chain: 'base', contractAddress: fixture.token.tokenContract, decimals, isActive: true }],
    },
  };
}

function Sending({ expose }: { expose: (transfer: Transfer) => void }) {
  const transfer = useTransfers();
  useEffect(() => {
    expose(transfer);
  });
  return (
    <SendForm
      chainShortName="BASE"
      walletName="Test wallet"
      walletAddress={wallet.address}
      selectedAsset={transfer.selectedAsset}
      transferableAssets={transfer.transferableAssets}
      toAddress={transfer.toAddress}
      amount={transfer.amount}
      isLoadingHoldings={transfer.isLoadingHoldings}
      prepareError={transfer.prepareError}
      selectAsset={transfer.selectAsset}
      setToAddress={transfer.setToAddress}
      setAmount={transfer.setAmount}
      useMaxAmount={transfer.useMaxAmount}
      onOpenAddressScanner={jest.fn()}
    />
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  holdings = [tokenHolding('1000', 2)];
  (apiClient.get as jest.Mock).mockImplementation(async (url: string) => ({
    data: url.includes('/holdings/') ? holdings : { results: [wallet], count: 1, next: null, previous: null },
  }));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
});

async function choose(kind: 'native' | 'token', chosen: Wallet = wallet) {
  let transfer!: Transfer;
  const view = await render(
    <QueryClientProvider client={client}>
      <Sending
        expose={(value) => {
          transfer = value;
        }}
      />
    </QueryClientProvider>,
  );
  await act(async () => {
    transfer.selectWallet(chosen);
  });
  await view.findByText(fixture.token.tokenSymbol, { exact: false });
  const asset = transfer.transferableAssets.find((candidate) => candidate.isNative === (kind === 'native'))!;
  await act(async () => {
    transfer.selectAsset(asset);
  });
  return { view, transfer: () => transfer };
}

async function prepare(kind: 'native' | 'token', typedAmount: string, answer: object) {
  (apiClient.post as jest.Mock).mockResolvedValue({ data: answer });
  const { view, transfer: current } = await choose(kind);
  const transfer = current();
  await act(async () => {
    transfer.setToAddress(fixture.native.toAddress);
    transfer.setAmount(typedAmount);
  });
  await act(async () => {
    current().submitTransfer();
  });
  return { view, transfer: current };
}

it.each([
  ['native', '0.1', fixture.native],
  ['token', '1.5', fixture.token],
] as const)('reviews the %s transfer the backend prepared for what was entered', async (kind, typed, answer) => {
  const { transfer } = await prepare(kind, typed, answer);
  await waitFor(() => expect(transfer().step).toBe('review'));
  expect(transfer().prepareError).toBeNull();
});

it.each([
  ['1.500 of a two-decimal token', 'token', '1.500', { ...fixture.token, amountToken: '1.500' }],
  ['1e-7 ETH', 'native', '1e-7', { ...fixture.native, amountEth: '0.0000001' }],
] as const)('reviews %s, which the backend accepts and echoes', async (_, kind, typed, answer) => {
  const { transfer } = await prepare(kind, typed, answer);
  await waitFor(() => expect(transfer().step).toBe('review'));
  expect(transfer().prepareError).toBeNull();
});

it.each([
  ['a token balance below a millionth', 'token', wallet, tokenHolding('0.0000005', 18), '0.0000005'],
  [
    'an ETH balance a millionth above the fee estimate',
    'native',
    { ...wallet, nativeBalance: '0.0000205' },
    tokenHolding('1000', 2),
    '0.0000005',
  ],
] as const)('Use Max writes %s as a plain decimal', async (_, kind, chosen, holding, amount) => {
  holdings = [holding];
  const { transfer } = await choose(kind, chosen);
  await act(async () => {
    transfer().useMaxAmount();
  });
  expect(transfer().amount).toBe(amount);
});

const REFUSAL =
  'This wallet has no current approval with any company, so it cannot send R779. Ask the operator to approve it, then try again.';

function refused() {
  return Object.assign(new Error('Request failed with status code 403'), {
    response: { status: 403, data: { detail: REFUSAL, code: 'stablecoin_approval_required' } },
  });
}

async function refusedTokenSend() {
  (apiClient.post as jest.Mock).mockRejectedValue(refused());
  const { view, transfer } = await choose('token');
  await act(async () => {
    transfer().setToAddress(fixture.native.toAddress);
    transfer().setAmount('1.5');
  });
  await act(async () => {
    transfer().submitTransfer();
  });
  expect(await view.findByText(REFUSAL)).toBeTruthy();
  return { view, transfer };
}

it.each([
  ['another token is chosen', (transfer: Transfer) => transfer.selectAsset(transfer.transferableAssets[0])],
  ['the recipient changes', (transfer: Transfer) => transfer.setToAddress(`0x${'5'.repeat(40)}`)],
  ['the amount changes', (transfer: Transfer) => transfer.setAmount('2')],
  ['Use Max fills the amount', (transfer: Transfer) => transfer.useMaxAmount()],
  ['another wallet is chosen', (transfer: Transfer) => transfer.selectWallet({ ...wallet, uuid: 'wallet-other' })],
])("clears a refused prepare's message when %s", async (_, change) => {
  const { view, transfer } = await refusedTokenSend();
  await act(async () => {
    change(transfer());
  });
  await view.findByText('Destination Address');
  expect(view.queryByText(REFUSAL)).toBeNull();
  expect(transfer().prepareError).toBeNull();
});

it('shows the refusal again when the same inputs are retried, and not while the retry is prepared', async () => {
  const { view, transfer } = await refusedTokenSend();
  let refuse!: (error: unknown) => void;
  (apiClient.post as jest.Mock).mockReturnValue(
    new Promise((_, reject) => {
      refuse = reject;
    }),
  );
  await act(async () => {
    transfer().submitTransfer();
  });
  const preparing = transfer().isPreparing;
  const shownWhilePreparing = view.queryByText(REFUSAL);
  await act(async () => {
    refuse(refused());
  });
  expect(preparing).toBe(true);
  expect(shownWhilePreparing).toBeNull();
  expect(await view.findByText(REFUSAL)).toBeTruthy();
});

it('Try Anyway on an ETH balance below the fee estimate writes nine tenths of it as a plain decimal', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { transfer } = await choose('native', { ...wallet, nativeBalance: '0.000001' });
  await act(async () => {
    transfer().useMaxAmount();
  });
  const tryAnyway = alert.mock.calls[0][2]!.find((button) => button.text === 'Try Anyway')!;
  await act(async () => {
    tryAnyway.onPress!();
  });
  expect(transfer().amount).toBe('0.0000009');
  alert.mockRestore();
});

it.each([
  ['another recipient', 'native', '0.1', { ...fixture.native, toAddress: `0x${'5'.repeat(40)}` }, 'recipient'],
  ['0.5 ETH for 0.1 typed', 'native', '0.1', { ...fixture.native, amountEth: '0.5' }, 'amount'],
  ['15 tokens for 1.5 typed', 'token', '1.5', { ...fixture.token, amountToken: '15' }, 'amount'],
  ['1.555 of a two-decimal token', 'token', '1.555', { ...fixture.token, amountToken: '1.555' }, 'amount'],
  [
    'the same call on another token contract',
    'token',
    '1.5',
    {
      ...fixture.token,
      tokenContract: `0x${'5'.repeat(40)}`,
      transaction: { ...fixture.token.transaction, to: `0x${'5'.repeat(40)}` },
    },
    'token',
  ],
] as const)('refuses %s before the review screen', async (_, kind, typed, answer, field) => {
  const { view, transfer } = await prepare(kind, typed, answer);
  expect(
    await view.findByText(`The prepared transfer does not match what you entered: the ${field} is different.`),
  ).toBeTruthy();
  expect(transfer().step).toBe('enter-details');
});
