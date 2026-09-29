import { useState } from 'react';
import { WALLET_SIGNING_PREFERENCE } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';

export type WalletSortOption = 'default' | 'verified' | 'name' | 'namedFirst' | 'highestValue' | 'highestBalance';

export const WALLET_SORTS: ReadonlyArray<{ id: WalletSortOption; label: string }> = [
  { id: 'default', label: 'Hardware first' },
  { id: 'verified', label: 'Verified first' },
  { id: 'name', label: 'Name, A to Z' },
  { id: 'namedFirst', label: 'Named first' },
  { id: 'highestValue', label: 'Highest value' },
  { id: 'highestBalance', label: 'Highest balance' },
];

function compareDecimals(left: string, right: string) {
  const decimal = (value: string) => (/^-?\d+(\.\d+)?$/.test(value) ? value : '0');
  const a = decimal(left);
  const b = decimal(right);
  const places = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const integer = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const magnitude = BigInt(whole + fraction.padEnd(places, '0'));
    return negative ? -magnitude : magnitude;
  };
  const x = integer(a);
  const y = integer(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

const label = (wallet: Wallet) => (wallet.name || wallet.address).toLowerCase();

export function sortWallets(wallets: Wallet[], option: WalletSortOption): Wallet[] {
  if (option === 'default') {
    return [...wallets].sort((a, b) => {
      const aIsHardware = a.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE;
      const bIsHardware = b.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE;
      if (aIsHardware === bIsHardware) return 0;
      return aIsHardware ? -1 : 1;
    });
  }

  return [...wallets].sort((a, b) => {
    switch (option) {
      case 'verified': {
        const aVerified = a.verificationStatus === 'VERIFIED' ? 0 : 1;
        const bVerified = b.verificationStatus === 'VERIFIED' ? 0 : 1;
        if (aVerified !== bVerified) return aVerified - bVerified;
        return label(a).localeCompare(label(b));
      }
      case 'name':
        return label(a).localeCompare(label(b));
      case 'namedFirst': {
        const aHasName = a.name ? 0 : 1;
        const bHasName = b.name ? 0 : 1;
        if (aHasName !== bHasName) return aHasName - bHasName;
        return label(a).localeCompare(label(b));
      }
      case 'highestValue':
        return compareDecimals(b.marketValue || '0', a.marketValue || '0');
      case 'highestBalance':
        return compareDecimals(b.nativeBalance || '0', a.nativeBalance || '0');
      default:
        return 0;
    }
  });
}

export function useWalletSort() {
  const [sorts, setSorts] = useState<Partial<Record<string, WalletSortOption>>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const sortOf = (chain: string): WalletSortOption => sorts[chain] ?? 'default';

  const toggle = (chain: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(chain)) next.delete(chain);
      else next.add(chain);
      return next;
    });

  const choose = (chain: string, option: WalletSortOption) => {
    setSorts((current) => ({ ...current, [chain]: option }));
    setOpen((current) => {
      const next = new Set(current);
      next.delete(chain);
      return next;
    });
  };

  return { sortOf, isOpen: (chain: string) => open.has(chain), toggle, choose };
}
