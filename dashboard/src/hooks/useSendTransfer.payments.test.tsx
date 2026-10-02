// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import apiClient from '@services/apiClient';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';
import type { ComponentProps } from 'react';
import type { TransferSigningFlow } from '@pages/wallets/components/TransferSigningFlow';
import fixture from '../../../packages/shared/tests/fixtures/prepared-transfer-api.json';

const wallet = {
  uuid: 'wallet-1',
  address: fixture.signer.address,
  chain: 'base',
  nativeBalance: '1',
  nativeMarketValue: '1',
} as unknown as Wallet;
const amount = '1.5000';
const prepared = { ...fixture.token, amountToken: amount };
const signingFlow = vi.fn();
const getWhitelistStatus = vi.fn();
const prepareTransfer = vi.fn(async () => ({ data: prepared }));

const getWalletHoldings = vi.fn(() =>
  Promise.resolve({
    data: [
      {
        uuid: 'share-holding',
        walletUuid: wallet.uuid,
        chain: wallet.chain,
        quantity: '10000',
        marketValue: '10000',
        assetSymbol: 'QAT',
        assetName: 'QA Shares',
        shareClass: null,
        asset: {
          isActive: true,
          assetType: 'tokenized_security',
          chainDeployments: [{ chain: 'base', contractAddress: `0x${'3'.repeat(40)}`, decimals: 0, isActive: true }],
        },
      },
      {
        uuid: 'payment-holding',
        walletUuid: wallet.uuid,
        chain: wallet.chain,
        quantity: '12.50',
        marketValue: null,
        assetSymbol: 'AUDY',
        assetName: 'Australian Dollar',
        shareClass: null,
        asset: {
          isActive: true,
          assetType: 'stablecoin',
          chainDeployments: [
            { chain: 'base', contractAddress: fixture.token.tokenContract, decimals: 2, isActive: true },
          ],
        },
      },
    ],
  }),
);

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(async () => ({ data: { valid: false } })) } }));

vi.mock('@ledova/shared', async () => {
  const actual = await vi.importActual<typeof import('@ledova/shared')>('@ledova/shared');
  return { ...actual, getWhitelistStatus, getWalletHoldings, prepareTransfer };
});

vi.mock('@pages/wallets/components/WalletSelectionModal', () => ({
  WalletSelectionModal: ({ isOpen, onSelectWallet }: { isOpen: boolean; onSelectWallet: (w: Wallet) => void }) =>
    isOpen ? (
      <button type="button" onClick={() => onSelectWallet(wallet)}>
        pick the wallet
      </button>
    ) : null,
}));

vi.mock('@pages/wallets/components/TransferSigningFlow', () => ({
  TransferSigningFlow: (props: ComponentProps<typeof TransferSigningFlow>) => {
    signingFlow(props);
    return props.isOpen ? (
      <button type="button" onClick={props.onPrepare}>
        prepare payment
      </button>
    ) : null;
  },
}));

const { ApiClientProvider } = await import('@ledova/shared');
const { SendTransferProvider, useSendTransfer } = await import('./useSendTransfer');

function Opener() {
  const { openSendTransfer } = useSendTransfer();
  return (
    <button type="button" onClick={openSendTransfer}>
      open send
    </button>
  );
}

function renderProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <SendTransferProvider>
          <Opener />
        </SendTransferProvider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the real Send provider payment flow', () => {
  it('carries the chosen payment, recipient and decimal amount into signing and preparation', async () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: /open send/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pick the wallet/i }));
    fireEvent.click(await screen.findByText('AUDY'));
    expect(screen.queryByText('QAT')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('0x...'), { target: { value: fixture.token.toAddress } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: amount } });

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByRole('button', { name: 'prepare payment' });
    expect(signingFlow).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isOpen: true,
        wallet,
        transferType: 'stablecoin',
        token: { symbol: 'AUDY', name: 'Australian Dollar' },
        toAddress: fixture.token.toAddress,
        amount,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'prepare payment' }));
    await waitFor(() =>
      expect(prepareTransfer).toHaveBeenCalledWith(apiClient, wallet.uuid, {
        toAddress: fixture.token.toAddress,
        amountToken: amount,
        tokenContract: fixture.token.tokenContract,
      }),
    );
    await waitFor(() =>
      expect(signingFlow).toHaveBeenLastCalledWith(
        expect.objectContaining({ preparedTransaction: prepared, prepareError: null }),
      ),
    );
    expect(getWhitelistStatus).not.toHaveBeenCalled();
  });
});
