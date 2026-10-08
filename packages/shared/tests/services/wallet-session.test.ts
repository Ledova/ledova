import axios from 'axios';
import {
  getWallets,
  createWallet,
  updateWallet,
  deleteWallet,
  syncWallet,
  requestVerificationChallenge,
  verifyWalletSignature,
} from '../../src';

it('preserves existing wallet calls and forwards optional transport guards on every ledger request', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} });
  const post = jest
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, syncResult: { status: 'success' } } });
  const patch = jest.spyOn(api, 'patch').mockResolvedValue({ data: {} });
  const remove = jest.spyOn(api, 'delete').mockResolvedValue({ data: {} });
  const input = { chain: 'base' as const, address: '0x' + 'a'.repeat(40) };
  const config = { timeout: 1000, headers: { 'X-Test': 'fictional' } };
  await getWallets(api);
  await getWallets(api, { page: 2 }, config);
  await createWallet(api, input);
  await createWallet(api, input, config);
  await updateWallet(api, 'wallet-a', { name: 'Fictional name' });
  await updateWallet(api, 'wallet-a', { name: 'Fictional name' }, config);
  await deleteWallet(api, 'wallet-a');
  await deleteWallet(api, 'wallet-a', config);
  await syncWallet(api, 'wallet-a');
  await syncWallet(api, 'wallet-a', config);
  await requestVerificationChallenge(api, 'wallet-a');
  await requestVerificationChallenge(api, 'wallet-a', config);
  await verifyWalletSignature(api, 'wallet-a', { signature: 'synthetic-proof' });
  await verifyWalletSignature(api, 'wallet-a', { signature: 'synthetic-proof' }, config);
  expect(get.mock.calls).toEqual([
    ['/api/wallets/', { params: undefined }],
    ['/api/wallets/', { ...config, params: { page: 2 } }],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/wallets/', input],
    ['/api/wallets/', input, config],
    ['/api/wallets/wallet-a/sync/', {}],
    ['/api/wallets/wallet-a/sync/', {}, config],
    ['/api/wallets/wallet-a/request-verification/', {}],
    ['/api/wallets/wallet-a/request-verification/', {}, config],
    ['/api/wallets/wallet-a/verify-signature/', { signature: 'synthetic-proof' }],
    ['/api/wallets/wallet-a/verify-signature/', { signature: 'synthetic-proof' }, config],
  ]);
  expect(patch.mock.calls).toEqual([
    ['/api/wallets/wallet-a/', { name: 'Fictional name' }],
    ['/api/wallets/wallet-a/', { name: 'Fictional name' }, config],
  ]);
  expect(remove.mock.calls).toEqual([['/api/wallets/wallet-a/'], ['/api/wallets/wallet-a/', config]]);
});
