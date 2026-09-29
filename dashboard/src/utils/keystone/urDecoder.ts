import { URDecoder } from '@ngraveio/bc-ur';
import { Transaction, Signature } from 'ethers';
import { readTransactionSignature, type TransactionSignature } from '@ledova/shared';
import { decodeBtcSignature, decodeEthSignature } from './registry';

interface UnsignedTransaction {
  to: string;
  value: string;
  gas: string;
  gasPrice: string;
  nonce: string;
  data: string;
  chainId: string;
}

function scannedSignature(urSignatureString: string): Uint8Array | null {
  try {
    const decoder = new URDecoder();
    decoder.receivePart(urSignatureString.toLowerCase());
    if (!decoder.isComplete()) return null;
    const ur = decoder.resultUR();
    const signature: unknown = ur.type === 'eth-signature' ? decodeEthSignature(ur.cbor) : null;
    return ArrayBuffer.isView(signature) ? (signature as Uint8Array) : null;
  } catch {
    return null;
  }
}

function signedBy(unsignedTx: UnsignedTransaction, signature: TransactionSignature, signer: string): string | null {
  try {
    const signed = Transaction.from({
      type: 0,
      to: unsignedTx.to,
      value: BigInt(unsignedTx.value),
      gasLimit: BigInt(unsignedTx.gas),
      gasPrice: BigInt(unsignedTx.gasPrice),
      nonce: parseInt(unsignedTx.nonce, 16),
      data: unsignedTx.data,
      chainId: BigInt(unsignedTx.chainId),
      signature: Signature.from(signature),
    });
    return signed.from?.toLowerCase() === signer.toLowerCase() ? signed.serialized : null;
  } catch {
    return null;
  }
}

export function decodeKeystoneSignedTransaction(
  urSignatureString: string,
  unsignedTx: UnsignedTransaction,
  signer: string,
): string {
  const scanned = scannedSignature(urSignatureString);
  if (!scanned) throw new Error('The scanned code is not a Keystone signature.');
  const signed = signedBy(unsignedTx, readTransactionSignature(scanned, BigInt(unsignedTx.chainId)), signer);
  if (!signed) throw new Error('The scanned signature is not from this wallet.');
  return signed;
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
      const signatureBuffer = decodeEthSignature(ur.cbor);

      if (signatureBuffer.length !== 65) {
        return null;
      }

      return '0x' + signatureBuffer.toString('hex');
    } else if (ur.type === 'btc-signature') {
      const signatureBuffer = decodeBtcSignature(ur.cbor);

      return signatureBuffer.toString('base64');
    } else {
      return null;
    }
  } catch {
    return null;
  }
}
