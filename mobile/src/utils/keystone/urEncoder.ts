import { EthSignRequest, DataType as EthDataType } from '@keystonehq/bc-ur-registry-eth';
import { BtcSignRequest, DataType as BtcDataType } from '@keystonehq/bc-ur-registry-btc';
import { v4 as uuid } from 'uuid';
import { Transaction } from 'ethers';
import {
  isSupportedEvmTestChainId,
  isBitcoinTestnetSigningPath,
  isValidBitcoinNativeSegwitTestAddress,
} from '@ledova/shared';
import type { TransferTransaction } from '../preparedTransfer';

export function encodeEthereumTransaction(
  address: string,
  transaction: TransferTransaction,
  derivationPath?: string,
  masterFingerprint?: string,
): { type: string; cbor: Buffer; urString: string } | null {
  try {
    const requestId = uuid();
    const chainId = Number(transaction.chainId);

    if (!derivationPath || !masterFingerprint || !isSupportedEvmTestChainId(chainId)) {
      return null;
    }

    const ethTx = Transaction.from(transaction);

    const unsignedTx = ethTx.unsignedSerialized;
    const signDataHex = unsignedTx.startsWith('0x') ? unsignedTx.slice(2) : unsignedTx;
    const signData = Buffer.from(signDataHex, 'hex');

    const xfpBuffer = Buffer.from(masterFingerprint, 'hex');

    const ethSignRequest = EthSignRequest.constructETHRequest(
      signData,
      EthDataType.transaction,
      derivationPath,
      xfpBuffer as unknown as string,
      requestId,
      chainId,
      address,
      'Ledova',
    );
    const cbor = ethSignRequest.toCBOR();
    const ur = ethSignRequest.toUREncoder(400);
    const urString = ur.nextPart();

    return { type: 'eth-sign-request', cbor, urString };
  } catch {
    return null;
  }
}

export function encodeEthereumMessage(
  address: string,
  message: string,
  derivationPath?: string,
  masterFingerprint?: string,
  chainId?: number,
): { type: string; cbor: Buffer; urString: string } | null {
  try {
    const requestId = uuid();
    const messageBytes = Buffer.from(message, 'utf8');

    if (!derivationPath || !masterFingerprint || chainId === undefined || !isSupportedEvmTestChainId(chainId)) {
      return null;
    }

    const xfpBuffer = Buffer.from(masterFingerprint, 'hex');

    const ethSignRequest = EthSignRequest.constructETHRequest(
      messageBytes,
      EthDataType.personalMessage,
      derivationPath,
      xfpBuffer as unknown as string,
      requestId,
      chainId,
      address,
      'Ledova',
    );

    const cbor = ethSignRequest.toCBOR();
    const ur = ethSignRequest.toUREncoder(400);
    const urString = ur.nextPart();

    return { type: 'eth-sign-request', cbor, urString };
  } catch {
    return null;
  }
}

export function encodeEthereumTypedData(
  address: string,
  typedData: object,
  derivationPath?: string,
  masterFingerprint?: string,
  chainId?: number,
): { type: string; cbor: Buffer; cborHex: string; urString: string } | null {
  try {
    const requestId = uuid();
    const typedDataBytes = Buffer.from(JSON.stringify(typedData), 'utf8');

    if (!derivationPath || !masterFingerprint || chainId === undefined || !isSupportedEvmTestChainId(chainId)) {
      return null;
    }

    const xfpBuffer = Buffer.from(masterFingerprint, 'hex');

    const ethSignRequest = EthSignRequest.constructETHRequest(
      typedDataBytes,
      EthDataType.typedData,
      derivationPath,
      xfpBuffer as unknown as string,
      requestId,
      chainId,
      address,
      'Ledova',
    );

    const cbor = ethSignRequest.toCBOR();
    const cborHex = cbor.toString('hex');
    const ur = ethSignRequest.toUREncoder(400);
    const urString = ur.nextPart();

    return { type: 'eth-sign-request', cbor, cborHex, urString };
  } catch {
    return null;
  }
}

export function encodeBitcoinMessage(
  address: string,
  message: string,
  derivationPath?: string,
  masterFingerprint?: string,
): { type: string; cbor: Buffer; urString: string } | null {
  try {
    const requestId = uuid();
    const messageBytes = Buffer.from(message, 'utf8');

    if (
      !derivationPath ||
      !masterFingerprint ||
      !isBitcoinTestnetSigningPath(derivationPath) ||
      !isValidBitcoinNativeSegwitTestAddress(address)
    ) {
      return null;
    }

    const btcSignRequest = BtcSignRequest.constructBtcRequest(
      requestId,
      [masterFingerprint],
      messageBytes,
      BtcDataType.message,
      [derivationPath],
      [address],
      'Ledova',
    );

    const cbor = btcSignRequest.toCBOR();
    const ur = btcSignRequest.toUREncoder(400);
    const urString = ur.nextPart();

    return { type: 'btc-sign-request', cbor, urString };
  } catch {
    return null;
  }
}
