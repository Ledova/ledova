import type { ApiSchema, ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type TokenType = ApiSchema<'TokenTypeEnum'>;
export type CapitalIncreaseStatus = ApiSchema<'CapitalRequestStatusEnum'>;

export type CompanyShareToken = ApiResponse<'api_v1_tokens_retrieve'>;

export type TokenCreate = ApiRequest<'api_v1_tokens_create'>;

export type CompanyShareTokenListItem = ApiResponse<'api_v1_tokens_list'>['results'][number];

export type CompanyTokenActionResponse = ApiResponse<'api_v1_tokens_deploy_create'>;
export type PauseSubmissionRequest = ApiRequest<'api_v1_tokens_pause_create'>;
export type PauseSubmissionResponse = ApiResponse<'api_v1_tokens_pause_create'>;

export type TokenHoldersResponse = ApiResponse<'api_v1_tokens_holders_retrieve'>;

export type FormerMember = ApiSchema<'FormerMember'>;

export type TokenIssuance = ApiResponse<'api_v1_tokens_issuances_list'>['results'][number];

export type CapitalIncreaseRequest = ApiSchema<'CapitalIncreaseDetail'>;

export type CapitalIncreaseCreate = ApiRequest<'api_v1_tokens_capital_increases_create'>;

export type CapitalIncreaseListItem = ApiResponse<'api_v1_tokens_capital_increases_list'>['results'][number];

export type CapitalIncreaseSubmission = ApiResponse<'api_v1_tokens_capital_increases_submit_create'>;

export type ShareIssuanceRequest = ApiSchema<'ShareIssuanceRequest'>;

export type ShareIssuanceRequestQueryParams = ApiQuery<'api_v1_tokens_issuance_requests_list'>;

export type ShareIssuanceSubmission = ApiResponse<'api_v1_tokens_issue_create'>;
