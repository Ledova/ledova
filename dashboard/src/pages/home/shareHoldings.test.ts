import { describe, expect, it } from 'vitest';
import { HOLDING_ASSET_TYPE, type HoldingWithWallet } from '@ledova/shared';
import { summarizeShareHoldings } from './shareHoldings';

function held(overrides: Partial<HoldingWithWallet> = {}): HoldingWithWallet {
  return {
    uuid: 'holding-1',
    assetUuid: 'asset-1',
    assetName: 'Registered asset',
    assetSymbol: 'ORD',
    quantity: '250.000000000000000000',
    chain: 'base',
    shareClass: { uuid: 'class-1', name: 'Ordinary shares', companyName: 'Fictional Company' },
    marketValue: null,
    valueSource: 'unpriced',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    lastSyncedAt: null,
    walletAddress: '0x1111',
    walletUuid: 'wallet-1',
    walletInfo: { uuid: 'wallet-1', name: 'Primary', address: '0x1111', chain: 'ethereum' },
    asset: {
      uuid: 'asset-1',
      name: 'Registered asset',
      symbol: 'ORD',
      assetType: HOLDING_ASSET_TYPE.TOKENIZED_SECURITY,
      assetTypeDisplay: 'Tokenized security',
      chain: null,
      chainDeployments: [],
      contractAddress: null,
      currentPrice: null,
      isYieldToken: false,
      lastNavUpdate: null,
      navPerToken: null,
      valueSource: 'unpriced',
      createdAt: '2026-09-27T00:00:00Z',
      updatedAt: '2026-09-27T00:00:00Z',
    },
    ...overrides,
  };
}

describe('summarizeShareHoldings', () => {
  it('sums whole shares exactly across wallets and chains beyond the safe integer limit', () => {
    const holdings = [
      held({ quantity: '9007199254740993.000000000000000000' }),
      held({
        uuid: 'holding-2',
        quantity: '2',
        walletInfo: { uuid: 'wallet-2', name: 'Secondary', address: '0x2222', chain: 'base' },
      }),
      held({ uuid: 'holding-3', quantity: '0003.000', chain: '' }),
      held({ uuid: 'holding-4', quantity: '4' }),
    ];

    expect(summarizeShareHoldings(holdings)).toEqual([
      {
        assetUuid: 'asset-1',
        name: 'Ordinary shares',
        companyName: 'Fictional Company',
        quantity: '9007199254741002',
        chains: [
          {
            chain: 'base',
            quantity: '9007199254740999',
            wallets: [
              { uuid: 'wallet-1', name: 'Primary', address: '0x1111', quantity: '9007199254740997' },
              { uuid: 'wallet-2', name: 'Secondary', address: '0x2222', quantity: '2' },
            ],
          },
          {
            chain: 'ethereum',
            quantity: '3',
            wallets: [{ uuid: 'wallet-1', name: 'Primary', address: '0x1111', quantity: '3' }],
          },
        ],
      },
    ]);
  });

  it('keeps a share holding whose class is hidden or unmatched and whose price is unavailable', () => {
    const input = held({ shareClass: null, assetName: 'Unmatched ordinary shares' });

    expect(summarizeShareHoldings([input])).toEqual([
      {
        assetUuid: 'asset-1',
        name: 'Unmatched ordinary shares',
        companyName: null,
        quantity: '250',
        chains: [
          {
            chain: 'base',
            quantity: '250',
            wallets: [{ uuid: 'wallet-1', name: 'Primary', address: '0x1111', quantity: '250' }],
          },
        ],
      },
    ]);
  });

  it('prefers available class labels without losing the quantity of a hidden row', () => {
    const input = [held({ shareClass: null }), held({ quantity: '7' })];

    expect(summarizeShareHoldings(input)[0]).toMatchObject({
      name: 'Ordinary shares',
      companyName: 'Fictional Company',
      quantity: '257',
    });
    expect(summarizeShareHoldings([...input].reverse())).toEqual(summarizeShareHoldings(input));
  });

  it('excludes every non-security asset before examining its fractional quantity or class labels', () => {
    const input = Object.values(HOLDING_ASSET_TYPE)
      .filter((assetType) => assetType !== HOLDING_ASSET_TYPE.TOKENIZED_SECURITY)
      .map((assetType) => held({ quantity: '0.00000001', asset: { ...held().asset, assetType } }));

    expect(summarizeShareHoldings([...input, held()])).toEqual(summarizeShareHoldings([held()]));
  });

  it('keeps same-named assets separate by the required holding asset UUID', () => {
    const input = [held({ assetUuid: 'asset-b' }), held({ assetUuid: 'asset-a' })];

    expect(summarizeShareHoldings(input).map(({ assetUuid, quantity }) => ({ assetUuid, quantity }))).toEqual([
      { assetUuid: 'asset-a', quantity: '250' },
      { assetUuid: 'asset-b', quantity: '250' },
    ]);
    expect(() => summarizeShareHoldings([held({ assetUuid: '' })])).toThrow('identify an asset');
  });

  it('drops zero balances without adding empty asset, chain or wallet rows', () => {
    expect(summarizeShareHoldings([held({ quantity: '0' }), held({ quantity: '000.000' })])).toEqual([]);
    expect(summarizeShareHoldings([held({ quantity: '0', chain: 'ethereum' }), held()])).toEqual(
      summarizeShareHoldings([held()]),
    );
  });

  it.each(['1.1', '0.000000000000000001', '-1', '-0', '+1', '1e3', '1.', '.0', '', ' 1', '1 ', 'NaN'])(
    'refuses malformed or non-whole share quantity %j',
    (quantity) => {
      expect(() => summarizeShareHoldings([held({ quantity })])).toThrow('non-negative whole number');
    },
  );

  it('orders companies, names, assets and wallet identities deterministically without changing its input', () => {
    const input = [
      held({ assetUuid: 'asset-z', shareClass: { uuid: 'class-z', companyName: 'Zulu Company', name: 'A' } }),
      held({ assetUuid: 'asset-b', shareClass: { uuid: 'class-b', companyName: 'Alpha Company', name: 'B' } }),
      held({ assetUuid: 'asset-c', shareClass: { uuid: 'class-c', companyName: 'Alpha Company', name: 'A' } }),
      held({ assetUuid: 'asset-a', shareClass: { uuid: 'class-a', companyName: 'Alpha Company', name: 'A' } }),
      held({ walletInfo: { uuid: 'wallet-z', name: null, address: '0x3333', chain: 'base' } }),
      held({ walletInfo: { uuid: 'wallet-b', name: null, address: '0x1111', chain: 'base' } }),
      held({ walletInfo: { uuid: 'wallet-a', name: null, address: '0x1111', chain: 'base' } }),
    ];
    const original = structuredClone(input);
    const result = summarizeShareHoldings(input);

    expect(result.map(({ assetUuid }) => assetUuid)).toEqual(['asset-a', 'asset-c', 'asset-b', 'asset-1', 'asset-z']);
    expect(result[3].chains[0].wallets.map(({ uuid }) => uuid)).toEqual(['wallet-a', 'wallet-b', 'wallet-z']);
    expect(result[3].chains[0].wallets.every(({ name }) => name === undefined)).toBe(true);
    expect(summarizeShareHoldings([...input].reverse())).toEqual(result);
    expect(input).toEqual(original);
  });
});
