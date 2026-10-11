import { HOLDING_ASSET_TYPE, type HoldingWithWallet } from '../../src';
import { summarizeShareHoldings } from '../../src/utils/share-holdings';

function held(overrides: Partial<HoldingWithWallet> = {}): HoldingWithWallet {
  return {
    uuid: 'holding-1',
    assetUuid: 'asset-1',
    assetName: 'Registered asset',
    assetSymbol: 'ORD',
    quantity: '250.000000000000000000',
    chain: 'base',
    shareClass: { uuid: 'class-1', name: 'Ordinary shares', symbol: 'ORD', companyName: 'Fictional Company' },
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
});
