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

const ether = {
  id: 'native-base',
  type: 'crypto' as const,
  symbol: 'ETH',
  name: 'Ether',
  balance: '0.0000205',
  displayBalance: '0.0000205',
  marketValue: '0',
  decimals: 18,
};

it('writes a maximum a millionth above the fee estimate as a plain decimal', () => {
  const wallet = {
    uuid: 'wallet-1',
    address: `0x${'1'.repeat(40)}`,
    chain: 'base',
    nativeBalance: '0.0000205',
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
  expect(screen.getByDisplayValue('0.0000005')).toBeTruthy();
});
