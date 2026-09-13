// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HardwareWalletImport } from '@ledova/shared';

const api = vi.hoisted(() => ({ post: vi.fn() }));
const qr = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@utils/keystone/bcurDecoder', () => ({ extractFromKeystoneQR: qr.decode }));

import { AccountSelector } from './AddWalletModal';

const address = '0x' + 'a'.repeat(40);
const data: HardwareWalletImport = {
  addresses: [{ address, networkType: 'ETH', addressIndex: 0, derivationPath: "m/44'/60'/0'/0/0" }],
  masterFingerprint: 'fingerprint',
  parentKeys: [{ parentPublicKey: 'public', parentChainCode: 'chain', parentDerivationPath: "m/44'/60'/0'/0" }],
};

beforeEach(() => {
  api.post.mockReset();
  qr.decode.mockReturnValue(data);
});
afterEach(cleanup);

it('queries and imports the selected Base network', async () => {
  api.post.mockImplementation(async (_url, body) => ({
    data: {
      chain: body.chain,
      balances: { [address]: body.chain === 'base' ? '2' : '5' },
    },
  }));
  const selected = vi.fn();
  const view = render(
    <AccountSelector urString="synthetic-qr" onSelectAccounts={selected} onCancel={vi.fn()} isLoading={false} />,
  );
  await view.findByText('5 ETH');
  fireEvent.change(view.getByLabelText('Import EVM network'), { target: { value: 'BASE' } });
  await view.findByText('2 ETH');
  expect(api.post).toHaveBeenLastCalledWith('/api/wallets/batch-check-balances/', {
    chain: 'base',
    addresses: [address],
  });
  fireEvent.click(view.getByRole('button', { name: 'Import 1 Wallet' }));
  expect(selected).toHaveBeenCalledWith([{ ...data.addresses[0], networkType: 'BASE' }], {
    ...data,
    addresses: [{ ...data.addresses[0], networkType: 'BASE' }],
  });
});

it('does not display a zero when the provider fails', async () => {
  api.post.mockRejectedValue(new Error('offline'));
  const view = render(
    <AccountSelector urString="synthetic-qr" onSelectAccounts={vi.fn()} onCancel={vi.fn()} isLoading={false} />,
  );
  await view.findByText('Unavailable');
  expect(view.queryByText('0 ETH')).toBeNull();
});
