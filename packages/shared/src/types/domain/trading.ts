import type { ApiSchema, ApiResponse } from '../contracts';

export type WhitelistStatus = ApiResponse<'api_v1_trading_whitelist_status_retrieve'>;

export type WalletTokenBalance = ApiSchema<'TradingWalletTokenBalance'>;
