import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Wallet } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { SendForm } from './components/SendForm';
import { useTransfers } from './useTransfers';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { uuid: 'owner' } }),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value.toFixed(2)}` }),
}));

const RECIPIENT = `0x${'b'.repeat(40)}`;
const STABLECOIN = `0x${'5'.repeat(40)}`;
const REFUSAL =
  'The recipient has no current approval with any company, so it cannot receive TUSD. ' +
  'Check the address, or ask the recipient to have their wallet approved.';

const wallet = {
  uuid: 'wallet-base',
  address: `0x${'a'.repeat(40)}`,
  chain: 'base',
  nativeBalance: '1',
  nativeMarketValue: '1',
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
    <>
      <SendForm
        chainShortName="BASE"
        walletName="Test wallet"
        walletAddress={wallet.address}
        selectedAsset={transfer.selectedAsset}
        transferableAssets={transfer.transferableAssets}
        toAddress={transfer.toAddress}
        amount={transfer.amount}
        isLoadingHoldings={transfer.isLoadingHoldings}
        selectAsset={transfer.selectAsset}
        setToAddress={transfer.setToAddress}
        setAmount={transfer.setAmount}
        useMaxAmount={transfer.useMaxAmount}
        onOpenAddressScanner={jest.fn()}
      />
      {transfer.prepareError ? <Text>{transfer.prepareError}</Text> : null}
    </>
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
            uuid: 'stablecoin-holding',
            walletUuid: wallet.uuid,
            chain: 'base',
            quantity: '100',
            assetSymbol: 'TUSD',
            assetName: 'Test Dollar',
            marketValue: '100',
            asset: {
              isActive: true,
              assetType: 'stablecoin',
              decimals: 2,
              contractAddress: STABLECOIN,
              chainDeployments: [{ chain: 'base', contractAddress: STABLECOIN, decimals: 2, isActive: true }],
            },
          },
        ]
      : { results: [wallet], count: 1, next: null, previous: null },
  }));
  (apiClient.post as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Request failed with status code 403'), {
      response: { status: 403, data: { detail: REFUSAL, code: 'stablecoin_approval_required' } },
    }),
  );
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.clearAllMocks();
});

it('shows the approval refusal the backend returns when a stablecoin transfer is prepared', async () => {
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
  await waitFor(() => expect(transfer.isLoadingHoldings).toBe(false));
  const stablecoin = transfer.transferableAssets.find((asset) => asset.symbol === 'TUSD');
  await act(async () => {
    transfer.selectAsset(stablecoin!);
  });
  await act(async () => {
    transfer.setToAddress(RECIPIENT);
    transfer.setAmount('5');
  });

  await act(async () => {
    transfer.submitTransfer();
  });

  expect(await view.findByText(REFUSAL)).toBeTruthy();
  expect(apiClient.post).toHaveBeenCalledWith('/api/wallets/wallet-base/prepare-transfer/', {
    toAddress: RECIPIENT,
    amountToken: '5',
    tokenContract: STABLECOIN,
  });
});
