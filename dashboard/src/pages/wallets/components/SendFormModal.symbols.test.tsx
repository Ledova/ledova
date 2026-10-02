// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';

const sender = `0x${'1'.repeat(40)}`;

function shareHolding(uuid: string, assetSymbol: string, companyName: string, contract: string) {
  return {
    uuid,
    walletUuid: 'wallet-1',
    chain: 'base',
    quantity: '40',
    marketValue: null,
    assetSymbol,
    assetName: `${companyName} Ordinary Shares`,
    shareClass: { uuid: `${uuid}-class`, name: 'Ordinary Shares', symbol: 'ORD', companyName },
    asset: {
      isActive: true,
      assetType: 'tokenized_security',
      chainDeployments: [{ chain: 'base', contractAddress: contract, decimals: 0, isActive: true }],
    },
  };
}

const getWalletHoldings = vi.fn(() =>
  Promise.resolve({
    data: [
      shareHolding('first', 'ORD', 'First Fictional Pty Ltd', `0x${'3'.repeat(40)}`),
      shareHolding('second', 'ORD.123456782', 'Second Fictional Pty Ltd', `0x${'4'.repeat(40)}`),
    ],
  }),
);
const getWhitelistStatus = vi.fn((_client: unknown, _token: string, address: string) =>
  Promise.resolve({ data: { address, isWhitelisted: true, status: 'whitelisted' } }),
);

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(async () => ({ data: {} })) } }));

vi.mock('@ledova/shared', async () => {
  const actual = await vi.importActual<typeof import('@ledova/shared')>('@ledova/shared');
  return { ...actual, getWhitelistStatus, getWalletHoldings };
});

const { ApiClientProvider } = await import('@ledova/shared');
const { useTransferFlow } = await import('../hooks/useTransferFlow');
const { SendFormModal } = await import('./SendFormModal');

const wallet = {
  uuid: 'wallet-1',
  address: sender,
  chain: 'base',
  nativeBalance: '1',
  nativeMarketValue: '1',
} as unknown as Wallet;

function Harness() {
  const flow = useTransferFlow(wallet);
  return (
    <SendFormModal
      isOpen
      onClose={() => {}}
      wallet={wallet}
      assets={flow.assets}
      isLoadingAssets={flow.isLoadingAssets}
      hasShareTokens={flow.hasShareTokens}
      isSenderWhitelisted={flow.isSenderWhitelisted}
      isRecipientWhitelisted={flow.isRecipientWhitelisted}
      isCheckingRecipientWhitelist={flow.isCheckingRecipientWhitelist}
      onTransfer={flow.handleCombinedTransfer}
      onAddressChange={flow.setToAddress}
      onAssetChange={flow.setSelectedAsset}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('lists each share class by its own symbol beside its company, never by the bridged asset symbol', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <Harness />
      </ApiClientProvider>
    </QueryClientProvider>,
  );

  const second = (await screen.findByText('Second Fictional Pty Ltd')).closest('button')!;
  const first = screen.getByText('First Fictional Pty Ltd').closest('button')!;
  for (const row of [first, second]) expect(within(row).getByText('ORD')).toBeDefined();
  expect(screen.queryByText(/ORD\.123456782/)).toBeNull();

  fireEvent.click(second);

  expect(screen.getByText('Amount (ORD)')).toBeDefined();
  expect(screen.queryByText(/ORD\.123456782/)).toBeNull();
});
