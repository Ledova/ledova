// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';

vi.mock('@hooks/useCurrency', () => ({
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value}` }),
}));

import { SendFormModal } from './SendFormModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const wallet = {
  uuid: 'wallet-1',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
  nativeBalance: '1',
  nativeMarketValue: '1',
} as unknown as Wallet;

const ether = {
  id: 'native-base',
  type: 'crypto' as const,
  symbol: 'ETH',
  name: 'Ether',
  balance: '1',
  displayBalance: '1',
  marketValue: '1',
  decimals: 18,
};
const coin = {
  id: 'holding-usdc',
  type: 'stablecoin' as const,
  symbol: 'USDC',
  name: 'USD Coin',
  balance: '50',
  displayBalance: '50',
  marketValue: '50',
  decimals: 6,
  tokenAddress: `0x${'5'.repeat(40)}`,
};

const onAssetChange = vi.fn();
const onAddressChange = vi.fn();

function form(props: Partial<ComponentProps<typeof SendFormModal>>) {
  return (
    <SendFormModal
      isOpen
      onClose={() => {}}
      wallet={wallet}
      assets={[ether, coin]}
      isLoadingAssets={false}
      hasShareTokens={false}
      isSenderWhitelisted
      isRecipientWhitelisted
      isCheckingRecipientWhitelist={false}
      onBack={() => {}}
      onTransfer={() => {}}
      onAssetChange={onAssetChange}
      onAddressChange={onAddressChange}
      {...props}
    />
  );
}

it('selects the first asset when it opens with assets already loaded, and tells the flow', () => {
  render(form({}));
  expect(screen.getByText('Amount (ETH)')).toBeTruthy();
  expect(onAssetChange).toHaveBeenLastCalledWith(ether);
  expect(onAddressChange).toHaveBeenLastCalledWith('');
});

it('waits for the assets to load before selecting the first one', () => {
  const view = render(form({ isLoadingAssets: true, assets: [ether] }));
  expect(screen.queryByText('Amount (ETH)')).toBeNull();
  expect(onAssetChange).toHaveBeenLastCalledWith(null);
  view.rerender(form({}));
  expect(screen.getByText('Amount (ETH)')).toBeTruthy();
  expect(onAssetChange).toHaveBeenLastCalledWith(ether);
});

it('clears the form and the flow each time it opens again', () => {
  const view = render(form({}));
  fireEvent.click(screen.getByText('USDC'));
  fireEvent.change(screen.getByPlaceholderText('0x...'), { target: { value: `0x${'2'.repeat(40)}` } });
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '5' } });
  expect(screen.getByText('Amount (USDC)')).toBeTruthy();
  expect(onAssetChange).toHaveBeenLastCalledWith(coin);

  view.rerender(form({ isOpen: false }));
  view.rerender(form({}));
  expect(screen.getByText('Amount (ETH)')).toBeTruthy();
  expect((screen.getByPlaceholderText('0x...') as HTMLInputElement).value).toBe('');
  expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('');
  expect(onAssetChange).toHaveBeenLastCalledWith(ether);
  expect(onAddressChange).toHaveBeenLastCalledWith('');
});
