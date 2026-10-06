import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterOpeningHolders = ApiSchema<'RegisterOpeningHolders'>;
export type RegisterOpeningHolder = ApiSchema<'RegisterOpeningHolder'>;
export type RegisterOpeningBoundary = ApiSchema<'RegisterOpeningBoundary'>;
export type RegisterOpeningDecisionPreview = ApiSchema<'RegisterOpeningDecisionPreview'>;
export type RegisterOpeningDecisionRequest = ApiRequest<'api_v1_tokens_register_openings_decision_preview_create'>;
export type RegisterOpeningDecideRequest = ApiRequest<'api_v1_tokens_register_openings_decide_create'>;
export type RegisterOpeningQueryParams = ApiQuery<'api_v1_tokens_register_openings_list'>;
export type RegisterOpeningRecord = ApiSchema<'RegisterOpening'>;

export type RegisterOpeningLink = { address: string; member: string };

export type RegisterOpeningPreparation = Omit<ApiRequest<'api_v1_tokens_register_openings_create'>, 'mapping'> & {
  mapping: RegisterOpeningLink[];
};

export type RegisterOpening = Omit<RegisterOpeningRecord, 'mapping'> & {
  mapping: RegisterOpeningLink[];
};
