import type { ApiResponse } from '../contracts';
export type WalletPreviewChain = BatchBalanceResponse['chain'];

export type BatchBalanceResponse = ApiResponse<'api_wallets_batch_check_balances_create'>;
