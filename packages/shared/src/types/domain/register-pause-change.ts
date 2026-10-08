import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterPauseChange = ApiSchema<'RegisterPauseChange'>;
export type RegisterPauseChangeSnapshot = ApiSchema<'RegisterPauseChangeSnapshot'>;
export type RegisterPauseChangeDecisionPreview = ApiSchema<'RegisterPauseChangeDecisionPreview'>;
export type RegisterPauseChangePreparation = ApiRequest<'api_v1_tokens_register_pause_changes_create'>;
export type RegisterPauseChangeDecisionRequest =
  ApiRequest<'api_v1_tokens_register_pause_changes_decision_preview_create'>;
export type RegisterPauseChangeDecideRequest = ApiRequest<'api_v1_tokens_register_pause_changes_decide_create'>;
export type RegisterPauseChangeQuery = ApiQuery<'api_v1_tokens_register_pause_changes_list'>;
