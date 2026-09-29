// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreparedWalletTransfer, Wallet } from '@ledova/shared';

const encoder = vi.hoisted(() => ({ encode: vi.fn() }));
vi.mock('@utils/keystone/urEncoder', () => ({ encodeEthereumTransaction: encoder.encode }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => <p>Synthetic signing code</p> }));
const scanner = vi.hoisted(() => ({ stop: vi.fn(), scan: null as ((text: string) => void) | null }));
vi.mock('@components/qr', () => ({
  useQRScanner: ({ onScanSuccess, enabled }: { onScanSuccess: (text: string) => void; enabled: boolean }) => {
    scanner.scan = enabled ? onScanSuccess : null;
    return { error: null, stopScanner: scanner.stop };
  },
  QRScannerView: () => <p>Synthetic camera</p>,
}));
vi.mock('@utils/keystone/urDecoder', () => ({ decodeKeystoneSignedTransaction: () => '0xsynthetic-signed' }));

import { TransferSigningFlow } from './TransferSigningFlow';

const wallet = {
  uuid: 'wallet-1',
  address: `0x${'1'.repeat(40)}`,
  chain: 'base',
  derivationPath: "m/44'/60'/0'/0/0",
  masterFingerprint: 'synthetic-fingerprint',
} as unknown as Wallet;

const prepared = {
  transaction: { to: `0x${'2'.repeat(40)}`, data: '0x', value: '1', gas: 21000, gasPrice: 1, nonce: 0, chainId: 84532 },
} as unknown as PreparedWalletTransfer;

const onPrepare = vi.fn();

function actions() {
  const row = screen.getAllByRole('button').at(-1)!.parentElement!;
  return Array.from(row.children).map((action) => action.textContent);
}

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

it('is the shared dialog named by its title, and can be cancelled while the transfer is prepared', () => {
  const onClose = vi.fn();
  render(flow({ onClose }));
  const dialog = screen.getByRole('dialog', { name: 'Sign Transfer' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('lists the transfer as rows and ends the instructions with Cancel then Continue', () => {
  render(flow({ preparedTransaction: prepared }));
  expect(screen.getByText('From').tagName).toBe('DT');
  expect(screen.getByText('Amount').tagName).toBe('DT');
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const next = screen.getByRole('button', { name: 'Continue' });
  expect(Array.from(cancel.parentElement!.children)).toEqual([cancel, next]);
});

it('keeps Cancel before Back while the code is shown and scanned, and stops the camera when cancelled', () => {
  const onClose = vi.fn();
  render(flow({ preparedTransaction: prepared, onClose }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(actions()).toEqual(['Cancel', 'Back', "I've Signed It"]);
  fireEvent.click(screen.getByRole('button', { name: "I've Signed It" }));
  expect(screen.getByText('Synthetic camera')).toBeTruthy();
  expect(actions()).toEqual(['Cancel', 'Back']);
  expect(scanner.stop).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(scanner.stop).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('holds Cancel while the transfer is broadcast and offers Close once it is sent', async () => {
  let sent!: (hash: string) => void;
  const onBroadcast = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        sent = resolve;
      }),
  );
  const onClose = vi.fn();
  render(flow({ preparedTransaction: prepared, onBroadcast, onClose }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: "I've Signed It" }));
  act(() => scanner.scan!('ur:eth-signature/synthetic'));
  expect(onBroadcast).toHaveBeenCalledWith('0xsynthetic-signed');
  expect(screen.getByText('Broadcasting transaction...')).toBeTruthy();
  const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => sent(`0x${'a'.repeat(64)}`));
  expect(screen.getByText('Transfer Sent!')).toBeTruthy();
  expect(actions()).toEqual(['Close']);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledOnce();
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
