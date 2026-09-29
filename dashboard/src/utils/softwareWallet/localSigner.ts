import { ethers } from 'ethers';
import { HDKey } from 'ethereum-cryptography/hdkey';
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { createLocalSigner } from '@ledova/shared';

export const DEFAULT_EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

const signer = createLocalSigner({ ethers, HDKey, mnemonicToSeedSync });

export const { deriveAddress, signEthereumTransaction, signEthereumMessage, signEthereumTypedData } = signer;
