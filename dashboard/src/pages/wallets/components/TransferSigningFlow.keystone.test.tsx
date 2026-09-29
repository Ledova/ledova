// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataItem, extend, type DataItemMap } from '@keystonehq/bc-ur-registry';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { AnimatedQRCode } from '@keystonehq/animated-qr';
import { Transaction, getAddress, parseEther } from 'ethers';
import type { Wallet } from '@ledova/shared';
import { useQRScanner } from '@components/qr';
import { signEthereumTransaction } from '@utils/softwareWallet/localSigner';
import fixture from '../../../../../packages/shared/tests/fixtures/prepared-transfer-api.json';
import { keystoneSignatureBytes, legacyV } from '../../../../../packages/shared/tests/fixtures/keystone-signatures';
import { TransferSigningFlow } from './TransferSigningFlow';

vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: vi.fn(() => null) }));
vi.mock('@components/qr', () => ({
  useQRScanner: vi.fn(() => ({ error: null, stopScanner: vi.fn() })),
  QRScannerView: () => null,
}));

const { mnemonic, derivationPath, address } = fixture.signer;
const wallet = {
  uuid: 'wallet-1',
  address,
  chain: 'base',
  derivationPath,
  masterFingerprint: '12345678',
} as unknown as Wallet;
const prepared = fixture.nativeBeyondDouble;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function continueWith(value: unknown) {
  const onBroadcast = vi.fn<(signedTx: string) => Promise<string>>(async () => `0x${'a'.repeat(64)}`);
  render(
    <TransferSigningFlow
      isOpen
      onClose={() => {}}
      transferType="crypto"
      wallet={wallet}
      toAddress={prepared.toAddress}
      amount={prepared.amountEth}
      preparedTransaction={{ ...prepared, transaction: { ...prepared.transaction, value: value as string } }}
      onBroadcast={onBroadcast}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  return onBroadcast;
}

function signingFlow() {
  const onBroadcast = continueWith(prepared.transaction.value);
  const request = extend
    .decodeToDataItem(Buffer.from(vi.mocked(AnimatedQRCode).mock.calls.at(-1)![0].cbor, 'hex'))
    .getData() as DataItemMap;
  const unsigned = Transaction.from(`0x${(request[2] as Buffer).toString('hex')}`);
  fireEvent.click(screen.getByRole('button', { name: "I've Signed It" }));
  const scan = async (path: string) => {
    const { r, s, yParity } = Transaction.from(await signEthereumTransaction(mnemonic, path, unsigned)).signature!;
    const firmware = Buffer.from(keystoneSignatureBytes(r, s, legacyV(unsigned.chainId, yParity)));
    const scanned = new UREncoder(
      new UR(extend.encodeDataItem(new DataItem({ 2: firmware })), 'eth-signature'),
      400,
    ).nextPart();
    const scanner = vi
      .mocked(useQRScanner)
      .mock.calls.filter(([options]) => options.enabled)
      .at(-1)![0];
    await act(async () => scanner.onScanSuccess(scanned));
    return firmware;
  };
  return { unsigned, onBroadcast, scan };
}

it('carries a native amount above 2^53 wei to the Keystone and back exactly, from its 66-byte signature', async () => {
  const { unsigned, onBroadcast, scan } = signingFlow();
  expect(unsigned.value).toBe(parseEther(prepared.amountEth));
  expect(unsigned.to).toBe(getAddress(prepared.toAddress));
  expect(unsigned.gasLimit).toBe(BigInt(prepared.gasLimit));
  expect(unsigned.gasPrice).toBe(BigInt(prepared.gasPriceWei));
  expect(unsigned.nonce).toBe(prepared.transaction.nonce);
  expect(unsigned.chainId).toBe(BigInt(prepared.transaction.chainId));
  expect(await scan(derivationPath)).toHaveLength(66);
  const signed = Transaction.from(onBroadcast.mock.calls[0][0]);
  expect(signed.from).toBe(address);
  expect(signed.chainId).toBe(31337n);
  expect(signed.value).toBe(parseEther(prepared.amountEth));
});

it('shows why it refuses a signature from another key and sends nothing', async () => {
  const { onBroadcast, scan } = signingFlow();
  await scan("m/44'/60'/0'/0/1");
  expect(screen.getByText('The scanned signature is not from this wallet.')).toBeTruthy();
  expect(screen.getByRole('button', { name: "I've Signed It" })).toBeTruthy();
  expect(onBroadcast).not.toHaveBeenCalled();
});

it('still encodes a value an older backend sent as a safe JSON number', () => {
  continueWith(1000);
  const request = extend
    .decodeToDataItem(Buffer.from(vi.mocked(AnimatedQRCode).mock.calls.at(-1)![0].cbor, 'hex'))
    .getData() as DataItemMap;
  expect(Transaction.from(`0x${(request[2] as Buffer).toString('hex')}`).value).toBe(1000n);
});

it.each([
  ['a decimal string', '9999999990000000000'],
  ['a number above 2^53 - 1', 2 ** 53],
  ['a fraction', 0.5],
])('refuses to encode a value sent as %s', (_, value) => {
  continueWith(value);
  expect(screen.getByText('Failed to format transaction for signing')).toBeTruthy();
  expect(AnimatedQRCode).not.toHaveBeenCalled();
});
