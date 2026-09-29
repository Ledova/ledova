// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import type { Wallet } from '@ledova/shared';
import { WalletItem } from './WalletItem';

vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value.toFixed(2)}` }),
}));

const wallet: Wallet = {
  uuid: 'wallet',
  userAccount: 'account',
  address: '0x' + 'a'.repeat(40),
  chain: 'base',
  verificationStatus: 'VERIFIED',
  verificationChallenge: null,
  verificationSignature: null,
  verifiedAt: null,
  lastSyncedAt: null,
  nativeBalance: '0',
  nativeMarketValue: '0',
  marketValue: '0',
  createdAt: '2026-09-09T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
};

afterEach(cleanup);

function figures(view: ReturnType<typeof render>) {
  const list = view.container.querySelector('dl')!;
  return Array.from(list.children).map((cell) => `${cell.tagName} ${cell.textContent}`);
}

describe('wallet signing preferences on the dashboard', () => {
  it.each(['hardware', 'software'] as const)(
    'labels %s as self-declared independently of address verification',
    (signingPreference) => {
      const view = render(<WalletItem wallet={{ ...wallet, signingPreference }} />);
      expect(
        view.getByLabelText(`${signingPreference === 'hardware' ? 'Hardware' : 'Software'} (self-declared)`),
      ).toBeTruthy();
      expect(view.getByLabelText('Wallet address verified')).toBeTruthy();
    },
  );

  it('does not invent a type badge for an unspecified preference', () => {
    const view = render(<WalletItem wallet={{ ...wallet, signingPreference: null }} />);
    expect(view.queryByLabelText('Hardware (self-declared)')).toBeNull();
    expect(view.queryByLabelText('Software (self-declared)')).toBeNull();
    expect(view.getByLabelText('Wallet address verified')).toBeTruthy();
  });
});

describe('a wallet row on the dashboard', () => {
  it.each([
    ['base', 'ETH'],
    ['ethereum', 'ETH'],
    ['bitcoin', 'BTC'],
  ] as const)("labels a %s wallet's balance in %s and its value, where there were two bare figures", (chain, unit) => {
    const view = render(<WalletItem wallet={{ ...wallet, chain, nativeBalance: '0.25', marketValue: '12.5' }} />);
    expect(figures(view)).toEqual(['DT Balance', `DD 0.25 ${unit}`, 'DT Value', 'DD AUD 12.50']);
  });

  it('names the wallet above its address and holds what is passed under it, rather than being a button', () => {
    const view = render(
      <WalletItem wallet={{ ...wallet, name: 'Primary wallet' }}>
        <p>Row actions</p>
      </WalletItem>,
    );
    expect(view.queryByRole('button')).toBeNull();
    const row = view.container.firstElementChild as HTMLElement;
    expect(within(row).getByText('Primary wallet').compareDocumentPosition(within(row).getByText(wallet.address))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(row).getByText('Row actions')).toBeTruthy();
  });
});
