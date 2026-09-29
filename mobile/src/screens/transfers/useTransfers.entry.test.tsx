import React, { useEffect } from 'react';
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
  (apiClient.get as jest.Mock).mockImplementation(async (url: string) => ({
    data: url.includes('/holdings/')
      ? [
          {
            uuid: 'token-holding',
            walletUuid: wallet.uuid,
            chain: 'base',
            quantity: '1000',
            assetSymbol: fixture.token.tokenSymbol,
            assetName: 'Repro token',
            marketValue: '1000',
            asset: {
              isActive: true,
              assetType: 'erc20_token',
              decimals: 2,
              contractAddress: fixture.token.tokenContract,
              chainDeployments: [
                { chain: 'base', contractAddress: fixture.token.tokenContract, decimals: 2, isActive: true },
              ],
            },
          },
        ]
      : { results: [wallet], count: 1, next: null, previous: null },
  }));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
});

async function prepare(kind: 'native' | 'token', typedAmount: string, answer: object) {
  (apiClient.post as jest.Mock).mockResolvedValue({ data: answer });
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
    transfer.selectWallet(wallet);
  });
  await view.findByText(fixture.token.tokenSymbol, { exact: false });
  const asset = transfer.transferableAssets.find((candidate) => candidate.isNative === (kind === 'native'))!;
  await act(async () => {
    transfer.selectAsset(asset);
  });
  await act(async () => {
    transfer.setToAddress(fixture.native.toAddress);
    transfer.setAmount(typedAmount);
  });
  await act(async () => {
    transfer.submitTransfer();
  });
  return { view, transfer: () => transfer };
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
