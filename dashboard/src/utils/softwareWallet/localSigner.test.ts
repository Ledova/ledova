import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVM_DERIVATION_PATH,
  deriveAddress,
  signEthereumMessage,
  signEthereumTransaction,
} from './localSigner';

const vectors = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shared/tests/fixtures/local-signing-vectors.json', import.meta.url),
    'utf8',
  ),
) as {
  synthetic_only: boolean;
  mnemonic: string;
  ethereum: {
    paths: string[];
    addresses: string[];
    messages: { message: string; signature: string }[];
    transaction: Record<'to' | 'value' | 'data' | 'gasLimit' | 'gasPrice' | 'chainId', string> & {
      type: number;
      nonce: number;
    };
    signed_transaction: string;
  };
};
const { mnemonic, ethereum } = vectors;

describe('the browser signer against eth-account', () => {
  it('derives the addresses of the synthetic phrase, starting from the default path', () => {
    expect(vectors.synthetic_only).toBe(true);
    expect(DEFAULT_EVM_DERIVATION_PATH).toBe(ethereum.paths[0]);
    expect(ethereum.paths.map((path) => deriveAddress(mnemonic, path))).toEqual(ethereum.addresses);
  });

  it.each(ethereum.messages)('signs %# to the exact bytes of an EIP-191 signature', async ({ message, signature }) => {
    expect(await signEthereumMessage(mnemonic, DEFAULT_EVM_DERIVATION_PATH, message)).toBe(signature);
  });

  it('signs a legacy approval to the exact serialised bytes', async () => {
    const { type, to, value, data, gasLimit, gasPrice, nonce, chainId } = ethereum.transaction;
    const signed = await signEthereumTransaction(mnemonic, DEFAULT_EVM_DERIVATION_PATH, {
      type,
      to,
      value: BigInt(value),
      data,
      gasLimit: BigInt(gasLimit),
      gasPrice: BigInt(gasPrice),
      nonce,
      chainId: BigInt(chainId),
    });

    expect(signed).toBe(ethereum.signed_transaction);
  });

  it('rejects rather than throws when the phrase cannot give a key at the path', async () => {
    const signing = signEthereumMessage(mnemonic, 'not a path', 'message');
    await expect(signing).rejects.toThrow();
    expect(() => deriveAddress(mnemonic, 'not a path')).toThrow();
  });
});
