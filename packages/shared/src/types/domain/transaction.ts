import type { ApiSchema, ApiQuery } from '../contracts';

export type Transaction = ApiSchema<'Transaction'>;

export type TransactionQueryParams = ApiQuery<'api_transactions_list'>;
