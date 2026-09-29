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
  return Array.from(view.getByText('Balance').parentElement!.children).map((cell) => cell.textContent);
}

describe('wallet signing preferences on the dashboard', () => {
  it.each([
    ['VERIFIED', 'Wallet address verified'],
    ['PENDING', 'Wallet address verification pending'],
  ] as const)(
    'exposes the %s status and the signing preference as named images, with their glyphs hidden',
    (verificationStatus, status) => {
      const view = render(
        <WalletItem
          wallet={{
            ...wallet,
            verificationStatus,
            signingPreference: 'hardware',
            lastSyncedAt: new Date().toISOString(),
          }}
        />,
      );
      expect(view.getByText('just now')).toBeTruthy();
      expect(view.getAllByRole('img').map((image) => image.getAttribute('aria-label'))).toEqual([
        status,
        'Hardware (self-declared)',
      ]);
      expect(view.getByRole('img', { name: status })).toBeTruthy();
      expect(view.getByRole('img', { name: 'Hardware (self-declared)' })).toBeTruthy();
      const glyphs = Array.from(view.container.querySelectorAll('svg'));
      expect(glyphs.length).toBeGreaterThan(0);
      expect(glyphs.filter((glyph) => glyph.getAttribute('aria-hidden') !== 'true')).toEqual([]);
    },
  );

  it.each(['hardware', 'software'] as const)(
    'labels %s as self-declared independently of address verification',
    (signingPreference) => {
      const view = render(<WalletItem wallet={{ ...wallet, signingPreference }} />);
      expect(
        view.getByRole('img', {
          name: `${signingPreference === 'hardware' ? 'Hardware' : 'Software'} (self-declared)`,
        }),
      ).toBeTruthy();
      expect(view.getByRole('img', { name: 'Wallet address verified' })).toBeTruthy();
    },
  );

  it('does not invent a type badge for an unspecified preference', () => {
    const view = render(<WalletItem wallet={{ ...wallet, signingPreference: null }} />);
    expect(view.queryByLabelText('Hardware (self-declared)')).toBeNull();
    expect(view.queryByLabelText('Software (self-declared)')).toBeNull();
    expect(view.getAllByRole('img').map((image) => image.getAttribute('aria-label'))).toEqual([
      'Wallet address verified',
    ]);
  });
});

describe('a wallet row on the dashboard', () => {
  it.each([
    ['base', 'ETH'],
    ['ethereum', 'ETH'],
    ['bitcoin', 'BTC'],
  ] as const)("labels a %s wallet's balance in %s and its value, where there were two bare figures", (chain, unit) => {
    const view = render(<WalletItem wallet={{ ...wallet, chain, nativeBalance: '0.25', marketValue: '12.5' }} />);
    expect(figures(view)).toEqual(['Balance', `0.25 ${unit}`, 'Value', 'AUD 12.50']);
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
