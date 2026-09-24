// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DerivedAddress, Wallet } from '@ledova/shared';

const keys = vi.hoisted(() => ({ derive: vi.fn() }));
vi.mock('@utils/keystone/bcurDecoder', () => ({ deriveAddressFromParentKey: keys.derive }));

import { DeriveAddressModal } from './DeriveAddressModal';

const wallet = {
  uuid: 'synthetic-wallet',
  chain: 'ethereum',
  addressIndex: 2,
  parentPublicKey: 'synthetic-public-key',
  parentChainCode: 'synthetic-chain-code',
  parentDerivationPath: "m/44'/60'/0'/0",
} as unknown as Wallet;

const derived: DerivedAddress = {
  address: '0x' + 'ab'.repeat(20),
  networkType: 'ETH',
  addressIndex: 3,
  derivationPath: "m/44'/60'/0'/0/3",
};

beforeEach(() => {
  keys.derive.mockReset();
});

afterEach(cleanup);

it('shows the next address from the parent key and confirms it', () => {
  keys.derive.mockReturnValue(derived);
  const confirmed = vi.fn();
  render(<DeriveAddressModal isOpen wallet={wallet} onConfirm={confirmed} onClose={() => {}} />);
  expect(keys.derive).toHaveBeenCalledWith('synthetic-public-key', 'synthetic-chain-code', "m/44'/60'/0'/0", 3);
  expect(screen.getByText(derived.address)).toBeTruthy();
  expect(screen.queryByText('Deriving address...')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Address' }));
  expect(confirmed).toHaveBeenCalledWith(derived);
});

it('shows a derivation failure and keeps confirmation disabled', () => {
  keys.derive.mockImplementation(() => {
    throw new Error('Synthetic derivation failure');
  });
  const confirmed = vi.fn();
  render(<DeriveAddressModal isOpen wallet={wallet} onConfirm={confirmed} onClose={() => {}} />);
  expect(screen.getByText('Synthetic derivation failure')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Add Address' }) as HTMLButtonElement).disabled).toBe(true);
});
