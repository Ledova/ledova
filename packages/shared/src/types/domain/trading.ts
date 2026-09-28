import type { ApiSchema, ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type ShareToken = ApiResponse<'api_v1_trading_tokens_retrieve'>;

export type TransferOrder = ApiSchema<'TransferOrderList'>;

export type CreateOrderRequest = Omit<OrderSubmissionRequest, 'submissionId' | 'ownerAccountUuid'>;

export type OrderSubmissionRequest = ApiRequest<'api_v1_trading_orders_create_message_create'>;

export type OrderSubmissionSnapshot = ApiResponse<'api_v1_trading_orders_submissions_retrieve'>;

export type OrderBookEntry = ApiSchema<'OrderBookEntry'>;

export type OrderBook = ApiResponse<'api_v1_trading_tokens_order_book_retrieve'>;

export type GetOrdersParams = ApiQuery<'api_v1_trading_orders_list'>;

export type WhitelistStatusState = ApiSchema<'WhitelistStatusStatusEnum'>;

export type WhitelistStatus = ApiResponse<'api_v1_trading_whitelist_status_retrieve'>;

export type WalletTokenBalance = ApiSchema<'TradingWalletTokenBalance'>;

export type WalletTokenBalancesResponse = ApiResponse<'api_v1_trading_wallets_balances_retrieve'>;

export type SwapOrder = ApiSchema<'SwapOrderList'>;

export type EIP712Domain = ApiSchema<'SigningDomain'>;

export type CreateOrderMessageResponse = ApiSchema<'OrderCreateChallenge'>;

export type SignedCreateOrderRequest = ApiRequest<'api_v1_trading_orders_create_create'>;

export type ShareTokenTransferPrepareResponse = ApiResponse<'api_v1_trading_transfers_prepare_create'>;

export type ApprovalTransaction = ApiSchema<'ApprovalTransaction'>;
