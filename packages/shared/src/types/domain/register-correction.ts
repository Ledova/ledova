import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterEntry = ApiSchema<'ShareRegisterEntry'>;
export type RegisterEntryChange = ApiSchema<'ShareRegisterEntryChange'>;
export type RegisterEntryKind = ApiSchema<'ShareRegisterEntryKindEnum'>;
export type RegisterEntryQueryParams = ApiQuery<'api_v1_tokens_register_entries_list'>;

export type RegisterCorrectionAuthority = ApiSchema<'RegisterCorrectionAuthorityEnum'>;
export type RegisterCorrectionChange = ApiSchema<'RegisterCorrectionChange'>;
export type RegisterCorrectionPreparation = ApiRequest<'api_v1_tokens_register_corrections_create'>;
export type RegisterCorrectionDecisionPreview = ApiSchema<'RegisterCorrectionDecisionPreview'>;
export type RegisterCorrectionDecisionRequest =
  ApiRequest<'api_v1_tokens_register_corrections_decision_preview_create'>;
export type RegisterCorrectionDecideRequest = ApiRequest<'api_v1_tokens_register_corrections_decide_create'>;
export type RegisterCorrectionQueryParams = ApiQuery<'api_v1_tokens_register_corrections_list'>;
export type RegisterCorrectionRecord = ApiSchema<'RegisterCorrection'>;

export type RegisterCorrection = Omit<RegisterCorrectionRecord, 'changes'> & {
  changes: RegisterCorrectionChange[];
};
