import type { Wallet } from './wallet';
import type { ApiResponse } from '../contracts';

import type { ValueSource } from './asset';

export type WalletHolding = ApiResponse<'api_wallets_holdings_list'>[number];

export interface WalletInfo {
  uuid: string;
  name: Wallet['name'];
  address: string;
  chain: string;
}

export interface HoldingWithWallet extends WalletHolding {
  walletInfo: WalletInfo;
}

export interface AssetTypeSummary {
  assetType: string;
  label: string;
  totalValue: number;
  holdingsCount: number;
}

export interface HoldingsSummary {
  totalValue: number;
  holdingsCount: number;
  walletsCount: number;
  byAssetType: AssetTypeSummary[];
}

export type AllocationBasis = 'value' | 'quantity' | 'unpriced';

export interface AssetChainSlice {
  chain: string;
  quantity: number;
  totalValue: number;
  priced: boolean;
}

export interface AssetAllocationItem {
  assetUuid: string;
  symbol: string;
  name: string;
  totalValue: number;
  percentage: number;
  basis: AllocationBasis;
  source: ValueSource;
  color: string;
  totalQuantity: number;
  perChain: AssetChainSlice[];
  navPerToken?: string | null;
}

export interface WalletTotals {
  btc: number;
  eth: number;
  base: number;
  btcMarketValue: number;
  ethMarketValue: number;
  baseMarketValue: number;
  btcTotalMarketValue: number;
  ethTotalMarketValue: number;
  baseTotalMarketValue: number;
}
