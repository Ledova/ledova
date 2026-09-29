import { createLocalSigner, type DerivationNode } from '../../src/utils/local-signer';

const MNEMONIC = 'synthetic phrase';
const PATH = "m/44'/60'/0'/0/0";

function settleable() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fakeCrypto(childPrivateKey: Uint8Array | null = Uint8Array.of(7, 8, 9)) {
  const seed = Uint8Array.of(1, 2, 3);
  const child: DerivationNode = { privateKey: childPrivateKey, derive: jest.fn() };
  const master = { privateKey: Uint8Array.of(4, 5, 6), derive: jest.fn(() => child) };
  const copies: Uint8Array[] = [];
  const signing = settleable();
  const calls: unknown[][] = [];

  class SigningKey {
    readonly bytes: number[];
    constructor(readonly privateKey: Uint8Array) {
      copies.push(privateKey);
      this.bytes = [...privateKey];
    }
  }

  class Wallet {
    readonly address: string;
    constructor(readonly key: SigningKey) {
      this.address = `address:${key.bytes.join('.')}`;
    }
    signTransaction(transaction: { to: string }) {
      calls.push(['transaction', transaction]);
      return signing.promise;
    }
    signMessage(message: string) {
      calls.push(['message', message]);
      return signing.promise;
    }
    signTypedData(domain: { name: string }, types: Record<string, { name: string }[]>, value: Record<string, unknown>) {
      calls.push(['typed data', domain, types, value]);
      return signing.promise;
    }
  }

  const crypto = {
    ethers: { Wallet, SigningKey },
    HDKey: { fromMasterSeed: jest.fn(() => master) },
    mnemonicToSeedSync: jest.fn(() => seed),
  };
  return { crypto, seed, master, child, copies, signing, calls, signer: createLocalSigner(crypto) };
}

const zeroed = (bytes: Uint8Array | null) => [...(bytes ?? [])].every((byte) => byte === 0);

describe('deriving the address', () => {
  it('derives from the phrase and path, reads the address from a copy of the key, then wipes every key', () => {
    const { crypto, seed, master, child, copies, signer } = fakeCrypto();

    expect(signer.deriveAddress(MNEMONIC, PATH)).toBe('address:7.8.9');

    expect(crypto.mnemonicToSeedSync).toHaveBeenCalledWith(MNEMONIC);
    expect(crypto.HDKey.fromMasterSeed).toHaveBeenCalledWith(seed);
    expect(master.derive).toHaveBeenCalledWith(PATH);
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toBe(child.privateKey);
    expect([seed, master.privateKey, child.privateKey, copies[0]!].every(zeroed)).toBe(true);
  });

  it('wipes the seed and master key and refuses when the path gives no private key', () => {
    const { seed, master, copies, signer } = fakeCrypto(null);

    expect(() => signer.deriveAddress(MNEMONIC, PATH)).toThrow('Failed to derive private key from mnemonic');
    expect(zeroed(seed) && zeroed(master.privateKey)).toBe(true);
    expect(copies).toHaveLength(0);
  });
});

describe.each([
  [
    'a transaction',
    (signer: ReturnType<typeof fakeCrypto>['signer']) => signer.signEthereumTransaction(MNEMONIC, PATH, { to: '0xto' }),
    ['transaction', { to: '0xto' }],
  ],
  [
    'a message',
    (signer: ReturnType<typeof fakeCrypto>['signer']) => signer.signEthereumMessage(MNEMONIC, PATH, 'challenge'),
    ['message', 'challenge'],
  ],
  [
    'typed data',
    (signer: ReturnType<typeof fakeCrypto>['signer']) =>
      signer.signEthereumTypedData(
        MNEMONIC,
        PATH,
        { name: 'Ledova' },
        { Order: [{ name: 'amount' }] },
        { amount: '1' },
      ),
    ['typed data', { name: 'Ledova' }, { Order: [{ name: 'amount' }] }, { amount: '1' }],
  ],
] as const)('signing %s', (_, sign, call) => {
  it('signs with an intact copy of the key and wipes it only once the signature is settled', async () => {
    const { seed, master, child, copies, signing, calls, signer } = fakeCrypto();
    const signature = sign(signer);

    expect(calls).toEqual([call]);
    expect(copies).toHaveLength(1);
    expect([seed, master.privateKey, child.privateKey].every(zeroed)).toBe(true);
    expect([...copies[0]!]).toEqual([7, 8, 9]);
    await Promise.resolve();
    expect([...copies[0]!]).toEqual([7, 8, 9]);

    signing.resolve('signature');
    expect(await signature).toBe('signature');
    expect(zeroed(copies[0]!)).toBe(true);
  });

  it('wipes the copy when signing fails', async () => {
    const { copies, signing, signer } = fakeCrypto();
    const signature = sign(signer);

    signing.reject(new Error('Synthetic signing failure'));
    await expect(signature).rejects.toThrow('Synthetic signing failure');
    expect(zeroed(copies[0]!)).toBe(true);
  });

  it('rejects, rather than throws, when the path gives no private key', async () => {
    const { seed, master, copies, signer } = fakeCrypto(null);
    const signature = sign(signer);

    await expect(signature).rejects.toThrow('Failed to derive private key from mnemonic');
    expect(zeroed(seed) && zeroed(master.privateKey)).toBe(true);
    expect(copies).toHaveLength(0);
  });
});

describe('using the private key directly', () => {
  it('hands over a copy of the derived key and wipes it after use', () => {
    const { seed, master, child, signer } = fakeCrypto();
    let used: Uint8Array | undefined;

    const result = signer.withPrivateKey(MNEMONIC, PATH, (privateKey) => {
      used = privateKey;
      expect([seed, master.privateKey, child.privateKey].every(zeroed)).toBe(true);
      return [...privateKey];
    });

    expect(result).toEqual([7, 8, 9]);
    expect(used).not.toBe(child.privateKey);
    expect(zeroed(used!)).toBe(true);
  });

  it('wipes the copy when its use fails', () => {
    const { signer } = fakeCrypto();
    let used: Uint8Array | undefined;

    expect(() =>
      signer.withPrivateKey(MNEMONIC, PATH, (privateKey) => {
        used = privateKey;
        throw new Error('Synthetic use failure');
      }),
    ).toThrow('Synthetic use failure');
    expect(zeroed(used!)).toBe(true);
  });

  it('refuses at compile time a callback that would read the key after it is wiped', async () => {
    const { signer } = fakeCrypto();
    const readLater = async (privateKey: Uint8Array) => {
      await Promise.resolve();
      return [...privateKey];
    };

    // @ts-expect-error
    const late = signer.withPrivateKey(MNEMONIC, PATH, readLater);

    expect(await late).toEqual([0, 0, 0]);
  });
});
