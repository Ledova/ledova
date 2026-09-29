import { runInNewContext } from 'node:vm';
import { build, type Plugin, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';
import { nodePolyfills } from './vite.config';

const PROBE = 'node-globals-probe';

function probeEntry(source: string): Plugin {
  return {
    name: 'probe-entry',
    resolveId: (id) => (id === PROBE ? id : null),
    load: (id) => (id === PROBE ? source : null),
  };
}

async function runInABrowserBundle(source: string): Promise<unknown> {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [nodePolyfills(['buffer', 'process']), probeEntry(source)],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: PROBE, output: { format: 'iife' } },
    },
  })) as Rolldown.RolldownOutput;
  const page: { probe?: unknown } = {};
  runInNewContext(result.output[0].code, page);
  return JSON.parse(JSON.stringify(page.probe));
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
});
