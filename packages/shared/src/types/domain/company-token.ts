import type { ApiSchema, ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type TokenStatus = ApiSchema<'ShareTokenStatusEnum'>;
export type TokenType = ApiSchema<'TokenTypeEnum'>;
export type IssuanceStatus = ApiSchema<'ShareIssuanceListStatusEnum'>;
export type IssuanceType = ApiSchema<'IssuanceTypeEnum'>;
export type CapitalIncreaseStatus = ApiSchema<'CapitalRequestStatusEnum'>;
export type TokenTabType = 'overview' | 'shares' | 'shareholders' | 'issuances' | 'capital-increases';

export type CompanyShareToken = ApiResponse<'api_v1_tokens_retrieve'>;

export type TokenCreate = ApiRequest<'api_v1_tokens_create'>;

export type CompanyShareTokenListItem = ApiResponse<'api_v1_tokens_list'>['results'][number];

export type CompanyTokenActionResponse = ApiResponse<'api_v1_tokens_deploy_create'>;
export type PauseSubmissionRequest = ApiRequest<'api_v1_tokens_pause_create'>;
export type PauseSubmissionResponse = ApiResponse<'api_v1_tokens_pause_create'>;

export type TokenHolder = ApiSchema<'ShareRegisterHolder'>;

export type TokenHoldersResponse = ApiResponse<'api_v1_tokens_holders_retrieve'>;

export type FormerMember = ApiSchema<'FormerMember'>;

export type TokenIssuance = ApiResponse<'api_v1_tokens_issuances_list'>['results'][number];

export type CapitalIncreaseRequest = ApiResponse<'api_v1_tokens_capital_increases_retrieve'>;

export type CapitalIncreaseCreate = ApiRequest<'api_v1_tokens_capital_increases_create'>;

export type CapitalIncreaseListItem = ApiResponse<'api_v1_tokens_capital_increases_list'>['results'][number];

export type CapitalIncreaseSubmission = ApiResponse<'api_v1_tokens_capital_increases_submit_create'>;

export type ShareIssuanceRequest = ApiResponse<'api_v1_tokens_issuance_requests_retrieve'>;

export type ShareIssuanceRequestQueryParams = ApiQuery<'api_v1_tokens_issuance_requests_list'>;

export type ShareIssuanceSubmission = ApiResponse<'api_v1_tokens_issue_create'>;
