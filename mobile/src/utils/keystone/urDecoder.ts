import { URDecoder } from '@ngraveio/bc-ur';
import { ETHSignature } from '@keystonehq/bc-ur-registry-eth';
import { BtcSignature } from '@keystonehq/bc-ur-registry-btc';
import { Signature, Transaction, type TransactionLike } from 'ethers';
import { readTransactionSignature, type TransactionSignature } from '@ledova/shared';

function scannedSignature(urSignatureString: string): Buffer | null {
  try {
    const decoder = new URDecoder();
    decoder.receivePart(urSignatureString.toLowerCase());
    if (!decoder.isComplete()) return null;
    const ur = decoder.resultUR();
    return ur.type === 'eth-signature' ? ETHSignature.fromCBOR(ur.cbor).getSignature() : null;
  } catch {
    return null;
  }
}

function signedBy(transaction: TransactionLike<string>, signature: TransactionSignature, signer: string) {
  try {
    const signed = Transaction.from({ ...transaction, signature: Signature.from(signature) });
    return signed.from?.toLowerCase() === signer.toLowerCase() ? signed.serialized : null;
  } catch {
    return null;
  }
}

export function decodeKeystoneSignature(
  urSignatureString: string,
  unsignedTransaction: TransactionLike<string> & { chainId: bigint },
  signer: string,
): string {
  const scanned = scannedSignature(urSignatureString);
  if (!scanned) throw new Error('The scanned code is not a Keystone signature.');
  const signed = signedBy(unsignedTransaction, readTransactionSignature(scanned, unsignedTransaction.chainId), signer);
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
