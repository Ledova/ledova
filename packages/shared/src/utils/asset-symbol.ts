import type { Transaction, WalletHolding } from '../types';

export function shownSymbol(asset: Pick<Transaction | WalletHolding, 'assetSymbol' | 'shareClass'>): string {
  return asset.shareClass?.symbol ?? asset.assetSymbol;
}
