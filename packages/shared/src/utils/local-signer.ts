export interface DerivationNode {
  readonly privateKey: Uint8Array | null;
  derive(path: string): DerivationNode;
}

interface SigningWallet {
  readonly address: string;
  signTransaction(transaction: never): Promise<string>;
  signMessage(message: string): Promise<string>;
  signTypedData(domain: never, types: never, value: Record<string, unknown>): Promise<string>;
}

export interface LocalSignerCrypto<Wallet, Key> {
  ethers: { Wallet: new (signingKey: Key) => Wallet; SigningKey: new (privateKey: Uint8Array) => Key };
  HDKey: { fromMasterSeed(seed: Uint8Array): DerivationNode };
  mnemonicToSeedSync(mnemonic: string): Uint8Array;
}

function wipe(...arrays: (Uint8Array | null | undefined)[]): void {
  for (const arr of arrays) {
    if (arr) arr.fill(0);
  }
}

export function createLocalSigner<Wallet extends SigningWallet, Key>({
  ethers,
  HDKey,
  mnemonicToSeedSync,
}: LocalSignerCrypto<Wallet, Key>) {
  function deriveKey(mnemonic: string, derivationPath: string) {
    const seed = mnemonicToSeedSync(mnemonic);
    const masterKey = HDKey.fromMasterSeed(seed);
    const childKey = masterKey.derive(derivationPath);

    if (!childKey.privateKey) {
      wipe(seed, masterKey.privateKey);
      throw new Error('Failed to derive private key from mnemonic');
    }

    const privateKey = new Uint8Array(childKey.privateKey);
    wipe(seed, masterKey.privateKey, childKey.privateKey);

    return { privateKey, cleanup: () => wipe(privateKey) };
  }

  function withPrivateKey<T>(
    mnemonic: string,
    derivationPath: string,
    use: (privateKey: Uint8Array) => T extends PromiseLike<unknown> ? never : T,
  ): T {
    const { privateKey, cleanup } = deriveKey(mnemonic, derivationPath);
    try {
      return use(privateKey);
    } finally {
      cleanup();
    }
  }

  async function withEthereumSigner<T>(
    mnemonic: string,
    derivationPath: string,
    sign: (wallet: Wallet) => Promise<T>,
  ): Promise<T> {
    const { privateKey, cleanup } = deriveKey(mnemonic, derivationPath);
    try {
      const wallet = new ethers.Wallet(new ethers.SigningKey(privateKey));
      return await sign(wallet);
    } finally {
      cleanup();
    }
  }

  return {
    withPrivateKey,

    deriveAddress(mnemonic: string, derivationPath: string): string {
      return withPrivateKey(
        mnemonic,
        derivationPath,
        (privateKey) => new ethers.Wallet(new ethers.SigningKey(privateKey)).address,
      );
    },

    async signEthereumTransaction(
      mnemonic: string,
      derivationPath: string,
      unsignedTx: Parameters<Wallet['signTransaction']>[0],
    ): Promise<string> {
      return withEthereumSigner(mnemonic, derivationPath, (wallet) => wallet.signTransaction(unsignedTx));
    },

    async signEthereumMessage(mnemonic: string, derivationPath: string, message: string): Promise<string> {
      return withEthereumSigner(mnemonic, derivationPath, (wallet) => wallet.signMessage(message));
    },

    async signEthereumTypedData(
      mnemonic: string,
      derivationPath: string,
      domain: Parameters<Wallet['signTypedData']>[0],
      types: Parameters<Wallet['signTypedData']>[1],
      value: Record<string, unknown>,
    ): Promise<string> {
      return withEthereumSigner(mnemonic, derivationPath, (wallet) => wallet.signTypedData(domain, types, value));
    },
  };
}
