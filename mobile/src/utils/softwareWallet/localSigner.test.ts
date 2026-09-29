import { Buffer } from 'buffer';
import vectors from '../../../../packages/shared/tests/fixtures/local-signing-vectors.json';
import { signBitcoinMessage, signEthereumMessage, signEthereumTransaction } from './localSigner';

const { mnemonic, ethereum, bitcoin } = vectors;
const [evmPath] = ethereum.paths;

it('uses only synthetic vectors', () => {
  expect(vectors.synthetic_only).toBe(true);
});

it.each(ethereum.messages)(
  'signs Ethereum message %# to the exact bytes eth-account gives',
  async ({ message, signature }) => {
    expect(await signEthereumMessage(mnemonic, evmPath, message)).toBe(signature);
  },
);

it('signs a legacy approval to the exact serialised bytes eth-account gives', async () => {
  const { type, to, value, data, gasLimit, gasPrice, nonce, chainId } = ethereum.transaction;
  const signed = await signEthereumTransaction(mnemonic, evmPath, {
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

it.each(bitcoin.messages)(
  'signs a $utf8_length-byte Bitcoin message to the exact compact signature bitcoin-message-tool gives',
  async ({ unit, repeat, utf8_length, signature }) => {
    const message = unit.repeat(repeat);
    expect(Buffer.byteLength(message, 'utf8')).toBe(utf8_length);

    const signed = await signBitcoinMessage(mnemonic, bitcoin.path, message);

    expect(signed).toBe(signature);
    expect([39, 40, 41, 42]).toContain(Buffer.from(signed, 'base64')[0]);
  },
);

it.each(["m/84'/0'/0'/0/0", "m/44'/1'/0'/0/0", evmPath])(
  'refuses to sign a Bitcoin message on %s, which is not a BIP84 testnet path',
  async (path) => {
    await expect(signBitcoinMessage(mnemonic, path, 'message')).rejects.toThrow(
      'Bitcoin signing requires a BIP84 testnet derivation path',
    );
  },
);
