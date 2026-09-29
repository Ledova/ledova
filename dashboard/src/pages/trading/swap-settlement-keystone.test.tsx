// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DataItem, extend, type DataItemMap } from '@keystonehq/bc-ur-registry';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { AnimatedQRCode } from '@keystonehq/animated-qr';
import { Transaction } from 'ethers';
import type { SwapSettlement, SwapSettlementState, Wallet } from '@ledova/shared';
import { useQRScanner } from '@components/qr';
import { approvalTransactionForSigning } from '@services/swapSettlements';
import { signEthereumTransaction } from '@utils/softwareWallet/localSigner';
import apiFixture from '../../../../packages/shared/tests/fixtures/swap-settlement-api.json';
import { settlementApproval, settlementResponse } from '../../../../packages/shared/tests/fixtures/swap-settlements';
import { keystoneSignatureBytes, legacyV } from '../../../../packages/shared/tests/fixtures/keystone-signatures';
import { SwapSettlementFlow } from './components/SwapSettlementFlow';

vi.mock('@components/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModalActions: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@components/qr', () => ({
  useQRScanner: vi.fn(() => ({ error: null, stopScanner: vi.fn() })),
  QRScannerView: () => null,
}));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: vi.fn(() => null) }));

const SEPOLIA = 11155111;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function onSepolia() {
  const response = settlementResponse('seller');
  response.typedData.domain.chainId = String(SEPOLIA);
  const approval = settlementApproval(response);
  approval.transaction.chainId = `0x${SEPOLIA.toString(16)}`;
  const state: SwapSettlementState = {
    attempt: 1,
    phase: 'approval-ready',
    response,
    approvalStatus: null,
    approvalData: approval,
    approvalResult: null,
    approvalOutcomes: [],
    unconfirmedApprovalHashes: [],
    error: null,
    notice: null,
  };
  const broadcastApproval = vi.fn<(raw: string) => Promise<void>>(async () => {});
  const settlement = {
    subscribe: () => () => {},
    getSnapshot: () => state,
    isCurrent: () => true,
    close: () => {},
    broadcastApproval,
  } as unknown as SwapSettlement;
  const wallet = {
    uuid: response.walletUuid,
    userAccount: response.ownerAccountUuid,
    address: apiFixture.addresses[0]!,
    chain: 'ethereum',
    verificationStatus: 'VERIFIED',
    signingPreference: 'hardware',
    derivationPath: apiFixture.paths[0]!,
    masterFingerprint: '12345678',
  } as Wallet;
  render(<SwapSettlementFlow settlement={settlement} wallets={[wallet]} onClose={() => {}} />);
  fireEvent.click(screen.getByText('Continue to approve'));
  const request = extend
    .decodeToDataItem(Buffer.from(vi.mocked(AnimatedQRCode).mock.calls.at(-1)![0].cbor, 'hex'))
    .getData() as DataItemMap;
  const unsigned = Transaction.from(`0x${(request[2] as Buffer).toString('hex')}`);
  fireEvent.click(screen.getByText("I've signed it"));
  const scan = async (path: string) => {
    const { r, s, yParity } = Transaction.from(
      await signEthereumTransaction(apiFixture.mnemonic, path, unsigned),
    ).signature!;
    const firmware = Buffer.from(keystoneSignatureBytes(r, s, legacyV(SEPOLIA, yParity)));
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
  return { approval, broadcastApproval, scan };
}

it('relays the 68-byte approval signature a Keystone sends on Ethereum Sepolia', async () => {
  const { approval, broadcastApproval, scan } = onSepolia();
  expect(await scan(apiFixture.paths[0]!)).toHaveLength(68);
  const signed = Transaction.from(broadcastApproval.mock.calls[0]![0]);
  expect(signed.from).toBe(apiFixture.addresses[0]);
  expect(signed.chainId).toBe(BigInt(SEPOLIA));
  const expected = approvalTransactionForSigning(approval.transaction);
  expect([signed.to, signed.data, signed.nonce, signed.gasLimit, signed.gasPrice]).toEqual([
    expected.to,
    expected.data,
    expected.nonce,
    expected.gasLimit,
    expected.gasPrice,
  ]);
});

it('shows why it refuses an approval signature from another key and sends nothing', async () => {
  const { broadcastApproval, scan } = onSepolia();
  await scan(apiFixture.paths[1]!);
  expect(screen.getByText('The scanned signature is not from this wallet.')).toBeTruthy();
  expect(broadcastApproval).not.toHaveBeenCalled();
});
