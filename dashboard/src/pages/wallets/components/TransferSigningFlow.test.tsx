// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreparedWalletTransfer, Wallet } from '@ledova/shared';

const encoder = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock('@utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: encoder.encode }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => <p>Synthetic signing code</p> }));

import { TransferSigningFlow } from './TransferSigningFlow';

const wallet = {
  uuid: 'wallet-1',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
  derivationPath: "m/44'/60'/0'/0/0",
  masterFingerprint: 'synthetic-fingerprint',
} as unknown as Wallet;

const prepared = {
  transaction: { to: `0x${'2'.repeat(40)}`, data: '0x', value: 1, gas: 21000, gasPrice: 1, nonce: 0, chainId: 84532 },
} as unknown as PreparedWalletTransfer;

const onPrepare = vi.fn();

function flow(props: Partial<ComponentProps<typeof TransferSigningFlow>>) {
  return (
    <TransferSigningFlow
      isOpen
      onClose={() => {}}
      transferType="crypto"
      wallet={wallet}
      toAddress={`0x${'2'.repeat(40)}`}
      amount="1"
      preparedTransaction={null}
      onPrepare={onPrepare}
      {...props}
    />
  );
}

beforeEach(() => {
  encoder.encode.mockReturnValue({ cborHex: 'synthetic-cbor', type: 'eth-sign-request' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('prepares once when opened and shows the instructions when the transaction arrives', () => {
  const view = render(flow({}));
  expect(screen.getByText('Preparing transaction...')).toBeTruthy();
  expect(onPrepare).toHaveBeenCalledOnce();
  view.rerender(flow({ preparedTransaction: prepared }));
  expect(screen.getByText('Sign this transfer with your hardware wallet to authorize the transaction.')).toBeTruthy();
  expect(onPrepare).toHaveBeenCalledOnce();
});

it('shows a preparation failure and returns to the instructions on Try Again', () => {
  const view = render(flow({}));
  view.rerender(flow({ prepareError: 'Synthetic preparation failure' }));
  expect(screen.getByText('Transfer Failed')).toBeTruthy();
  expect(screen.getByText('Synthetic preparation failure')).toBeTruthy();
  fireEvent.click(screen.getByText('Try Again'));
  expect(screen.getByText('Sign this transfer with your hardware wallet to authorize the transaction.')).toBeTruthy();
  expect(screen.queryByText('Synthetic preparation failure')).toBeNull();
});

it('starts again from the instructions and prepares again each time it reopens', () => {
  const view = render(flow({ preparedTransaction: prepared }));
  fireEvent.click(screen.getByText('Continue'));
  expect(screen.getByText('Synthetic signing code')).toBeTruthy();
  view.rerender(flow({ isOpen: false, preparedTransaction: prepared }));
  view.rerender(flow({ preparedTransaction: prepared }));
  expect(screen.queryByText('Synthetic signing code')).toBeNull();
  expect(screen.getByText('Sign this transfer with your hardware wallet to authorize the transaction.')).toBeTruthy();
  expect(onPrepare).toHaveBeenCalledTimes(2);
});
