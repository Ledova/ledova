import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterParticularsChange = ApiSchema<'RegisterParticularsChange'>;
export type RegisterParticularsChangeDecisionPreview = ApiSchema<'RegisterParticularsChangeDecisionPreview'>;
export type RegisterParticularsChangeDecisionRequest =
  ApiRequest<'api_v1_tokens_register_particulars_changes_decision_preview_create'>;
export type RegisterParticularsChangeDecideRequest =
  ApiRequest<'api_v1_tokens_register_particulars_changes_decide_create'>;
export type RegisterParticularsChangeQueryParams = ApiQuery<'api_v1_tokens_register_particulars_changes_list'>;
export type RegisterParticularsChangePreparation = ApiRequest<'api_v1_tokens_register_particulars_changes_create'>;
