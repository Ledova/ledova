import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { borrowedModule } from '../relative-imports.mjs';

const mobile = path.resolve(import.meta.dirname, '../..');
const repo = path.dirname(mobile);
const signer = path.join(mobile, 'src/utils/softwareWallet/localSigner.ts');

test('refuses a relative import that climbs out of mobile into the root node_modules', () => {
  assert.equal(
    borrowedModule(mobile, signer, '../../../../node_modules/ethers'),
    path.join(repo, 'node_modules/ethers'),
  );
});

test("refuses one into a workspace package's node_modules, from a test file as from app code", () => {
  const spec = path.join(mobile, 'src/services/swapSettlements.test.ts');
  assert.equal(
    borrowedModule(mobile, spec, '../../../packages/shared/node_modules/axios'),
    path.join(repo, 'packages/shared/node_modules/axios'),
  );
});

test('refuses an absolute path into a node_modules outside mobile', () => {
  const target = path.join(repo, 'node_modules/ethers/lib.commonjs/index.js');
  assert.equal(borrowedModule(mobile, signer, target), target);
});

test('allows relative imports that stay in mobile, including into its own node_modules', () => {
  for (const specifier of [
    './seedDerivation',
    '../../services/secureKeyStorage',
    '../../../node_modules/ethers',
    '../../../../mobile/node_modules/ethers',
  ])
    assert.equal(borrowedModule(mobile, signer, specifier), null, specifier);
});

test('allows relative imports out of mobile that reach no node_modules, such as the shared fixtures', () => {
  assert.equal(
    borrowedModule(mobile, signer, '../../../../packages/shared/tests/fixtures/local-signing-vectors.json'),
    null,
  );
});

test('leaves package names to the rest of check-resolution', () => {
  for (const specifier of ['ethers', '@ledova/shared', 'node:path', 'buffer'])
    assert.equal(borrowedModule(mobile, signer, specifier), null, specifier);
});

test('judges only the part of the path an import climbs, not where the repository sits', () => {
  const nested = path.join(path.sep, 'tmp', 'node_modules', 'ledova', 'mobile');
  const app = path.join(nested, 'src/App.tsx');
  assert.equal(borrowedModule(nested, app, '../../packages/shared/src/index.ts'), null);
  assert.equal(borrowedModule(nested, app, '../../node_modules/ethers'), path.join(nested, '../node_modules/ethers'));
});
