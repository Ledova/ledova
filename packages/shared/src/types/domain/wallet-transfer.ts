import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type PrepareTransferRequest = Omit<ApiRequest<'api_wallets_prepare_transfer_create'>, 'amountBtc'>;

export type PrepareBitcoinTransferRequest = Required<
  Pick<ApiRequest<'api_wallets_prepare_transfer_create'>, 'toAddress' | 'amountBtc'>
>;

export type PrepareTransferResponse = ApiSchema<'PreparedEvmTransfer'>;

export type PreparedEvmTransaction = ApiSchema<'PreparedEvmTransaction'>;

export type PrepareBitcoinTransferResponse = ApiSchema<'PreparedBitcoinTransfer'>;

export type PreparedWalletTransfer = ApiResponse<'api_wallets_prepare_transfer_create'>;

export type BroadcastTransferRequest = ApiRequest<'api_wallets_broadcast_transfer_create'>;

export type BroadcastTransferResponse = ApiResponse<'api_wallets_broadcast_transfer_create'>;
