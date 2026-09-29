import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { build, type Plugin, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { nodePolyfills } from './vite.config';
import * as vectors from './src/utils/keystone/testVectors';

const PROBE = 'node-globals-probe';
const KEYSTONE = fileURLToPath(new URL('./src/utils/keystone/', import.meta.url));

const KEYSTONE_PROBE = `
import { Buffer } from 'buffer';
import * as v from '${KEYSTONE}testVectors.ts';
import { BtcDataType, EthDataType, createBtcSignRequest, createEthSignRequest } from '${KEYSTONE}registry.ts';
import { decodeKeystoneMessageSignature } from '${KEYSTONE}urDecoder.ts';
import { extractFromKeystoneQR } from '${KEYSTONE}bcurDecoder.ts';

const eth = createEthSignRequest(
  Buffer.from(v.MESSAGE, 'utf8'),
  EthDataType.personalMessage,
  v.ETH_PATH,
  v.FINGERPRINT,
  v.REQUEST_ID,
  v.ETH_CHAIN_ID,
  v.ETH_ADDRESS,
  v.ORIGIN,
);
const btc = createBtcSignRequest(
  v.REQUEST_ID,
  [v.FINGERPRINT],
  Buffer.from(v.MESSAGE, 'utf8'),
  BtcDataType.message,
  [v.BTC_PATH],
  [v.TESTNET_BTC_ADDRESS],
  v.ORIGIN,
);
const account = extractFromKeystoneQR(v.HARDHAT_ACCOUNT_EXPORT_UR);

globalThis.probe = {
  ethRequest: [eth.toCBOR().toString('hex'), eth.toUREncoder(400).nextPart()],
  btcRequest: [btc.toCBOR().toString('hex'), btc.toUREncoder(400).nextPart()],
  ethSignature: decodeKeystoneMessageSignature(v.ETH_SIGNATURE_UR),
  btcSignature: decodeKeystoneMessageSignature(v.BTC_SIGNATURE_UR),
  account: account && { masterFingerprint: account.masterFingerprint, addresses: account.addresses },
};
`;

function probeEntry(source: string): Plugin {
  return {
    name: 'probe-entry',
    resolveId: (id) => (id === PROBE ? id : null),
    load: (id) => (id === PROBE ? source : null),
  };
}

function aPageWithoutNodeGlobals() {
  const page = createContext({ console, crypto, TextEncoder, TextDecoder, atob, btoa });
  runInContext('globalThis.window = globalThis.self = globalThis;', page);
  return page;
}

async function runInABrowserBundle(source: string): Promise<unknown> {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [nodePolyfills(), probeEntry(source)],
    resolve: { tsconfigPaths: true },
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: PROBE, output: { format: 'iife' } },
    },
  })) as Rolldown.RolldownOutput;
  const page = aPageWithoutNodeGlobals();
  runInContext(result.output[0].code, page);
  return JSON.parse(JSON.stringify(runInContext('globalThis.probe', page)));
}

describe('the node polyfills in the browser bundle', () => {
  it('give code that uses Buffer as a global the Buffer class', async () => {
    const probe = await runInABrowserBundle(
      "globalThis.probe = { hex: Buffer.from('hi', 'utf8').toString('hex'), isBuffer: Buffer.isBuffer(Buffer.alloc(1)) };",
    );
    expect(probe).toEqual({ hex: '6869', isBuffer: true });
  });

  it('give code that uses process as a global the process object', async () => {
    const probe = await runInABrowserBundle('globalThis.probe = { nextTick: typeof process.nextTick };');
    expect(probe).toEqual({ nextTick: 'function' });
  });

  it('let the Keystone utilities reproduce their test vectors byte for byte', async () => {
    const probe = await runInABrowserBundle(KEYSTONE_PROBE);
    expect(probe).toEqual({
      ethRequest: [vectors.ETH_REQUEST_CBOR, vectors.ETH_REQUEST_UR],
      btcRequest: [vectors.BTC_REQUEST_CBOR, vectors.BTC_REQUEST_UR],
      ethSignature: vectors.ETH_SIGNATURE,
      btcSignature: vectors.BTC_SIGNATURE,
      account: { masterFingerprint: vectors.HARDHAT_MASTER_FINGERPRINT, addresses: [vectors.HARDHAT_ACCOUNT_0] },
    });
  });
});
