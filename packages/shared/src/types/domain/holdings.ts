import type { Wallet } from './wallet';
import type { ApiResponse } from '../contracts';

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
