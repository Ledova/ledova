import { Buffer } from 'buffer';
import { ethers } from 'ethers';
import { HDKey } from 'ethereum-cryptography/hdkey';
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { secp256k1 } from 'ethereum-cryptography/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { createLocalSigner, isBitcoinTestnetSigningPath } from '@ledova/shared';

const signer = createLocalSigner({ ethers, HDKey, mnemonicToSeedSync });

export const { signEthereumTransaction, signEthereumMessage, signEthereumTypedData } = signer;

export async function signBitcoinMessage(mnemonic: string, derivationPath: string, message: string): Promise<string> {
  if (!isBitcoinTestnetSigningPath(derivationPath)) {
    throw new Error('Bitcoin signing requires a BIP84 testnet derivation path');
  }

  return signer.withPrivateKey(mnemonic, derivationPath, (privateKey) => {
    const prefix = '\x18Bitcoin Signed Message:\n';
    const msgBytes = Buffer.from(message, 'utf8');
    const varint = encodeVarint(msgBytes.length);
    const payload = Buffer.concat([Buffer.from(prefix, 'utf8'), varint, msgBytes]);
    const msgHash = sha256(sha256(payload));

    const sig = secp256k1.sign(msgHash, privateKey);

    const recoveryFlag = 39 + sig.recovery;
    const rBytes = hexToBytes32(sig.r.toString(16));
    const sBytes = hexToBytes32(sig.s.toString(16));

    const compactSig = Buffer.alloc(65);
    compactSig[0] = recoveryFlag;
    Buffer.from(rBytes).copy(compactSig, 1);
    Buffer.from(sBytes).copy(compactSig, 33);

    return compactSig.toString('base64');
  });
}

function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xfe;
  buf.writeUInt32LE(n, 1);
  return buf;
}

function hexToBytes32(hex: string): Uint8Array {
  const padded = hex.padStart(64, '0');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(padded.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
