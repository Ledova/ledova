import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterReconciliation = ApiSchema<'RegisterReconciliation'>;
export type RegisterReconciliationStatus = ApiSchema<'RegisterReconciliationStatusEnum'>;
export type RegisterDiscrepancy = ApiSchema<'RegisterDiscrepancy'>;
export type RegisterAcknowledgeRequest = ApiRequest<'api_v1_tokens_register_reconciliations_acknowledge_create'>;
export type RegisterReconciliationQueryParams = ApiQuery<'api_v1_tokens_register_reconciliations_list'>;
