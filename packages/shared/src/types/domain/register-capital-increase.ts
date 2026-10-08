import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterCapitalIncrease = ApiSchema<'RegisterCapitalIncrease'>;
export type RegisterCapitalIncreaseSnapshot = ApiSchema<'RegisterCapitalIncreaseSnapshot'>;
export type RegisterCapitalIncreaseDecisionPreview = ApiSchema<'RegisterCapitalIncreaseDecisionPreview'>;
export type RegisterCapitalIncreasePreparation = ApiRequest<'api_v1_tokens_register_capital_increases_create'>;
export type RegisterCapitalIncreaseDecisionRequest =
  ApiRequest<'api_v1_tokens_register_capital_increases_decision_preview_create'>;
export type RegisterCapitalIncreaseDecideRequest = ApiRequest<'api_v1_tokens_register_capital_increases_decide_create'>;
export type RegisterCapitalIncreaseQuery = ApiQuery<'api_v1_tokens_register_capital_increases_list'>;
