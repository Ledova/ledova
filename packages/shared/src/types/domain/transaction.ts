import type { ApiResponse, ApiQuery } from '../contracts';

export type Transaction = ApiResponse<'api_transactions_retrieve'>;

export type TransactionQueryParams = ApiQuery<'api_transactions_list'>;
