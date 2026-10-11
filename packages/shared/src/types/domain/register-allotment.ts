import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterAllotment = ApiSchema<'RegisterAllotment'>;
export type RegisterAllotmentDecisionPreview = ApiSchema<'RegisterAllotmentDecisionPreview'>;
export type RegisterAllotmentPreparation = ApiRequest<'api_v1_tokens_register_allotments_create'>;
export type RegisterAllotmentDecisionRequest = ApiRequest<'api_v1_tokens_register_allotments_decision_preview_create'>;
export type RegisterAllotmentDecideRequest = ApiRequest<'api_v1_tokens_register_allotments_decide_create'>;
export type RegisterAllotmentQueryParams = ApiQuery<'api_v1_tokens_register_allotments_list'>;
