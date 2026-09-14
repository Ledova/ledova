import type { ApiSchema, ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type WalletSigningPreference = ApiSchema<'WalletSigningPreferenceEnum'>;

export type Wallet = ApiResponse<'api_wallets_retrieve'>;

export type WalletQueryParams = ApiQuery<'api_wallets_list'>;

export type CreateWallet = ApiRequest<'api_wallets_create'>;

export type WalletSyncResult = ApiSchema<'WalletSyncResult'>;

export type SyncWalletResponse = ApiResponse<'api_wallets_sync_create'>;
