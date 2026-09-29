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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('carries a native amount above 2^53 wei to the Keystone and back exactly', async () => {
  const prepared = fixture.nativeBeyondDouble;
  const onBroadcast = vi.fn<(signedTx: string) => Promise<string>>(async () => `0x${'a'.repeat(64)}`);
  render(
    <TransferSigningFlow
      isOpen
      onClose={() => {}}
      transferType="crypto"
      wallet={wallet}
      toAddress={prepared.toAddress}
      amount={prepared.amountEth}
      preparedTransaction={prepared}
      onBroadcast={onBroadcast}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  const request = extend
    .decodeToDataItem(Buffer.from(vi.mocked(AnimatedQRCode).mock.calls.at(-1)![0].cbor, 'hex'))
    .getData() as DataItemMap;
  const unsigned = Transaction.from(`0x${(request[2] as Buffer).toString('hex')}`);
  expect(unsigned.value).toBe(parseEther(prepared.amountEth));
  expect(unsigned.to).toBe(getAddress(prepared.toAddress));
  expect(unsigned.gasLimit).toBe(BigInt(prepared.gasLimit));
  expect(unsigned.gasPrice).toBe(BigInt(prepared.gasPriceWei));
  expect(unsigned.nonce).toBe(prepared.transaction.nonce);
  expect(unsigned.chainId).toBe(BigInt(prepared.transaction.chainId));

  fireEvent.click(screen.getByRole('button', { name: "I've Signed It" }));
  const device = Transaction.from(await signEthereumTransaction(mnemonic, derivationPath, unsigned));
  const signature = device.signature!.serialized;
  const scanned = new UREncoder(
    new UR(extend.encodeDataItem(new DataItem({ 2: Buffer.from(signature.slice(2), 'hex') })), 'eth-signature'),
    400,
  ).nextPart();
  const scanner = vi
    .mocked(useQRScanner)
    .mock.calls.filter(([options]) => options.enabled)
    .at(-1)![0];
  await act(async () => scanner.onScanSuccess(scanned));
  const signed = Transaction.from(onBroadcast.mock.calls[0][0]);
  expect(signed.from).toBe(address);
  expect(signed.value).toBe(parseEther(prepared.amountEth));
});
