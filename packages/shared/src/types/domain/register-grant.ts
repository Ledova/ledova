import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterGrant = ApiSchema<'RegisterGrant'>;
export type RegisterGrantDecisionPreview = ApiSchema<'RegisterGrantDecisionPreview'>;
export type RegisterGrantPreparation = ApiRequest<'api_v1_tokens_register_grants_create'>;
export type RegisterGrantDecisionRequest = ApiRequest<'api_v1_tokens_register_grants_decision_preview_create'>;
export type RegisterGrantDecideRequest = ApiRequest<'api_v1_tokens_register_grants_decide_create'>;
export type RegisterGrantQueryParams = ApiQuery<'api_v1_tokens_register_grants_list'>;
