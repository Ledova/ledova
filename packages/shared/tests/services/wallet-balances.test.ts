import type { AxiosInstance } from 'axios';
import { fetchBatchBalances, fetchImportBalances, getWalletHoldings } from '../../src/services/wallet-balances';
import type { DerivedAddress } from '../../src/types';
import { importAddressKey } from '../../src/utils/wallet-import';

describe('wallet balance services', () => {
  const get = jest.fn();
  const apiClient = { get } as unknown as AxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('gets wallet holdings without query parameters', () => {
    getWalletHoldings(apiClient, 'wallet-uuid');

    expect(get).toHaveBeenCalledWith('/api/wallets/wallet-uuid/holdings/');
  });
});

describe('import balance previews', () => {
  const post = jest.fn();
  const api = { post } as unknown as AxiosInstance;
  const address: DerivedAddress = {
    address: '0x' + 'a'.repeat(40),
    networkType: 'ETH',
    addressIndex: 0,
    derivationPath: "m/44'/60'/0'/0/0",
  };
  const base: DerivedAddress = { ...address, networkType: 'BASE' };

  beforeEach(() => post.mockReset());

  it('keeps the same EVM address separate on Ethereum and Base', async () => {
    post.mockImplementation(async (_url, body) => ({
      data: {
        chain: body.chain,
        balances: { [address.address]: body.chain === 'base' ? '5' : '2' },
      },
    }));
    const result = await fetchImportBalances(api, [address, base]);
    expect(post).toHaveBeenCalledWith('/api/wallets/batch-check-balances/', {
      chain: 'ethereum',
      addresses: [address.address],
    });
    expect(post).toHaveBeenCalledWith('/api/wallets/batch-check-balances/', {
      chain: 'base',
      addresses: [address.address],
    });
    expect(result.get(importAddressKey(address))).toBe('2 ETH');
    expect(result.get(importAddressKey(base))).toBe('5 ETH');
  });

  it('preserves an actual zero and labels an unavailable balance', async () => {
    post.mockImplementation(async (_url, body) => ({
      data: {
        chain: body.chain,
        balances: { [address.address]: body.chain === 'base' ? null : '0' },
      },
    }));
    const result = await fetchImportBalances(api, [address, base]);
    expect(result.get(importAddressKey(address))).toBe('0 ETH');
    expect(result.get(importAddressKey(base))).toBe('Unavailable');
  });

  it('does not invent a zero after a transport failure', async () => {
    post.mockRejectedValue(new Error('offline'));
    expect((await fetchImportBalances(api, [base])).get(importAddressKey(base))).toBe('Unavailable');
  });

  it('refuses a response for a network it did not ask about', async () => {
    post.mockResolvedValue({ data: { chain: 'ethereum', balances: { [address.address]: '50' } } });
    await expect(fetchBatchBalances(api, { chain: 'base', addresses: [address.address] })).rejects.toThrow(
      'does not match',
    );
  });

  it('splits imports into bounded requests without changing their network', async () => {
    const addresses = Array.from({ length: 21 }, (_, index) => ({
      ...base,
      address: `0x${index.toString(16).padStart(40, '0')}`,
    }));
    post.mockImplementation(async (_url, body) => ({
      data: {
        chain: body.chain,
        balances: Object.fromEntries(body.addresses.map((item: string) => [item, '1'])),
      },
    }));
    const result = await fetchImportBalances(api, addresses);
    expect(post.mock.calls.map(([, body]) => [body.chain, body.addresses.length])).toEqual([
      ['base', 20],
      ['base', 1],
    ]);
    expect([...result.values()]).toEqual(Array(21).fill('1 ETH'));
  });
});
