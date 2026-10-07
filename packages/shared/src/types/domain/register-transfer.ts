import type { ApiQuery, ApiRequest, ApiResponse, ApiSchema } from '../contracts';

export type RegisterTransfer = ApiSchema<'RegisterTransfer'>;
export type RegisterTransferDecisionPreview = ApiSchema<'RegisterTransferDecisionPreview'>;
export type RegisterTransferPreparation = ApiRequest<'api_v1_tokens_register_transfers_create'>;
export type RegisterTransferDecisionRequest = ApiRequest<'api_v1_tokens_register_transfers_decision_preview_create'>;
export type RegisterTransferDecideRequest = ApiRequest<'api_v1_tokens_register_transfers_decide_create'>;
export type RegisterTransferQueryParams = ApiQuery<'api_v1_tokens_register_transfers_list'>;
export type RegisterTransferMembers = ApiResponse<'api_v1_tokens_register_members_retrieve'>;
export type RegisterTransferMember = RegisterTransferMembers['members'][number];
