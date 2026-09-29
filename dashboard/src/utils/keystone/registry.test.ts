import { describe, expect, it } from 'vitest';
import { decodeKeystoneMessageSignature } from './urDecoder';
import { encodeBitcoinMessage } from './urEncoder';
import { extractFromKeystoneQR } from './bcurDecoder';
import { BtcDataType, EthDataType, createBtcSignRequest, createEthSignRequest } from './registry';
import {
  BTC_PATH,
  BTC_REQUEST_CBOR,
  BTC_REQUEST_UR,
  BTC_SIGNATURE,
  BTC_SIGNATURE_UR,
  ETH_ADDRESS,
  ETH_CHAIN_ID,
  ETH_PATH,
  ETH_REQUEST_CBOR,
  ETH_REQUEST_UR,
  ETH_SIGNATURE,
  ETH_SIGNATURE_UR,
  FINGERPRINT,
  HARDHAT_ACCOUNT_0,
  HARDHAT_ACCOUNT_EXPORT_UR,
  HARDHAT_MASTER_FINGERPRINT,
  MESSAGE,
  ORIGIN,
  REQUEST_ID,
  TESTNET_BTC_ADDRESS,
} from './testVectors';

describe('Keystone UR compatibility', () => {
  it('matches the neutral Ethereum sign-request fixture', () => {
    const request = createEthSignRequest(
      Buffer.from(MESSAGE, 'utf8'),
      EthDataType.personalMessage,
      ETH_PATH,
      FINGERPRINT,
      REQUEST_ID,
      ETH_CHAIN_ID,
      ETH_ADDRESS,
      ORIGIN,
    );

    expect(request.toCBOR().toString('hex')).toBe(ETH_REQUEST_CBOR);
    expect(request.toUREncoder(400).nextPart()).toBe(ETH_REQUEST_UR);
  });

  it('matches the neutral Bitcoin sign-request fixture', () => {
    const request = createBtcSignRequest(
      REQUEST_ID,
      [FINGERPRINT],
      Buffer.from(MESSAGE, 'utf8'),
      BtcDataType.message,
      [BTC_PATH],
      [TESTNET_BTC_ADDRESS],
      ORIGIN,
    );

    expect(request.toCBOR().toString('hex')).toBe(BTC_REQUEST_CBOR);
    expect(request.toUREncoder(400).nextPart()).toBe(BTC_REQUEST_UR);
  });

  it('refuses mainnet Bitcoin addresses and derivation paths', () => {
    expect(encodeBitcoinMessage(`bc1q${'a'.repeat(38)}`, MESSAGE, "m/84'/0'/0'/0/0", FINGERPRINT)).toBeNull();
    expect(encodeBitcoinMessage(TESTNET_BTC_ADDRESS, MESSAGE, "m/84'/0'/0'/0/0", FINGERPRINT)).toBeNull();
    expect(encodeBitcoinMessage(TESTNET_BTC_ADDRESS, MESSAGE, BTC_PATH, FINGERPRINT)).not.toBeNull();
  });

  it('decodes Ethereum message signatures', () => {
    expect(decodeKeystoneMessageSignature(ETH_SIGNATURE_UR)).toBe(ETH_SIGNATURE);
  });

  it('decodes Bitcoin message signatures', () => {
    expect(decodeKeystoneMessageSignature(BTC_SIGNATURE_UR)).toBe(BTC_SIGNATURE);
  });

  it('imports the first account of the Hardhat test mnemonic from its account export', () => {
    const imported = extractFromKeystoneQR(HARDHAT_ACCOUNT_EXPORT_UR);

    expect(imported?.masterFingerprint).toBe(HARDHAT_MASTER_FINGERPRINT);
    expect(imported?.addresses).toEqual([HARDHAT_ACCOUNT_0]);
  });
});
