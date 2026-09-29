import { URDecoder } from '@ngraveio/bc-ur';
import { ETHSignature } from '@keystonehq/bc-ur-registry-eth';
import { BtcSignature } from '@keystonehq/bc-ur-registry-btc';
import { Transaction } from 'ethers';
import type { PreparedEvmTransaction } from '@ledova/shared';
import { preparedTransferTransaction } from '../preparedTransfer';

export function decodeKeystoneSignature(
  urSignatureString: string,
  unsignedTransaction: PreparedEvmTransaction,
): string | null {
  try {
    const decoder = new URDecoder();
    decoder.receivePart(urSignatureString.toLowerCase());

    if (!decoder.isComplete()) {
      return null;
    }

    const ur = decoder.resultUR();
    const signature = ETHSignature.fromCBOR(ur.cbor);
    const signatureBuffer = signature.getSignature();

    if (signatureBuffer.length !== 65) {
      return null;
    }

    const r = '0x' + signatureBuffer.slice(0, 32).toString('hex');
    const s = '0x' + signatureBuffer.slice(32, 64).toString('hex');
    const v = signatureBuffer[64];

    const ethTx = Transaction.from({ ...preparedTransferTransaction(unsignedTransaction), signature: { r, s, v } });

    return ethTx.serialized;
  } catch {
    return null;
  }
}

export function decodeKeystoneMessageSignature(urSignatureString: string): string | null {
  try {
    const decoder = new URDecoder();
    decoder.receivePart(urSignatureString.toLowerCase());

    if (!decoder.isComplete()) {
      return null;
    }

    const ur = decoder.resultUR();

    if (ur.type === 'eth-signature') {
      const signature = ETHSignature.fromCBOR(ur.cbor);
      const signatureBuffer = signature.getSignature();

      if (signatureBuffer.length !== 65) {
        return null;
      }

      return '0x' + signatureBuffer.toString('hex');
    } else if (ur.type === 'btc-signature') {
      const signature = BtcSignature.fromCBOR(ur.cbor);
      const signatureBuffer = signature.getSignature();

      return signatureBuffer.toString('base64');
    } else {
      return null;
    }
  } catch {
    return null;
  }
}
