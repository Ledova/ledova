// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Wallet } from '@ledova/shared';

vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `$${value}` }),
}));

import { SendFormModal } from './SendFormModal';

afterEach(() => {
  cleanup();
});

it.each([
  ['a millionth above the fee estimate', '0.0000205', '0.0000005'],
  ['3.3 ETH, without the float noise of eighteen places', '3.3', '3.29998'],
])('writes the maximum of %s as a plain decimal', (_, balance, maximum) => {
  const ether = {
    id: 'native-base',
    type: 'crypto' as const,
    symbol: 'ETH',
    name: 'Ether',
    balance,
    displayBalance: balance,
    marketValue: '0',
    decimals: 18,
  };
  const wallet = {
    uuid: 'wallet-1',
    address: `0x${'1'.repeat(40)}`,
    chain: 'base',
    nativeBalance: balance,
    nativeMarketValue: '0',
  } as unknown as Wallet;
  render(
    <SendFormModal
      isOpen
      onClose={() => {}}
      wallet={wallet}
      assets={[ether]}
      isLoadingAssets={false}
      hasShareTokens={false}
      isSenderWhitelisted
      isRecipientWhitelisted
      isCheckingRecipientWhitelist={false}
      onBack={() => {}}
      onTransfer={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Use Max' }));
  expect(screen.getByDisplayValue(maximum)).toBeTruthy();
});
