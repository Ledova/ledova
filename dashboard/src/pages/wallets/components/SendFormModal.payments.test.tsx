// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';

const sender = `0x${'1'.repeat(40)}`;
const recipient = `0x${'2'.repeat(40)}`;

function holding(symbol: string, assetType: string, decimals: number, quantity: string, marketValue: string | null) {
  return {
    uuid: `holding-${symbol}`,
    walletUuid: 'wallet-1',
    chain: 'base',
    quantity,
    marketValue,
    assetSymbol: symbol,
    assetName: symbol,
    shareClass: null,
    asset: {
      isActive: true,
      assetType,
      chainDeployments: [{ chain: 'base', contractAddress: `0x${'3'.repeat(40)}`, decimals, isActive: true }],
    },
  };
}

const getWhitelistStatus = vi.fn();
const getWalletHoldings = vi.fn(() =>
  Promise.resolve({
    data: [
      {
        ...holding('QAT', 'tokenized_security', 0, '10000', '10000'),
        shareClass: { uuid: 'qat-class', symbol: 'QAT', name: 'Ordinary', companyName: 'Fictional Shares Pty Ltd' },
      },
      holding('QAT.123456782', 'tokenized_security', 0, '40', null),
      holding('USDC', 'stablecoin', 6, '1000.50', '1000.50'),
      holding('AUDY', 'stablecoin', 2, '12.50', null),
    ],
  }),
);

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(async () => ({ data: { valid: false } })) } }));

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
      senderWhitelistStatus={flow.senderWhitelistStatus}
      recipientWhitelistStatus={flow.recipientWhitelistStatus}
      onBack={() => {}}
      onTransfer={flow.handleCombinedTransfer}
      onAddressChange={flow.setToAddress}
      onAssetChange={flow.setSelectedAsset}
    />
  );
}

function renderFlow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <Harness />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

async function choosePayment(symbol: string) {
  fireEvent.click(await screen.findByText(symbol));
  fireEvent.change(screen.getByPlaceholderText('0x...'), { target: { value: recipient } });
}

function continueDisabled() {
  return screen.getByRole('button', { name: /continue/i }).hasAttribute('disabled');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Send form payment policy', () => {
  it('offers ETH, USDC and AUDY while excluding shares with or without class metadata', async () => {
    renderFlow();

    await screen.findByText('USDC');

    expect(screen.getByText('ETH')).toBeDefined();
    expect(screen.getByText('AUDY')).toBeDefined();
    expect(screen.queryByText(/QAT/)).toBeNull();
    expect(screen.queryByText('Fictional Shares Pty Ltd')).toBeNull();
    expect(getWalletHoldings).toHaveBeenCalledWith(apiClient, wallet.uuid);
    expect(getWhitelistStatus).not.toHaveBeenCalled();
  });

  it('keeps an unpriced payment nullable and permits a valid decimal quantity', async () => {
    renderFlow();
    await choosePayment('AUDY');

    const payment = screen.getByText('AUDY').closest('button')!;
    expect(within(payment).getByText('Unpriced')).toBeDefined();
    expect(within(payment).queryByText(/NaN|\$0\.00/)).toBeNull();
    expect(screen.getByText('Unpriced: no fiat estimate available.')).toBeDefined();
    expect(screen.getByText('Max: 12.50 AUDY')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '2.50' } });

    expect(continueDisabled()).toBe(false);
    expect(getWhitelistStatus).not.toHaveBeenCalled();
  });

  it.each(['ETH', 'USDC', 'AUDY'])(
    'permits %s without querying a sender or recipient share allowlist',
    async (symbol) => {
      renderFlow();
      await screen.findByText('USDC');
      await choosePayment(symbol);
      fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.50' } });

      expect(continueDisabled()).toBe(false);
      expect(getWhitelistStatus).not.toHaveBeenCalled();
      expect(screen.queryByText(/whitelisted|Checking whitelist/i)).toBeNull();
    },
  );

  it('marks the chosen payment as a pressed row and clears the previous amount', async () => {
    renderFlow();
    await screen.findByText('USDC');
    const ether = screen.getByText('ETH').closest('button')!;
    const usdc = screen.getByText('USDC').closest('button')!;
    expect(ether.getAttribute('aria-pressed')).toBe('true');
    expect(usdc.getAttribute('aria-pressed')).toBe('false');
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0.50' } });

    fireEvent.click(usdc);

    expect(usdc.getAttribute('aria-pressed')).toBe('true');
    expect(ether.getAttribute('aria-pressed')).toBe('false');
    expect(usdc.parentElement!.className).toContain('divide-y');
    expect(screen.getByText('Amount (USDC)')).toBeDefined();
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('');
    expect(continueDisabled()).toBe(true);
  });

  it('keeps an invalid destination disabled and presents its warning as a line', async () => {
    renderFlow();
    await choosePayment('USDC');
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '2.50' } });
    fireEvent.change(screen.getByPlaceholderText('0x...'), { target: { value: '0x123' } });

    const warning = screen.getByText(/Please enter a valid.*address/);
    expect(warning.closest('p')!.className).toContain('text-warning-light');
    expect(warning.closest('[class*="bg-warning"]')).toBeNull();
    expect(continueDisabled()).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('0x...'), { target: { value: recipient } });
    expect(screen.queryByText(/Please enter a valid.*address/)).toBeNull();
    expect(continueDisabled()).toBe(false);
  });

  it('requires a positive quantity within the payment balance and supports its full maximum', async () => {
    renderFlow();
    await choosePayment('AUDY');
    const amount = screen.getByPlaceholderText('0.00');
    expect(continueDisabled()).toBe(true);
    fireEvent.change(amount, { target: { value: '0' } });
    expect(continueDisabled()).toBe(true);
    fireEvent.change(amount, { target: { value: '12.51' } });
    expect(screen.getByText('Amount exceeds available balance')).toBeDefined();
    expect(continueDisabled()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Use Max' }));

    expect((amount as HTMLInputElement).value).toBe('12.50');
    expect(screen.queryByText('Amount exceeds available balance')).toBeNull();
    expect(continueDisabled()).toBe(false);
    expect(getWhitelistStatus).not.toHaveBeenCalled();
  });
});
